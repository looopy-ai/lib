/**
 * Agent Loop Iteration Span Helpers
 *
 * Tracing utilities for agent loop iterations
 */

import { type Span, SpanStatusCode, trace } from '@opentelemetry/api';
import { SpanAttributes, SpanNames } from '../tracing';

export interface LoopIterationSpanParams {
  agentId: string;
  contextId: string;
  taskId: string;
  iteration: number;
  parentContext: import('@opentelemetry/api').Context; // Parent context for sibling spans
}

/**
 * Start loop iteration span
 */
export const startLoopIterationSpan = (params: LoopIterationSpanParams) => {
  const tracer = trace.getTracer('looopy');

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
    params.parentContext
  );

  const traceContext = trace.setSpan(params.parentContext, span);

  return { span, traceContext };
};

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
