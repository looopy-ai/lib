/**
 * LLM Call Span Helpers
 *
 * Tracing utilities for LLM provider calls
 */

import { SpanStatusCode, trace } from '@opentelemetry/api';
import { tap } from 'rxjs/internal/operators/tap';
import type { LoopContext } from '../../core-v2/types';
import type { Message } from '../../core/types';
import type { AnyEvent } from '../../events/types';
import { SpanAttributes, SpanNames } from '../tracing';

export interface LLMCallSpanParams {
  agentId: string;
  taskId: string;
  messages: Message[];
  parentContext: import('@opentelemetry/api').Context;
}

/**
 * Start LLM call span
 */
export const startLLMCallSpan = (context: LoopContext, messages: Message[]) => {
  const tracer = trace.getTracer('looopy');

  const span = tracer.startSpan(
    SpanNames.LLM_CALL,
    {
      attributes: {
        [SpanAttributes.AGENT_ID]: context.agentId,
        [SpanAttributes.TASK_ID]: context.taskId,
        [SpanAttributes.GEN_AI_PROMPT]: JSON.stringify(messages),
        [SpanAttributes.LANGFUSE_OBSERVATION_TYPE]: 'generation',
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
            span.setAttribute(SpanAttributes.GEN_AI_COMPLETION, event.content);
          }
          span.setAttribute(SpanAttributes.LLM_FINISH_REASON, event.finishReason || 'unknown');
          span.setStatus({ code: SpanStatusCode.OK });
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
