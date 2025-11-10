/**
 * Composed streaming operators for common LLM response patterns
 *
 * These operators combine the low-level chat-completion operators
 * into higher-level, reusable pipelines for common use cases.
 */

import { type Observable, share } from 'rxjs';
import { aggregateChoice } from './aggregate';
import { getContent, splitInlineXml } from './content';
import { assembleToolCalls, getToolCalls } from './tool-calls';
import type { Choice, InlineXml, ToolCall } from './types';

/**
 * Pipeline result containing multiple output streams
 */
export type StreamPipeline<T extends Choice = Choice> = {
  /** Stream of content chunks (with inline XML removed) */
  content: Observable<string>;
  /** Stream of extracted inline XML tags (e.g., <thinking>) */
  tags: Observable<InlineXml>;
  /** Stream of complete tool calls as they're assembled */
  toolCalls: Observable<ToolCall>;
  /** Single aggregated Choice emitted at completion */
  aggregated: Observable<T>;
};

/**
 * Create a complete streaming pipeline from Choice chunks
 *
 * This operator splits a Choice stream into multiple specialized streams:
 * - Content chunks (cleaned of inline XML)
 * - Inline XML tags (thoughts, etc.)
 * - Assembled tool calls
 * - Final aggregated response
 *
 * @example
 * ```typescript
 * const pipeline = createStreamPipeline(streamingChoices$);
 *
 * // Display content to user in real-time
 * pipeline.content.subscribe(chunk => updateUI(chunk));
 *
 * // Extract and log thoughts
 * pipeline.tags.pipe(
 *   filter(tag => tag.name === 'thinking')
 * ).subscribe(thought => console.log(thought.content));
 *
 * // Execute tools as they arrive
 * pipeline.toolCalls.subscribe(toolCall => executeTool(toolCall));
 *
 * // Get final complete response
 * pipeline.aggregated.subscribe(final => saveFinalResponse(final));
 * ```
 */
export function createStreamPipeline<T extends Choice = Choice>(
  source: Observable<T>
): StreamPipeline<T> {
  // Share the source to avoid multiple subscriptions
  const shared$ = source.pipe(share());

  // Extract and split content (removes inline XML)
  const contentStream$ = shared$.pipe(getContent());
  const { content, tags } = splitInlineXml(contentStream$);

  // Extract and assemble tool calls
  const toolCalls = shared$.pipe(getToolCalls(), assembleToolCalls());

  // Aggregate final response
  const aggregated = shared$.pipe(aggregateChoice<T>());

  return {
    content,
    tags,
    toolCalls,
    aggregated,
  };
}

/**
 * Simplified pipeline for content-only streaming (no tool calls)
 *
 * @example
 * ```typescript
 * const { content, thoughts } = streamContentWithThoughts(choices$);
 *
 * content.subscribe(chunk => display(chunk));
 * thoughts.subscribe(thought => logThought(thought));
 * ```
 */
export function streamContentWithThoughts<T extends Choice = Choice>(
  source: Observable<T>
): {
  content: Observable<string>;
  thoughts: Observable<InlineXml>;
  aggregated: Observable<T>;
} {
  const shared$ = source.pipe(share());
  const { content, tags } = splitInlineXml(shared$.pipe(getContent()));
  const aggregated = shared$.pipe(aggregateChoice<T>());

  return {
    content,
    thoughts: tags,
    aggregated,
  };
}

/**
 * Simplified pipeline for tool-call only responses (no content streaming)
 *
 * @example
 * ```typescript
 * const { toolCalls, aggregated } = streamToolCalls(choices$);
 *
 * toolCalls.subscribe(call => executeTool(call));
 * aggregated.subscribe(final => checkCompletion(final));
 * ```
 */
export function streamToolCalls<T extends Choice = Choice>(
  source: Observable<T>
): {
  toolCalls: Observable<ToolCall>;
  aggregated: Observable<T>;
} {
  const shared$ = source.pipe(share());
  const toolCalls = shared$.pipe(getToolCalls(), assembleToolCalls());
  const aggregated = shared$.pipe(aggregateChoice<T>());

  return {
    toolCalls,
    aggregated,
  };
}

/**
 * Pipeline that provides side-effect callbacks for each stream type
 *
 * Useful when you want to handle all stream types with callbacks
 * while still maintaining the aggregated result.
 *
 * @example
 * ```typescript
 * const aggregated$ = observeStreams(choices$, {
 *   onContent: (chunk) => updateUI(chunk),
 *   onThought: (thought) => logThought(thought),
 *   onToolCall: (call) => executeTool(call),
 * });
 *
 * await lastValueFrom(aggregated$); // Wait for completion
 * ```
 */
export function observeStreams<T extends Choice = Choice>(
  source: Observable<T>,
  handlers: {
    onContent?: (chunk: string) => void;
    onThought?: (thought: InlineXml) => void;
    onToolCall?: (toolCall: ToolCall) => void;
  }
): Observable<T> {
  const shared$ = source.pipe(share());

  // Set up side-effect subscriptions if handlers provided
  if (handlers.onContent || handlers.onThought) {
    const contentStream$ = shared$.pipe(getContent());
    const { content, tags } = splitInlineXml(contentStream$);

    if (handlers.onContent) {
      content.subscribe(handlers.onContent);
    }

    if (handlers.onThought) {
      tags.subscribe(handlers.onThought);
    }
  }

  if (handlers.onToolCall) {
    shared$.pipe(getToolCalls(), assembleToolCalls()).subscribe(handlers.onToolCall);
  }

  // Return aggregated result
  return shared$.pipe(aggregateChoice<T>());
}

/**
 * Collect all stream outputs into arrays
 *
 * Useful for testing or when you need all chunks collected.
 *
 * @example
 * ```typescript
 * const result = await collectStreams(choices$);
 * console.log('Content chunks:', result.contentChunks);
 * console.log('Thoughts:', result.thoughts);
 * console.log('Tool calls:', result.toolCalls);
 * console.log('Final:', result.final);
 * ```
 */
export async function collectStreams<T extends Choice = Choice>(
  source: Observable<T>
): Promise<{
  contentChunks: string[];
  thoughts: InlineXml[];
  toolCalls: ToolCall[];
  final: T;
}> {
  const pipeline = createStreamPipeline(source);

  const contentChunks: string[] = [];
  const thoughts: InlineXml[] = [];
  const toolCalls: ToolCall[] = [];

  // Collect all chunks
  pipeline.content.subscribe((chunk) => contentChunks.push(chunk));
  pipeline.tags.subscribe((tag) => thoughts.push(tag));
  pipeline.toolCalls.subscribe((call) => toolCalls.push(call));

  // Wait for final aggregated result
  const final = await new Promise<T>((resolve, reject) => {
    pipeline.aggregated.subscribe({
      next: resolve,
      error: reject,
    });
  });

  return {
    contentChunks,
    thoughts,
    toolCalls,
    final,
  };
}
