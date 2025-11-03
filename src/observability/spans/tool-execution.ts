/**
 * Tool Execution Span Helpers
 *
 * Tracing utilities for tool execution
 */

import { context as otelContext, type Span, SpanStatusCode, trace } from '@opentelemetry/api';
import type { ToolCall, ToolResult, TraceContext } from '../../core/types';
import { extractTraceContext, SpanAttributes, SpanNames } from '../tracing';

export interface ToolExecutionSpanParams {
  agentId: string;
  taskId: string;
  toolCall: ToolCall;
  traceContext?: TraceContext;
}

/**
 * Start tool execution span
 */
export function startToolExecutionSpan(params: ToolExecutionSpanParams): Span {
  const tracer = trace.getTracer('looopy');
  const parentContext = params.traceContext ? extractTraceContext(params.traceContext) : undefined;

  const span = tracer.startSpan(
    SpanNames.TOOL_EXECUTE,
    {
      attributes: {
        [SpanAttributes.AGENT_ID]: params.agentId,
        [SpanAttributes.TASK_ID]: params.taskId,
        [SpanAttributes.TOOL_NAME]: params.toolCall.function.name,
        [SpanAttributes.TOOL_CALL_ID]: params.toolCall.id,
        [SpanAttributes.LANGFUSE_OBSERVATION_TYPE]: 'tool',
        input: JSON.stringify(params.toolCall.function.arguments),
      },
    },
    parentContext || otelContext.active()
  );

  return span;
}

/**
 * Complete tool execution span with success
 */
export function completeToolExecutionSpan(span: Span, result: ToolResult): void {
  // Set output
  if (result.success) {
    span.setAttribute('output', JSON.stringify(result.result));
    span.setStatus({ code: SpanStatusCode.OK });
  } else {
    span.setAttribute('output', result.error || 'Tool execution failed');
    span.setStatus({ code: SpanStatusCode.ERROR });
    if (result.error) {
      span.setAttribute('error.message', result.error);
    }
  }

  span.end();
}

/**
 * Complete tool execution span with error (no provider found)
 */
export function failToolExecutionSpan(span: Span, error: string): void {
  span.setAttribute('output', error);
  span.setStatus({
    code: SpanStatusCode.ERROR,
    message: error,
  });
  span.end();
}

/**
 * Complete tool execution span with exception
 */
export function failToolExecutionSpanWithException(span: Span, error: Error): void {
  span.setAttribute('output', error.message);
  span.setStatus({
    code: SpanStatusCode.ERROR,
    message: error.message,
  });
  span.recordException(error);
  span.end();
}
