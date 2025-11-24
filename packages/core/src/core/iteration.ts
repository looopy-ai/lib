import { concat, defer, filter, map, mergeMap, type Observable, shareReplay } from 'rxjs';
import { startLLMCallSpan, startLoopIterationSpan } from '../observability/spans';
import type { AnyEvent, ToolCallEvent } from '../types/event';
import type { Message } from '../types/message';
import type { ToolProvider } from '../types/tools';
import { getSystemPrompt, type SystemPrompt } from '../utils/prompt';
import { runToolCall } from './tools';
import type { IterationConfig, LoopContext } from './types';

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
export const runIteration = (
  context: LoopContext,
  config: IterationConfig,
  history: Message[],
): Observable<AnyEvent> => {
  const logger = context.logger.child({
    component: 'iteration',
    iteration: config.iterationNumber,
  });
  const { traceContext: iterationContext, tapFinish: finishIterationSpan } = startLoopIterationSpan(
    { ...context, logger },
    config.iterationNumber,
  );

  const llmEvents$ = defer(async () => {
    const systemPrompt = await getSystemPrompt(context.systemPrompt);
    const messages = await prepareMessages(systemPrompt, context.skillPrompts, history);
    const tools = await prepareTools(context.toolProviders);
    return { messages, tools, systemPrompt };
  }).pipe(
    mergeMap(({ messages, tools, systemPrompt }) => {
      const { tapFinish: finishLLMCallSpan } = startLLMCallSpan(
        { ...context, parentContext: iterationContext },
        systemPrompt,
        messages,
      );
      return config.llmProvider
        .call({
          messages,
          tools,
          stream: true,
          sessionId: context.taskId,
        })
        .pipe(
          map(
            (event): AnyEvent =>
              ({
                contextId: context.contextId,
                taskId: context.taskId,
                ...event,
              }) as AnyEvent,
          ),
          finishLLMCallSpan,
        );
    }),
    shareReplay(),
  );

  // If tool call, execute tools
  const toolEvents$ = llmEvents$.pipe(
    filter((event): event is ToolCallEvent => event.kind === 'tool-call'),
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
  systemPrompt: SystemPrompt | undefined,
  skillPrompts: Record<string, string> | undefined,
  history: Message[],
): Promise<Message[]> => {
  const messages: Message[] = [];

  // Add system prompt if available
  if (systemPrompt) {
    messages.push({
      role: 'system',
      content: systemPrompt.prompt,
      name: systemPrompt.name || 'system-prompt',
    });
  }

  // Add skill prompts if available
  if (skillPrompts) {
    for (const [name, content] of Object.entries(skillPrompts)) {
      messages.push({
        role: 'system',
        content,
        name,
      });
    }
  }

  return messages.concat(history);
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
const prepareTools = async (toolProviders: ToolProvider[]) => {
  const toolPromises = toolProviders.map((p) => p.getTools());
  const toolArrays = await Promise.all(toolPromises);
  return toolArrays.flat();
};
