import { catchError, concat, defer, mergeMap, type Observable, of, tap } from 'rxjs';
import { startToolExecuteSpan } from '../observability/spans';
import { toolErrorEvent } from '../tools/tool-result-events';
import type { AnyEvent, ToolCallEvent, ToolExecutionEvent } from '../types/event';
import type { ToolCall, ToolDefinition, ToolProvider } from '../types/tools';
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
 * - Tool providers emit their own tool execution events; this function prepends the `tool-start`.
 * - If no provider is found, the original `tool-call` event is returned unchanged.
 * - Creates OpenTelemetry spans for distributed tracing
 * - Logs all execution steps at trace level
 * - Handles errors gracefully and returns error events instead of throwing
 */
export const runToolCall = (
  context: IterationContext,
  toolCall: ToolCallEvent,
): Observable<AnyEvent> => {
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
    logger.debug(
      { providerName: provider.name, toolIcon: tool.icon },
      'Found tool provider for tool',
    );

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

    const toolCallInput: ToolCall = {
      id: toolCall.toolCallId,
      type: 'function',
      function: {
        name: toolCall.toolName,
        arguments: toolCall.arguments,
      },
    };

    // Start tool execution span
    const { tapFinish } = startToolExecuteSpan(context, toolCall);

    const execution$ = defer(() => {
      try {
        logger.trace({ providerName: provider.name }, 'Executing tool');

        return provider.execute(toolCallInput, context).pipe(
          tap((event) => {
            if (event.kind !== 'tool-complete') {
              return;
            }
            logger.trace(
              { providerName: provider.name, success: event.success },
              'Tool execution complete',
            );
          }),
          tapFinish,
          catchError((error) => {
            const err = error instanceof Error ? error : new Error(String(error));
            logger.error(
              {
                providerName: provider.name,
                error: err.message,
                stack: err.stack,
              },
              'Tool execution error',
            );
            return of<AnyEvent>(toolErrorEvent(context, toolCallInput, err.message));
          }),
        );
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        logger.error(
          {
            providerName: provider.name,
            error: err.message,
            stack: err.stack,
          },
          'Tool execution error',
        );
        return of<AnyEvent>(toolErrorEvent(context, toolCallInput, err.message));
      }
    });

    return concat(of<AnyEvent>(toolStartEvent), execution$);
  }).pipe(mergeMap((obs) => obs));
};
