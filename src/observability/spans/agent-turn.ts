/**
 * Agent Turn Span Helpers
 *
 * Tracing utilities for agent turn execution (multi-turn conversation spans)
 */

import { context, type Span, trace } from '@opentelemetry/api';
import { SpanAttributes } from '../tracing';

export interface AgentTurnSpanParams {
  agentId: string;
  taskId: string;
  contextId: string;
  turnNumber: number;
  userMessage: string | null;
}

const safeName = (name: string) => name.replace(/[^a-zA-Z0-9_-]+/g, '-');

/**
 * Start agent turn span
 */
export function startAgentTurnSpan(params: AgentTurnSpanParams): Span {
  const tracer = trace.getTracer('looopy-agent');

  const span = tracer.startSpan(`agent[${safeName(params.agentId)}]`, {
    attributes: {
      [SpanAttributes.SESSION_ID]: params.contextId,
      [SpanAttributes.AGENT_ID]: params.agentId,
      [SpanAttributes.TASK_ID]: params.taskId,
      'agent.turn.number': params.turnNumber,
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
  span.setAttribute('agent.turn.count', turnCount);
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
export function startAgentInitializeSpan(params: {
  agentId: string;
  contextId: string;
  parentSpan?: Span;
}): Span {
  const tracer = trace.getTracer('looopy-agent');

  const spanOptions: import('@opentelemetry/api').SpanOptions = {
    attributes: {
      [SpanAttributes.SESSION_ID]: params.contextId,
      [SpanAttributes.AGENT_ID]: params.agentId,
    },
  };

  // If parent span provided, create child span using context
  if (params.parentSpan) {
    const ctx = trace.setSpan(context.active(), params.parentSpan);
    return tracer.startSpan(`agent.initialize`, spanOptions, ctx);
  }

  return tracer.startSpan(`agent.initialize[${params.agentId}]`, spanOptions);
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
