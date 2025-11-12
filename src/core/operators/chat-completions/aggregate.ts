import { Observable, type OperatorFunction } from 'rxjs';
import { InlineXmlParser } from './content';
import type { Choice, InlineXml, LLMUsage, ToolCall } from './types';

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
  thoughts?: InlineXml[];
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
  deltas: ToolCall[],
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
  toolCallsByIndex: Map<number, ToolCallAccumulator>,
  xmlParser: InlineXmlParser,
): void => {
  // Set index from first choice (should be consistent)
  if (aggregated.index === undefined) {
    aggregated.index = choice.index;
  }

  // Aggregate delta fields
  if (choice.delta) {
    // Process content through XML parser to extract tags and clean content
    if (choice.delta.content) {
      xmlParser.processChunk(choice.delta.content);
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
      const xmlParser = new InlineXmlParser();

      const sub = source.subscribe({
        next: (choice) => {
          processChoice(choice, aggregated, toolCallsByIndex, xmlParser);
        },
        error: (err) => subscriber.error(err),
        complete: () => {
          // Finalize XML parsing to get clean content and extracted thoughts
          const { content, tags } = xmlParser.finalize();

          // Set the clean content
          if (content) {
            aggregated.delta = {
              ...aggregated.delta,
              content,
            };
          }

          // Store extracted thoughts
          if (tags.length > 0) {
            aggregated.thoughts = tags;
          }

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

const mergeDetailsObject = (
  target: Record<string, number>,
  source?: Record<string, number>,
): void => {
  if (!source) return;
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === 'number') {
      target[key] = (target[key] || 0) + value;
    }
  }
};

const buildAggregatedUsage = (
  promptTokens: number,
  completionTokens: number,
  totalTokens: number,
  cacheCreationInputTokens: number,
  cacheReadInputTokens: number,
  completionTokensDetails: Record<string, number>,
  promptTokensDetails: Record<string, number>,
): LLMUsage => {
  const aggregated: LLMUsage = {};

  if (promptTokens > 0) aggregated.prompt_tokens = promptTokens;
  if (completionTokens > 0) aggregated.completion_tokens = completionTokens;
  if (totalTokens > 0) aggregated.total_tokens = totalTokens;
  if (cacheCreationInputTokens > 0)
    aggregated.cache_creation_input_tokens = cacheCreationInputTokens;
  if (cacheReadInputTokens > 0) aggregated.cache_read_input_tokens = cacheReadInputTokens;

  if (Object.keys(completionTokensDetails).length > 0) {
    aggregated.completion_tokens_details = completionTokensDetails;
  }

  if (Object.keys(promptTokensDetails).length > 0) {
    aggregated.prompt_tokens_details = promptTokensDetails;
  }

  return aggregated;
};

/**
 * Aggregate streaming LLMUsage deltas into a single complete LLMUsage object.
 *
 * This operator accumulates all numeric fields from streamed LLMUsage objects
 * and emits a single aggregated LLMUsage at the end of the stream.
 *
 * For numeric fields (token counts), values are summed across all deltas.
 * For nested objects (completion_tokens_details, prompt_tokens_details),
 * their numeric fields are also summed.
 *
 * @example
 * ```typescript
 * // Stream of usage deltas from LLM provider
 * const usageStream$ = of(
 *   { prompt_tokens: 10, completion_tokens: 5 },
 *   { prompt_tokens: 0, completion_tokens: 8 },
 *   { prompt_tokens: 0, completion_tokens: 3 }
 * );
 *
 * usageStream$.pipe(
 *   aggregateLLMUsage()
 * ).subscribe(aggregated => {
 *   console.log(aggregated);
 *   // Output: { prompt_tokens: 10, completion_tokens: 16, total_tokens: 0 }
 * });
 * ```
 */
export const aggregateLLMUsage =
  <T extends LLMUsage>(): OperatorFunction<T, T> =>
  (source) =>
    new Observable<T>((subscriber) => {
      let promptTokens = 0;
      let completionTokens = 0;
      let totalTokens = 0;
      let cacheCreationInputTokens = 0;
      let cacheReadInputTokens = 0;
      const completionTokensDetails: Record<string, number> = {};
      const promptTokensDetails: Record<string, number> = {};

      const sub = source.subscribe({
        next: (usage) => {
          // Aggregate top-level numeric fields
          if (usage.prompt_tokens) promptTokens += usage.prompt_tokens;
          if (usage.completion_tokens) completionTokens += usage.completion_tokens;
          if (usage.total_tokens) totalTokens += usage.total_tokens;
          if (usage.cache_creation_input_tokens)
            cacheCreationInputTokens += usage.cache_creation_input_tokens;
          if (usage.cache_read_input_tokens) cacheReadInputTokens += usage.cache_read_input_tokens;

          // Aggregate nested detail objects
          mergeDetailsObject(completionTokensDetails, usage.completion_tokens_details);
          mergeDetailsObject(promptTokensDetails, usage.prompt_tokens_details);
        },
        error: (err) => subscriber.error(err),
        complete: () => {
          const aggregated = buildAggregatedUsage(
            promptTokens,
            completionTokens,
            totalTokens,
            cacheCreationInputTokens,
            cacheReadInputTokens,
            completionTokensDetails,
            promptTokensDetails,
          );

          subscriber.next(aggregated as T);
          subscriber.complete();
        },
      });

      return () => sub.unsubscribe();
    });
