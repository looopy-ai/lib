import { concat, EMPTY, from, type Observable, of } from 'rxjs';
import type { ExecutionContext } from '../types/context';
import type { AnyEvent, InternalToolMessageEvent, ToolCompleteEvent } from '../types/event';
import type { ToolCall, ToolResult } from '../types/tools';

export const toolErrorEvent = (
  context: ExecutionContext,
  toolCall: ToolCall,
  errorMessage: string,
): ToolCompleteEvent => ({
  kind: 'tool-complete',
  contextId: context.contextId,
  taskId: context.taskId,
  toolCallId: toolCall.id,
  toolName: toolCall.function.name,
  success: false,
  result: null,
  error: errorMessage,
  timestamp: new Date().toISOString(),
});

export const toolResultToEvents = (
  context: ExecutionContext,
  _toolCall: ToolCall,
  result: ToolResult,
): Observable<AnyEvent> => {
  const toolCompleteEvent: ToolCompleteEvent = {
    kind: 'tool-complete',
    contextId: context.contextId,
    taskId: context.taskId,
    toolCallId: result.toolCallId,
    toolName: result.toolName,
    success: result.success,
    result: result.result,
    error: result.error,
    timestamp: new Date().toISOString(),
  };

  const messageEvents: InternalToolMessageEvent[] =
    result.messages?.map((message) => ({
      kind: 'internal:tool-message',
      contextId: context.contextId,
      taskId: context.taskId,
      message,
      timestamp: new Date().toISOString(),
    })) ?? [];

  return concat(of(toolCompleteEvent), messageEvents.length > 0 ? from(messageEvents) : EMPTY);
};
