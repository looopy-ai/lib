/**
 * LLM Call Span Helpers
 *
 * Tracing utilities for LLM provider calls
 */

import { type Span, SpanStatusCode, trace } from '@opentelemetry/api';
import type { Message } from '../../core/types';
import type { ContentCompleteEvent, LLMEvent } from '../../events/types';
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
export const startLLMCallSpan = (params: LLMCallSpanParams) => {
  const tracer = trace.getTracer('looopy');

  const span = tracer.startSpan(
    SpanNames.LLM_CALL,
    {
      attributes: {
        [SpanAttributes.AGENT_ID]: params.agentId,
        [SpanAttributes.TASK_ID]: params.taskId,
        [SpanAttributes.GEN_AI_PROMPT]: JSON.stringify(params.messages),
        [SpanAttributes.LANGFUSE_OBSERVATION_TYPE]: 'generation',
      },
    },
    params.parentContext,
  );

  const traceContext = trace.setSpan(params.parentContext, span);

  return { span, traceContext };
};

/**
 * Set LLM response attributes on span
 */
export function setContentCompleteEventAttributes(
  span: Span,
  event: LLMEvent<ContentCompleteEvent>,
): void {
  // Set finish reason
  span.setAttribute(SpanAttributes.LLM_FINISH_REASON, event.finishReason || 'unknown');

  // Only set completion if there's actual content (don't set empty string for tool calls)
  const hasContent = event.content && event.content.trim().length > 0;
  if (hasContent) {
    span.setAttribute(SpanAttributes.GEN_AI_COMPLETION, event.content);
  }
}

/**
 * Complete LLM call span with success
 */
export function completeLLMCallSpan(span: Span, event: LLMEvent<ContentCompleteEvent>): void {
  setContentCompleteEventAttributes(span, event);
  span.setStatus({ code: SpanStatusCode.OK });
  span.end();
}

/**
 * Complete LLM call span with error
 */
export function failLLMCallSpan(span: Span, error: Error | string): void {
  const err = error instanceof Error ? error : new Error(String(error));

  span.setStatus({
    code: SpanStatusCode.ERROR,
    message: err.message,
  });
  span.recordException(err);
  span.end();
}
