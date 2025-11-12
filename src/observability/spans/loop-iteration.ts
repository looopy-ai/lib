/**
 * Agent Loop Iteration Span Helpers
 *
 * Tracing utilities for agent loop iterations
 */

import { SpanStatusCode, trace } from '@opentelemetry/api';
import { tap } from 'rxjs/internal/operators/tap';
import type { LoopContext } from '../../core-v2/types';
import type { AnyEvent } from '../../events';
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
export const startLoopIterationSpan = (context: LoopContext, iteration: number) => {
  const tracer = trace.getTracer('looopy');

  const span = tracer.startSpan(
    SpanNames.LOOP_ITERATION,
    {
      attributes: {
        [SpanAttributes.SESSION_ID]: context.contextId,
        [SpanAttributes.AGENT_ID]: context.agentId,
        [SpanAttributes.TASK_ID]: context.taskId,
        [SpanAttributes.ITERATION]: iteration,
        [SpanAttributes.LANGFUSE_OBSERVATION_TYPE]: 'chain',
      },
    },
    context.parentContext,
  );

  const traceContext = trace.setSpan(context.parentContext, span);

  return {
    span,
    traceContext,
    tapFinish: tap<AnyEvent>({
      next: (event) => {
        if (event.kind === 'content-complete') {
          if (event.content) {
            span.setAttribute(SpanAttributes.OUTPUT, event.content);
            span.setAttribute(SpanAttributes.LLM_FINISH_REASON, event.finishReason);
            span.setStatus({ code: SpanStatusCode.OK });
          }
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
