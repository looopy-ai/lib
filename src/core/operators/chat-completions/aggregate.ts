import { Observable, type OperatorFunction } from 'rxjs';
import type { Choice, ToolCall } from './types';

type ToolCallAccumulator = {
  id: string | null;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
};

type AggregatedChoice = {
  index?: number;
  delta?: {
    content?: string;
    tool_calls?: ToolCall[];
  };
  finish_reason?: string | null;
};

const mergeToolCallDelta = (existing: ToolCallAccumulator, delta: ToolCall): void => {
  if (delta.id) {
    existing.id = delta.id;
  }
  if (delta.function?.name) {
    existing.function.name = delta.function.name;
  }
  if (delta.function?.arguments) {
    existing.function.arguments += delta.function.arguments;
  }
};

const createToolCallAccumulator = (delta: ToolCall): ToolCallAccumulator => ({
  id: delta.id ?? null,
  type: 'function',
  function: {
    name: delta.function?.name || '',
    arguments: delta.function?.arguments || '',
  },
});

const processToolCallDeltas = (
  toolCallsByIndex: Map<number, ToolCallAccumulator>,
  deltas: ToolCall[]
): void => {
  for (const toolCallDelta of deltas) {
    const idx = toolCallDelta.index;
    const existing = toolCallsByIndex.get(idx);

    if (!existing) {
      toolCallsByIndex.set(idx, createToolCallAccumulator(toolCallDelta));
    } else {
      mergeToolCallDelta(existing, toolCallDelta);
    }
  }
};

const finalizeToolCalls = (toolCallsByIndex: Map<number, ToolCallAccumulator>): ToolCall[] => {
  return Array.from(toolCallsByIndex.entries())
    .sort(([a], [b]) => a - b)
    .map(([idx, tc]) => ({
      index: idx,
      id: tc.id,
      type: tc.type,
      function: tc.function,
    }));
};

const processChoice = (
  choice: Choice,
  aggregated: AggregatedChoice,
  toolCallsByIndex: Map<number, ToolCallAccumulator>
): void => {
  // Set index from first choice (should be consistent)
  if (aggregated.index === undefined) {
    aggregated.index = choice.index;
  }

  // Aggregate delta fields
  if (choice.delta) {
    // Concatenate content
    if (choice.delta.content) {
      const existingContent = aggregated.delta?.content || '';
      aggregated.delta = {
        ...aggregated.delta,
        content: existingContent + choice.delta.content,
      };
    }

    // Aggregate tool calls by index
    if (choice.delta.tool_calls) {
      processToolCallDeltas(toolCallsByIndex, choice.delta.tool_calls);
    }
  }

  // Update finish_reason (typically set in the last chunk)
  if (choice.finish_reason) {
    aggregated.finish_reason = choice.finish_reason;
  }
};

/**
 * Aggregate streaming Choice deltas into a single complete Choice object.
 *
 * This operator accumulates all delta fields from streamed Choice objects
 * and emits a single aggregated Choice at the end of the stream.
 *
 * Follows the OpenAI streaming response pattern where:
 * - content chunks are concatenated
 * - tool_calls are assembled by index
 * - finish_reason is set from the final delta
 *
 * @see https://platform.openai.com/docs/guides/streaming-responses
 */
export const aggregateChoice =
  <T extends Choice>(): OperatorFunction<T, T> =>
  (source) =>
    new Observable<T>((subscriber) => {
      const aggregated: AggregatedChoice = {};
      const toolCallsByIndex = new Map<number, ToolCallAccumulator>();

      const sub = source.subscribe({
        next: (choice) => {
          processChoice(choice, aggregated, toolCallsByIndex);
        },
        error: (err) => subscriber.error(err),
        complete: () => {
          // Add aggregated tool_calls to delta if any were collected
          if (toolCallsByIndex.size > 0) {
            aggregated.delta = {
              ...aggregated.delta,
              tool_calls: finalizeToolCalls(toolCallsByIndex),
            };
          }

          // Emit the fully aggregated choice
          subscriber.next(aggregated as T);
          subscriber.complete();
        },
      });

      return () => sub.unsubscribe();
    });
