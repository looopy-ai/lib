import type pino from 'pino';
import { lastValueFrom, of, throwError, toArray } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LLMProvider } from '../core/types';
import type { AnyEvent } from '../events/types';
import * as spans from '../observability/spans';
import type { ToolProvider } from '../tools/interfaces';
import { runIteration } from './iteration';
import * as tools from './tools';
import type { IterationConfig, LoopContext, Message } from './types';

// Mock the span functions
vi.mock('../observability/spans', () => ({
  startLoopIterationSpan: vi.fn(() => ({
    span: {
      end: vi.fn(),
      setAttribute: vi.fn(),
      setAttributes: vi.fn(),
      setStatus: vi.fn(),
      recordException: vi.fn(),
    },
    traceContext: {},
    tapFinish: <T>(source: T) => source, // Pass-through operator
  })),
  startLLMCallSpan: vi.fn(() => ({
    span: {
      end: vi.fn(),
      setAttribute: vi.fn(),
      setAttributes: vi.fn(),
      setStatus: vi.fn(),
      recordException: vi.fn(),
    },
    traceContext: {},
    tapFinish: <T>(source: T) => source, // Pass-through operator
  })),
}));

// Mock the tools module
vi.mock('./tools', () => ({
  runToolCall: vi.fn((context, event) =>
    of({
      kind: 'tool-complete',
      contextId: context.contextId,
      taskId: context.taskId,
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      success: true,
      result: 'mocked tool result',
      timestamp: new Date().toISOString(),
    }),
  ),
}));

describe('iteration', () => {
  let mockContext: LoopContext;
  let mockConfig: IterationConfig;
  let mockHistory: Message[];
  let mockLLMProvider: LLMProvider;

  beforeEach(() => {
    vi.clearAllMocks();

    mockLLMProvider = {
      call: vi.fn(() =>
        of({
          kind: 'content-complete',
          content: 'Test response',
          timestamp: new Date().toISOString(),
        } as AnyEvent),
      ),
    };

    mockContext = {
      agentId: 'agent-123',
      contextId: 'ctx-456',
      taskId: 'task-789',
      turnNumber: 1,
      systemPrompt: 'You are a test assistant',
      toolProviders: [],
      logger: {
        trace: vi.fn(),
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      } as unknown as pino.Logger,
      parentContext: {} as import('@opentelemetry/api').Context,
    };

    mockConfig = {
      iterationNumber: 1,
      llmProvider: mockLLMProvider,
    };

    mockHistory = [{ role: 'user', content: 'Hello, how are you?' }];
  });

  describe('runIteration', () => {
    it('should log iteration start with context', async () => {
      const events$ = runIteration(mockContext, mockConfig, mockHistory);
      await lastValueFrom(events$.pipe(toArray()));

      expect(mockContext.logger.info).toHaveBeenCalledWith(
        {
          taskId: 'task-789',
          iteration: 1,
          history: mockHistory,
        },
        'Starting iteration',
      );
    });

    it('should create OpenTelemetry span with correct parameters', async () => {
      const events$ = runIteration(mockContext, mockConfig, mockHistory);
      await lastValueFrom(events$.pipe(toArray()));

      expect(spans.startLoopIterationSpan).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: 'agent-123',
          contextId: 'ctx-456',
          taskId: 'task-789',
          parentContext: expect.any(Object),
        }),
        1, // iteration number as second parameter
      );
    });

    it('should call LLM provider with prepared messages and tools', async () => {
      const mockTool = {
        name: 'test_tool',
        description: 'A test tool',
        parameters: {
          type: 'object' as const,
          properties: {},
        },
      };

      const mockToolProvider: ToolProvider = {
        canHandle: vi.fn(() => true),
        execute: vi.fn(),
        getTools: vi.fn(async () => [mockTool]),
      };

      mockContext.toolProviders = [mockToolProvider];

      const events$ = runIteration(mockContext, mockConfig, mockHistory);
      await lastValueFrom(events$.pipe(toArray()));

      expect(mockLLMProvider.call).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [
            {
              role: 'system',
              content: 'You are a test assistant',
              name: 'system-prompt',
            },
            { role: 'user', content: 'Hello, how are you?' },
          ],
          tools: [mockTool],
          stream: true,
          sessionId: 'task-789',
        }),
      );
    });

    it('should add system prompt to messages when present', async () => {
      mockContext.systemPrompt = 'Custom system prompt';

      const events$ = runIteration(mockContext, mockConfig, mockHistory);
      await lastValueFrom(events$.pipe(toArray()));

      expect(mockLLMProvider.call).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            {
              role: 'system',
              content: 'Custom system prompt',
              name: 'system-prompt',
            },
          ]),
        }),
      );
    });

    it('should add skill prompts to messages when present', async () => {
      mockContext.skillPrompts = {
        'code-generation': 'You can write Python code',
        'data-analysis': 'You can analyze data',
      };

      const events$ = runIteration(mockContext, mockConfig, mockHistory);
      await lastValueFrom(events$.pipe(toArray()));

      expect(mockLLMProvider.call).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            {
              role: 'system',
              content: 'You can write Python code',
              name: 'code-generation',
            },
            {
              role: 'system',
              content: 'You can analyze data',
              name: 'data-analysis',
            },
          ]),
        }),
      );
    });

    it('should work without system prompt', async () => {
      delete mockContext.systemPrompt;

      const events$ = runIteration(mockContext, mockConfig, mockHistory);
      await lastValueFrom(events$.pipe(toArray()));

      const callArgs = vi.mocked(mockLLMProvider.call).mock.calls[0][0];
      expect(callArgs.messages).not.toContainEqual(
        expect.objectContaining({
          name: 'system-prompt',
        }),
      );
    });

    it('should work without skill prompts', async () => {
      delete mockContext.skillPrompts;

      const events$ = runIteration(mockContext, mockConfig, mockHistory);
      await lastValueFrom(events$.pipe(toArray()));

      const callArgs = vi.mocked(mockLLMProvider.call).mock.calls[0][0];
      const skillPromptMessages = callArgs.messages.filter(
        (m: Message) => m.role === 'system' && m.name !== 'system-prompt',
      );
      expect(skillPromptMessages).toHaveLength(0);
    });

    it('should emit LLM events with contextId and taskId stamped', async () => {
      vi.mocked(mockLLMProvider.call).mockReturnValue(
        of({
          kind: 'content-delta',
          delta: 'Hello',
          timestamp: new Date().toISOString(),
        } as AnyEvent),
      );

      const events$ = runIteration(mockContext, mockConfig, mockHistory);
      const events = await lastValueFrom(events$.pipe(toArray()));

      expect(events[0]).toEqual(
        expect.objectContaining({
          contextId: 'ctx-456',
          taskId: 'task-789',
          kind: 'content-delta',
          delta: 'Hello',
        }),
      );
    });

    it('should execute tools when LLM emits tool-call events', async () => {
      const toolCallEvent = {
        kind: 'tool-call',
        contextId: 'ctx-456',
        taskId: 'task-789',
        toolCallId: 'call-123',
        toolName: 'test_tool',
        arguments: { param: 'value' },
        timestamp: new Date().toISOString(),
      };

      vi.mocked(mockLLMProvider.call).mockReturnValue(of(toolCallEvent as unknown as AnyEvent));

      const events$ = runIteration(mockContext, mockConfig, mockHistory);
      await lastValueFrom(events$.pipe(toArray()));

      expect(tools.runToolCall).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: 'agent-123',
          contextId: 'ctx-456',
          taskId: 'task-789',
          parentContext: expect.any(Object), // iteration context
        }),
        expect.objectContaining({
          kind: 'tool-call',
          contextId: 'ctx-456',
          taskId: 'task-789',
          toolCallId: 'call-123',
          toolName: 'test_tool',
        }),
      );
    });

    it('should emit tool events after LLM events', async () => {
      const llmEvent1 = {
        kind: 'content-delta',
        delta: 'Calling tool',
        timestamp: new Date().toISOString(),
      };

      const toolCallEvent = {
        kind: 'tool-call',
        toolCallId: 'call-123',
        toolName: 'test_tool',
        arguments: {},
        timestamp: new Date().toISOString(),
      };

      const llmEvent2 = {
        kind: 'content-complete',
        content: 'Done',
        timestamp: new Date().toISOString(),
      };

      vi.mocked(mockLLMProvider.call).mockReturnValue(
        of(llmEvent1 as AnyEvent, toolCallEvent as AnyEvent, llmEvent2 as AnyEvent),
      );

      const events$ = runIteration(mockContext, mockConfig, mockHistory);
      const events = await lastValueFrom(events$.pipe(toArray()));

      // LLM events come first (including tool-call), then tool execution events
      expect(events.length).toBeGreaterThan(3);
      expect(events[0].kind).toBe('content-delta');
      expect(events[1].kind).toBe('tool-call');
      expect(events[2].kind).toBe('content-complete');
      // Tool execution events come after
      const toolCompleteEvent = events.find((e) => e.kind === 'tool-complete');
      expect(toolCompleteEvent).toBeDefined();
    });

    it('should handle multiple tool calls', async () => {
      const toolCall1 = {
        kind: 'tool-call',
        toolCallId: 'call-1',
        toolName: 'tool_one',
        arguments: {},
        timestamp: new Date().toISOString(),
      };

      const toolCall2 = {
        kind: 'tool-call',
        toolCallId: 'call-2',
        toolName: 'tool_two',
        arguments: {},
        timestamp: new Date().toISOString(),
      };

      vi.mocked(mockLLMProvider.call).mockReturnValue(
        of(toolCall1 as AnyEvent, toolCall2 as AnyEvent),
      );

      const events$ = runIteration(mockContext, mockConfig, mockHistory);
      await lastValueFrom(events$.pipe(toArray()));

      expect(tools.runToolCall).toHaveBeenCalledTimes(2);
      expect(tools.runToolCall).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ toolCallId: 'call-1' }),
      );
      expect(tools.runToolCall).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ toolCallId: 'call-2' }),
      );
    });

    it('should collect tools from multiple providers', async () => {
      const tool1 = {
        name: 'tool1',
        description: 'Tool 1',
        parameters: {
          type: 'object' as const,
          properties: {},
        },
      };

      const tool2 = {
        name: 'tool2',
        description: 'Tool 2',
        parameters: {
          type: 'object' as const,
          properties: {},
        },
      };

      const provider1: ToolProvider = {
        canHandle: vi.fn(),
        execute: vi.fn(),
        getTools: vi.fn(async () => [tool1]),
      };

      const provider2: ToolProvider = {
        canHandle: vi.fn(),
        execute: vi.fn(),
        getTools: vi.fn(async () => [tool2]),
      };

      mockContext.toolProviders = [provider1, provider2];

      const events$ = runIteration(mockContext, mockConfig, mockHistory);
      await lastValueFrom(events$.pipe(toArray()));

      expect(mockLLMProvider.call).toHaveBeenCalledWith(
        expect.objectContaining({
          tools: [tool1, tool2],
        }),
      );
    });

    it('should handle empty tool providers array', async () => {
      mockContext.toolProviders = [];

      const events$ = runIteration(mockContext, mockConfig, mockHistory);
      await lastValueFrom(events$.pipe(toArray()));

      expect(mockLLMProvider.call).toHaveBeenCalledWith(
        expect.objectContaining({
          tools: [],
        }),
      );
    });

    it('should use tapFinish operator for span management', async () => {
      const events$ = runIteration(mockContext, mockConfig, mockHistory);
      await lastValueFrom(events$.pipe(toArray()));

      // Verify that startLoopIterationSpan was called (which returns tapFinish)
      expect(spans.startLoopIterationSpan).toHaveBeenCalled();
    });

    it('should handle LLM errors through tapFinish operator', async () => {
      const testError = new Error('LLM error');
      vi.mocked(mockLLMProvider.call).mockReturnValue(throwError(() => testError));

      const events$ = runIteration(mockContext, mockConfig, mockHistory);

      await expect(lastValueFrom(events$.pipe(toArray()))).rejects.toThrow('LLM error');

      // Verify span was created (tapFinish will handle the error)
      expect(spans.startLoopIterationSpan).toHaveBeenCalled();
    });

    it('should preserve message history order', async () => {
      const complexHistory: Message[] = [
        { role: 'user', content: 'First message' },
        { role: 'assistant', content: 'First response' },
        { role: 'user', content: 'Second message' },
        { role: 'assistant', content: 'Second response' },
      ];

      mockContext.systemPrompt = 'System';
      mockContext.skillPrompts = { skill1: 'Skill 1' };

      const events$ = runIteration(mockContext, mockConfig, complexHistory);
      await lastValueFrom(events$.pipe(toArray()));

      const callArgs = vi.mocked(mockLLMProvider.call).mock.calls[0][0];
      const messages = callArgs.messages;

      // System prompts first
      expect(messages[0]).toEqual({
        role: 'system',
        content: 'System',
        name: 'system-prompt',
      });
      expect(messages[1]).toEqual({
        role: 'system',
        content: 'Skill 1',
        name: 'skill1',
      });

      // Then history in order
      expect(messages[2]).toEqual({ role: 'user', content: 'First message' });
      expect(messages[3]).toEqual({ role: 'assistant', content: 'First response' });
      expect(messages[4]).toEqual({ role: 'user', content: 'Second message' });
      expect(messages[5]).toEqual({ role: 'assistant', content: 'Second response' });
    });

    it('should pass iteration number correctly', async () => {
      mockConfig.iterationNumber = 5;

      const events$ = runIteration(mockContext, mockConfig, mockHistory);
      await lastValueFrom(events$.pipe(toArray()));

      expect(spans.startLoopIterationSpan).toHaveBeenCalledWith(
        expect.any(Object), // context object
        5, // iteration number as second parameter
      );

      expect(mockContext.logger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          iteration: 5,
        }),
        'Starting iteration',
      );
    });

    it('should use stream: true and sessionId in LLM call', async () => {
      const events$ = runIteration(mockContext, mockConfig, mockHistory);
      await lastValueFrom(events$.pipe(toArray()));

      expect(mockLLMProvider.call).toHaveBeenCalledWith(
        expect.objectContaining({
          stream: true,
          sessionId: 'task-789',
        }),
      );
    });

    it('should handle empty message history', async () => {
      const emptyHistory: Message[] = [];

      const events$ = runIteration(mockContext, mockConfig, emptyHistory);
      await lastValueFrom(events$.pipe(toArray()));

      const callArgs = vi.mocked(mockLLMProvider.call).mock.calls[0][0];
      expect(callArgs.messages).toEqual([
        {
          role: 'system',
          content: 'You are a test assistant',
          name: 'system-prompt',
        },
      ]);
    });

    it('should emit all LLM events in the output stream', async () => {
      // Create observable with multiple events
      const llmEvents = [
        {
          kind: 'content-delta',
          delta: 'Hello',
          timestamp: new Date().toISOString(),
        },
        {
          kind: 'content-delta',
          delta: ' world',
          timestamp: new Date().toISOString(),
        },
        {
          kind: 'content-complete',
          content: 'Hello world',
          timestamp: new Date().toISOString(),
        },
      ];

      vi.mocked(mockLLMProvider.call).mockReturnValue(of(...(llmEvents as AnyEvent[])));

      const events$ = runIteration(mockContext, mockConfig, mockHistory);
      const allEvents = await lastValueFrom(events$.pipe(toArray()));

      // Should emit all three LLM events
      expect(allEvents).toHaveLength(3);
      expect(allEvents[0].kind).toBe('content-delta');
      expect(allEvents[1].kind).toBe('content-delta');
      expect(allEvents[2].kind).toBe('content-complete');
    });

    it('should handle tool provider that returns empty tools', async () => {
      const emptyProvider: ToolProvider = {
        canHandle: vi.fn(),
        execute: vi.fn(),
        getTools: vi.fn(async () => []),
      };

      mockContext.toolProviders = [emptyProvider];

      const events$ = runIteration(mockContext, mockConfig, mockHistory);
      await lastValueFrom(events$.pipe(toArray()));

      expect(mockLLMProvider.call).toHaveBeenCalledWith(
        expect.objectContaining({
          tools: [],
        }),
      );
    });

    it('should propagate iteration context to tool execution', async () => {
      const toolCallEvent = {
        kind: 'tool-call',
        toolCallId: 'call-123',
        toolName: 'test_tool',
        arguments: {},
        timestamp: new Date().toISOString(),
      };

      vi.mocked(mockLLMProvider.call).mockReturnValue(of(toolCallEvent as AnyEvent));

      const events$ = runIteration(mockContext, mockConfig, mockHistory);
      await lastValueFrom(events$.pipe(toArray()));

      // Check that iteration context (traceContext) is passed to tools
      expect(tools.runToolCall).toHaveBeenCalledWith(
        expect.objectContaining({
          parentContext: expect.any(Object), // iteration's traceContext
        }),
        expect.any(Object),
      );
    });

    it('should handle multiple skill prompts in insertion order', async () => {
      mockContext.skillPrompts = {
        first: 'First skill',
        second: 'Second skill',
        third: 'Third skill',
      };

      const events$ = runIteration(mockContext, mockConfig, mockHistory);
      await lastValueFrom(events$.pipe(toArray()));

      const callArgs = vi.mocked(mockLLMProvider.call).mock.calls[0][0];
      const skillMessages = callArgs.messages.filter(
        (m: Message) => m.role === 'system' && m.name !== 'system-prompt',
      );

      expect(skillMessages).toHaveLength(3);
      expect(skillMessages[0].name).toBe('first');
      expect(skillMessages[1].name).toBe('second');
      expect(skillMessages[2].name).toBe('third');
    });
  });
});
