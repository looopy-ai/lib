/**
 * Test that Agent correctly exposes scheduled artifact store
 *
 * This test documents the correct pattern for creating artifact tools:
 * Tools should be created AFTER Agent construction using agent.artifactStore
 * to ensure they use the same scheduled store instance as AgentLoop.
 */

import { of } from 'rxjs';
import { describe, expect, it } from 'vitest';
import { Agent } from '../src/core/agent';
import { ArtifactScheduler } from '../src/stores/artifacts/artifact-scheduler';
import { InMemoryArtifactStore } from '../src/stores/artifacts/memory-artifact-store';
import { InMemoryMessageStore } from '../src/stores/messages/memory-message-store';

describe('Agent Artifact Store Scheduling', () => {
  it('should wrap artifact store with scheduler on construction', () => {
    const baseStore = new InMemoryArtifactStore();
    const messageStore = new InMemoryMessageStore();

    const agent = new Agent({
      contextId: 'test-context',
      agentId: 'test-agent',
      llmProvider: {
        call: () =>
          of({
            kind: 'content-complete',
            contextId: 'test-context',
            taskId: 'test-task',
            message: { role: 'assistant', content: 'test' },
            finish_reason: 'stop',
            usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
            timestamp: new Date().toISOString(),
          }),
      },
      toolProviders: [],
      messageStore,
      artifactStore: baseStore,
    });

    // Agent should expose the scheduled store
    expect(agent.artifactStore).toBeInstanceOf(ArtifactScheduler);
    expect(agent.artifactStore).not.toBe(baseStore);
  });

  it('should use same scheduled store in agent config', () => {
    const baseStore = new InMemoryArtifactStore();
    const messageStore = new InMemoryMessageStore();

    const agent = new Agent({
      contextId: 'test-context',
      agentId: 'test-agent',
      llmProvider: {
        call: () =>
          of({
            kind: 'content-complete',
            contextId: 'test-context',
            taskId: 'test-task',
            message: { role: 'assistant', content: 'test' },
            finish_reason: 'stop',
            usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
            timestamp: new Date().toISOString(),
          }),
      },
      toolProviders: [],
      messageStore,
      artifactStore: baseStore,
    });

    // Config should store the scheduled version
    // biome-ignore lint/complexity/useLiteralKeys: accessing private property for test
    expect(agent['config'].artifactStore).toBeInstanceOf(ArtifactScheduler);

    // Getter should return same instance as config
    // biome-ignore lint/complexity/useLiteralKeys: accessing private property for test
    expect(agent.artifactStore).toBe(agent['config'].artifactStore);
  });

  it('should allow creating artifact tools with agent.artifactStore', () => {
    const baseStore = new InMemoryArtifactStore();
    const messageStore = new InMemoryMessageStore();

    const agent = new Agent({
      contextId: 'test-context',
      agentId: 'test-agent',
      llmProvider: {
        call: () =>
          of({
            kind: 'content-complete',
            contextId: 'test-context',
            taskId: 'test-task',
            message: { role: 'assistant', content: 'test' },
            finish_reason: 'stop',
            usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
            timestamp: new Date().toISOString(),
          }),
      },
      toolProviders: [],
      messageStore,
      artifactStore: baseStore,
    });

    // This is the CORRECT pattern: create tools after Agent construction
    // using agent.artifactStore to ensure they use the scheduled store
    const scheduledStore = agent.artifactStore;
    expect(scheduledStore).toBeInstanceOf(ArtifactScheduler);

    // Tools can now be created with the scheduled store
    // Example: const artifactTools = createArtifactTools(agent.artifactStore, stateStore);
  });
});
