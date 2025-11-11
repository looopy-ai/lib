/**
 * LLM Call Span Helpers
 *
 * Tracing utilities for LLM provider calls
 */

import { type Span, SpanStatusCode, trace } from '@opentelemetry/api';
import type { LLMResponse, Message } from '../../core/types';
import { SpanAttributes, SpanNames } from '../tracing';

export interface LLMCallSpanParams {
  agentId: string;
  taskId: string;
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
        [SpanAttributes.LANGFUSE_OBSERVATION_TYPE]: 'generation',
      },
    },
    params.parentContext
  );

  const traceContext = trace.setSpan(params.parentContext, span);

  return { span, traceContext };
};

/**
 * Set LLM response attributes on span
 */
export function setLLMResponseAttributes(
  span: Span,
  response: LLMResponse,
  messages: Message[]
): void {
  // Set finish reason
  span.setAttribute(SpanAttributes.LLM_FINISH_REASON, response.finishReason || 'unknown');

  // Set input/output for Langfuse
  span.setAttribute(SpanAttributes.GEN_AI_PROMPT, JSON.stringify(messages));

  // Only set completion if there's actual content (don't set empty string for tool calls)
  const hasContent = response.message.content && response.message.content.trim().length > 0;
  if (hasContent) {
    span.setAttribute(SpanAttributes.GEN_AI_COMPLETION, response.message.content);
  }

  // Set model information
  if (response.model) {
    span.setAttribute(SpanAttributes.GEN_AI_REQUEST_MODEL, response.model);
    span.setAttribute(SpanAttributes.GEN_AI_RESPONSE_MODEL, response.model);
  }

  // Set usage information
  if (response.usage) {
    if (response.usage.promptTokens) {
      span.setAttribute(SpanAttributes.GEN_AI_USAGE_PROMPT_TOKENS, response.usage.promptTokens);
    }
    if (response.usage.completionTokens) {
      span.setAttribute(
        SpanAttributes.GEN_AI_USAGE_COMPLETION_TOKENS,
        response.usage.completionTokens
      );
    }
    if (response.usage.totalTokens) {
      span.setAttribute(SpanAttributes.GEN_AI_USAGE_TOTAL_TOKENS, response.usage.totalTokens);
    }
  }
}

/**
 * Complete LLM call span with success
 */
export function completeLLMCallSpan(span: Span, response: LLMResponse, messages: Message[]): void {
  setLLMResponseAttributes(span, response, messages);
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
