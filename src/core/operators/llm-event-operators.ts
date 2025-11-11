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
  messages: Message[],
  toolCount: number,
  eventBuffer: import('../../events').AnyEvent[]
): void {
  eventBuffer.push(
    createInternalLLMCallEvent({
      contextId,
      taskId,
      iteration,
      messageCount: messages.length,
      toolCount,
    })
  );
}
