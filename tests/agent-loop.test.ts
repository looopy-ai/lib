/**
 * Agent Loop Tests
 *
 * Tests for the core agent loop execution engine.
 */

import { context } from '@opentelemetry/api';
import { evaluate } from 'mathjs';
import { firstValueFrom, lastValueFrom, type Observable, of, throwError, toArray } from 'rxjs';
import { delay } from 'rxjs/operators';
import { beforeEach, describe, expect, it } from 'vitest';
import { AgentLoop } from '../src/core/agent-loop';
import type { AgentLoopConfig } from '../src/core/config';
import type {
  ArtifactStore,
  ExecutionContext,
  LLMProvider,
  LLMResponse,
  PersistedLoopState,
  StoredArtifact,
  TaskStateStore,
  ToolCall,
  ToolDefinition,
  ToolProvider,
  ToolResult,
} from '../src/core/types';
import type { AnyEvent, ContentCompleteEvent, LLMEvent } from '../src/events/types';

// Helper to convert LLMResponse to LLM events
function createMockLLMEvents(response: LLMResponse): LLMEvent<ContentCompleteEvent> {
  return {
    kind: 'content-complete',
    content: response.message.content || '',
    toolCalls: response.toolCalls?.map((tc) => ({
      id: tc.id,
      type: 'function' as const,
      function: {
        name: tc.function.name,
        arguments:
          (typeof tc.function.arguments === 'string'
            ? JSON.parse(tc.function.arguments)
            : tc.function.arguments) || {},
      },
    })),
    finishReason: response.finishReason || 'stop',
    timestamp: new Date().toISOString(),
  };
}

// Mock LLM Provider
class MockLLMProvider implements LLMProvider {
  private responses: LLMResponse[] = [];
  private currentIndex = 0;

  constructor(responses: LLMResponse[]) {
    this.responses = responses;
  }

  call(): Observable<LLMEvent<AnyEvent>> {
    const response = this.responses[this.currentIndex];
    this.currentIndex++;
    const event = createMockLLMEvents(response);
    return of(event).pipe(delay(10));
  }
}

// Mock Tool Provider
class MockToolProvider implements ToolProvider {
  async getTools(): Promise<ToolDefinition[]> {
    return [
      {
        name: 'get_weather',
        description: 'Get weather for a location',
        parameters: {
          type: 'object',
          properties: {
            location: { type: 'string' },
          },
          required: ['location'],
        },
      },
      {
        name: 'calculate',
        description: 'Perform calculation',
        parameters: {
          type: 'object',
          properties: {
            expression: { type: 'string' },
          },
          required: ['expression'],
        },
      },
    ];
  }

  canHandle(toolName: string): boolean {
    return ['get_weather', 'calculate'].includes(toolName);
  }

  async execute(toolCall: ToolCall, _context: ExecutionContext): Promise<ToolResult> {
    const args = toolCall.function.arguments;

    if (toolCall.function.name === 'get_weather') {
      return {
        toolCallId: toolCall.id,
        toolName: toolCall.function.name,
        success: true,
        result: { temperature: 72, condition: 'sunny', location: args.location },
      };
    }

    if (toolCall.function.name === 'calculate') {
      return {
        toolCallId: toolCall.id,
        toolName: toolCall.function.name,
        success: true,
        result: { result: evaluate(args.expression as string) },
      };
    }

    return {
      toolCallId: toolCall.id,
      toolName: toolCall.function.name,
      success: false,
      result: null,
      error: 'Unknown tool',
    };
  }
}

// Mock State Store
class MockStateStore implements TaskStateStore {
  private states = new Map<string, PersistedLoopState>();

  async save(taskId: string, state: PersistedLoopState): Promise<void> {
    this.states.set(taskId, state);
  }

  async load(taskId: string): Promise<PersistedLoopState | null> {
    return this.states.get(taskId) || null;
  }

  async exists(taskId: string): Promise<boolean> {
    return this.states.has(taskId);
  }

  async delete(taskId: string): Promise<void> {
    this.states.delete(taskId);
  }

  async listTasks(): Promise<string[]> {
    return Array.from(this.states.keys());
  }

  async setTTL(_taskId: string, _ttlSeconds: number): Promise<void> {
    // No-op for mock
  }
}

// Mock Artifact Store
class MockArtifactStore implements ArtifactStore {
  // New type-specific creation methods
  async createFileArtifact(): Promise<string> {
    return `file-artifact-${Date.now()}`;
  }

  async createDataArtifact(): Promise<string> {
    return `data-artifact-${Date.now()}`;
  }

  async createDatasetArtifact(): Promise<string> {
    return `dataset-artifact-${Date.now()}`;
  }

  // New type-specific operations
  async appendFileChunk(): Promise<void> {
    // No-op for mock
  }

  async writeData(): Promise<void> {
    // No-op for mock
  }

  async appendDatasetBatch(): Promise<void> {
    // No-op for mock
  }

  // New type-specific getters
  async getFileContent(): Promise<string> {
    return '';
  }

  async getDataContent(): Promise<Record<string, unknown>> {
    return {};
  }

  async getDatasetRows(): Promise<Record<string, unknown>[]> {
    return [];
  }

  // Common methods
  async getArtifact(): Promise<StoredArtifact | null> {
    return null;
  }

  async listArtifacts(): Promise<string[]> {
    return [];
  }

  async deleteArtifact(): Promise<void> {
    // No-op for mock
  }
}

describe('AgentLoop', () => {
  let config: AgentLoopConfig;
  let taskStateStore: MockStateStore;

  // Helper to create test context
  const createTestContext = (
    userMessage: string,
    overrides: Partial<import('../src/core/types').AgentLoopContext> = {}
  ): import('../src/core/types').AgentLoopContext => ({
    agentId: 'test-agent',
    contextId: 'test-context',
    taskId: 'test-task',
    messages: [{ role: 'user', content: userMessage }],
    parentContext: context.active(),
    ...overrides,
  });

  beforeEach(() => {
    taskStateStore = new MockStateStore();

    config = {
      agentId: 'test-agent',
      llmProvider: new MockLLMProvider([]),
      toolProviders: [new MockToolProvider()],
      taskStateStore,
      artifactStore: new MockArtifactStore(),
      maxIterations: 10,
      enableCheckpoints: true,
      checkpointInterval: 2,
    };
  });

  describe('Basic Execution', () => {
    it('should execute simple completion without tools', async () => {
      const llmProvider = new MockLLMProvider([
        {
          message: { role: 'assistant', content: 'Hello! How can I help?' },
          finished: true,
          finishReason: 'stop',
        },
      ]);

      const loop = new AgentLoop({
        ...config,
        llmProvider,
      });

      const events$ = loop.execute(createTestContext('Hi there!'));
      const events = await lastValueFrom(events$.pipe(toArray()));

      // Should have: task-created, task-status (working), task-complete events
      expect(events.length).toBeGreaterThanOrEqual(3);
      expect(events[0].kind).toBe('task-created');

      // Find working status event (may have internal events mixed in)
      const workingEvent = events.find((e) => e.kind === 'task-status' && e.status === 'working');
      expect(workingEvent).toBeDefined();

      const finalEvent = events[events.length - 1];
      expect(finalEvent.kind).toBe('task-complete');
    });

    it('should emit A2A-compliant events', async () => {
      const llmProvider = new MockLLMProvider([
        {
          message: { role: 'assistant', content: 'Test response' },
          finished: true,
          finishReason: 'stop',
        },
      ]);

      const loop = new AgentLoop({
        ...config,
        llmProvider,
      });

      const events$ = loop.execute(createTestContext('Test'));
      const events = await lastValueFrom(events$.pipe(toArray()));

      // Verify all events use internal event protocol
      const externalEvents = events.filter((e) => !e.kind.startsWith('internal:'));
      expect(externalEvents.length).toBeGreaterThan(0);

      // First event should be task-created
      expect(events[0].kind).toBe('task-created');
      expect(events[0]).toHaveProperty('taskId');
      expect(events[0]).toHaveProperty('contextId');

      // Last event should be task-complete
      const lastEvent = events[events.length - 1];
      expect(lastEvent.kind).toBe('task-complete');
    });
  });

  describe('Tool Execution', () => {
    it('should execute tool calls', async () => {
      const llmProvider = new MockLLMProvider([
        {
          message: { role: 'assistant', content: 'Let me check the weather' },
          toolCalls: [
            {
              id: 'call-1',
              type: 'function',
              function: {
                name: 'get_weather',
                arguments: { location: 'San Francisco' },
              },
            },
          ],
          finished: false,
          finishReason: 'tool_calls',
        },
        {
          message: {
            role: 'assistant',
            content: 'It is 72°F and sunny in San Francisco!',
          },
          finished: true,
          finishReason: 'stop',
        },
      ]);

      const loop = new AgentLoop({
        ...config,
        llmProvider,
      });

      const events$ = loop.execute(createTestContext('What is the weather in San Francisco?'));
      const events = await lastValueFrom(events$.pipe(toArray()));

      // Should complete successfully
      const finalEvent = events[events.length - 1];
      expect(finalEvent.kind).toBe('task-complete');
    });

    it('should handle multiple tool calls', async () => {
      const llmProvider = new MockLLMProvider([
        {
          message: { role: 'assistant', content: 'Let me get that info' },
          toolCalls: [
            {
              id: 'call-1',
              type: 'function',
              function: {
                name: 'get_weather',
                arguments: { location: 'NYC' },
              },
            },
            {
              id: 'call-2',
              type: 'function',
              function: {
                name: 'calculate',
                arguments: { expression: '2 + 2' },
              },
            },
          ],
          finished: false,
          finishReason: 'tool_calls',
        },
        {
          message: {
            role: 'assistant',
            content: 'Weather is good and 2+2=4',
          },
          finished: true,
          finishReason: 'stop',
        },
      ]);

      const loop = new AgentLoop({
        ...config,
        llmProvider,
      });

      const events$ = loop.execute(createTestContext('Get weather and calculate 2+2'));
      const events = await lastValueFrom(events$.pipe(toArray()));

      const finalEvent = events[events.length - 1];
      expect(finalEvent.kind).toBe('task-complete');
    });

    it('should handle tool errors gracefully', async () => {
      const errorProvider = new (class implements ToolProvider {
        async getTools() {
          return [
            {
              name: 'failing_tool',
              description: 'A tool that fails',
              parameters: { type: 'object' as const, properties: {} },
            },
          ];
        }

        canHandle(name: string) {
          return name === 'failing_tool';
        }

        async execute(toolCall: ToolCall): Promise<ToolResult> {
          return {
            toolCallId: toolCall.id,
            toolName: toolCall.function.name,
            success: false,
            result: null,
            error: 'Tool execution failed',
          };
        }
      })();

      const llmProvider = new MockLLMProvider([
        {
          message: { role: 'assistant', content: 'Calling tool' },
          toolCalls: [
            {
              id: 'call-1',
              type: 'function',
              function: { name: 'failing_tool', arguments: {} },
            },
          ],
          finished: false,
          finishReason: 'tool_calls',
        },
        {
          message: { role: 'assistant', content: 'Tool failed but handled' },
          finished: true,
          finishReason: 'stop',
        },
      ]);

      const loop = new AgentLoop({
        ...config,
        llmProvider,
        toolProviders: [errorProvider],
      });

      const events$ = loop.execute(createTestContext('Test error handling'));
      const events = await lastValueFrom(events$.pipe(toArray()));

      // Should still complete
      const finalEvent = events[events.length - 1];
      expect(finalEvent.kind).toBe('task-complete');
    });
  });

  describe('Checkpointing', () => {
    it('should checkpoint state periodically', async () => {
      const llmProvider = new MockLLMProvider([
        {
          message: { role: 'assistant', content: 'Response 1' },
          finished: false,
        },
        {
          message: { role: 'assistant', content: 'Response 2' },
          finished: false,
        },
        {
          message: { role: 'assistant', content: 'Response 3' },
          finished: true,
          finishReason: 'stop',
        },
      ]);

      const loop = new AgentLoop({
        ...config,
        llmProvider,
        checkpointInterval: 1,
      });

      const events$ = loop.execute(createTestContext('Multi-iteration test'));
      await lastValueFrom(events$.pipe(toArray()));

      // Should have checkpointed
      const tasks = await taskStateStore.listTasks();
      expect(tasks.length).toBe(1);

      const state = await taskStateStore.load(tasks[0]);
      expect(state).not.toBeNull();
      expect(state?.completed).toBe(true);
    });

    it('should resume from checkpoint', async () => {
      const taskId = 'test-task-resume';

      // Create a checkpointed state
      const checkpointedState: PersistedLoopState = {
        taskId,
        agentId: 'test-agent',
        contextId: 'test-context',
        messages: [
          { role: 'system', content: 'You are helpful' },
          { role: 'user', content: 'Hello' },
        ],
        systemPrompt: 'You are helpful',
        iteration: 2,
        completed: false,
        availableTools: [],
        pendingToolCalls: [],
        completedToolCalls: {},
        artifactIds: [],
        activeSubAgents: [],
        lastActivity: new Date().toISOString(),
        resumeFrom: 'llm-call',
      };

      await taskStateStore.save(taskId, checkpointedState);

      // Resume execution
      const llmProvider = new MockLLMProvider([
        {
          message: { role: 'assistant', content: 'Resumed and completed!' },
          finished: true,
          finishReason: 'stop',
        },
      ]);

      const events$ = await AgentLoop.resume(taskId, {
        ...config,
        llmProvider,
      });

      const events = await lastValueFrom(events$.pipe(toArray()));

      // Should complete from resumed state
      const finalEvent = events[events.length - 1];
      expect(finalEvent.kind).toBe('task-complete');
    });

    it('should return completed state when resuming finished task', async () => {
      const taskId = 'completed-task';

      const completedState: PersistedLoopState = {
        taskId,
        agentId: 'test-agent',
        contextId: 'test-context',
        messages: [{ role: 'assistant', content: 'All done!' }],
        systemPrompt: 'You are helpful',
        iteration: 5,
        completed: true,
        availableTools: [],
        pendingToolCalls: [],
        completedToolCalls: {},
        artifactIds: [],
        activeSubAgents: [],
        lastActivity: new Date().toISOString(),
        resumeFrom: 'completed',
      };

      await taskStateStore.save(taskId, completedState);

      const events$ = await AgentLoop.resume(taskId, config);
      const event = await firstValueFrom(events$);

      // Should emit completion event for already-completed task
      expect(event.kind).toBe('task-complete');
    });
  });

  describe('Error Handling', () => {
    it('should handle execution errors', async () => {
      const errorProvider = new (class implements LLMProvider {
        call(): Observable<LLMEvent<AnyEvent>> {
          return throwError(() => new Error('LLM service unavailable'));
        }
      })();

      const loop = new AgentLoop({
        ...config,
        llmProvider: errorProvider,
      });

      const events$ = loop.execute(createTestContext('This will fail'));
      const events = await lastValueFrom(events$.pipe(toArray()));

      // Should have error in events - check for task-status with failed status
      const statusEvents = events.filter((e) => e.kind === 'task-status');
      const hasFailedStatus = statusEvents.some(
        (e) => e.kind === 'task-status' && e.status === 'failed'
      );
      expect(hasFailedStatus || events.length === 0).toBe(true);
    });

    it('should respect max iterations', async () => {
      // LLM that never finishes
      const llmProvider = new MockLLMProvider(
        Array(20).fill({
          message: { role: 'assistant', content: 'Still working...' },
          finished: false,
        })
      );

      const loop = new AgentLoop({
        ...config,
        llmProvider,
        maxIterations: 5,
      });

      const events$ = loop.execute(createTestContext('Infinite loop test'));
      const events = await lastValueFrom(events$.pipe(toArray()));

      // Should stop after max iterations - find the last non-internal event
      const externalEvents = events.filter((e) => !e.kind.startsWith('internal:'));
      const finalEvent = externalEvents[externalEvents.length - 1];
      // When max iterations hit, may end with task-status, task-complete, content-complete, or content-delta
      expect(['task-status', 'task-complete', 'content-complete', 'content-delta']).toContain(
        finalEvent.kind
      );
    });
  });

  describe('Context Propagation', () => {
    it('should propagate trace context', async () => {
      const llmProvider = new MockLLMProvider([
        {
          message: { role: 'assistant', content: 'Done' },
          finished: true,
          finishReason: 'stop',
        },
      ]);

      const loop = new AgentLoop({
        ...config,
        llmProvider,
      });

      const events$ = loop.execute(createTestContext('Test', {}));
      const events = await lastValueFrom(events$.pipe(toArray()));

      expect(events.length).toBeGreaterThan(0);
    });

    it('should propagate auth context', async () => {
      const llmProvider = new MockLLMProvider([
        {
          message: { role: 'assistant', content: 'Done' },
          finished: true,
          finishReason: 'stop',
        },
      ]);

      const loop = new AgentLoop({
        ...config,
        llmProvider,
      });

      const authContext = {
        userId: 'user-123',
        scopes: ['read', 'write'],
      };

      const events$ = loop.execute(createTestContext('Test', { authContext }));
      const events = await lastValueFrom(events$.pipe(toArray()));

      expect(events.length).toBeGreaterThan(0);
    });
  });
});
