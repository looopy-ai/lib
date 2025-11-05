/**
 * Agent Loop Tests
 *
 * Tests for the core agent loop execution engine.
 */

import { evaluate } from 'mathjs';
import { firstValueFrom, lastValueFrom, type Observable, of, throwError, toArray } from 'rxjs';
import { delay } from 'rxjs/operators';
import { beforeEach, describe, expect, it } from 'vitest';
import { AgentLoop } from '../src/core/agent-loop';
import type { AgentLoopConfig } from '../src/core/config';
import type {
    ArtifactPart,
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

// Mock LLM Provider
class MockLLMProvider implements LLMProvider {
  private responses: LLMResponse[] = [];
  private currentIndex = 0;

  constructor(responses: LLMResponse[]) {
    this.responses = responses;
  }

  call(): Observable<LLMResponse> {
    const response = this.responses[this.currentIndex];
    this.currentIndex++;
    return of(response).pipe(delay(10));
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
  async createArtifact(): Promise<string> {
    return `artifact-${Date.now()}`;
  }

  async appendPart(): Promise<void> {
    // No-op for mock
  }

  async replacePart(): Promise<void> {
    // No-op for mock
  }

  async replaceParts(): Promise<void> {
    // No-op for mock
  }

  async getArtifact(): Promise<StoredArtifact | null> {
    return null;
  }

  async getArtifactParts(_artifactId: string, _resolveExternal?: boolean): Promise<ArtifactPart[]> {
    return [];
  }

  async getTaskArtifacts(): Promise<string[]> {
    return [];
  }

  async queryArtifacts(): Promise<string[]> {
    return [];
  }

  async getArtifactByContext(
    _contextId: string,
    _artifactId: string
  ): Promise<StoredArtifact | null> {
    return null;
  }

  async deleteArtifact(): Promise<void> {
    // No-op for mock
  }

  async getArtifactContent(): Promise<string | object> {
    return '';
  }
}

describe('AgentLoop', () => {
  let config: AgentLoopConfig;
  let stateStore: MockStateStore;

  // Helper to create test context
  const createTestContext = (
    userMessage: string,
    overrides: Partial<import('../src/core/types').Context> = {}
  ): import('../src/core/types').Context => ({
    agentId: 'test-agent',
    contextId: 'test-context',
    messages: [{ role: 'user', content: userMessage }],
    ...overrides,
  });

  beforeEach(() => {
    stateStore = new MockStateStore();

    config = {
      agentId: 'test-agent',
      llmProvider: new MockLLMProvider([]),
      toolProviders: [new MockToolProvider()],
      stateStore,
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

      // Should have: task, working, completed events
      expect(events.length).toBeGreaterThanOrEqual(3);
      expect(events[0].kind).toBe('task');
      expect(events[1].kind).toBe('status-update');
      if (events[1].kind === 'status-update') {
        expect(events[1].status.state).toBe('working');
      }

      const finalEvent = events[events.length - 1];
      expect(finalEvent.kind).toBe('status-update');
      if (finalEvent.kind === 'status-update') {
        expect(finalEvent.status.state).toBe('completed');
        expect(finalEvent.final).toBe(true);
      }
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

      // Verify all events are A2A-compliant
      events.forEach((event) => {
        if (!event.kind.startsWith('internal:')) {
          expect(['task', 'status-update', 'artifact-update']).toContain(event.kind);
        }
      });

      // First event should be TaskEvent
      expect(events[0].kind).toBe('task');
      expect(events[0]).toHaveProperty('id');
      expect(events[0]).toHaveProperty('contextId');
      expect(events[0]).toHaveProperty('status');

      // Last event should be final StatusUpdateEvent
      const lastEvent = events[events.length - 1];
      expect(lastEvent.kind).toBe('status-update');
      if (lastEvent.kind === 'status-update') {
        expect(lastEvent.final).toBe(true);
      }
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
      expect(finalEvent.kind).toBe('status-update');
      if (finalEvent.kind === 'status-update') {
        expect(finalEvent.status.state).toBe('completed');
      }
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
      if (finalEvent.kind === 'status-update') {
        expect(finalEvent.status.state).toBe('completed');
      }
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
      if (finalEvent.kind === 'status-update') {
        expect(finalEvent.status.state).toBe('completed');
      }
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
      const tasks = await stateStore.listTasks();
      expect(tasks.length).toBe(1);

      const state = await stateStore.load(tasks[0]);
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

      await stateStore.save(taskId, checkpointedState);

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
      if (finalEvent.kind === 'status-update') {
        expect(finalEvent.status.state).toBe('completed');
      }
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

      await stateStore.save(taskId, completedState);

      const events$ = await AgentLoop.resume(taskId, config);
      const event = await firstValueFrom(events$);

      if (event.kind === 'status-update') {
        expect(event.status.state).toBe('completed');
        expect(event.final).toBe(true);
      }
    });
  });

  describe('Error Handling', () => {
    it('should handle execution errors', async () => {
      const errorProvider = new (class implements LLMProvider {
        call(): Observable<LLMResponse> {
          return throwError(() => new Error('LLM service unavailable'));
        }
      })();

      const loop = new AgentLoop({
        ...config,
        llmProvider: errorProvider,
      });

      const events$ = loop.execute(createTestContext('This will fail'));
      const events = await lastValueFrom(events$.pipe(toArray()));

      const errorEvent = events[events.length - 1];
      if (errorEvent.kind === 'status-update') {
        expect(errorEvent.status.state).toBe('failed');
        expect(errorEvent.final).toBe(true);
        expect(errorEvent.metadata).toHaveProperty('error');
      }
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

      // Should stop after max iterations
      const finalEvent = events[events.length - 1];
      if (finalEvent.kind === 'status-update') {
        expect(finalEvent.status.state).toBe('completed');
      }
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

      const traceContext = {
        traceId: 'trace-123',
        spanId: 'span-456',
        traceFlags: 1,
      };

      const events$ = loop.execute(createTestContext('Test', { traceContext }));
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
