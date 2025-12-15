import { context } from '@opentelemetry/api';
import pino from 'pino';
import { lastValueFrom, of, throwError, toArray } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as spanHelpers from '../observability/spans/tool';
import { toolResultToEvents } from '../tools/tool-result-events';
import type { IterationContext, Plugin } from '../types/core';
import type { ContextEvent, ToolCallEvent } from '../types/event';
import type { ToolCall } from '../types/tools';
import { runToolCall } from './tools';

const createTestLogger = () => pino.pino();
type LoggerInstance = ReturnType<typeof createTestLogger>;
type SpyInstance = ReturnType<typeof vi.fn>;

const createContextWithPlugins = (
  plugins: readonly Plugin<unknown>[],
): IterationContext<unknown> => ({
  agentId: 'agent-123',
  contextId: 'ctx-456',
  taskId: 'task-789',
  turnNumber: 1,
  plugins,
  logger: createTestLogger(),
  parentContext: context.active(),
  authContext: {
    userId: 'user-1',
  },
});

const getChildLogger = (logger: LoggerInstance): LoggerInstance | undefined => {
  const childSpy = logger.child as unknown as SpyInstance;
  return childSpy.mock.results[0]?.value as LoggerInstance | undefined;
};

const expectChildLogger = (logger: LoggerInstance): LoggerInstance => {
  const childLogger = getChildLogger(logger);
  expect(childLogger).toBeDefined();
  return childLogger as LoggerInstance;
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
  let mockContext: IterationContext<unknown>;
  let mockToolCall: ContextEvent<ToolCallEvent>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockContext = {
      agentId: 'agent-123',
      contextId: 'ctx-456',
      taskId: 'task-789',
      turnNumber: 1,
      plugins: [] as readonly Plugin<unknown>[],
      logger: createTestLogger(),
      parentContext: context.active(),
      authContext: {
        userId: 'user-1',
      },
    } as IterationContext<unknown>;

    mockToolCall = {
      kind: 'tool-call',
      contextId: 'ctx-456',
      taskId: 'task-789',
      path: ['tool:test_tool'],
      toolCallId: 'call-abc',
      toolName: 'test_tool',
      arguments: { param: 'value' },
      timestamp: '2025-11-12T10:00:00Z',
    };
  });

  describe('runToolCall', () => {
    const mockToolDef = {
      id: 'test_tool',
      description: 'A test tool',
      parameters: {
        type: 'object' as const,
        properties: {},
      },
      icon: 'mock-icon',
    };

    const createSuccessExecute = (result: unknown) =>
      vi.fn((toolCall: ToolCall, _execContext: IterationContext<unknown>) =>
        toolResultToEvents({
          toolCallId: toolCall.id,
          toolName: toolCall.function.name,
          success: true,
          result,
        }),
      );

    it('should emit tool-start and tool-complete when a provider supports the tool', async () => {
      const mockProvider: Plugin<unknown> = {
        name: 'mock-provider',
        getTool: vi.fn(async () => mockToolDef),
        listTools: vi.fn(async () => [mockToolDef]),
        executeTool: createSuccessExecute('test result'),
      };

      const testContext = createContextWithPlugins([mockProvider]);

      const events$ = runToolCall(testContext, mockToolCall);
      const events = await lastValueFrom(events$.pipe(toArray()));

      expect(events).toHaveLength(2);
      expect(events[0]).toEqual(
        expect.objectContaining({
          kind: 'tool-start',
          toolCallId: 'call-abc',
          toolName: 'test_tool',
          arguments: { param: 'value' },
          icon: 'mock-icon',
        }),
      );
      expect(events[1]).toEqual(
        expect.objectContaining({
          kind: 'tool-complete',
          toolCallId: 'call-abc',
          toolName: 'test_tool',
          success: true,
          result: 'test result',
        }),
      );
    });

    it('should call provider.execute with correct parameters', async () => {
      const mockProvider: Plugin<unknown> = {
        name: 'mock-provider',
        getTool: vi.fn(async () => mockToolDef),
        listTools: vi.fn(async () => [mockToolDef]),
        executeTool: createSuccessExecute('result'),
      };

      const testContext = createContextWithPlugins([mockProvider]);

      const events$ = runToolCall(testContext, mockToolCall);
      await lastValueFrom(events$.pipe(toArray()));

      expect(mockProvider.executeTool).toHaveBeenCalledWith(
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

    it('should execute the first provider that returns a matching tool', async () => {
      const provider1: Plugin<unknown> = {
        name: 'provider-1',
        getTool: vi.fn(async () => undefined),
        listTools: vi.fn(async () => []),
        executeTool: vi.fn(() => of()),
      };

      const provider2: Plugin<unknown> = {
        name: 'provider-2',
        getTool: vi.fn(async () => mockToolDef),
        listTools: vi.fn(async () => [mockToolDef]),
        executeTool: createSuccessExecute('correct'),
      };

      const provider3: Plugin<unknown> = {
        name: 'provider-3',
        getTool: vi.fn(async () => mockToolDef),
        listTools: vi.fn(async () => [mockToolDef]),
        executeTool: vi.fn(() => of()),
      };

      const testContext = createContextWithPlugins([provider1, provider2, provider3]);

      const events$ = runToolCall(testContext, mockToolCall);
      const events = await lastValueFrom(events$.pipe(toArray()));

      expect(provider1.executeTool).not.toHaveBeenCalled();
      expect(provider2.executeTool).toHaveBeenCalledTimes(1);
      expect(provider3.executeTool).not.toHaveBeenCalled();

      expect(events.at(-1)).toMatchObject({
        kind: 'tool-complete',
        result: 'correct',
      });
    });

    it('should warn and pass through the tool-call when no provider matches', async () => {
      const events$ = runToolCall(mockContext, mockToolCall);
      const events = await lastValueFrom(events$.pipe(toArray()));

      expect(events).toHaveLength(1);
      expect(events[0]).toEqual(mockToolCall);

      const childLogger = expectChildLogger(mockContext.logger);
      expect(childLogger.warn).toHaveBeenCalledWith('No plugin found for tool');
    });

    it('should handle provider throwing an error', async () => {
      const testError = new Error('Provider crashed');
      const mockProvider: Plugin<unknown> = {
        name: 'mock-provider',
        getTool: vi.fn(async () => mockToolDef),
        listTools: vi.fn(async () => [mockToolDef]),
        executeTool: vi.fn(() => throwError(() => testError)),
      };

      const testContext = createContextWithPlugins([mockProvider]);

      const events$ = runToolCall(testContext, mockToolCall);
      const events = await lastValueFrom(events$.pipe(toArray()));

      expect(events.at(-1)).toEqual(
        expect.objectContaining({
          kind: 'tool-complete',
          success: false,
          error: 'Provider crashed',
        }),
      );

      const childLogger = expectChildLogger(testContext.logger);
      expect(childLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Provider crashed',
        }),
        'Tool execution error',
      );
    });

    it('should handle provider throwing non-Error object', async () => {
      const mockProvider: Plugin<unknown> = {
        name: 'mock-provider',
        getTool: vi.fn(async () => mockToolDef),
        listTools: vi.fn(async () => [mockToolDef]),
        executeTool: vi.fn(() => throwError(() => 'String error')),
      };

      const testContext = createContextWithPlugins([mockProvider]);

      const events$ = runToolCall(testContext, mockToolCall);
      const events = await lastValueFrom(events$.pipe(toArray()));

      expect(events.at(-1)).toEqual(
        expect.objectContaining({
          kind: 'tool-complete',
          success: false,
          error: 'String error',
        }),
      );
    });

    it('should log trace messages during execution', async () => {
      const mockProvider: Plugin<unknown> = {
        name: 'mock-provider',
        getTool: vi.fn(async () => mockToolDef),
        listTools: vi.fn(async () => [mockToolDef]),
        executeTool: createSuccessExecute('result'),
      };

      const testContext = createContextWithPlugins([mockProvider]);

      const events$ = runToolCall(testContext, mockToolCall);
      await lastValueFrom(events$.pipe(toArray()));

      const childLogger = expectChildLogger(testContext.logger);
      expect(childLogger.debug).toHaveBeenCalledWith(
        { providerName: 'mock-provider', toolIcon: 'mock-icon' },
        'Found tool provider for tool',
      );
      expect(childLogger.trace).toHaveBeenCalledWith(
        { providerName: 'mock-provider' },
        'Executing tool',
      );
      expect(childLogger.trace).toHaveBeenCalledWith(
        expect.objectContaining({ success: true }),
        'Tool execution complete',
      );
    });

    it('should create OpenTelemetry span with correct parameters', async () => {
      const mockProvider: Plugin<unknown> = {
        name: 'mock-provider',
        getTool: vi.fn(async () => mockToolDef),
        listTools: vi.fn(async () => [mockToolDef]),
        executeTool: createSuccessExecute('result'),
      };

      const testContext = createContextWithPlugins([mockProvider]);

      const events$ = runToolCall(testContext, mockToolCall);
      await lastValueFrom(events$.pipe(toArray()));

      expect(spanHelpers.startToolExecuteSpan).toHaveBeenCalledWith(
        testContext,
        expect.objectContaining({
          kind: 'tool-call',
          toolName: 'test_tool',
          toolCallId: 'call-abc',
        }),
      );
    });

    it('should use tapFinish operator for span management', async () => {
      const mockProvider: Plugin<unknown> = {
        name: 'mock-provider',
        getTool: vi.fn(async () => mockToolDef),
        listTools: vi.fn(async () => [mockToolDef]),
        executeTool: createSuccessExecute('result'),
      };

      const testContext = createContextWithPlugins([mockProvider]);

      const events$ = runToolCall(testContext, mockToolCall);
      await lastValueFrom(events$.pipe(toArray()));

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

      const mockProvider: Plugin<unknown> = {
        name: 'mock-provider',
        getTool: vi.fn(async () => mockToolDef),
        listTools: vi.fn(async () => [mockToolDef]),
        executeTool: createSuccessExecute(complexResult),
      };

      const testContext = createContextWithPlugins([mockProvider]);

      const events$ = runToolCall(testContext, mockToolCall);
      const events = await lastValueFrom(events$.pipe(toArray()));

      const completeEvent = events[1];
      if (completeEvent.kind === 'tool-complete') {
        expect(completeEvent.result).toEqual(complexResult);
      }
    });

    it('should handle empty arguments object', async () => {
      const mockProvider: Plugin<unknown> = {
        name: 'mock-provider',
        getTool: vi.fn(async () => mockToolDef),
        listTools: vi.fn(async () => [mockToolDef]),
        executeTool: createSuccessExecute('result'),
      };

      const testContext = createContextWithPlugins([mockProvider]);

      const toolCallWithEmptyArgs: ContextEvent<ToolCallEvent> = {
        ...mockToolCall,
        arguments: {},
      };

      const events$ = runToolCall(testContext, toolCallWithEmptyArgs);
      const events = await lastValueFrom(events$.pipe(toArray()));

      expect(mockProvider.executeTool).toHaveBeenCalledWith(
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
      const mockProvider: Plugin<unknown> = {
        name: 'mock-provider',
        getTool: vi.fn(async () => mockToolDef),
        listTools: vi.fn(async () => [mockToolDef]),
        executeTool: createSuccessExecute('result'),
      };

      const testContext = createContextWithPlugins([mockProvider]);

      const events$ = runToolCall(testContext, mockToolCall);
      const events = await lastValueFrom(events$.pipe(toArray()));

      for (const event of events) {
        expect(event.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      }
    });
  });
});
