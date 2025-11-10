/**
 * Test that documents the correct pattern for artifact store scheduling
 *
 * The correct pattern is to wrap the artifact store with ArtifactScheduler BEFORE
 * passing it to Agent, and use the same scheduled instance for artifact tools.
 */

import { of } from 'rxjs';
import { describe, expect, it } from 'vitest';
import { Agent } from '../src/core/agent';
import { ArtifactScheduler } from '../src/stores/artifacts/artifact-scheduler';
import { InMemoryArtifactStore } from '../src/stores/artifacts/memory-artifact-store';
import { InMemoryMessageStore } from '../src/stores/messages/memory-message-store';

describe('Agent Artifact Store Scheduling', () => {
  it('should accept pre-scheduled artifact store', () => {
    const baseStore = new InMemoryArtifactStore();
    const scheduledStore = new ArtifactScheduler(baseStore);
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
      artifactStore: scheduledStore, // Pass scheduled store directly
    });

    // Agent should use the store as-is, no wrapping
    // biome-ignore lint/complexity/useLiteralKeys: accessing private property for test
    expect(agent['config'].artifactStore).toBe(scheduledStore);
  });

  it('should use same store instance for agent and tools - correct pattern', () => {
    const baseStore = new InMemoryArtifactStore();
    const scheduledStore = new ArtifactScheduler(baseStore);
    const messageStore = new InMemoryMessageStore();

    // ✅ CORRECT: Create scheduled store once, use everywhere
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
      artifactStore: scheduledStore, // Same instance
    });

    // Tools would use the same scheduledStore instance
    // Example: const artifactTools = createArtifactTools(scheduledStore, stateStore);

    // biome-ignore lint/complexity/useLiteralKeys: accessing private property for test
    expect(agent['config'].artifactStore).toBe(scheduledStore);
  });

  it('can also work without scheduler if user chooses', () => {
    const baseStore = new InMemoryArtifactStore();
    const messageStore = new InMemoryMessageStore();

    // User can choose NOT to use scheduler
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
      artifactStore: baseStore, // Use base store directly
    });

    // biome-ignore lint/complexity/useLiteralKeys: accessing private property for test
    expect(agent['config'].artifactStore).toBe(baseStore);
    // biome-ignore lint/complexity/useLiteralKeys: accessing private property for test
    expect(agent['config'].artifactStore).not.toBeInstanceOf(ArtifactScheduler);
  });
});
