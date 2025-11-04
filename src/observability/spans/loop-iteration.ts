/**
 * Agent Loop Iteration Span Helpers
 *
 * Tracing utilities for agent loop iterations
 */

import {
  context as otelContext,
  type Span,
  type Context as SpanContext,
  SpanStatusCode,
  trace,
} from '@opentelemetry/api';
import type { TraceContext } from '../../core/types';
import { injectTraceContext, SpanAttributes, SpanNames } from '../tracing';

export interface LoopIterationSpanParams {
  agentId: string;
  taskId: string;
  contextId: string;
  iteration: number;
  traceContext?: TraceContext;
  rootContext?: SpanContext; // Parent context for sibling spans
}

/**
 * Start loop iteration span
 */
export function startLoopIterationSpan(params: LoopIterationSpanParams): {
  span: Span;
  traceContext: TraceContext;
} {
  const tracer = trace.getTracer('looopy');

  // Use root context if provided (makes iterations siblings, not nested)
  const parentContext = params.rootContext || otelContext.active();

  const span = tracer.startSpan(
    SpanNames.LOOP_ITERATION,
    {
      attributes: {
        [SpanAttributes.SESSION_ID]: params.contextId,
        [SpanAttributes.AGENT_ID]: params.agentId,
        [SpanAttributes.TASK_ID]: params.taskId,
        [SpanAttributes.ITERATION]: params.iteration,
        [SpanAttributes.LANGFUSE_OBSERVATION_TYPE]: 'chain',
      },
    },
    parentContext
  );

  const spanContext = trace.setSpan(parentContext, span);
  const traceContext = injectTraceContext(spanContext);

  if (!traceContext) {
    throw new Error('Failed to inject trace context');
  }

  return { span, traceContext };
}

/**
 * Complete iteration span with success
 */
export function completeIterationSpan(span: Span): void {
  span.setStatus({ code: SpanStatusCode.OK });
  span.end();
}

/**
 * Complete iteration span with error
 */
export function failIterationSpan(span: Span, error: Error | string): void {
  const err = error instanceof Error ? error : new Error(String(error));

  span.setStatus({
    code: SpanStatusCode.ERROR,
    message: err.message,
  });
  span.recordException(err);
  span.end();
}
