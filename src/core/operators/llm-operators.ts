/**
 * RxJS Operator Callbacks for LLM Calls
 *
 * Factory functions that create operator callbacks for the callLLM() pipeline.
 */

import type { Span } from '@opentelemetry/api';
import type { Logger } from 'pino';
import { completeLLMCallSpan, failLLMCallSpan, startLLMCallSpan } from '../../observability/spans';
import type { LLMResponse, LoopState, Message } from '../types';

/**
 * Factory for preparing LLM call
 *
 * Builds message array and starts span, returns state with messages
 */
export const prepareLLMCall = (
  state: LoopState,
  parentContext: import('@opentelemetry/api').Context,
  logger: Logger
) => {
  const messages = [
    {
      role: 'system' as const,
      content: state.systemPrompt,
    },
    ...state.messages,
  ];

  logger.debug(
    {
      taskId: state.taskId,
      messageCount: messages.length,
      toolCount: state.availableTools.length,
    },
    'Calling LLM'
  );

  // Start LLM call span
  const { span, traceContext } = startLLMCallSpan({
    agentId: state.agentId,
    taskId: state.taskId,
    parentContext,
  });

  return { state, messages, span, traceContext };
};

/**
 * Factory for processing LLM response
 *
 * Sanitizes, logs response and completes the span with metrics
 */
export const tapLLMResponse = (span: Span, messages: Message[], logger: Logger) => {
  return (response: LLMResponse) => {
    logger.debug(
      {
        finishReason: response.finishReason,
        hasToolCalls: !!response.toolCalls?.length,
        toolCallCount: response.toolCalls?.length || 0,
      },
      'LLM response received'
    );

    // Complete span with response
    completeLLMCallSpan(span, response, messages);
  };
};

/**
 * Factory for sanitizing and mapping LLM response to state
 */
export const mapLLMResponseToState = (state: LoopState) => {
  return (response: LLMResponse): LoopState => ({
    ...state,
    lastLLMResponse: response,
  });
};

/**
 * Factory for LLM error handler
 */
export const catchLLMError = (span: Span) => {
  return (error: Error) => {
    // Fail span with error
    failLLMCallSpan(span, error);
    throw error;
  };
};
