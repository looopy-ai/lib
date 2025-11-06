/**
 * LLM Call Event Operators
 *
 * Functions for emitting LLM-related internal events during agent loop execution.
 *
 * Design: design/internal-event-protocol.md (Internal Debug Events)
 */

import { createInternalLLMCallEvent } from '../../events';
import type { Message } from '../types';

/**
 * Emit internal:llm-call event when LLM is invoked
 */
export function emitLLMCallEvent(
  taskId: string,
  contextId: string,
  iteration: number,
  model: string,
  messages: Message[],
  toolCount: number,
  eventBuffer: import('../../events').InternalEvent[]
): void {
  eventBuffer.push(
    createInternalLLMCallEvent({
      contextId,
      taskId,
      iteration,
      model,
      messageCount: messages.length,
      toolCount,
    })
  );
}
