import { catchError, concat, defer, map, mergeMap, type Observable, of, tap } from 'rxjs';
import { isChildTaskEvent } from '../events/utils';
import { startToolExecuteSpan } from '../observability/spans';
import { toolErrorEvent } from '../tools/tool-result-events';
import { type IterationContext, isToolPlugin } from '../types/core';
import type {
  AnyEvent,
  ContextAnyEvent,
  ContextEvent,
  ToolCallEvent,
  ToolExecutionEvent,
} from '../types/event';
import type { ToolCall } from '../types/tools';
import { safeValidateToolCall } from '../types/tools';

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
export const runToolCall = <AuthContext>(
  context: IterationContext<AuthContext>,
  toolCall: ContextEvent<ToolCallEvent>,
): Observable<ContextAnyEvent> => {
  const logger = context.logger.child({
    component: 'tool-call',
    toolCallId: toolCall.toolCallId,
    toolName: toolCall.toolName,
  });

  return defer(async () => {
    const toolCallInput: ToolCall = {
      id: toolCall.toolCallId,
      type: 'function',
      function: {
        name: toolCall.toolName,
        arguments: toolCall.arguments,
      },
    };

    // Validate tool call structure and name format
    const validation = safeValidateToolCall(toolCallInput);

    if (!validation.success) {
      const errorMessage = `Invalid tool call format: ${(validation.errors || []).map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`;
      logger.error(
        {
          toolCallId: toolCall.toolCallId,
          toolName: toolCall.toolName,
          errors: validation.errors,
        },
        'Invalid tool call from LLM - tool name must match ^[a-zA-Z0-9_-]+$',
      );
      // Return tool error event for invalid tool name format
      return of(toolErrorEvent(toolCallInput, errorMessage));
    }

    const matchingPlugins = await Promise.all(
      context.plugins.filter(isToolPlugin).map(async (p) => ({
        plugin: p,
        tool: await p.getTool?.(toolCall.toolName),
      })),
    );

    const matchingPlugin = matchingPlugins.find((p) => p.tool !== undefined);
    if (!matchingPlugin?.tool) {
      logger.warn('No plugin found for tool');
      return of(toolCall);
    }

    const { plugin, tool } = matchingPlugin;
    logger.debug(
      { providerName: plugin.name, toolIcon: tool.icon },
      'Found tool provider for tool',
    );

    // Create tool-start event
    const toolStartEvent: ToolExecutionEvent = {
      kind: 'tool-start',
      toolCallId: toolCall.toolCallId,
      icon: tool.icon,
      toolName: toolCall.toolName,
      arguments: toolCall.arguments,
      timestamp: new Date().toISOString(),
    };

    // Start tool execution span
    const { tapFinish } = startToolExecuteSpan(context, toolCall);

    const execution$ = defer<Observable<ContextAnyEvent | AnyEvent>>(() => {
      try {
        logger.trace({ providerName: plugin.name }, 'Executing tool');

        if (!isToolPlugin(plugin)) {
          return of(toolErrorEvent(toolCallInput, 'Plugin does not implement tools'));
        }

        return plugin.executeTool(toolCallInput, context).pipe(
          tap((event) => {
            if (isChildTaskEvent(event)) return;
            if (event.kind !== 'tool-complete') {
              return;
            }
            logger.trace(
              { providerName: plugin.name, success: event.success },
              'Tool execution complete',
            );
          }),
          tapFinish,
          catchError((error) => {
            const err = error instanceof Error ? error : new Error(String(error));
            logger.error(
              {
                providerName: plugin.name,
                error: err.message,
                stack: err.stack,
              },
              'Tool execution error',
            );
            return of(toolErrorEvent(toolCallInput, err.message));
          }),
        );
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        logger.error(
          {
            providerName: plugin.name,
            error: err.message,
            stack: err.stack,
          },
          'Tool execution error',
        );
        return of(toolErrorEvent(toolCallInput, err.message));
      }
    });

    return concat(of(toolStartEvent), execution$);
  }).pipe(
    mergeMap((obs) => obs),
    map<ContextAnyEvent | AnyEvent, ContextAnyEvent>((event) => ({
      contextId: context.contextId,
      taskId: context.taskId,
      path: [`tool:${toolCall.toolName}`],
      ...event,
    })),
  );
};
