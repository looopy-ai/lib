/**
 * Agent Loop Span Helpers
 *
 * Tracing utilities for the main agent loop span
 */

import { type Context, SpanStatusCode, trace } from '@opentelemetry/api';
import { tap } from 'rxjs/internal/operators/tap';
import type { AnyEvent } from '../../events/types';
import { SpanAttributes, SpanNames } from '../tracing';

export interface AgentLoopSpanParams {
  agentId: string;
  taskId: string;
  contextId: string;
  prompt?: string;
  parentContext: Context;
}

/**
 * Start agent loop span
 */
export const startAgentLoopSpan = (params: AgentLoopSpanParams) => {
  const tracer = trace.getTracer('looopy');

  const span = tracer.startSpan(
    SpanNames.LOOP_START,
    {
      attributes: {
        [SpanAttributes.SESSION_ID]: params.contextId,
        [SpanAttributes.AGENT_ID]: params.agentId,
        [SpanAttributes.TASK_ID]: params.taskId,
        input: params.prompt,
        [SpanAttributes.LANGFUSE_OBSERVATION_TYPE]: 'event',
      },
    },
    params.parentContext,
  );

  const traceContext = trace.setSpan(params.parentContext, span);

  return {
    span,
    traceContext,
    tapFinish: tap<AnyEvent>({
      next: (event) => {
        switch (event.kind) {
          case 'content-complete':
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
