/**
 * Tool Execution Span Helpers
 *
 * Tracing utilities for tool execution
 */

import { context as otelContext, SpanStatusCode, trace } from '@opentelemetry/api';
import { tap } from 'rxjs';
import { isChildTaskEvent } from '../../events/utils';
import type { IterationContext } from '../../types/core';
import type {
  AnyEvent,
  ContextAnyEvent,
  ToolCallEvent,
  ToolCompleteEvent,
} from '../../types/event';
import type { ToolCall } from '../../types/tools';
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
export const startToolExecuteSpan = <AuthContext>(
  context: IterationContext<AuthContext>,
  toolStart: ToolCallEvent,
) => {
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
    tapFinish: tap<ContextAnyEvent | AnyEvent>({
      next: (event) => {
        if (isChildTaskEvent(event) || !isToolCompleteEvent(event)) {
          return;
        }

        try {
          span.setAttribute('output', JSON.stringify(event.result));
        } catch {
          // Ignore serialization errors
        }

        if (event.success) {
          span.setStatus({ code: SpanStatusCode.OK });
          return;
        }

        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: event.error ?? 'Tool execution failed',
        });
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

const isToolCompleteEvent = (event: AnyEvent): event is ToolCompleteEvent => {
  return event.kind === 'tool-complete';
};
