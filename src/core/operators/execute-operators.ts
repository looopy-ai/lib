/**
 * RxJS Operator Callbacks for Agent Execution
 *
 * Factory functions that create operator callbacks for the execute() pipeline.
 */

import { context as otelContext, type Span, trace } from '@opentelemetry/api';
import type { Logger } from 'pino';
import { completeAgentExecuteSpan, startAgentLoopSpan } from '../../observability/spans';
import { extractTraceContext } from '../../observability/tracing';
import { createFailedEvent } from '../events';
import type { AgentEvent, Context, LoopState } from '../types';

type WithTraceContext = {
  _rootSpan?: Span;
  _rootContext?: import('@opentelemetry/api').Context;
};

/**
 * Factory for tap operator before execution
 *
 * Starts the root execution span and stores trace context
 */
export const tapBeforeExecute = (
  rootSpanRef: { current: Span | null },
  context: Partial<Context>,
  logger: Logger
) => {
  return (state: LoopState) => {
    // Start agent execution span
    const { span, traceContext } = startAgentLoopSpan({
      agentId: state.agentId,
      taskId: state.taskId,
      contextId: state.contextId,
      prompt: context.messages?.at(-1)?.content,
      traceContext: context.traceContext,
    });

    // Store span and trace context
    rootSpanRef.current = span;
    state.traceContext = traceContext;
    (state as WithTraceContext)._rootSpan = span;

    // Store root context for iterations (using parent context or active)
    const parentCtx = context.traceContext ? extractTraceContext(context.traceContext) : undefined;
    const activeCtx = parentCtx || otelContext.active();
    (state as WithTraceContext)._rootContext = trace.setSpan(activeCtx, span);

    logger.debug(
      {
        taskId: state.taskId,
        contextId: state.contextId,
        toolCount: state.availableTools.length,
        traceId: state.traceContext?.traceId,
      },
      'Execution prepared'
    );
  };
};

/**
 * Factory for tap operator after execution events
 *
 * Completes the root span when task finishes
 */
export const tapAfterExecuteEvents = () => {
  return (event: AgentEvent) => {
    // Task completion events trigger span completion
    if (event.kind === 'task-complete' || event.kind === 'task-status') {
      const span = (event as WithTraceContext)._rootSpan;
      if (span) {
        // Determine if this is final based on event type and status
        const isFinal = event.kind === 'task-complete' ||
          (event.kind === 'task-status' && (
            event.status === 'completed' ||
            event.status === 'failed' ||
            event.status === 'canceled'
          ));

        if (isFinal) {
          completeAgentExecuteSpan(span, {
            state: event.kind === 'task-complete' ? 'completed' : event.status as 'completed' | 'failed',
            output: event.kind === 'task-complete' ? event.content : event.message,
            error: event.metadata?.error as string | undefined,
          });
        }
      }
    }
  };
};

/**
 * Factory for catchError operator
 *
 * Handles execution errors and completes span with failure
 */
export const catchExecuteError = (
  rootSpanRef: { current: Span | null },
  context: Partial<Context>,
  logger: Logger,
  execId: string
) => {
  return (error: Error) => {
    logger.error({ error: error.message, stack: error.stack, execId }, 'Agent execution failed');

    // Complete root span with error
    if (rootSpanRef.current) {
      completeAgentExecuteSpan(rootSpanRef.current, {
        state: 'failed',
        error: error.message,
      });
    }

    return [
      createFailedEvent(context.taskId || 'unknown', context.contextId || 'unknown', error.message),
    ];
  };
};
