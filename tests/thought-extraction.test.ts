/**
 * Tests for thought extraction from LLM responses
 */

import { lastValueFrom, Observable } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentLoop } from '../src/core/agent-loop';
import type { ArtifactStore, LLMProvider } from '../src/core/types';
import type { InternalEvent } from '../src/events';

// Mock ArtifactStore implementation
class MockArtifactStore implements ArtifactStore {
  async createFileArtifact(): Promise<string> {
    return 'artifact-1';
  }
  async createDataArtifact(): Promise<string> {
    return 'artifact-1';
  }
  async createDatasetArtifact(): Promise<string> {
    return 'artifact-1';
  }
  async appendFileChunk(): Promise<void> {}
  async writeData(): Promise<void> {}
  async appendDatasetBatch(): Promise<void> {}
  async getArtifact(): Promise<null> {
    return null;
  }
  async getFileContent(): Promise<string> {
    return '';
  }
  async getDataContent(): Promise<Record<string, unknown>> {
    return {};
  }
  async getDatasetRows(): Promise<Record<string, unknown>[]> {
    return [];
  }
  async getTaskArtifacts(): Promise<string[]> {
    return [];
  }
  async queryArtifacts(): Promise<string[]> {
    return [];
  }
  async getArtifactByContext(): Promise<null> {
    return null;
  }
  async deleteArtifact(): Promise<void> {}
}

describe('Thought Extraction', () => {
  let mockLLMProvider: LLMProvider;
  let capturedEvents: InternalEvent[];

  beforeEach(() => {
    capturedEvents = [];
  });

  it('should extract thoughts from streaming content delta', async () => {
    // Mock provider that returns thinking tags in streaming delta
    mockLLMProvider = {
      call: () => {
        return new Observable((subscriber) => {
          // First chunk with thinking tag
          subscriber.next({
            message: {
              role: 'assistant',
              content: '<thinking>I need to analyze this carefully</thinking>',
              contentDelta: '<thinking>I need to analyze this carefully</thinking>',
            },
            finished: false,
          });

          // Second chunk with normal content
          subscriber.next({
            message: {
              role: 'assistant',
              content: '<thinking>I need to analyze this carefully</thinking>The answer is 42',
              contentDelta: 'The answer is 42',
            },
            finished: false,
          });

          // Final response
          subscriber.next({
            message: {
              role: 'assistant',
              content: '<thinking>I need to analyze this carefully</thinking>The answer is 42',
            },
            finished: true,
            finishReason: 'stop' as const,
          });

          subscriber.complete();
        });
      },
    };

    const loop = new AgentLoop({
      agentId: 'test-agent',
      llmProvider: mockLLMProvider,
      toolProviders: [],
      taskStateStore: {
        save: vi.fn().mockResolvedValue(undefined),
        load: vi.fn().mockResolvedValue(null),
        delete: vi.fn().mockResolvedValue(undefined),
        exists: vi.fn().mockResolvedValue(false),
        listTasks: vi.fn().mockResolvedValue([]),
        setTTL: vi.fn().mockResolvedValue(undefined),
      },
      artifactStore: new MockArtifactStore(),
    });

    const events$ = loop.startTurn([{ role: 'user', content: 'What is the answer?' }], {
      contextId: 'test-context',
      turnNumber: 1,
    });

    // Collect all events
    events$.subscribe((event) => {
      capturedEvents.push(event);
    });

    await lastValueFrom(events$);

    // Find thought events
    const thoughtEvents = capturedEvents.filter((e) => e.kind === 'thought-stream');

    // Should have extracted one thought
    expect(thoughtEvents.length).toBeGreaterThan(0);

    const thoughtEvent = thoughtEvents[0];
    expect(thoughtEvent.kind).toBe('thought-stream');
    if (thoughtEvent.kind === 'thought-stream') {
      expect(thoughtEvent.content).toBe('I need to analyze this carefully');
      expect(thoughtEvent.thoughtType).toBe('reasoning');
      expect(thoughtEvent.verbosity).toBe('normal');
      expect(thoughtEvent.thoughtId).toBeDefined();
      expect(thoughtEvent.thoughtId).toMatch(/^thought-\d+-[a-z0-9]+$/);
    }

    // Find content events - should not contain thinking tags
    const contentDeltaEvents = capturedEvents.filter((e) => e.kind === 'content-delta');
    const contentCompleteEvents = capturedEvents.filter((e) => e.kind === 'content-complete');

    // Content delta should not include thinking tags (first chunk should be empty or removed)
    for (const event of contentDeltaEvents) {
      if (event.kind === 'content-delta') {
        expect(event.delta).not.toContain('<thinking>');
        expect(event.delta).not.toContain('</thinking>');
      }
    }

    // Content complete should not include thinking tags
    for (const event of contentCompleteEvents) {
      if (event.kind === 'content-complete') {
        expect(event.content).not.toContain('<thinking>');
        expect(event.content).not.toContain('</thinking>');
        expect(event.content).toContain('The answer is 42');
      }
    }
  });

  it('should handle multiple thinking tags', async () => {
    mockLLMProvider = {
      call: () => {
        return new Observable((subscriber) => {
          subscriber.next({
            message: {
              role: 'assistant',
              content:
                '<thinking>First thought</thinking>Content<thinking>Second thought</thinking>',
              contentDelta:
                '<thinking>First thought</thinking>Content<thinking>Second thought</thinking>',
            },
            finished: false,
          });

          subscriber.next({
            message: {
              role: 'assistant',
              content:
                '<thinking>First thought</thinking>Content<thinking>Second thought</thinking>',
            },
            finished: true,
            finishReason: 'stop' as const,
          });

          subscriber.complete();
        });
      },
    };

    const loop = new AgentLoop({
      agentId: 'test-agent',
      llmProvider: mockLLMProvider,
      toolProviders: [],
      taskStateStore: {
        save: vi.fn().mockResolvedValue(undefined),
        load: vi.fn().mockResolvedValue(null),
        delete: vi.fn().mockResolvedValue(undefined),
        exists: vi.fn().mockResolvedValue(false),
        listTasks: vi.fn().mockResolvedValue([]),
        setTTL: vi.fn().mockResolvedValue(undefined),
      },
      artifactStore: new MockArtifactStore(),
    });

    const events$ = loop.startTurn([{ role: 'user', content: 'Think about this' }], {
      contextId: 'test-context',
      turnNumber: 1,
    });

    events$.subscribe((event) => {
      capturedEvents.push(event);
    });

    await lastValueFrom(events$);

    const thoughtEvents = capturedEvents.filter((e) => e.kind === 'thought-stream');

    // Should have two thought events
    expect(thoughtEvents.length).toBeGreaterThanOrEqual(2);

    if (thoughtEvents[0]?.kind === 'thought-stream') {
      expect(thoughtEvents[0].content).toBe('First thought');
    }
    if (thoughtEvents[1]?.kind === 'thought-stream') {
      expect(thoughtEvents[1].content).toBe('Second thought');
    }
  });

  it('should handle content without thinking tags', async () => {
    mockLLMProvider = {
      call: () => {
        return new Observable((subscriber) => {
          subscriber.next({
            message: {
              role: 'assistant',
              content: 'Just regular content',
              contentDelta: 'Just regular content',
            },
            finished: false,
          });

          subscriber.next({
            message: {
              role: 'assistant',
              content: 'Just regular content',
            },
            finished: true,
            finishReason: 'stop' as const,
          });

          subscriber.complete();
        });
      },
    };

    const loop = new AgentLoop({
      agentId: 'test-agent',
      llmProvider: mockLLMProvider,
      toolProviders: [],
      taskStateStore: {
        save: vi.fn().mockResolvedValue(undefined),
        load: vi.fn().mockResolvedValue(null),
        delete: vi.fn().mockResolvedValue(undefined),
        exists: vi.fn().mockResolvedValue(false),
        listTasks: vi.fn().mockResolvedValue([]),
        setTTL: vi.fn().mockResolvedValue(undefined),
      },
      artifactStore: new MockArtifactStore(),
    });

    const events$ = loop.startTurn([{ role: 'user', content: 'Simple question' }], {
      contextId: 'test-context',
      turnNumber: 1,
    });

    events$.subscribe((event) => {
      capturedEvents.push(event);
    });

    await lastValueFrom(events$);

    // Should have no thought events
    const thoughtEvents = capturedEvents.filter((e) => e.kind === 'thought-stream');
    expect(thoughtEvents.length).toBe(0);

    // Content should remain unchanged
    const contentEvents = capturedEvents.filter((e) => e.kind === 'content-delta');
    if (contentEvents[0]?.kind === 'content-delta') {
      expect(contentEvents[0].delta).toBe('Just regular content');
    }
  });
});
