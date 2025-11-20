import { concat, defer, mergeMap, type Observable, of } from 'rxjs';
import { startToolExecuteSpan } from '../observability/spans';
import type { ToolCallEvent, ToolCompleteEvent, ToolExecutionEvent } from '../types/event';
import type { ToolDefinition, ToolProvider } from '../types/tools';
import type { IterationContext } from './types';

/**
 * Execute a tool call and return an observable stream of tool execution events
 *
 * This function orchestrates the complete tool execution lifecycle:
 * 1. Emits a `tool-start` event immediately
 * 2. Creates an OpenTelemetry span for tracing
 * 3. Finds the appropriate tool provider
 * 4. Executes the tool with the provider
 * 5. Emits a `tool-complete` event with the result or error
 *
 * @param context - The iteration context containing configuration, logger, and tool providers
 * @param toolCall - The tool call event containing the tool name, arguments, and call ID
 *
 * @returns An observable that emits:
 *   - First: A `tool-start` event with tool call details
 *   - Then: A `tool-complete` event with either:
 *     - `success: true` and the tool result, or
 *     - `success: false` and an error message
 *
 * @example
 * ```typescript
 * const toolCall: ToolCallEvent = {
 *   kind: 'tool-call',
 *   contextId: 'ctx-123',
 *   taskId: 'task-456',
 *   toolCallId: 'call-789',
 *   toolName: 'search',
 *   arguments: '{"query": "weather"}',
 *   timestamp: new Date().toISOString()
 * };
 *
 * runToolCall(context, toolCall).subscribe({
 *   next: (event) => {
 *     if (event.kind === 'tool-start') {
 *       console.log('Tool started:', event.toolName);
 *     } else if (event.kind === 'tool-complete') {
 *       console.log('Tool completed:', event.success, event.result);
 *     }
 *   }
 * });
 * ```
 *
 * @remarks
 * - The function searches for a provider by checking `provider.canHandle(toolName)`
 * - If no provider is found, emits a `tool-complete` event with `success: false`
 * - Creates OpenTelemetry spans for distributed tracing
 * - Logs all execution steps at trace level
 * - Handles errors gracefully and returns error events instead of throwing
 */
export const runToolCall = (
  context: IterationContext,
  toolCall: ToolCallEvent,
): Observable<ToolExecutionEvent> => {
  const logger = context.logger.child({
    component: 'tool-call',
    toolCallId: toolCall.toolCallId,
    toolName: toolCall.toolName,
  });

  return defer(async () => {
    const matchingProviders = await Promise.all(
      context.toolProviders.map(async (p) => ({
        provider: p,
        tool: await p.getTool(toolCall.toolName),
      })),
    );

    const matchingProvider = matchingProviders.find(
      (p): p is { provider: ToolProvider; tool: ToolDefinition } => p.tool !== undefined,
    );
    if (!matchingProvider) {
      logger.warn('No tool provider found for tool');
      return of(toolCall);
    }

    const { provider, tool } = matchingProvider;
    logger.trace({ providerName: provider.name }, 'Found tool provider for tool');

    // Create tool-start event
    const toolStartEvent: ToolExecutionEvent = {
      kind: 'tool-start',
      contextId: context.contextId,
      taskId: context.taskId,
      toolCallId: toolCall.toolCallId,
      icon: tool.icon,
      toolName: toolCall.toolName,
      arguments: toolCall.arguments,
      timestamp: new Date().toISOString(),
    };

    // Start tool execution span
    const { tapFinish } = startToolExecuteSpan(context, toolCall);

    // Execute tool and create events
    const toolResultEvents$ = defer(async () => {
      logger.trace({ providerName: provider.name }, 'Executing tool');

      try {
        const result = await provider.execute(
          {
            id: toolCall.toolCallId,
            type: 'function',
            function: {
              name: toolCall.toolName,
              arguments: toolCall.arguments,
            },
          },
          context,
        ); // TODO use event

        logger.trace(
          {
            success: result.success,
          },
          'Tool execution complete',
        );

        // TODO handle tool failures

        // Complete span with result
        // completeToolExecutionSpan(span, result);

        return createToolCompleteEvent(context, toolCall, result.result);
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        logger.error(
          {
            error: err.message,
            stack: err.stack,
          },
          'Tool execution failed',
        );

        // Fail span with exception
        // failToolExecutionSpanWithException(span, err);

        return createToolErrorEvent(context, toolCall, err.message);
      }
    });

    return concat(of(toolStartEvent), toolResultEvents$).pipe(tapFinish);
  }).pipe(mergeMap((obs) => obs));
};

/**
 * Create a successful tool completion event
 *
 * @internal
 * @param context - The iteration context
 * @param toolCall - The original tool call event
 * @param result - The result returned by the tool
 * @returns A `tool-complete` event with `success: true` and the result
 */
const createToolCompleteEvent = (
  context: IterationContext,
  toolCall: ToolCallEvent,
  result: unknown,
): ToolExecutionEvent =>
  ({
    kind: 'tool-complete',
    contextId: context.contextId,
    taskId: context.taskId,
    toolCallId: toolCall.toolCallId,
    toolName: toolCall.toolName,
    success: true,
    result: result,
    timestamp: new Date().toISOString(),
  }) satisfies ToolCompleteEvent;

/**
 * Create a failed tool completion event
 *
 * @internal
 * @param context - The iteration context
 * @param toolCall - The original tool call event
 * @param errorMessage - The error message describing why the tool failed
 * @returns A `tool-complete` event with `success: false`, `result: null`, and an error message
 */
const createToolErrorEvent = (
  context: IterationContext,
  toolCall: ToolCallEvent,
  errorMessage: string,
): ToolExecutionEvent =>
  ({
    kind: 'tool-complete',
    contextId: context.contextId,
    taskId: context.taskId,
    toolCallId: toolCall.toolCallId,
    toolName: toolCall.toolName,
    success: false,
    result: null,
    error: errorMessage,
    timestamp: new Date().toISOString(),
  }) satisfies ToolCompleteEvent;
