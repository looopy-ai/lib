import { concat, EMPTY, mergeMap, of, reduce, shareReplay } from 'rxjs';
import { createTaskCompleteEvent, createTaskCreatedEvent, createTaskStatusEvent } from '../events';
import { isChildTaskEvent } from '../events/utils';
import { startAgentLoopSpan } from '../observability/spans';
import type { LoopConfig, LoopContext } from '../types/core';
import type {
  ContentCompleteEvent,
  ContextAnyEvent,
  ContextEvent,
  ToolInputRequiredEvent,
} from '../types/event';
import { isToolInputRequiredEvent } from '../types/event';
import type { LLMMessage } from '../types/message';
import { recursiveMerge } from '../utils/recursive-merge';
import { runIteration } from './iteration';

const MAX_REPLAY_BUFFER_SIZE = 1000; // Limit the replay buffer size to prevent memory issues in long-running loops

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
 * - The loop also stops when any tool emits a `tool-input-required` event; the final
 *   event instead of `task-complete` is `task-status: waiting-input`
 */
export const runLoop = <AuthContext>(
  context: LoopContext<AuthContext>,
  config: LoopConfig<AuthContext>,
  history: LLMMessage[],
) => {
  const logger = context.logger.child({ component: 'loop' });
  const { traceContext: loopContext, tapFinish } = startAgentLoopSpan({
    agentId: context.agentId,
    contextId: context.contextId,
    taskId: context.taskId,
    prompt: history.filter((m) => m.role === 'user').at(-1)?.content || '',
    parentContext: context.parentContext,
  });
  logger.debug('Starting agent loop');

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
      iteration: 0,
    },
    (state) =>
      runIteration(
        { ...context, parentContext: loopContext },
        {
          llmProvider: config.llmProvider,
          iterationNumber: state.iteration,
          filterPlugins: config.filterPlugins,
        },
        state.messages,
      ),
    (state, { events }) => ({
      ...state,
      iteration: state.iteration + 1,
      messages: [...state.messages, ...eventsToMessages(events)],
    }),
    (e) =>
      (!isChildTaskEvent(e) && e.kind === 'content-complete' && e.finishReason !== 'tool_calls') ||
      (!isChildTaskEvent(e) && e.kind === 'tool-input-required'),
  ).pipe(shareReplay({ bufferSize: MAX_REPLAY_BUFFER_SIZE, refCount: false }));

  // Build a final task-complete or task-waiting-input event
  const finalSummary$ = merged$.pipe(
    reduce<
      ContextAnyEvent,
      {
        lastComplete: ContextEvent<ContentCompleteEvent> | null;
        pendingInputs: ContextEvent<ToolInputRequiredEvent>[];
      }
    >(
      (acc, e) => {
        if (isChildTaskEvent(e)) return acc;
        if (e.kind === 'content-complete') return { ...acc, lastComplete: e };
        if (isToolInputRequiredEvent(e))
          return { ...acc, pendingInputs: [...acc.pendingInputs, e] };
        return acc;
      },
      { lastComplete: null, pendingInputs: [] },
    ),
    mergeMap(({ lastComplete, pendingInputs }) => {
      if (pendingInputs.length > 0) {
        // At least one tool is waiting for input — surface a waiting-input status
        return of(
          createTaskStatusEvent({
            contextId: context.contextId,
            taskId: context.taskId,
            status: 'waiting-input',
            metadata: {
              pendingInputIds: pendingInputs.map((e) => e.inputId),
              pendingToolNames: pendingInputs.map((e) => e.toolName),
            },
          }),
        );
      }
      if (!lastComplete) return EMPTY;
      return of(
        createTaskCompleteEvent({
          contextId: context.contextId,
          taskId: context.taskId,
          content: lastComplete.content,
          metadata: { finishReason: lastComplete.finishReason },
        }),
      );
    }),
  );

  // Merge initial events, LLM events from iterations, and final summary event
  return concat(of(taskEvent, workingEvent), merged$, finalSummary$).pipe(tapFinish);
};

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
export const eventsToMessages = (events: ContextAnyEvent[]): LLMMessage[] =>
  events.flatMap((event): LLMMessage[] => {
    if (isChildTaskEvent(event)) return [];

    switch (event.kind) {
      case 'content-complete': {
        const msgs: LLMMessage[] = event.content
          ? [{ role: 'assistant', content: event.content }]
          : [];
        if (event.finishReason === 'tool_calls' && (event.toolCalls?.length ?? 0) > 0) {
          msgs.push({ role: 'assistant', content: '', toolCalls: event.toolCalls });
        }
        return msgs;
      }
      case 'tool-complete':
        return [
          {
            role: 'tool',
            name: event.toolName,
            content: event.success
              ? event.result
                ? JSON.stringify(event.result)
                : 'Success'
              : event.error || 'Error executing tool',
            toolCallId: event.toolCallId,
          },
        ];
      case 'internal:tool-message':
        return [event.message];
      default:
        return [];
    }
  });
