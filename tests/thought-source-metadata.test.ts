/**
 * Test for thought source metadata
 *
 * Verifies that thoughts extracted from content and tool calls
 * are tagged with the correct source metadata.
 */

import { Subject } from 'rxjs';
import { describe, expect, it } from 'vitest';
import type { LoopEventEmitter } from '../src/core/operators/event-emitter';
import { extractThoughtsFromStream } from '../src/core/operators/thought-stream';
import type { LLMResponse } from '../src/core/types';
import type { ThoughtStreamEvent } from '../src/events/types';

describe('Thought Source Metadata', () => {
  it('should tag thoughts from content with source="content"', async () => {
    const emittedEvents: ThoughtStreamEvent[] = [];

    // Mock event emitter
    const mockEmitter: Partial<LoopEventEmitter> = {
      emitContentDelta: () => {
        // No-op for this test
      },
      emitThought: (
        _taskId: string,
        _contextId: string,
        thoughtType: import('../src/events/types').ThoughtType,
        content: string,
        options?: {
          thoughtId?: string;
          verbosity?: import('../src/events/types').ThoughtVerbosity;
          metadata?: Record<string, unknown>;
        }
      ) => {
        emittedEvents.push({
          kind: 'thought-stream',
          contextId: 'test-ctx',
          taskId: 'test-task',
          thoughtId: options?.thoughtId || 'test-id',
          thoughtType,
          verbosity: options?.verbosity || 'normal',
          content,
          index: 0,
          timestamp: new Date().toISOString(),
          metadata: options?.metadata,
        });
      },
    };

    const source$ = new Subject<LLMResponse>();

    // Apply the operator
    const result$ = source$.pipe(
      extractThoughtsFromStream('test-task', 'test-ctx', mockEmitter as LoopEventEmitter)
    );

    // Subscribe
    const responses: LLMResponse[] = [];
    result$.subscribe({
      next: (response) => responses.push(response),
    });

    // Emit response with thinking tag in content
    source$.next({
      message: {
        role: 'assistant',
        content: '<thinking>Planning my approach</thinking>Hello!',
      },
      finished: false,
    });

    source$.complete();

    // Wait for processing
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Verify thought was emitted with source="content"
    expect(emittedEvents).toHaveLength(1);
    expect(emittedEvents[0].content).toBe('Planning my approach');
    expect(emittedEvents[0].metadata?.source).toBe('content');
  });
});
