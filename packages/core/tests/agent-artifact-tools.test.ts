/**
 * Test that documents the correct pattern for artifact store scheduling
 * and verifies agent-level integration with artifact tools including override functionality.
 */

import { concat, lastValueFrom, of } from 'rxjs';
import { beforeEach, describe, expect, it } from 'vitest';
import { Agent } from '../src/core/agent';
import { InMemoryArtifactStore } from '../src/stores/artifacts/memory-artifact-store';
import { InMemoryStateStore } from '../src/stores/memory/memory-state-store';
import { InMemoryMessageStore } from '../src/stores/messages/memory-message-store';
import { createArtifactTools } from '../src/tools/artifact-tools';
import type { LLMProvider } from '../src/types/llm';

describe('Agent Artifact Tools Integration', () => {
  let artifactStore: InMemoryArtifactStore;
  let messageStore: InMemoryMessageStore;
  let taskStateStore: InMemoryStateStore;

  beforeEach(() => {
    artifactStore = new InMemoryArtifactStore();
    messageStore = new InMemoryMessageStore();
    taskStateStore = new InMemoryStateStore();
  });

  // Mock LLM provider that returns tool calls on first call, then completes
  const createMockLLMProvider = (
    toolCalls?: Array<{ name: string; arguments: string }>,
  ): LLMProvider => {
    let callCount = 0;
    return {
      call: () => {
        callCount++;

        // First call: return tool calls if provided
        if (callCount === 1 && toolCalls) {
          const timestamp = new Date().toISOString();
          const parsedToolCalls = toolCalls.map((tc, idx) => ({
            id: `call_${idx}`,
            type: 'function' as const,
            function: {
              name: tc.name,
              arguments: JSON.parse(tc.arguments), // Parse the JSON string to object
            },
          }));

          // Emit tool-call events first, then content-complete
          // This matches how LiteLLM provider works
          const toolCallEvents = parsedToolCalls.map((tc) => ({
            kind: 'tool-call' as const,
            contextId: 'test-context',
            taskId: 'test-task',
            toolCallId: tc.id,
            toolName: tc.function.name,
            arguments: tc.function.arguments,
            timestamp,
          }));

          const contentComplete = {
            kind: 'content-complete' as const,
            contextId: 'test-context',
            taskId: 'test-task',
            content: '',
            finishReason: 'tool_calls' as const,
            toolCalls: parsedToolCalls,
            timestamp,
          };

          return concat(...toolCallEvents.map((e) => of(e)), of(contentComplete));
        }

        // Second call (or first if no tool calls): return completion
        return of({
          kind: 'content-complete' as const,
          contextId: 'test-context',
          taskId: 'test-task',
          content: 'Done',
          finishReason: 'stop' as const,
          timestamp: new Date().toISOString(),
        });
      },
    };
  };

  it('should accept pre-scheduled artifact store', async () => {
    const mockLLM = createMockLLMProvider();
    const artifactTools = createArtifactTools(artifactStore, taskStateStore);

    const agent = new Agent({
      contextId: 'test-context',
      llmProvider: mockLLM,
      toolProviders: [artifactTools],
      messageStore,
    });

    // biome-ignore lint/suspicious/noExplicitAny: accessing private for test verification
    const configStore = (agent as any).config.artifactStore;
    expect(configStore).toBe(artifactStore);
  });

  it('should use artifact tools to create and override file artifacts', async () => {
    // First turn: create artifact
    const createLLM = createMockLLMProvider([
      {
        name: 'create_file_artifact',
        arguments: JSON.stringify({
          artifactId: 'test-file',
          name: 'Test File',
          description: 'A test file',
          mimeType: 'text/plain',
        }),
      },
    ]);

    const artifactTools = createArtifactTools(artifactStore, taskStateStore);

    const agent1 = new Agent({
      contextId: 'test-context',
      llmProvider: createLLM,
      toolProviders: [artifactTools],
      messageStore,
    });

    const turn1$ = await agent1.startTurn('Create a file artifact');
    await lastValueFrom(turn1$);

    // Verify artifact was created
    let artifact = await artifactStore.getArtifact('test-context', 'test-file');
    expect(artifact).toBeDefined();
    expect(artifact?.type).toBe('file');
    expect(artifact?.name).toBe('Test File');
    const initialVersion = artifact?.version || 0;

    // Second turn: override the same artifact
    const overrideLLM = createMockLLMProvider([
      {
        name: 'create_file_artifact',
        arguments: JSON.stringify({
          artifactId: 'test-file',
          name: 'Updated Test File',
          description: 'An updated test file',
          mimeType: 'text/markdown',
          override: true,
        }),
      },
    ]);

    const agent2 = new Agent({
      contextId: 'test-context',
      llmProvider: overrideLLM,
      toolProviders: [artifactTools],
      messageStore,
    });

    const turn2$ = await agent2.startTurn('Override the file artifact');
    await lastValueFrom(turn2$);

    // Verify artifact was overridden
    artifact = await artifactStore.getArtifact('test-context', 'test-file');
    expect(artifact).toBeDefined();
    expect(artifact?.type).toBe('file');
    expect(artifact?.name).toBe('Updated Test File');
    expect(artifact?.version).toBeGreaterThan(initialVersion); // Version incremented
  });

  it('should use artifact tools to create and override data artifacts', async () => {
    // First turn: create data artifact
    const createLLM = createMockLLMProvider([
      {
        name: 'create_data_artifact',
        arguments: JSON.stringify({
          artifactId: 'test-data',
          name: 'Test Data',
          description: 'Test data object',
          data: { value: 'original' },
        }),
      },
    ]);

    const artifactTools = createArtifactTools(artifactStore, taskStateStore);

    const agent1 = new Agent({
      contextId: 'test-context',
      llmProvider: createLLM,
      toolProviders: [artifactTools],
      messageStore,
    });

    const turn1$ = await agent1.startTurn('Create a data artifact');
    await lastValueFrom(turn1$);

    // Verify artifact was created
    let artifact = await artifactStore.getArtifact('test-context', 'test-data');
    expect(artifact).toBeDefined();
    expect(artifact?.type).toBe('data');
    const initialVersion = artifact?.version || 0;

    let data = await artifactStore.getDataContent('test-context', 'test-data');
    expect(data).toEqual({ value: 'original' });

    // Second turn: override with new data
    const overrideLLM = createMockLLMProvider([
      {
        name: 'create_data_artifact',
        arguments: JSON.stringify({
          artifactId: 'test-data',
          name: 'Updated Test Data',
          data: { value: 'updated' },
          override: true,
        }),
      },
    ]);

    const agent2 = new Agent({
      contextId: 'test-context',
      llmProvider: overrideLLM,
      toolProviders: [artifactTools],
      messageStore,
    });

    const turn2$ = await agent2.startTurn('Override the data artifact');
    await lastValueFrom(turn2$);

    // Verify artifact was overridden
    artifact = await artifactStore.getArtifact('test-context', 'test-data');
    expect(artifact).toBeDefined();
    expect(artifact?.type).toBe('data');
    expect(artifact?.version).toBeGreaterThan(initialVersion); // Version incremented

    data = await artifactStore.getDataContent('test-context', 'test-data');
    expect(data).toEqual({ value: 'updated' });
  });

  it('should use artifact tools to create and override dataset artifacts', async () => {
    const schema = {
      columns: [
        { name: 'id', type: 'number' as const },
        { name: 'name', type: 'string' as const },
      ],
    };

    // First turn: create dataset
    const createLLM = createMockLLMProvider([
      {
        name: 'create_dataset_artifact',
        arguments: JSON.stringify({
          artifactId: 'test-dataset',
          name: 'Test Dataset',
          description: 'Test dataset',
          schema,
        }),
      },
    ]);

    const artifactTools = createArtifactTools(artifactStore, taskStateStore);

    const agent1 = new Agent({
      contextId: 'test-context',
      llmProvider: createLLM,
      toolProviders: [artifactTools],
      messageStore,
    });

    const turn1$ = await agent1.startTurn('Create a dataset artifact');
    await lastValueFrom(turn1$);

    // Verify artifact was created
    let artifact = await artifactStore.getArtifact('test-context', 'test-dataset');
    expect(artifact).toBeDefined();
    expect(artifact?.type).toBe('dataset');
    const initialVersion = artifact?.version || 0;

    // Second turn: override the dataset
    const overrideLLM = createMockLLMProvider([
      {
        name: 'create_dataset_artifact',
        arguments: JSON.stringify({
          artifactId: 'test-dataset',
          name: 'Updated Dataset',
          schema,
          override: true,
        }),
      },
    ]);

    const agent2 = new Agent({
      contextId: 'test-context',
      llmProvider: overrideLLM,
      toolProviders: [artifactTools],
      messageStore,
    });

    const turn2$ = await agent2.startTurn('Override the dataset');
    await lastValueFrom(turn2$);

    // Verify artifact was overridden
    artifact = await artifactStore.getArtifact('test-context', 'test-dataset');
    expect(artifact).toBeDefined();
    expect(artifact?.type).toBe('dataset');
    expect(artifact?.name).toBe('Updated Dataset');
    expect(artifact?.version).toBeGreaterThan(initialVersion); // Version incremented
  });

  it('can also work without scheduler if user chooses', async () => {
    const mockLLM = createMockLLMProvider();
    const artifactTools = createArtifactTools(artifactStore, taskStateStore);

    const agent = new Agent({
      contextId: 'test-context',
      llmProvider: mockLLM,
      toolProviders: [artifactTools],
      messageStore,
    });

    // biome-ignore lint/suspicious/noExplicitAny: accessing private for test verification
    const configStore = (agent as any).config.artifactStore;
    expect(configStore).toBe(artifactStore);
  });
});
