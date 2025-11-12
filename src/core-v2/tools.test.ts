import type pino from 'pino';
import { firstValueFrom, lastValueFrom, toArray } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolCallEvent } from '../events/types';
import * as spans from '../observability/spans';
import type { ToolCall, ToolProvider, ToolResult } from '../tools/interfaces';
import { runToolCall } from './tools';
import type { IterationContext } from './types';

// Mock the span functions
vi.mock('../observability/spans', () => ({
  startToolExecutionSpan: vi.fn(() => ({
    span: {
      end: vi.fn(),
      setAttributes: vi.fn(),
      setStatus: vi.fn(),
      recordException: vi.fn(),
    },
    traceContext: {},
  })),
  completeToolExecutionSpan: vi.fn(),
  failToolExecutionSpan: vi.fn(),
  failToolExecutionSpanWithException: vi.fn(),
}));

describe('tools', () => {
  let mockContext: IterationContext;
  let mockToolCall: ToolCallEvent;

  beforeEach(() => {
    vi.clearAllMocks();

    mockContext = {
      agentId: 'agent-123',
      contextId: 'ctx-456',
      taskId: 'task-789',
      turnNumber: 1,
      toolProviders: [],
      logger: {
        trace: vi.fn(),
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      } as unknown as pino.Logger,
      parentContext: {} as import('@opentelemetry/api').Context,
      authContext: {
        userId: 'user-1',
      },
    };

    mockToolCall = {
      kind: 'tool-call',
      contextId: 'ctx-456',
      taskId: 'task-789',
      toolCallId: 'call-abc',
      toolName: 'test_tool',
      arguments: { param: 'value' },
      timestamp: '2025-11-12T10:00:00Z',
    };
  });

  describe('runToolCall', () => {
    it('should emit tool-start event immediately', async () => {
      const mockProvider: ToolProvider = {
        canHandle: vi.fn(() => true),
        execute: vi.fn(async (toolCall: ToolCall) => ({
          toolCallId: toolCall.id,
          toolName: toolCall.function.name,
          success: true,
          result: 'test result',
        })),
        getTools: vi.fn(async () => []),
      };

      mockContext.toolProviders = [mockProvider];

      const events$ = runToolCall(mockContext, mockToolCall);
      const firstEvent = await firstValueFrom(events$);

      expect(firstEvent).toEqual({
        kind: 'tool-start',
        contextId: 'ctx-456',
        taskId: 'task-789',
        toolCallId: 'call-abc',
        toolName: 'test_tool',
        arguments: { param: 'value' },
        timestamp: expect.any(String),
      });
    });

    it('should emit tool-complete event with success after tool execution', async () => {
      const mockResult = { data: 'test data', count: 42 };
      const mockProvider: ToolProvider = {
        canHandle: vi.fn(() => true),
        execute: vi.fn(async (toolCall: ToolCall) => ({
          toolCallId: toolCall.id,
          toolName: toolCall.function.name,
          success: true,
          result: mockResult,
        })),
        getTools: vi.fn(async () => []),
      };

      mockContext.toolProviders = [mockProvider];

      const events$ = runToolCall(mockContext, mockToolCall);
      const events = await lastValueFrom(events$.pipe(toArray()));

      expect(events).toHaveLength(2);
      expect(events[1]).toEqual({
        kind: 'tool-complete',
        contextId: 'ctx-456',
        taskId: 'task-789',
        toolCallId: 'call-abc',
        toolName: 'test_tool',
        success: true,
        result: mockResult,
        timestamp: expect.any(String),
      });
    });

    it('should call provider.execute with correct parameters', async () => {
      const mockProvider: ToolProvider = {
        canHandle: vi.fn(() => true),
        execute: vi.fn(async (toolCall: ToolCall) => ({
          toolCallId: toolCall.id,
          toolName: toolCall.function.name,
          success: true,
          result: 'result',
        })),
        getTools: vi.fn(async () => []),
      };

      mockContext.toolProviders = [mockProvider];

      const events$ = runToolCall(mockContext, mockToolCall);
      await lastValueFrom(events$.pipe(toArray()));

      expect(mockProvider.execute).toHaveBeenCalledWith(
        {
          id: 'call-abc',
          type: 'function',
          function: {
            name: 'test_tool',
            arguments: { param: 'value' },
          },
        },
        {
          contextId: 'ctx-456',
          taskId: 'task-789',
          agentId: 'agent-123',
          authContext: { userId: 'user-1' },
        },
      );
    });

    it('should find correct provider when multiple providers exist', async () => {
      const provider1: ToolProvider = {
        canHandle: vi.fn(() => false),
        execute: vi.fn(),
        getTools: vi.fn(async () => []),
      };

      const provider2: ToolProvider = {
        canHandle: vi.fn(() => true),
        execute: vi.fn(async (toolCall: ToolCall) => ({
          toolCallId: toolCall.id,
          toolName: toolCall.function.name,
          success: true,
          result: 'correct',
        })),
        getTools: vi.fn(async () => []),
      };

      const provider3: ToolProvider = {
        canHandle: vi.fn(() => false),
        execute: vi.fn(),
        getTools: vi.fn(async () => []),
      };

      mockContext.toolProviders = [provider1, provider2, provider3];

      const events$ = runToolCall(mockContext, mockToolCall);
      const events = await lastValueFrom(events$.pipe(toArray()));

      expect(provider1.canHandle).toHaveBeenCalledWith('test_tool');
      expect(provider2.canHandle).toHaveBeenCalledWith('test_tool');
      expect(provider3.canHandle).not.toHaveBeenCalled(); // Should stop at provider2

      expect(provider1.execute).not.toHaveBeenCalled();
      expect(provider2.execute).toHaveBeenCalled();
      expect(provider3.execute).not.toHaveBeenCalled();

      const completeEvent = events[1];
      if (completeEvent.kind === 'tool-complete') {
        expect(completeEvent.result).toBe('correct');
      }
    });

    it('should emit error event when no provider found', async () => {
      mockContext.toolProviders = []; // No providers

      const events$ = runToolCall(mockContext, mockToolCall);
      const events = await lastValueFrom(events$.pipe(toArray()));

      expect(events).toHaveLength(2);
      expect(events[1]).toEqual({
        kind: 'tool-complete',
        contextId: 'ctx-456',
        taskId: 'task-789',
        toolCallId: 'call-abc',
        toolName: 'test_tool',
        success: false,
        result: null,
        error: 'No provider found for tool: test_tool',
        timestamp: expect.any(String),
      });
    });

    it('should handle provider throwing an error', async () => {
      const testError = new Error('Provider crashed');
      const mockProvider: ToolProvider = {
        canHandle: vi.fn(() => true),
        execute: vi.fn(async () => {
          throw testError;
        }),
        getTools: vi.fn(async () => []),
      };

      mockContext.toolProviders = [mockProvider];

      const events$ = runToolCall(mockContext, mockToolCall);
      const events = await lastValueFrom(events$.pipe(toArray()));

      expect(events[1]).toEqual({
        kind: 'tool-complete',
        contextId: 'ctx-456',
        taskId: 'task-789',
        toolCallId: 'call-abc',
        toolName: 'test_tool',
        success: false,
        result: null,
        error: 'Provider crashed',
        timestamp: expect.any(String),
      });

      expect(mockContext.logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: 'task-789',
          toolName: 'test_tool',
          error: 'Provider crashed',
        }),
        'Tool execution failed',
      );
    });

    it('should handle provider throwing non-Error object', async () => {
      const mockProvider: ToolProvider = {
        canHandle: vi.fn(() => true),
        execute: vi.fn(async () => {
          throw 'String error'; // Throw a string instead of Error
        }),
        getTools: vi.fn(async () => []),
      };

      mockContext.toolProviders = [mockProvider];

      const events$ = runToolCall(mockContext, mockToolCall);
      const events = await lastValueFrom(events$.pipe(toArray()));

      expect(events[1]).toEqual({
        kind: 'tool-complete',
        contextId: 'ctx-456',
        taskId: 'task-789',
        toolCallId: 'call-abc',
        toolName: 'test_tool',
        success: false,
        result: null,
        error: 'String error',
        timestamp: expect.any(String),
      });
    });

    it('should log trace messages during execution', async () => {
      const mockProvider: ToolProvider = {
        canHandle: vi.fn(() => true),
        execute: vi.fn(async (toolCall: ToolCall) => ({
          toolCallId: toolCall.id,
          toolName: toolCall.function.name,
          success: true,
          result: 'result',
        })),
        getTools: vi.fn(async () => []),
      };

      mockContext.toolProviders = [mockProvider];

      const events$ = runToolCall(mockContext, mockToolCall);
      await lastValueFrom(events$.pipe(toArray()));

      expect(mockContext.logger.trace).toHaveBeenCalledWith(
        {
          taskId: 'task-789',
          toolName: 'test_tool',
          toolCallId: 'call-abc',
        },
        'Executing tool',
      );

      expect(mockContext.logger.trace).toHaveBeenCalledWith(
        {
          taskId: 'task-789',
          toolName: 'test_tool',
          success: true,
        },
        'Tool execution complete',
      );
    });

    it('should log warning when no provider found', async () => {
      mockContext.toolProviders = [];

      const events$ = runToolCall(mockContext, mockToolCall);
      await lastValueFrom(events$.pipe(toArray()));

      expect(mockContext.logger.warn).toHaveBeenCalledWith(
        {
          taskId: 'task-789',
          toolName: 'test_tool',
        },
        'No provider found for tool',
      );
    });

    it('should create OpenTelemetry span with correct parameters', async () => {
      const mockProvider: ToolProvider = {
        canHandle: vi.fn(() => true),
        execute: vi.fn(async (toolCall: ToolCall) => ({
          toolCallId: toolCall.id,
          toolName: toolCall.function.name,
          success: true,
          result: 'result',
        })),
        getTools: vi.fn(async () => []),
      };

      mockContext.toolProviders = [mockProvider];

      const events$ = runToolCall(mockContext, mockToolCall);
      await lastValueFrom(events$.pipe(toArray()));

      expect(spans.startToolExecuteSpan).toHaveBeenCalledWith({
        agentId: 'agent-123',
        taskId: 'task-789',
        toolCall: {
          id: 'call-abc',
          type: 'function',
          function: {
            name: 'test_tool',
            arguments: { param: 'value' },
          },
        },
        parentContext: expect.any(Object),
      });
    });

    it('should complete span on successful execution', async () => {
      const mockResult: ToolResult = {
        toolCallId: 'call-abc',
        toolName: 'test_tool',
        success: true,
        result: 'result',
      };

      const mockProvider: ToolProvider = {
        canHandle: vi.fn(() => true),
        execute: vi.fn(async () => mockResult),
        getTools: vi.fn(async () => []),
      };

      mockContext.toolProviders = [mockProvider];

      const events$ = runToolCall(mockContext, mockToolCall);
      await lastValueFrom(events$.pipe(toArray()));

      expect(spans.completeToolExecutionSpan).toHaveBeenCalledWith(expect.any(Object), mockResult);
    });

    it('should fail span when no provider found', async () => {
      mockContext.toolProviders = [];

      const events$ = runToolCall(mockContext, mockToolCall);
      await lastValueFrom(events$.pipe(toArray()));

      expect(spans.failToolExecutionSpan).toHaveBeenCalledWith(
        expect.any(Object),
        'No provider found for tool: test_tool',
      );
    });

    it('should fail span with exception on error', async () => {
      const testError = new Error('Tool error');
      const mockProvider: ToolProvider = {
        canHandle: vi.fn(() => true),
        execute: vi.fn(async () => {
          throw testError;
        }),
        getTools: vi.fn(async () => []),
      };

      mockContext.toolProviders = [mockProvider];

      const events$ = runToolCall(mockContext, mockToolCall);
      await lastValueFrom(events$.pipe(toArray()));

      expect(spans.failToolExecutionSpanWithException).toHaveBeenCalledWith(
        expect.any(Object),
        testError,
      );
    });

    it('should handle tools with complex result types', async () => {
      const complexResult = {
        nested: {
          data: [1, 2, 3],
          metadata: { timestamp: '2025-11-12' },
        },
        status: 'ok',
      };

      const mockProvider: ToolProvider = {
        canHandle: vi.fn(() => true),
        execute: vi.fn(async (toolCall: ToolCall) => ({
          toolCallId: toolCall.id,
          toolName: toolCall.function.name,
          success: true,
          result: complexResult,
        })),
        getTools: vi.fn(async () => []),
      };

      mockContext.toolProviders = [mockProvider];

      const events$ = runToolCall(mockContext, mockToolCall);
      const events = await lastValueFrom(events$.pipe(toArray()));

      const completeEvent = events[1];
      if (completeEvent.kind === 'tool-complete') {
        expect(completeEvent.result).toEqual(complexResult);
      }
    });

    it('should preserve contextId and taskId in all events', async () => {
      const mockProvider: ToolProvider = {
        canHandle: vi.fn(() => true),
        execute: vi.fn(async (toolCall: ToolCall) => ({
          toolCallId: toolCall.id,
          toolName: toolCall.function.name,
          success: true,
          result: 'result',
        })),
        getTools: vi.fn(async () => []),
      };

      mockContext.toolProviders = [mockProvider];

      const events$ = runToolCall(mockContext, mockToolCall);
      const events = await lastValueFrom(events$.pipe(toArray()));

      for (const event of events) {
        expect(event.contextId).toBe('ctx-456');
        expect(event.taskId).toBe('task-789');
      }
    });

    it('should handle empty arguments object', async () => {
      const mockProvider: ToolProvider = {
        canHandle: vi.fn(() => true),
        execute: vi.fn(async (toolCall: ToolCall) => ({
          toolCallId: toolCall.id,
          toolName: toolCall.function.name,
          success: true,
          result: 'result',
        })),
        getTools: vi.fn(async () => []),
      };

      mockContext.toolProviders = [mockProvider];

      const toolCallWithEmptyArgs: ToolCallEvent = {
        ...mockToolCall,
        arguments: {},
      };

      const events$ = runToolCall(mockContext, toolCallWithEmptyArgs);
      const events = await lastValueFrom(events$.pipe(toArray()));

      expect(mockProvider.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          function: { name: 'test_tool', arguments: {} },
        }),
        expect.any(Object),
      );

      const completeEvent = events[1];
      if (completeEvent.kind === 'tool-complete') {
        expect(completeEvent.success).toBe(true);
      }
    });

    it('should include timestamps in all events', async () => {
      const mockProvider: ToolProvider = {
        canHandle: vi.fn(() => true),
        execute: vi.fn(async (toolCall: ToolCall) => ({
          toolCallId: toolCall.id,
          toolName: toolCall.function.name,
          success: true,
          result: 'result',
        })),
        getTools: vi.fn(async () => []),
      };

      mockContext.toolProviders = [mockProvider];

      const events$ = runToolCall(mockContext, mockToolCall);
      const events = await lastValueFrom(events$.pipe(toArray()));

      for (const event of events) {
        expect(event.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      }
    });
  });
});
