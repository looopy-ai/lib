/**
 * LLM Call Span Helpers
 *
 * Tracing utilities for LLM provider calls
 */

import { context as otelContext, type Span, SpanStatusCode, trace } from '@opentelemetry/api';
import type { LLMResponse, Message, TraceContext } from '../../core/types';
import { extractTraceContext, SpanAttributes, SpanNames } from '../tracing';

export interface LLMCallSpanParams {
  agentId: string;
  taskId: string;
  traceContext?: TraceContext;
}

/**
 * Start LLM call span
 */
export function startLLMCallSpan(params: LLMCallSpanParams): Span {
  const tracer = trace.getTracer('looopy');
  const parentContext = params.traceContext ? extractTraceContext(params.traceContext) : undefined;

  const span = tracer.startSpan(
    SpanNames.LLM_CALL,
    {
      attributes: {
        [SpanAttributes.AGENT_ID]: params.agentId,
        [SpanAttributes.TASK_ID]: params.taskId,
        [SpanAttributes.LANGFUSE_OBSERVATION_TYPE]: 'generation',
      },
    },
    parentContext || otelContext.active()
  );

  return span;
}

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
  span.setAttribute(SpanAttributes.GEN_AI_COMPLETION, response.message.content || '');

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
