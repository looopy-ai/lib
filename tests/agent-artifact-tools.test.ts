/**
 * Test that documents the correct pattern for artifact store scheduling
 * and verifies agent-level integration with artifact tools including override functionality.
 */

import { lastValueFrom, of } from 'rxjs';
import { beforeEach, describe, expect, it } from 'vitest';
import { Agent } from '../src/core/agent';
import type { LLMProvider } from '../src/core/types';
import { ArtifactScheduler } from '../src/stores/artifacts/artifact-scheduler';
import { InMemoryArtifactStore } from '../src/stores/artifacts/memory-artifact-store';
import { InMemoryStateStore } from '../src/stores/memory/memory-state-store';
import { InMemoryMessageStore } from '../src/stores/messages/memory-message-store';
import { createArtifactTools } from '../src/tools/artifact-tools';

describe('Agent Artifact Tools Integration', () => {
  let artifactStore: InMemoryArtifactStore;
  let scheduledStore: ArtifactScheduler;
  let messageStore: InMemoryMessageStore;
  let taskStateStore: InMemoryStateStore;

  beforeEach(() => {
    artifactStore = new InMemoryArtifactStore();
    scheduledStore = new ArtifactScheduler(artifactStore);
    messageStore = new InMemoryMessageStore();
    taskStateStore = new InMemoryStateStore();
  });

  // Mock LLM provider that returns tool calls
  const createMockLLMProvider = (
    toolCalls?: Array<{ name: string; arguments: string }>
  ): LLMProvider => ({
    call: () => {
      return of({
        kind: 'content-complete' as const,
        content: toolCalls ? '' : 'Done',
        toolCalls: toolCalls?.map((tc, idx) => ({
          id: `call_${idx}`,
          type: 'function' as const,
          function: {
            name: tc.name,
            arguments: tc.arguments,
          },
        })),
        timestamp: new Date().toISOString(),
      });
    },
  });

  it('should accept pre-scheduled artifact store', async () => {
    const mockLLM = createMockLLMProvider();
    const artifactTools = createArtifactTools(scheduledStore, taskStateStore);

    const agent = new Agent({
      contextId: 'test-context',
      llmProvider: mockLLM,
      toolProviders: [artifactTools],
      messageStore,
      artifactStore: scheduledStore,
    });

    // biome-ignore lint/suspicious/noExplicitAny: accessing private for test verification
    const configStore = (agent as any).config.artifactStore;
    expect(configStore).toBe(scheduledStore);
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

    const artifactTools = createArtifactTools(scheduledStore, taskStateStore);

    const agent1 = new Agent({
      contextId: 'test-context',
      llmProvider: createLLM,
      toolProviders: [artifactTools],
      messageStore,
      artifactStore: scheduledStore,
    });

    const turn1$ = await agent1.startTurn('Create a file artifact');
    await lastValueFrom(turn1$);

    // Verify artifact was created
    let artifact = await artifactStore.getArtifact('test-file');
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
      artifactStore: scheduledStore,
    });

    const turn2$ = await agent2.startTurn('Override the file artifact');
    await lastValueFrom(turn2$);

    // Verify artifact was overridden
    artifact = await artifactStore.getArtifact('test-file');
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

    const artifactTools = createArtifactTools(scheduledStore, taskStateStore);

    const agent1 = new Agent({
      contextId: 'test-context',
      llmProvider: createLLM,
      toolProviders: [artifactTools],
      messageStore,
      artifactStore: scheduledStore,
    });

    const turn1$ = await agent1.startTurn('Create a data artifact');
    await lastValueFrom(turn1$);

    // Verify artifact was created
    let artifact = await artifactStore.getArtifact('test-data');
    expect(artifact).toBeDefined();
    expect(artifact?.type).toBe('data');
    const initialVersion = artifact?.version || 0;

    let data = await artifactStore.getDataContent('test-data');
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
      artifactStore: scheduledStore,
    });

    const turn2$ = await agent2.startTurn('Override the data artifact');
    await lastValueFrom(turn2$);

    // Verify artifact was overridden
    artifact = await artifactStore.getArtifact('test-data');
    expect(artifact).toBeDefined();
    expect(artifact?.type).toBe('data');
    expect(artifact?.version).toBeGreaterThan(initialVersion); // Version incremented

    data = await artifactStore.getDataContent('test-data');
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

    const artifactTools = createArtifactTools(scheduledStore, taskStateStore);

    const agent1 = new Agent({
      contextId: 'test-context',
      llmProvider: createLLM,
      toolProviders: [artifactTools],
      messageStore,
      artifactStore: scheduledStore,
    });

    const turn1$ = await agent1.startTurn('Create a dataset artifact');
    await lastValueFrom(turn1$);

    // Verify artifact was created
    let artifact = await artifactStore.getArtifact('test-dataset');
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
      artifactStore: scheduledStore,
    });

    const turn2$ = await agent2.startTurn('Override the dataset');
    await lastValueFrom(turn2$);

    // Verify artifact was overridden
    artifact = await artifactStore.getArtifact('test-dataset');
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
      artifactStore: artifactStore, // Direct store, no scheduling
    });

    // biome-ignore lint/suspicious/noExplicitAny: accessing private for test verification
    const configStore = (agent as any).config.artifactStore;
    expect(configStore).toBe(artifactStore);
  });
});
