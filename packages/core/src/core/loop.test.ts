import pino from 'pino';
import { lastValueFrom, type Observable, of, throwError, toArray } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as spans from '../observability/spans';
import type { LoopConfig, TurnContext } from '../types/core';
import type { ContextAnyEvent } from '../types/event';
import type { LLMProvider } from '../types/llm';
import type { LLMMessage } from '../types/message';
import * as iteration from './iteration';
import { runLoop } from './loop';

// Mock the 'pino' module using the shared manual mock
vi.mock('pino');

// Mock the span functions
vi.mock('../observability/spans', () => ({
  startAgentLoopSpan: vi.fn(() => ({
    span: {
      end: vi.fn(),
      setAttributes: vi.fn(),
      setStatus: vi.fn(),
      recordException: vi.fn(),
    },
    traceContext: {},
    // New API: provide tapFinish wrapper instead of setSuccess/setError
    tapFinish: (source: Observable<unknown>) => source,
  })),
}));

// Mock the iteration module
vi.mock('./iteration', () => ({
  runIteration: vi.fn((context) =>
    of({
      kind: 'content-complete',
      contextId: context.contextId,
      taskId: context.taskId,
      content: 'Test response',
      finishReason: 'stop',
      timestamp: new Date().toISOString(),
    } as ContextAnyEvent),
  ),
}));

describe('loop', () => {
  let mockContext: TurnContext<unknown>;
  let mockConfig: LoopConfig;
  let mockMessages: LLMMessage[];
  let mockLLMProvider: LLMProvider;

  beforeEach(() => {
    vi.clearAllMocks();

    mockLLMProvider = {
      call: vi.fn(),
    };

    mockContext = {
      agentId: 'agent-123',
      contextId: 'ctx-456',
      taskId: 'task-789',
      turnNumber: 1,
      plugins: [],
      logger: pino.pino(),
      parentContext: {} as import('@opentelemetry/api').Context,
    };

    mockConfig = {
      llmProvider: mockLLMProvider,
      maxIterations: 10,
      stopOnToolError: false,
    };

    mockMessages = [{ role: 'user', content: 'Hello, how are you?' }];
  });

  describe('runLoop', () => {
    it('should emit task-created event as first event', async () => {
      const events$ = runLoop(mockContext, mockConfig, mockMessages);
      const events = await lastValueFrom(events$.pipe(toArray()));

      expect(events[0]).toEqual({
        kind: 'task-created',
        contextId: 'ctx-456',
        taskId: 'task-789',
        initiator: 'user',
        timestamp: expect.any(String),
        metadata: {
          historyLength: 1,
        },
        parentTaskId: undefined,
      });
    });

    it('should emit task-status working event as second event', async () => {
      const events$ = runLoop(mockContext, mockConfig, mockMessages);
      const events = await lastValueFrom(events$.pipe(toArray()));

      expect(events[1]).toEqual({
        kind: 'task-status',
        contextId: 'ctx-456',
        taskId: 'task-789',
        status: 'working',
        message: undefined,
        timestamp: expect.any(String),
        metadata: {},
      });
    });

    it('should create OpenTelemetry span with correct parameters', async () => {
      const events$ = runLoop(mockContext, mockConfig, mockMessages);
      await lastValueFrom(events$.pipe(toArray()));

      expect(spans.startAgentLoopSpan).toHaveBeenCalledWith({
        agentId: 'agent-123',
        contextId: 'ctx-456',
        taskId: 'task-789',
        prompt: 'Hello, how are you?',
        parentContext: expect.any(Object),
      });
    });

    it('should extract prompt from last user message', async () => {
      const messagesWithHistory: LLMMessage[] = [
        { role: 'user', content: 'First message' },
        { role: 'assistant', content: 'First response' },
        { role: 'user', content: 'Second message' },
      ];

      const events$ = runLoop(mockContext, mockConfig, messagesWithHistory);
      await lastValueFrom(events$.pipe(toArray()));

      expect(spans.startAgentLoopSpan).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: 'Second message',
        }),
      );
    });

    it('should handle empty prompt when no user messages', async () => {
      const noUserMessages: LLMMessage[] = [
        { role: 'assistant', content: 'Only assistant message' },
      ];

      const events$ = runLoop(mockContext, mockConfig, noUserMessages);
      await lastValueFrom(events$.pipe(toArray()));

      expect(spans.startAgentLoopSpan).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: '',
        }),
      );
    });

    it('should call runIteration with initial state', async () => {
      const events$ = runLoop(mockContext, mockConfig, mockMessages);
      await lastValueFrom(events$.pipe(toArray()));

      expect(iteration.runIteration).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: 'agent-123',
          contextId: 'ctx-456',
          taskId: 'task-789',
          turnNumber: 1,
          parentContext: expect.any(Object), // loop context
        }),
        {
          llmProvider: mockLLMProvider,
          iterationNumber: 0,
        },
        mockMessages,
      );
    });

    it('should stop after single iteration when LLM finishes with stop reason', async () => {
      vi.mocked(iteration.runIteration).mockReturnValue(
        of({
          kind: 'content-complete',
          contextId: 'ctx-456',
          taskId: 'task-789',
          content: 'Final response',
          finishReason: 'stop',
          timestamp: new Date().toISOString(),
        } as ContextAnyEvent),
      );

      const events$ = runLoop(mockContext, mockConfig, mockMessages);
      await lastValueFrom(events$.pipe(toArray()));

      // Should only call iteration once (iteration 0)
      expect(iteration.runIteration).toHaveBeenCalledTimes(1);
      expect(iteration.runIteration).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ iterationNumber: 0 }),
        expect.any(Array),
      );
    });

    it('should continue iterations when LLM requests tool calls', async () => {
      let callCount = 0;
      vi.mocked(iteration.runIteration).mockImplementation(() => {
        callCount++;

        if (callCount === 1) {
          // First iteration: LLM requests tool
          return of(
            {
              kind: 'tool-call',
              contextId: 'ctx-456',
              taskId: 'task-789',
              toolCallId: 'call-1',
              toolName: 'search',
              arguments: { q: 'test' },
              timestamp: new Date().toISOString(),
            } as ContextAnyEvent,
            {
              kind: 'tool-complete',
              contextId: 'ctx-456',
              taskId: 'task-789',
              toolCallId: 'call-1',
              toolName: 'search',
              success: true,
              result: { items: ['result1'] },
              timestamp: new Date().toISOString(),
            } as ContextAnyEvent,
            {
              kind: 'content-complete',
              contextId: 'ctx-456',
              taskId: 'task-789',
              content: '',
              finishReason: 'tool_calls',
              timestamp: new Date().toISOString(),
            } as ContextAnyEvent,
          );
        } else {
          // Second iteration: LLM finishes
          return of({
            kind: 'content-complete',
            contextId: 'ctx-456',
            taskId: 'task-789',
            content: 'Final answer',
            finishReason: 'stop',
            timestamp: new Date().toISOString(),
          } as ContextAnyEvent);
        }
      });

      const events$ = runLoop(mockContext, mockConfig, mockMessages);
      await lastValueFrom(events$.pipe(toArray()));

      // Should call iteration twice (iteration 0 and 1)
      expect(iteration.runIteration).toHaveBeenCalledTimes(2);
      expect(iteration.runIteration).toHaveBeenNthCalledWith(
        1,
        expect.any(Object),
        expect.objectContaining({ iterationNumber: 0 }),
        expect.any(Array),
      );
      expect(iteration.runIteration).toHaveBeenNthCalledWith(
        2,
        expect.any(Object),
        expect.objectContaining({ iterationNumber: 1 }),
        expect.any(Array),
      );
    });

    it('should add tool results to messages for next iteration', async () => {
      let callCount = 0;
      vi.mocked(iteration.runIteration).mockImplementation(() => {
        callCount++;

        if (callCount === 1) {
          return of(
            {
              kind: 'tool-call',
              contextId: 'ctx-456',
              taskId: 'task-789',
              toolCallId: 'call-1',
              toolName: 'calculate',
              arguments: { x: 5, y: 3 },
              timestamp: new Date().toISOString(),
            } as ContextAnyEvent,
            {
              kind: 'content-complete',
              contextId: 'ctx-456',
              taskId: 'task-789',
              content: '',
              finishReason: 'tool_calls',
              toolCalls: [
                {
                  id: 'call-1',
                  type: 'function',
                  function: {
                    name: 'calculate',
                    arguments: { x: 5, y: 3 },
                  },
                },
              ],
              timestamp: new Date().toISOString(),
            } as ContextAnyEvent,
            {
              kind: 'tool-complete',
              contextId: 'ctx-456',
              taskId: 'task-789',
              toolCallId: 'call-1',
              toolName: 'calculate',
              success: true,
              result: 8,
              timestamp: new Date().toISOString(),
            } as ContextAnyEvent,
          );
        } else {
          return of({
            kind: 'content-complete',
            contextId: 'ctx-456',
            taskId: 'task-789',
            content: 'Result is 8',
            finishReason: 'stop',
            timestamp: new Date().toISOString(),
          } as ContextAnyEvent);
        }
      });

      const events$ = runLoop(mockContext, mockConfig, mockMessages);
      await lastValueFrom(events$.pipe(toArray()));

      // Check second iteration received updated messages
      const secondCallMessages = vi.mocked(iteration.runIteration).mock.calls[1][2];

      // Should have original message plus assistant message (from tool-call) and tool result
      // Note: content-complete with empty content doesn't create an assistant message
      expect(secondCallMessages).toHaveLength(3);
      expect(secondCallMessages[0]).toEqual({ role: 'user', content: 'Hello, how are you?' });
      // Assistant message from tool-call event
      expect(secondCallMessages[1]).toMatchObject({
        role: 'assistant',
        content: '',
        toolCalls: expect.arrayContaining([
          expect.objectContaining({
            id: 'call-1',
            type: 'function',
            function: expect.objectContaining({
              name: 'calculate',
              arguments: { x: 5, y: 3 },
            }),
          }),
        ]),
      });
      // Tool result message
      expect(secondCallMessages[2]).toEqual({
        role: 'tool',
        name: 'calculate',
        content: '8',
        toolCallId: 'call-1',
      });
    });

    it('should not add child task content to messages for next iteration', async () => {
      let callCount = 0;
      vi.mocked(iteration.runIteration).mockImplementation(() => {
        callCount++;

        if (callCount === 1) {
          return of(
            {
              kind: 'content-complete',
              contextId: 'ctx-456',
              taskId: 'task-789',
              content: '',
              finishReason: 'tool_calls',
              toolCalls: [
                {
                  id: 'call-1',
                  type: 'function',
                  function: {
                    name: 'delegate',
                    arguments: {},
                  },
                },
              ],
              timestamp: new Date().toISOString(),
            } as ContextAnyEvent,
            {
              kind: 'tool-complete',
              contextId: 'ctx-456',
              taskId: 'task-789',
              toolCallId: 'call-1',
              toolName: 'delegate',
              success: true,
              result: 'delegated result',
              timestamp: new Date().toISOString(),
            } as ContextAnyEvent,
            {
              kind: 'content-complete',
              contextId: 'child-ctx',
              taskId: 'child-task',
              parentTaskId: 'task-789',
              content: 'child agent output',
              finishReason: 'stop',
              timestamp: new Date().toISOString(),
            } as ContextAnyEvent,
          );
        }

        return of({
          kind: 'content-complete',
          contextId: 'ctx-456',
          taskId: 'task-789',
          content: 'Final response',
          finishReason: 'stop',
          timestamp: new Date().toISOString(),
        } as ContextAnyEvent);
      });

      const events$ = runLoop(mockContext, mockConfig, mockMessages);
      await lastValueFrom(events$.pipe(toArray()));

      const secondCallMessages = vi.mocked(iteration.runIteration).mock.calls[1][2];

      expect(secondCallMessages).toHaveLength(3);
      expect(secondCallMessages[0]).toEqual(mockMessages[0]);
      expect(secondCallMessages[1]).toEqual({
        role: 'assistant',
        content: '',
        toolCalls: expect.arrayContaining([
          expect.objectContaining({
            id: 'call-1',
            function: expect.objectContaining({ name: 'delegate' }),
          }),
        ]),
      });
      expect(secondCallMessages[2]).toEqual({
        role: 'tool',
        name: 'delegate',
        content: '"delegated result"',
        toolCallId: 'call-1',
      });
      expect(
        secondCallMessages.some(
          (message) => message.role === 'assistant' && message.content === 'child agent output',
        ),
      ).toBe(false);
    });

    it('should emit all iteration events in output stream', async () => {
      vi.mocked(iteration.runIteration).mockReturnValue(
        of(
          {
            kind: 'content-delta',
            contextId: 'ctx-456',
            taskId: 'task-789',
            delta: 'Hello',
            timestamp: new Date().toISOString(),
          } as ContextAnyEvent,
          {
            kind: 'content-delta',
            contextId: 'ctx-456',
            taskId: 'task-789',
            delta: ' world',
            timestamp: new Date().toISOString(),
          } as ContextAnyEvent,
          {
            kind: 'content-complete',
            contextId: 'ctx-456',
            taskId: 'task-789',
            content: 'Hello world',
            finishReason: 'stop',
            timestamp: new Date().toISOString(),
          } as ContextAnyEvent,
        ),
      );

      const events$ = runLoop(mockContext, mockConfig, mockMessages);
      const events = await lastValueFrom(events$.pipe(toArray()));

      // Should have: task-created, task-status, content-delta, content-delta, content-complete, task-complete
      expect(events).toHaveLength(6);
      expect(events[2].kind).toBe('content-delta');
      expect(events[3].kind).toBe('content-delta');
      expect(events[4].kind).toBe('content-complete');
      expect(events[5].kind).toBe('task-complete');
    });

    it('should finalize span when stream completes', async () => {
      const mockTapFinish = vi.fn((source: Observable<ContextAnyEvent>) => source);

      vi.mocked(spans.startAgentLoopSpan).mockReturnValue({
        span: {
          end: vi.fn(),
          setAttributes: vi.fn(),
          setStatus: vi.fn(),
          recordException: vi.fn(),
        } as unknown as import('@opentelemetry/api').Span,
        traceContext: {} as import('@opentelemetry/api').Context,
        tapFinish: mockTapFinish,
      });

      const events$ = runLoop(mockContext, mockConfig, mockMessages);
      await lastValueFrom(events$.pipe(toArray()));

      expect(mockTapFinish).toHaveBeenCalled();
    });

    it('should handle tool execution errors', async () => {
      let callCount = 0;
      vi.mocked(iteration.runIteration).mockImplementation(() => {
        callCount++;

        if (callCount === 1) {
          return of(
            {
              kind: 'tool-call',
              contextId: 'ctx-456',
              taskId: 'task-789',
              toolCallId: 'call-1',
              toolName: 'broken_tool',
              arguments: {},
              timestamp: new Date().toISOString(),
            } as ContextAnyEvent,
            {
              kind: 'tool-complete',
              contextId: 'ctx-456',
              taskId: 'task-789',
              toolCallId: 'call-1',
              toolName: 'broken_tool',
              success: false,
              result: null,
              error: 'Tool execution failed',
              timestamp: new Date().toISOString(),
            } as ContextAnyEvent,
            {
              kind: 'content-complete',
              contextId: 'ctx-456',
              taskId: 'task-789',
              content: '',
              finishReason: 'tool_calls',
              timestamp: new Date().toISOString(),
            } as ContextAnyEvent,
          );
        } else {
          return of({
            kind: 'content-complete',
            contextId: 'ctx-456',
            taskId: 'task-789',
            content: 'Tool failed but continuing',
            finishReason: 'stop',
            timestamp: new Date().toISOString(),
          } as ContextAnyEvent);
        }
      });

      const events$ = runLoop(mockContext, mockConfig, mockMessages);
      await lastValueFrom(events$.pipe(toArray()));

      const secondCallMessages = vi.mocked(iteration.runIteration).mock.calls[1][2];
      const toolMessage = secondCallMessages.find((m) => m.role === 'tool');

      expect(toolMessage).toEqual(
        expect.objectContaining({
          role: 'tool',
          name: 'broken_tool',
          content: 'Tool execution failed',
          toolCallId: 'call-1',
        }),
      );
    });

    it('should ignore content-delta events when converting to messages', async () => {
      let callCount = 0;
      vi.mocked(iteration.runIteration).mockImplementation(() => {
        callCount++;

        if (callCount === 1) {
          return of(
            {
              kind: 'content-delta',
              contextId: 'ctx-456',
              taskId: 'task-789',
              delta: 'Streaming',
              timestamp: new Date().toISOString(),
            } as ContextAnyEvent,
            {
              kind: 'content-delta',
              contextId: 'ctx-456',
              taskId: 'task-789',
              delta: ' response',
              timestamp: new Date().toISOString(),
            } as ContextAnyEvent,
            {
              kind: 'content-complete',
              contextId: 'ctx-456',
              taskId: 'task-789',
              content: 'Streaming response',
              finishReason: 'stop',
              timestamp: new Date().toISOString(),
            } as ContextAnyEvent,
          );
        } else {
          return of({
            kind: 'content-complete',
            contextId: 'ctx-456',
            taskId: 'task-789',
            content: 'Should not reach here',
            finishReason: 'stop',
            timestamp: new Date().toISOString(),
          } as ContextAnyEvent);
        }
      });

      const events$ = runLoop(mockContext, mockConfig, mockMessages);
      await lastValueFrom(events$.pipe(toArray()));

      // Should only call iteration once (content-complete with stop finishes loop)
      expect(iteration.runIteration).toHaveBeenCalledTimes(1);
    });

    it('should convert content-complete to assistant message', async () => {
      let callCount = 0;
      vi.mocked(iteration.runIteration).mockImplementation(() => {
        callCount++;

        if (callCount === 1) {
          return of({
            kind: 'content-complete',
            contextId: 'ctx-456',
            taskId: 'task-789',
            content: 'Intermediate response',
            finishReason: 'tool_calls',
            timestamp: new Date().toISOString(),
          } as ContextAnyEvent);
        } else {
          return of({
            kind: 'content-complete',
            contextId: 'ctx-456',
            taskId: 'task-789',
            content: 'Final response',
            finishReason: 'stop',
            timestamp: new Date().toISOString(),
          } as ContextAnyEvent);
        }
      });

      const events$ = runLoop(mockContext, mockConfig, mockMessages);
      await lastValueFrom(events$.pipe(toArray()));

      const secondCallMessages = vi.mocked(iteration.runIteration).mock.calls[1][2];
      const assistantMessage = secondCallMessages.find((m) => m.role === 'assistant');

      expect(assistantMessage).toEqual({
        role: 'assistant',
        content: 'Intermediate response',
      });
    });

    it('should handle empty messages array', async () => {
      const events$ = runLoop(mockContext, mockConfig, []);
      await lastValueFrom(events$.pipe(toArray()));

      expect(iteration.runIteration).toHaveBeenCalledWith(
        expect.any(Object),
        expect.any(Object),
        [],
      );

      expect(spans.startAgentLoopSpan).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: '',
        }),
      );
    });

    it('should propagate loop context to iterations', async () => {
      const events$ = runLoop(mockContext, mockConfig, mockMessages);
      await lastValueFrom(events$.pipe(toArray()));

      // Check that iteration received loop's trace context as parent
      expect(iteration.runIteration).toHaveBeenCalledWith(
        expect.objectContaining({
          parentContext: expect.any(Object), // This should be the loop's traceContext
        }),
        expect.any(Object),
        expect.any(Array),
      );
    });

    it('should maintain message order across iterations', async () => {
      let callCount = 0;
      vi.mocked(iteration.runIteration).mockImplementation(() => {
        callCount++;

        if (callCount === 1) {
          return of({
            kind: 'content-complete',
            contextId: 'ctx-456',
            taskId: 'task-789',
            content: '',
            finishReason: 'tool_calls',
            toolCalls: [
              {
                id: 'call-1',
                type: 'function',
                function: {
                  name: 'calculate',
                  arguments: { x: 5, y: 3 },
                },
              },
            ],
            timestamp: new Date().toISOString(),
          } as ContextAnyEvent);
        } else if (callCount === 2) {
          return of(
            {
              kind: 'tool-call',
              contextId: 'ctx-456',
              taskId: 'task-789',
              toolCallId: 'call-1',
              toolName: 'test',
              arguments: {},
              timestamp: new Date().toISOString(),
            } as ContextAnyEvent,
            {
              kind: 'tool-complete',
              contextId: 'ctx-456',
              taskId: 'task-789',
              toolCallId: 'call-1',
              toolName: 'test',
              success: true,
              result: 'result',
              timestamp: new Date().toISOString(),
            } as ContextAnyEvent,
            {
              kind: 'content-complete',
              contextId: 'ctx-456',
              taskId: 'task-789',
              content: '',
              finishReason: 'tool_calls',
              timestamp: new Date().toISOString(),
            } as ContextAnyEvent,
          );
        } else {
          return of({
            kind: 'content-complete',
            contextId: 'ctx-456',
            taskId: 'task-789',
            content: 'Final response',
            finishReason: 'stop',
            timestamp: new Date().toISOString(),
          } as ContextAnyEvent);
        }
      });

      const events$ = runLoop(mockContext, mockConfig, mockMessages);
      await lastValueFrom(events$.pipe(toArray()));

      const thirdCallMessages = vi.mocked(iteration.runIteration).mock.calls[2][2];

      // Messages should be in order: user, assistant (1st), assistant (2nd tool call), tool
      expect(thirdCallMessages[0].role).toBe('user');
      expect(thirdCallMessages[1]).toEqual({
        role: 'assistant',
        content: '',
        toolCalls: expect.arrayContaining([
          expect.objectContaining({
            id: 'call-1',
            type: 'function',
            function: expect.objectContaining({
              name: 'calculate',
              arguments: { x: 5, y: 3 },
            }),
          }),
        ]),
      });
      expect(thirdCallMessages[2].role).toBe('tool');
    });

    it('should handle tool-complete without error field', async () => {
      let callCount = 0;
      vi.mocked(iteration.runIteration).mockImplementation(() => {
        callCount++;

        if (callCount === 1) {
          return of(
            {
              kind: 'tool-call',
              contextId: 'ctx-456',
              taskId: 'task-789',
              toolCallId: 'call-1',
              toolName: 'test',
              arguments: {},
              timestamp: new Date().toISOString(),
            } as ContextAnyEvent,
            {
              kind: 'tool-complete',
              contextId: 'ctx-456',
              taskId: 'task-789',
              toolCallId: 'call-1',
              toolName: 'test',
              success: false,
              result: null,
              // No error field
              timestamp: new Date().toISOString(),
            } as ContextAnyEvent,
            {
              kind: 'content-complete',
              contextId: 'ctx-456',
              taskId: 'task-789',
              content: '',
              finishReason: 'tool_calls',
              timestamp: new Date().toISOString(),
            } as ContextAnyEvent,
          );
        } else {
          return of({
            kind: 'content-complete',
            contextId: 'ctx-456',
            taskId: 'task-789',
            content: 'Handled gracefully',
            finishReason: 'stop',
            timestamp: new Date().toISOString(),
          } as ContextAnyEvent);
        }
      });

      const events$ = runLoop(mockContext, mockConfig, mockMessages);
      await lastValueFrom(events$.pipe(toArray()));

      const secondCallMessages = vi.mocked(iteration.runIteration).mock.calls[1][2];
      const toolMessage = secondCallMessages.find((m) => m.role === 'tool');

      expect(toolMessage).toEqual(
        expect.objectContaining({
          content: 'Error executing tool',
        }),
      );
    });

    it('should finalize span even if error occurs', async () => {
      const mockTapFinish = vi.fn((source: Observable<ContextAnyEvent>) => source);

      vi.mocked(spans.startAgentLoopSpan).mockReturnValue({
        span: {
          end: vi.fn(),
          setAttributes: vi.fn(),
          setStatus: vi.fn(),
          recordException: vi.fn(),
        } as unknown as import('@opentelemetry/api').Span,
        traceContext: {} as import('@opentelemetry/api').Context,
        tapFinish: mockTapFinish,
      });

      vi.mocked(iteration.runIteration).mockReturnValue(
        throwError(() => new Error('Iteration error')),
      );

      const events$ = runLoop(mockContext, mockConfig, mockMessages);

      await expect(lastValueFrom(events$.pipe(toArray()))).rejects.toThrow('Iteration error');

      expect(mockTapFinish).toHaveBeenCalled();
    });
  });
});
