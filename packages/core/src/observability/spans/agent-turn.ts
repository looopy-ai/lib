/**
 * Agent Turn Span Helpers
 *
 * Tracing utilities for agent turn execution (multi-turn conversation spans)
 */

import { type Context, context, type Span, SpanStatusCode, trace } from '@opentelemetry/api';
import { tap } from 'rxjs/internal/operators/tap';
import type { AnyEvent } from '../../events';
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
export const startAgentTurnSpan = (params: AgentTurnSpanParams) => {
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
  const traceContext = trace.setSpan(context.active(), span);

  return {
    span,
    traceContext,
    tapFinish: tap<AnyEvent>({
      next: (event) => {
        switch (event.kind) {
          case 'task-complete':
            if (event.content) {
              span.setAttribute(SpanAttributes.OUTPUT, event.content);
            }
            span.setStatus({ code: SpanStatusCode.OK });
            break;
          default:
            break;
        }
      },
      complete: () => span.end(),
      error: (err) => {
        span.recordException(err);
        span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
        span.end();
      },
    }),
  };
};

/**
 * Add span event for messages loaded
 */
export function addMessagesLoadedEvent(span: Span, count: number): void {
  span.addEvent('messages.loaded', { count });
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
export const startAgentInitializeSpan = (params: {
  agentId: string;
  contextId: string;
  parentContext: Context;
}) => {
  const tracer = trace.getTracer('looopy-agent');

  const spanOptions: import('@opentelemetry/api').SpanOptions = {
    attributes: {
      [SpanAttributes.SESSION_ID]: params.contextId,
      [SpanAttributes.AGENT_ID]: params.agentId,
    },
  };

  const span = tracer.startSpan(`agent.initialize`, spanOptions, params.parentContext);
  const traceContext = trace.setSpan(params.parentContext, span);

  return { span, traceContext };
};

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
