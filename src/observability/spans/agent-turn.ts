/**
 * Agent Turn Span Helpers
 *
 * Tracing utilities for agent turn execution (multi-turn conversation spans)
 */

import { type Span, trace } from '@opentelemetry/api';
import { SpanAttributes } from '../tracing';

export interface AgentTurnSpanParams {
  agentId: string;
  taskId: string;
  contextId: string;
  turnNumber: number;
  userMessage: string | null;
}

/**
 * Start agent turn span
 */
export function startAgentTurnSpan(params: AgentTurnSpanParams): Span {
  const tracer = trace.getTracer('looopy-agent');

  const span = tracer.startSpan(`agent.turn[${params.agentId}]`, {
    attributes: {
      'session.id': params.contextId,
      'agent.contextId': params.contextId,
      'agent.agentId': params.agentId,
      'agent.taskId': params.taskId,
      'agent.turnNumber': params.turnNumber,
      'agent.hasUserMessage': params.userMessage !== null,
      [SpanAttributes.LANGFUSE_OBSERVATION_TYPE]: 'agent',
      // Add input as span attribute for Langfuse
      ...(params.userMessage ? { input: params.userMessage } : {}),
    },
  });

  return span;
}

/**
 * Add span event for messages loaded
 */
export function addMessagesLoadedEvent(span: Span, count: number): void {
  span.addEvent('messages.loaded', { count });
}

/**
 * Add span event for messages saved
 */
export function addMessagesSavedEvent(span: Span, count: number): void {
  span.addEvent('messages.saved', { count });
}

/**
 * Add span event for messages compacted
 */
export function addMessagesCompactedEvent(span: Span): void {
  span.addEvent('messages.compacted');
}

/**
 * Set output attribute on span (final assistant message)
 */
export function setTurnOutputAttribute(span: Span, output: string): void {
  span.setAttribute('output', output);
}

/**
 * Set turn count attribute on span
 */
export function setTurnCountAttribute(span: Span, turnCount: number): void {
  span.setAttribute('agent.turnCount', turnCount);
}

/**
 * Complete agent turn span with success
 */
export function completeAgentTurnSpan(span: Span): void {
  span.setStatus({ code: 1 }); // OK
  span.end();
}

/**
 * Fail agent turn span with error
 */
export function failAgentTurnSpan(span: Span, error: Error): void {
  span.setStatus({
    code: 2, // ERROR
    message: error.message,
  });
  span.recordException(error);
  span.end();
}

/**
 * Start agent initialization span
 */
export function startAgentInitializeSpan(params: { agentId: string; contextId: string }): Span {
  const tracer = trace.getTracer('looopy-agent');

  const span = tracer.startSpan(`agent.initialize[${params.agentId}]`, {
    attributes: {
      'session.id': params.contextId,
      'agent.contextId': params.contextId,
      'agent.agentId': params.agentId,
    },
  });

  return span;
}

/**
 * Set resume attributes on initialization span
 */
export function setResumeAttributes(span: Span, existingMessageCount: number): void {
  span.setAttribute('agent.resumed', true);
  span.setAttribute('agent.existingMessages', existingMessageCount);
}

/**
 * Complete agent initialization span with success
 */
export function completeAgentInitializeSpan(span: Span): void {
  span.setStatus({ code: 1 }); // OK
  span.end();
}

/**
 * Fail agent initialization span with error
 */
export function failAgentInitializeSpan(span: Span, error: Error): void {
  span.setStatus({
    code: 2, // ERROR
    message: error.message,
  });
  span.recordException(error);
  span.end();
}
