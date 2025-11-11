/**
 * RxJS Operator Callbacks for Agent Execution
 *
 * Factory functions that create operator callbacks for the execute() pipeline.
 */

import type { Span } from '@opentelemetry/api';
import type { Logger } from 'pino';
import type { LLMUsageEvent } from '../../events/types';
import { completeAgentExecuteSpan } from '../../observability/spans';
import { createFailedEvent } from '../events';
import type { AgentEvent, AgentLoopContext } from '../types';

/**
 * Factory for tap operator after execution events
 *
 * Completes the root span when task finishes
 */
export const tapAfterTurn = (
  setOutput: (output?: string) => void,
  setUsage: (usage: LLMUsageEvent) => void
) => {
  return (event: AgentEvent) => {
    if (event.kind === 'llm-usage') {
      setUsage(event);
      return;
    }

    // Only process completion events
    if (event.kind !== 'task-complete' && event.kind !== 'task-status') {
      return;
    }

    // Check if this is a final event
    const isFinal =
      event.kind === 'task-complete' ||
      (event.kind === 'task-status' &&
        (event.status === 'completed' || event.status === 'failed' || event.status === 'canceled'));

    if (!isFinal) {
      return;
    }

    // Extract output and state
    const output = event.kind === 'task-complete' ? event.content : event.message;
    setOutput(output); // TODO status
    // const state =
    //   event.kind === 'task-complete' ? 'completed' : (event.status as 'completed' | 'failed');
    // const error = event.metadata?.error as string | undefined;

    // logger.trace(
    //   { eventKind: event.kind, hasOutput: !!output, outputLength: output?.length, state },
    //   'Completing agent execute span'
    // );

    // completeAgentExecuteSpan(span, { state, output, error });
  };
};

/**
 * Factory for catchError operator
 *
 * Handles execution errors and completes span with failure
 */
export const catchTurnError = (
  rootSpanRef: { current: Span | null },
  context: Partial<AgentLoopContext>,
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
