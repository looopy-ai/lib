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
import type { ThoughtStreamEvent, ThoughtType, ThoughtVerbosity } from '../src/events/types';

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

  it('should tag thoughts from tool calls with source="tool-call"', async () => {
    const emittedEvents: ThoughtStreamEvent[] = [];

    // Mock event emitter that captures thoughts
    const mockEmitter: Partial<LoopEventEmitter> = {
      emitThought: (
        _taskId: string,
        _contextId: string,
        thoughtType: import('../src/events/types').ThoughtType,
        content: string,
        options?: {
          thoughtId?: string;
          verbosity?: import('../src/events/types').ThoughtVerbosity;
          confidence?: number;
          alternatives?: string[];
          relatedTo?: string;
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
          metadata: {
            confidence: options?.confidence,
            relatedTo: options?.relatedTo,
            alternatives: options?.alternatives,
            ...options?.metadata,
          },
        });
      },
    };

    // Import and use thought tools
    const { thoughtTools } = await import('../src/tools/thought-tools');

    const provider = thoughtTools({
      eventEmitter: mockEmitter as LoopEventEmitter,
      taskId: 'test-task',
      contextId: 'test-ctx',
    });

    // Execute think_aloud tool
    const result = await provider.execute(
      {
        id: 'call_123',
        type: 'function',
        function: {
          name: 'think_aloud',
          arguments: {
            thought: 'I need to use the calculator tool',
            thought_type: 'planning',
            confidence: 0.9,
          },
        },
      },
      {} as import('../src/tools/interfaces').ExecutionContext
    );

    // Verify tool execution succeeded
    expect(result.success).toBe(true);

    // Verify thought was emitted with source="tool-call"
    expect(emittedEvents).toHaveLength(1);
    expect(emittedEvents[0].content).toBe('I need to use the calculator tool');
    expect(emittedEvents[0].thoughtType).toBe('planning');
    expect(emittedEvents[0].metadata?.source).toBe('tool-call');
    expect(emittedEvents[0].metadata?.confidence).toBe(0.9);
  });

  it('should handle multiple thoughts from different sources', async () => {
    const emittedEvents: ThoughtStreamEvent[] = [];

    const mockEmitter: Partial<LoopEventEmitter> = {
      emitContentDelta: () => {
        // No-op for this test
      },
      emitThought: (
        _taskId: string,
        _contextId: string,
        thoughtType: ThoughtType,
        content: string,
        options?: {
          thoughtId?: string;
          verbosity?: ThoughtVerbosity;
          metadata?: Record<string, unknown>;
        }
      ) => {
        emittedEvents.push({
          kind: 'thought-stream',
          contextId: 'test-ctx',
          taskId: 'test-task',
          thoughtId: options?.thoughtId || `thought-${emittedEvents.length}`,
          thoughtType,
          verbosity: options?.verbosity || 'normal',
          content,
          index: emittedEvents.length,
          timestamp: new Date().toISOString(),
          metadata: options?.metadata,
        });
      },
    };

    // Extract from content
    const source$ = new Subject<LLMResponse>();
    const result$ = source$.pipe(
      extractThoughtsFromStream('test-task', 'test-ctx', mockEmitter as LoopEventEmitter)
    );

    const responses: LLMResponse[] = [];
    result$.subscribe({
      next: (response) => responses.push(response),
    });

    source$.next({
      message: {
        role: 'assistant',
        content: '<thinking>First thought from content</thinking>Response text',
      },
      finished: false,
    });

    source$.complete();

    await new Promise((resolve) => setTimeout(resolve, 10));

    // Use tool call
    const { thoughtTools } = await import('../src/tools/thought-tools');
    const provider = thoughtTools({
      eventEmitter: mockEmitter as LoopEventEmitter,
      taskId: 'test-task',
      contextId: 'test-ctx',
    });

    await provider.execute(
      {
        id: 'call_456',
        type: 'function',
        function: {
          name: 'think_aloud',
          arguments: {
            thought: 'Second thought from tool call',
            thought_type: 'reasoning',
          },
        },
      },
      {} as import('../src/tools/interfaces').ExecutionContext
    );

    // Verify both thoughts were emitted with correct sources
    expect(emittedEvents).toHaveLength(2);

    expect(emittedEvents[0].content).toBe('First thought from content');
    expect(emittedEvents[0].metadata?.source).toBe('content');

    expect(emittedEvents[1].content).toBe('Second thought from tool call');
    expect(emittedEvents[1].metadata?.source).toBe('tool-call');
  });
});
