/**
 * LLM Event Processor Operator
 *
 * Bridges LLM provider events to agent-loop architecture:
 * - Events flow to subscribers via LoopEventEmitter (external Observable<AgentEvent>)
 * - Final response flows to pipeline as LLMResponse (internal Observable<LoopState>)
 */

import type { OperatorFunction } from 'rxjs';
import { filter, last, map, tap } from 'rxjs/operators';
import type {
  AnyEvent,
  ContentCompleteEvent,
  ContentDeltaEvent,
  LLMEvent,
  ThoughtStreamEvent,
} from '../../events/types';
import type { LLMResponse } from '../types';
import type { LoopEventEmitter } from './event-emitter';

/**
 * Extract LLMResponse from event stream while emitting events to subscribers
 *
 * Agent-loop architecture:
 * - Internal pipeline: Observable<LoopState> for state management
 * - External API: Observable<AgentEvent> for real-time updates
 *
 * This operator bridges the two:
 * 1. Emits events via eventEmitter → merge → Observable<AgentEvent> (external)
 * 2. Extracts ContentCompleteEvent → LLMResponse → LoopState (internal)
 *
 * @param taskId - Task identifier to stamp onto events
 * @param contextId - Context identifier to stamp onto events
 * @param eventEmitter - Emits events to subscribers (merged in execute())
 */
export function extractResponseFromEvents(
  taskId: string,
  contextId: string,
  eventEmitter: LoopEventEmitter
): OperatorFunction<LLMEvent<AnyEvent>, LLMResponse> {
  return (source) =>
    source.pipe(
      // Side effect: Emit each event via eventEmitter for subscribers
      tap((event) => {
        switch (event.kind) {
          case 'content-delta': {
            const e = event as LLMEvent<ContentDeltaEvent>;
            eventEmitter.emitContentDelta(taskId, contextId, e.delta, e.index);
            break;
          }
          case 'thought-stream': {
            const e = event as LLMEvent<ThoughtStreamEvent>;
            eventEmitter.emitThought(taskId, contextId, e.thoughtType, e.content, {
              verbosity: e.verbosity,
              thoughtId: e.thoughtId,
            });
            break;
          }
          case 'content-complete': {
            const e = event as LLMEvent<ContentCompleteEvent>;
            eventEmitter.emitContentComplete(taskId, contextId, e.content);
            break;
          }
        }
      }),

      // Filter to final event and convert to LLMResponse for internal pipeline
      filter((event): event is LLMEvent<ContentCompleteEvent> => event.kind === 'content-complete'),
      last(),
      map((event): LLMResponse => {
        // Parse toolCalls arguments from JSON string to object
        const toolCalls = event.toolCalls?.map((tc) => ({
          ...tc,
          function: {
            ...tc.function,
            arguments:
              (typeof tc.function.arguments === 'string'
                ? JSON.parse(tc.function.arguments)
                : tc.function.arguments) || {},
          },
        }));

        return {
          message: {
            role: 'assistant',
            content: event.content,
            toolCalls,
          },
          toolCalls,
          finished: true,
          finishReason: 'stop',
        };
      })
    );
}
