/**
 * Tool Execution Span Helpers
 *
 * Tracing utilities for tool execution
 */

import { context as otelContext, SpanStatusCode, trace } from '@opentelemetry/api';
import { tap } from 'rxjs/internal/operators/tap';
import type { ToolCall } from '../../core/types';
import type { IterationContext } from '../../core-v2/types';
import type { ToolExecutionEvent, ToolStartEvent } from '../../events';
import { SpanAttributes, SpanNames } from '../tracing';

export interface ToolExecutionSpanParams {
  agentId: string;
  taskId: string;
  toolCall: ToolCall;
  parentContext?: import('@opentelemetry/api').Context;
}

/**
 * Start tool execution span
 */
export const startToolExecuteSpan = (context: IterationContext, toolStart: ToolStartEvent) => {
  const tracer = trace.getTracer('looopy');

  const span = tracer.startSpan(
    SpanNames.TOOL_EXECUTE,
    {
      attributes: {
        [SpanAttributes.AGENT_ID]: context.agentId,
        [SpanAttributes.TASK_ID]: context.taskId,
        [SpanAttributes.TOOL_NAME]: toolStart.toolName,
        [SpanAttributes.TOOL_CALL_ID]: toolStart.toolCallId,
        [SpanAttributes.LANGFUSE_OBSERVATION_TYPE]: 'tool',
        input: JSON.stringify(toolStart.arguments),
      },
    },
    context.parentContext,
  );

  const traceContext = trace.setSpan(context.parentContext || otelContext.active(), span);

  return {
    span,
    traceContext,
    tapFinish: tap<ToolExecutionEvent>({
      next: (event) => {
        if (event.kind === 'tool-complete') {
          if (event.success) {
            span.setAttribute('output', JSON.stringify(event.result));
            span.setStatus({ code: SpanStatusCode.OK });
          } else {
            span.setAttribute('output', event.error || 'Tool execution failed');
            span.setStatus({ code: SpanStatusCode.ERROR });
            if (event.error) {
              span.setAttribute('error.message', event.error);
            }
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
