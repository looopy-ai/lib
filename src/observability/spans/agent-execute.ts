/**
 * Agent Execute Span Helpers
 *
 * Tracing utilities for the main agent execution span
 */

import { context as otelContext, type Span, trace } from '@opentelemetry/api';
import type { TraceContext } from '../../core/types';
import { extractTraceContext, injectTraceContext, SpanAttributes, SpanNames } from '../tracing';

export interface AgentExecuteSpanParams {
  agentId: string;
  taskId: string;
  contextId: string;
  prompt: string;
  traceContext?: TraceContext;
}

/**
 * Start agent execution span
 */
export function startAgentExecuteSpan(params: AgentExecuteSpanParams): {
  span: Span;
  traceContext: TraceContext;
} {
  const tracer = trace.getTracer('looopy');
  const parentContext = params.traceContext ? extractTraceContext(params.traceContext) : undefined;

  const activeContext = parentContext || otelContext.active();

  const span = tracer.startSpan(
    SpanNames.AGENT_EXECUTE,
    {
      attributes: {
        [SpanAttributes.AGENT_ID]: params.agentId,
        [SpanAttributes.TASK_ID]: params.taskId,
        [SpanAttributes.CONTEXT_ID]: params.contextId,
        input: params.prompt,
        [SpanAttributes.LANGFUSE_OBSERVATION_TYPE]: 'agent',
      },
    },
    activeContext
  );

  const spanContext = trace.setSpan(activeContext, span);
  const traceContext = injectTraceContext(spanContext);

  if (!traceContext) {
    throw new Error('Failed to inject trace context');
  }

  return { span, traceContext };
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
