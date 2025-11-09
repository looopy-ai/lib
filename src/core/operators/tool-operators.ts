/**
 * Tool Execution Event Operators
 *
 * RxJS operators for emitting tool execution events during agent loop execution.
 *
 * Design: design/internal-event-protocol.md (Tool Execution Events)
 */

import { createToolCompleteEvent, createToolStartEvent } from '../../events';
import type { ToolCall, ToolResult } from '../types';

/**
 * Emit tool-start event when tool execution begins
 */
export function emitToolStartEvent(
  taskId: string,
  contextId: string,
  toolCall: ToolCall,
  eventBuffer: import('../../events').AnyEvent[]
): void {
  if (toolCall.function.name === 'toolName') return;
  eventBuffer.push(
    createToolStartEvent({
      contextId,
      taskId,
      toolCallId: toolCall.id,
      toolName: toolCall.function.name,
      arguments: toolCall.function.arguments,
      metadata: {},
    })
  );
}

/**
 * Emit tool-complete event when tool execution finishes
 */
export function emitToolCompleteEvent(
  taskId: string,
  contextId: string,
  result: ToolResult,
  eventBuffer: import('../../events').AnyEvent[]
): void {
  if (result.toolName === 'toolName') return;
  eventBuffer.push(
    createToolCompleteEvent({
      contextId,
      taskId,
      toolCallId: result.toolCallId,
      toolName: result.toolName,
      success: result.success,
      result: result.result,
      error: result.error,
      metadata: {},
    })
  );
}
