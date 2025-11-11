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
  startLoopIterationSpan,
} from '../../observability/spans';
import type { LoopState } from '../types';

/**
 * Factory for starting iteration span
 *
 * Creates a new iteration span and returns updated state with trace context
 */
export const startIterationSpan = (
  state: LoopState,
  nextIteration: number,
  logger: Logger,
  parentContext: import('@opentelemetry/api').Context
) => {
  logger.debug(
    {
      taskId: state.taskId,
      iteration: nextIteration,
    },
    'Starting iteration'
  );

  // Start iteration span
  const { span, traceContext } = startLoopIterationSpan({
    agentId: state.agentId,
    taskId: state.taskId,
    contextId: state.contextId,
    iteration: nextIteration,
    parentContext,
  });

  // Inject iteration context into state so child operations can use it
  return {
    span,
    traceContext,
  };
};

/**
 * Factory for completing iteration
 *
 * Updates iteration number and completes the span
 */
export const completeIteration = (span: Span, nextIteration: number, logger: Logger) => {
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
    completeIterationSpan(span);

    return { ...state, iteration: nextIteration };
  };
};

/**
 * Factory for iteration error handler
 *
 * Fails the iteration span with error details
 */
export const catchIterationError = (span: Span) => {
  return (error: Error) => {
    // Fail span with error
    failIterationSpan(span, error);
    throw error;
  };
};
