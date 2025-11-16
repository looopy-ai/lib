import { context } from '@opentelemetry/api';
import pino from 'pino';
import { firstValueFrom, lastValueFrom, toArray } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as spanHelpers from '../observability/spans/tool';
import type { ToolCallEvent } from '../types/event';
import type { ToolCall, ToolProvider } from '../types/tools';
import { runToolCall } from './tools';
import type { IterationContext } from './types';

const createTestLogger = () => pino.pino();
type LoggerInstance = ReturnType<typeof createTestLogger>;
type SpyInstance = ReturnType<typeof vi.fn>;

const getChildLogger = (logger: LoggerInstance): LoggerInstance | undefined => {
  const childSpy = logger.child as unknown as SpyInstance;
  return childSpy.mock.results[0]?.value as LoggerInstance | undefined;
};

const expectChildLogger = (logger: LoggerInstance): LoggerInstance => {
  const childLogger = getChildLogger(logger);
  expect(childLogger).toBeDefined();
  return childLogger!;
};

// Mock the 'pino' module using the shared manual mock
vi.mock('pino');

// Mock the span functions
vi.mock('../observability/spans/tool', () => ({
  startToolExecuteSpan: vi.fn(() => ({
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
      logger: createTestLogger(),
      parentContext: context.active(),
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
        expect.objectContaining({
          contextId: 'ctx-456',
          taskId: 'task-789',
          agentId: 'agent-123',
          authContext: { userId: 'user-1' },
          parentContext: expect.any(Object),
        }),
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

      const childLogger = expectChildLogger(mockContext.logger);
      expect(childLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
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

      const childLogger = expectChildLogger(mockContext.logger);
      expect(childLogger.trace).toHaveBeenCalledWith('Executing tool');

      expect(childLogger.trace).toHaveBeenCalledWith(
        {
          success: true,
        },
        'Tool execution complete',
      );
    });

    it('should log warning when no provider found', async () => {
      mockContext.toolProviders = [];

      const events$ = runToolCall(mockContext, mockToolCall);
      await lastValueFrom(events$.pipe(toArray()));

      const childLogger = expectChildLogger(mockContext.logger);
      expect(childLogger.warn).toHaveBeenCalledWith('No provider found for tool');
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

      expect(spanHelpers.startToolExecuteSpan).toHaveBeenCalledWith(
        mockContext,
        expect.objectContaining({
          kind: 'tool-start',
          toolName: 'test_tool',
          toolCallId: 'call-abc',
          arguments: { param: 'value' },
        }),
      );
    });

    it('should use tapFinish operator for span management', async () => {
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

      // Verify that startToolExecuteSpan was called (which returns tapFinish)
      expect(spanHelpers.startToolExecuteSpan).toHaveBeenCalled();
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
