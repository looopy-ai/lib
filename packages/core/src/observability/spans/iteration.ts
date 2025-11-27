/**
 * Agent Loop Iteration Span Helpers
 *
 * Tracing utilities for agent loop iterations
 */

import { SpanStatusCode, trace } from '@opentelemetry/api';
import { tap } from 'rxjs/internal/operators/tap';
import type { LoopContext } from '../../core/types';
import type { ContextAnyEvent } from '../../types/event';
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
export const startLoopIterationSpan = <AuthContext>(
  context: LoopContext<AuthContext>,
  iteration: number,
) => {
  const logger = context.logger;
  logger.info('Starting iteration');
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
    tapFinish: tap<ContextAnyEvent>({
      next: (event) => {
        if (event.kind === 'content-complete') {
          if (event.content) {
            span.setAttribute(SpanAttributes.OUTPUT, event.content);
            span.setAttribute(SpanAttributes.LLM_FINISH_REASON, event.finishReason);
            span.setStatus({ code: SpanStatusCode.OK });
          }
          logger.debug({ finishReason: event.finishReason }, 'Iteration completed successfully');
        }
      },
      complete: () => span.end(),
      error: (err) => {
        span.recordException(err);
        span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
        span.end();
        logger.error({ error: err.message }, 'Iteration failed');
      },
    }),
  };
};
