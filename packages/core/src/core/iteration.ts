import { concat, defer, filter, map, mergeMap, type Observable, shareReplay } from 'rxjs';
import { startLLMCallSpan, startLoopIterationSpan } from '../observability/spans';
import type { IterationConfig, IterationContext, Plugin } from '../types/core';
import type { AnyEvent, ContextAnyEvent, ContextEvent, ToolCallEvent } from '../types/event';
import type { LLMMessage } from '../types/message';
import { getSystemPrompts, type SystemPrompts } from '../utils/prompt';
import { runToolCall } from './tools';

/**
 * Execute a single agent loop iteration with LLM call and tool execution
 *
 * An iteration represents one complete cycle of:
 * 1. Preparing messages (adding system/skill prompts to history)
 * 2. Preparing tools (gathering all available tools from providers)
 * 3. Calling the LLM with messages and tools
 * 4. Executing any tool calls requested by the LLM
 * 5. Creating OpenTelemetry spans for observability
 *
 * The iteration completes when:
 * - The LLM returns a final response (no tool calls), OR
 * - All requested tool calls have been executed
 *
 * @param context - The loop context containing agent configuration, logger, and tool providers
 * @param config - The iteration configuration including iteration number and LLM provider
 * @param history - The message history from previous iterations and user input
 *
 * @returns An observable stream that emits:
 *   - LLM events (content-delta, content-complete, tool-call, etc.)
 *   - Tool execution events (tool-start, tool-complete) if tools are called
 *
 * @example
 * ```typescript
 * const context: LoopContext = {
 *   agentId: 'agent-1',
 *   contextId: 'ctx-123',
 *   taskId: 'task-456',
 *   systemPrompt: 'You are a helpful assistant',
 *   toolProviders: [localToolProvider],
 *   logger,
 *   parentContext: otelContext
 * };
 *
 * const config: IterationConfig = {
 *   iterationNumber: 1,
 *   llmProvider: liteLLMProvider
 * };
 *
 * const history: Message[] = [
 *   { role: 'user', content: 'What is the weather?' }
 * ];
 *
 * runIteration(context, config, history).subscribe({
 *   next: (event) => {
 *     console.log('Event:', event.kind);
 *     if (event.kind === 'content-delta') {
 *       process.stdout.write(event.delta);
 *     }
 *   },
 *   complete: () => console.log('Iteration complete')
 * });
 * ```
 *
 * @remarks
 * - Messages are prepared by adding system and skill prompts before the history
 * - Tools are collected from all providers and flattened into a single array
 * - LLM events are shared to prevent duplicate LLM calls
 * - Tool calls are executed in parallel using `mergeMap`
 * - Creates an OpenTelemetry span for the entire iteration
 * - Logs iteration start at info level with full context
 */
export const runIteration = <AuthContext>(
  context: IterationContext<AuthContext>,
  config: IterationConfig<AuthContext>,
  history: LLMMessage[],
): Observable<ContextAnyEvent> => {
  const logger = context.logger.child({
    component: 'iteration',
    iteration: config.iterationNumber,
  });
  const { traceContext: iterationContext, tapFinish: finishIterationSpan } = startLoopIterationSpan(
    { ...context, logger },
    config.iterationNumber,
  );

  const llmEvents$ = defer(async () => {
    // const systemPrompt = await getSystemPrompt(context.systemPrompt, context);
    const systemPrompts = await getSystemPrompts(context.plugins, context);
    const messages = await prepareMessages(systemPrompts, history);
    const tools = await prepareTools(context.plugins);
    logger.debug(
      { systemPrompts, messages: messages.length, tools: tools.map((t) => t.id).join(', ') },
      'Prepared messages and tools for LLM call',
    );
    return { messages, tools, systemPrompts };
  }).pipe(
    mergeMap(({ messages, tools, systemPrompts }) => {
      const { tapFinish: finishLLMCallSpan } = startLLMCallSpan(
        { ...context, parentContext: iterationContext },
        systemPrompts,
        messages,
        tools,
      );

      const metadata = systemPrompts.before
        .concat(systemPrompts.after)
        .reverse()
        .reduce<Record<string, unknown>>((acc, sp) => {
          if (sp.metadata) {
            // biome-ignore lint/performance/noAccumulatingSpread: gotta do it
            return Object.assign(acc, sp.metadata);
          }
          return acc;
        }, {});
      const llmProvider =
        typeof config.llmProvider === 'function'
          ? config.llmProvider(context, metadata)
          : config.llmProvider;

      return llmProvider
        .call({
          messages,
          tools,
          stream: true,
          sessionId: context.taskId,
        })
        .pipe(
          finishLLMCallSpan,
          map<AnyEvent, ContextAnyEvent>(
            (event): ContextAnyEvent => ({
              contextId: context.contextId,
              taskId: context.taskId,
              path: undefined,
              ...event,
            }),
          ),
        );
    }),
    shareReplay({ refCount: true }),
  );

  // If tool call, execute tools
  const toolEvents$ = llmEvents$.pipe(
    filter((event): event is ContextEvent<ToolCallEvent> => event.kind === 'tool-call'),
    mergeMap((event) =>
      runToolCall(
        {
          ...context,
          logger: context.logger.child({ iteration: config.iterationNumber }),
          parentContext: iterationContext,
        },
        event,
      ),
    ),
  );

  return concat(
    llmEvents$.pipe(
      // filter out tool-call events as they will be re-emitted in toolEvents$ if necessary
      filter((event) => event.kind !== 'tool-call'),
    ),
    toolEvents$,
  ).pipe(finishIterationSpan);
};

const prepareMessages = async (
  systemPrompts: SystemPrompts,
  history: LLMMessage[],
): Promise<LLMMessage[]> => {
  const messages: LLMMessage[] = systemPrompts.before.map((sp) => ({
    role: 'system',
    content: sp.content,
  }));

  return messages.concat(
    history,
    systemPrompts.after.map((sp) => ({
      role: 'system',
      content: sp.content,
    })),
  );
};

/**
 * Gather all available tools from all tool providers
 *
 * Collects tool definitions from all registered tool providers and flattens
 * them into a single array for the LLM to use.
 *
 * @internal
 * @param toolProviders - Array of tool providers to query for available tools
 * @returns A promise that resolves to a flattened array of all tool definitions
 *
 * @example
 * ```typescript
 * const providers = [
 *   localToolProvider,    // Has: search, calculate
 *   mcpToolProvider,      // Has: file_read, file_write
 *   clientToolProvider    // Has: show_ui
 * ];
 *
 * const tools = await prepareTools(providers);
 * // Result: [search, calculate, file_read, file_write, show_ui]
 * ```
 *
 * @remarks
 * - All providers are queried in parallel using `Promise.all`
 * - Tool arrays from each provider are flattened into a single array
 * - If a provider fails to return tools, the promise will reject
 * - Duplicate tool names from different providers are not filtered
 */
const prepareTools = async <AuthContext>(toolProviders: readonly Plugin<AuthContext>[]) => {
  const toolPromises = toolProviders.map((p) => p.listTools?.());
  const toolArrays = await Promise.all(toolPromises);
  return toolArrays.filter(Boolean).flat();
};
