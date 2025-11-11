/**
 * Agent Loop Span Helpers
 *
 * Tracing utilities for the main agent loop span
 */

import { type Context, type Span, trace } from '@opentelemetry/api';
import type { LLMUsageEvent } from '../../events/types';
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
    params.parentContext
  );

  const traceContext = trace.setSpan(params.parentContext, span);

  return {
    span,
    traceContext,
    setOutput: (output?: string) => {
      if (!output) return;
      span.setAttribute(SpanAttributes.OUTPUT, output);
    },
    setSuccess: () => {
      span.end();
    },
    setError: (err: Error) => {
      span.recordException(err);
      span.setStatus({ code: 2, message: err.message });
      span.end();
    },
  };
};

export function addLLMUsageToSpan(span: Span, usage: LLMUsageEvent): void {
  span.setAttribute(SpanAttributes.GEN_AI_RESPONSE_MODEL, usage.model);
  span.setAttribute(SpanAttributes.GEN_AI_USAGE_PROMPT_TOKENS, usage.prompt_tokens || 0);
  span.setAttribute(SpanAttributes.GEN_AI_USAGE_COMPLETION_TOKENS, usage.completion_tokens || 0);
  span.setAttribute(SpanAttributes.GEN_AI_USAGE_TOTAL_TOKENS, usage.total_tokens || 0);
  span.setAttribute(
    SpanAttributes.GEN_AI_USAGE_COMPLETION_TOKENS_DETAILS,
    JSON.stringify(usage.completion_tokens_details || {})
  );
  span.setAttribute(
    SpanAttributes.GEN_AI_USAGE_PROMPT_TOKENS_DETAILS,
    JSON.stringify(usage.prompt_tokens_details || {})
  );
  span.setAttribute(
    SpanAttributes.GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS,
    usage.cache_creation_input_tokens || 0
  );
  span.setAttribute(
    SpanAttributes.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS,
    usage.cache_read_input_tokens || 0
  );
}

/**
 * Set output and complete agent execution span
 */
export function completeAgentExecuteSpan(
  span: Span,
  result: {
    state: 'completed' | 'failed';
    output?: string;
    error?: string;
  }
): void {
  if (result.output) {
    span.setAttribute('output', result.output);
  }

  span.setStatus({
    code: result.state === 'completed' ? 0 : 2, // OK : ERROR
    message: result.error,
  });

  if (result.error) {
    span.recordException(new Error(result.error));
  }

  span.end();
}
