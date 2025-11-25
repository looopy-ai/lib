import {
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
export function recursiveMerge<S, E>(
  initial: S,
  eventsFor: (state: S & { iteration: number }) => Observable<E>,
  next: (state: S, info: { iteration: number; events: E[] }) => S,
  isStop: (e: E) => boolean,
): Observable<E> {
  const seed: Iter<S, E> = {
    state: initial,
    iteration: 0,
    events$: eventsFor({ ...initial, iteration: 0 }).pipe(shareReplay({ refCount: true })),
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
