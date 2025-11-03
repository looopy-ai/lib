/**
 * RxJS Operator Callbacks for Agent Iterations
 *
 * Factory functions that create operator callbacks for the executeIteration() pipeline.
 */

import type { Span } from '@opentelemetry/api';
import type { Logger } from 'pino';
import {
  completeIterationSpan,
  failIterationSpan,
  startAgentIterationSpan,
} from '../../observability/spans';
import type { LoopState } from '../types';

type WithTraceContext = {
  _rootContext?: import('@opentelemetry/api').Context;
};

/**
 * Factory for starting iteration span
 *
 * Creates a new iteration span and returns updated state with trace context
 */
export const startIterationSpan = (
  spanRef: { current: Span | null },
  nextIteration: number,
  logger: Logger
) => {
  return (state: LoopState) => {
    logger.debug(
      {
        taskId: state.taskId,
        iteration: nextIteration,
      },
      'Starting iteration'
    );

    // Start iteration span
    const { span, traceContext } = startAgentIterationSpan({
      agentId: state.agentId,
      taskId: state.taskId,
      iteration: nextIteration,
      traceContext: state.traceContext,
      rootContext: (state as WithTraceContext)._rootContext,
    });

    spanRef.current = span;

    // Inject iteration context into state so child operations can use it
    return {
      ...state,
      traceContext,
    };
  };
};

/**
 * Factory for completing iteration
 *
 * Updates iteration number and completes the span
 */
export const completeIteration = (
  spanRef: { current: Span | null },
  nextIteration: number,
  logger: Logger
) => {
  return (state: LoopState) => {
    logger.trace(
      {
        taskId: state.taskId,
        iteration: nextIteration,
        completed: state.completed,
      },
      'Iteration complete'
    );

    // Complete span successfully
    if (spanRef.current) {
      completeIterationSpan(spanRef.current);
    }

    return { ...state, iteration: nextIteration };
  };
};

/**
 * Factory for iteration error handler
 *
 * Fails the iteration span with error details
 */
export const catchIterationError = (spanRef: { current: Span | null }) => {
  return (error: Error) => {
    // Fail span with error
    if (spanRef.current) {
      failIterationSpan(spanRef.current, error);
    }
    throw error;
  };
};
