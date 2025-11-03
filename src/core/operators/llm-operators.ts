/**
 * RxJS Operator Callbacks for LLM Calls
 *
 * Factory functions that create operator callbacks for the callLLM() pipeline.
 */

import type { Span } from '@opentelemetry/api';
import type { Logger } from 'pino';
import { completeLLMCallSpan, failLLMCallSpan, startLLMCallSpan } from '../../observability/spans';
import { sanitizeLLMResponse } from '../sanitize';
import type { LLMResponse, LoopState, Message } from '../types';

/**
 * Factory for preparing LLM call
 *
 * Builds message array and starts span, returns state with messages
 */
export const prepareLLMCall = (spanRef: { current: Span | null }, logger: Logger) => {
  return (state: LoopState): { state: LoopState; messages: Message[] } => {
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
    spanRef.current = startLLMCallSpan({
      agentId: state.agentId,
      taskId: state.taskId,
      traceContext: state.traceContext,
    });

    return { state, messages };
  };
};

/**
 * Factory for processing LLM response
 *
 * Sanitizes, logs response and completes the span with metrics
 */
export const tapLLMResponse = (
  spanRef: { current: Span | null },
  messages: Message[],
  logger: Logger
) => {
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
    if (spanRef.current) {
      completeLLMCallSpan(spanRef.current, response, messages);
    }
  };
};

/**
 * Factory for sanitizing and mapping LLM response to state
 */
export const mapLLMResponseToState = (state: LoopState) => {
  return (response: LLMResponse): LoopState => {
    // Sanitize response before storing
    const sanitizedResponse = sanitizeLLMResponse(response);

    return {
      ...state,
      lastLLMResponse: sanitizedResponse,
    };
  };
};

/**
 * Factory for LLM error handler
 */
export const catchLLMError = (spanRef: { current: Span | null }) => {
  return (error: Error) => {
    // Fail span with error
    if (spanRef.current) {
      failLLMCallSpan(spanRef.current, error);
    }
    throw error;
  };
};
