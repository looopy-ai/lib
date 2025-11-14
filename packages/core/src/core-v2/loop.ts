import {
  concat,
  EMPTY,
  expand,
  map,
  mergeMap,
  type Observable,
  of,
  reduce,
  share,
  shareReplay,
} from 'rxjs';
import { createTaskCompleteEvent, createTaskCreatedEvent, createTaskStatusEvent } from '../events';
import { startAgentLoopSpan } from '../observability/spans';
import type { AnyEvent, ContentCompleteEvent } from '../types/event';
import { runIteration } from './iteration';
import type { LoopConfig, Message, TurnContext } from './types';

/**
 * Execute the main agent loop that processes a turn through multiple iterations
 *
 * The agent loop orchestrates multiple iterations of LLM calls and tool executions
 * until the LLM produces a final response (indicated by `finishReason !== 'tool_calls'`).
 *
 * Flow:
 * 1. Emits initial task-created and working status events
 * 2. Runs iterations recursively:
 *    - Each iteration calls the LLM with current message history
 *    - If LLM requests tools, executes them and continues to next iteration
 *    - If LLM finishes (no tool calls), stops iteration
 * 3. Converts iteration events to messages for next iteration
 * 4. Completes when LLM finishes or max iterations reached
 *
 * @param context - The turn context containing agent/task identifiers, parent trace context, and logger
 * @param config - The loop configuration including LLM provider settings
 * @param history - The initial message history (typically includes user input and conversation history)
 *
 * @returns An observable stream that emits:
 *   - Initial events: task-created, status update (working)
 *   - Iteration events: content-delta, content-complete, tool-call, tool-start, tool-complete
 *   - Continues until LLM returns a non-tool-call finish reason
 *
 * @example
 * ```typescript
 * const context: TurnContext = {
 *   agentId: 'agent-1',
 *   contextId: 'ctx-123',
 *   taskId: 'task-456',
 *   parentContext: otelContext,
 *   logger,
 *   systemPrompt: 'You are helpful',
 *   toolProviders: [localTools]
 * };
 *
 * const config: LoopConfig = {
 *   llmProvider: liteLLMProvider
 * };
 *
 * const messages: Message[] = [
 *   { role: 'user', content: 'What is 2+2 and then search for cats?' }
 * ];
 *
 * runLoop(context, config, messages).subscribe({
 *   next: (event) => {
 *     if (event.kind === 'content-delta') {
 *       process.stdout.write(event.delta);
 *     }
 *     if (event.kind === 'tool-call') {
 *       console.log('Calling tool:', event.toolName);
 *     }
 *   },
 *   complete: () => console.log('Loop complete')
 * });
 * ```
 *
 * @remarks
 * - Creates an OpenTelemetry span for the entire loop execution
 * - Recursively expands iterations until LLM finishes
 * - Converts events from each iteration to messages for the next iteration
 * - Tool calls result in new iterations with tool results added to message history
 * - The loop stops when `content-complete` event has `finishReason !== 'tool_calls'`
 */
export const runLoop = (context: TurnContext, config: LoopConfig, history: Message[]) => {
  const { traceContext: loopContext, tapFinish } = startAgentLoopSpan({
    agentId: context.agentId,
    contextId: context.contextId,
    taskId: context.taskId,
    prompt: history.filter((m) => m.role === 'user').at(-1)?.content || '',
    parentContext: context.parentContext,
  });

  // Emit initial events
  const taskEvent = createTaskCreatedEvent({
    contextId: context.contextId,
    taskId: context.taskId,
    initiator: 'user',
    metadata: {
      historyLength: history.length,
    },
  });
  const workingEvent = createTaskStatusEvent({
    contextId: context.contextId,
    taskId: context.taskId,
    status: 'working',
    metadata: {},
  });

  const merged$ = recursiveMerge(
    {
      messages: history,
      completed: false,
      iteration: 0,
    },
    (state) =>
      runIteration(
        { ...context, parentContext: loopContext },
        {
          llmProvider: config.llmProvider,
          iterationNumber: state.iteration,
        },
        state.messages,
      ),
    (state, { events }) => ({
      ...state,
      messages: [...state.messages, ...eventsToMessages(events)],
    }),
    (e) => e.kind === 'content-complete' && e.finishReason !== 'tool_calls',
  ).pipe(shareReplay());

  // Build a final task-complete event from the last content-complete event
  const finalSummary$ = merged$.pipe(
    // Accumulate the last seen content-complete event (if any)
    reduce<AnyEvent, ContentCompleteEvent | null>(
      (last, e) => (e.kind === 'content-complete' ? e : last),
      null,
    ),
    mergeMap((last) => {
      if (!last) return EMPTY;
      return of(
        createTaskCompleteEvent({
          contextId: context.contextId,
          taskId: context.taskId,
          content: last.content,
          metadata: { finishReason: last.finishReason },
        }),
      );
    }),
  );

  // Merge initial events, LLM events from iterations, and final summary event
  return concat(of(taskEvent, workingEvent), merged$, finalSummary$).pipe(tapFinish);
};

/**
 * Internal type representing a single iteration state with its event stream
 *
 * @internal
 */
type Iter<S, E> = {
  state: S;
  iteration: number;
  events$: Observable<E>;
};

/**
 * Recursively merge multiple iterations into a single event stream
 *
 * This is a generic recursive iteration pattern using RxJS `expand` operator.
 * It continues expanding iterations until a stop condition is met.
 *
 * The pattern:
 * 1. Start with initial state
 * 2. Generate events for current iteration
 * 3. Collect all events from current iteration
 * 4. Check if stop condition met
 * 5. If not stopped, compute next state from events and continue
 * 6. If stopped, complete the recursion
 * 7. Merge all iteration events into single output stream
 *
 * @internal
 * @template S - The state type that evolves between iterations
 * @template E - The event type emitted by each iteration
 *
 * @param initial - The initial state to start with
 * @param eventsFor - Function that creates an event observable for a given state
 * @param next - Function that computes next state from current state and collected events
 * @param isStop - Predicate that determines if an event signals iteration completion
 *
 * @returns An observable that emits all events from all iterations until stop condition
 *
 * @example
 * ```typescript
 * // State tracks message history and completion
 * type State = {
 *   messages: Message[];
 *   completed: boolean;
 *   iteration: number;
 * };
 *
 * // Events from LLM and tools
 * type Event = ContentDelta | ContentComplete | ToolCall | ToolComplete;
 *
 * const merged$ = recursiveMerge(
 *   { messages: [], completed: false, iteration: 0 },
 *   (state) => callLLM(state.messages),           // Generate events
 *   (state, { events }) => ({                      // Update state
 *     ...state,
 *     messages: [...state.messages, ...toMessages(events)]
 *   }),
 *   (e) => e.kind === 'content-complete'           // Stop condition
 * );
 * ```
 *
 * @remarks
 * - Uses RxJS `expand` operator for recursive iteration
 * - Each iteration's events are shared to prevent duplicate execution
 * - Events from all iterations are merged into a single output stream
 * - Stop condition is checked for each event in the iteration
 * - When stop event found, recursion halts and no next iteration is created
 */
function recursiveMerge<S, E>(
  initial: S,
  eventsFor: (state: S & { iteration: number }) => Observable<E>,
  next: (state: S, info: { iteration: number; events: E[] }) => S,
  isStop: (e: E) => boolean,
): Observable<E> {
  const seed: Iter<S, E> = {
    state: initial,
    iteration: 0,
    events$: eventsFor({ ...initial, iteration: 0 }).pipe(shareReplay()),
  };

  const iterations$: Observable<Iter<S, E>> = of(seed).pipe(
    expand(({ state, iteration, events$ }) =>
      // Summarize the *current* iteration's events
      events$.pipe(
        reduce(
          (acc, e) => {
            acc.events.push(e);
            if (isStop(e)) acc.sawStop = true;
            return acc;
          },
          { events: [] as E[], sawStop: false },
        ),
        mergeMap(({ events, sawStop }) => {
          if (sawStop) return EMPTY; // stop recursion

          // Compute the next state using the finished loop's events
          return of(next(state, { iteration, events })).pipe(
            map((nextState) => {
              const nextIter = iteration + 1;
              return {
                state: nextState as S,
                iteration: nextIter,
                events$: eventsFor({
                  ...(nextState as S),
                  iteration: nextIter,
                }).pipe(share()),
              } as Iter<S, E>;
            }),
          );
        }),
      ),
    ),
  );

  // Merge all loops' events into a single output stream
  return iterations$.pipe(mergeMap(({ events$ }) => events$));
}

/**
 * Convert agent loop events to LLM-compatible message format
 *
 * Transforms events from an iteration into messages that can be sent to the LLM
 * in the next iteration. This is how tool calls and tool results are incorporated
 * into the conversation history.
 *
 * Conversion rules:
 * - `content-complete` → assistant message with content
 * - `tool-call` → assistant message with toolCalls field
 * - `tool-complete` → tool message with result/error
 * - Other events → ignored
 *
 * @internal
 * @param events - Array of events from an iteration
 * @returns Array of messages to add to conversation history
 *
 * @example
 * ```typescript
 * const events = [
 *   { kind: 'content-delta', delta: 'Let me' },
 *   { kind: 'content-delta', delta: ' help' },
 *   { kind: 'tool-call', toolName: 'search', toolCallId: 'call-1', arguments: '{"q":"cats"}' },
 *   { kind: 'tool-start', toolName: 'search', toolCallId: 'call-1' },
 *   { kind: 'tool-complete', toolName: 'search', toolCallId: 'call-1', success: true, result: [...] }
 * ];
 *
 * const messages = eventsToMessages(events);
 * // Result:
 * // [
 * //   { role: 'assistant', content: '', toolCalls: [{ id: 'call-1', type: 'function', function: { name: 'search', arguments: '{"q":"cats"}' } }] },
 * //   { role: 'tool', name: 'search', content: '[...]', toolCallId: 'call-1' }
 * // ]
 * ```
 *
 * @remarks
 * - Only processes content-complete, tool-call, and tool-complete events
 * - Content-delta events are ignored (they're aggregated in content-complete)
 * - Tool call creates assistant message with empty content and toolCalls field
 * - Tool complete creates tool message with stringified result or error
 * - Messages are in correct order for LLM consumption
 */
const eventsToMessages = (events: AnyEvent[]): Message[] => {
  const messages: Message[] = [];
  for (const event of events) {
    switch (event.kind) {
      case 'content-complete':
        if (event.content) {
          messages.push({
            role: 'assistant',
            content: event.content,
          });
        }
        break;
      case 'tool-call':
        messages.push({
          role: 'assistant',
          content: '',
          toolCalls: [
            {
              id: event.toolCallId,
              type: 'function',
              function: {
                name: event.toolName,
                arguments: event.arguments,
              },
            },
          ],
        });
        break;
      case 'tool-complete':
        messages.push({
          role: 'tool',
          name: event.toolName,
          content: event.success
            ? event.result
              ? JSON.stringify(event.result)
              : 'Success'
            : event.error || 'Error executing tool',
          toolCallId: event.toolCallId,
        });
        break;
      default:
        break;
    }
  }
  return messages;
};
