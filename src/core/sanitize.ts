/**
 * LLM Response Sanitization
 *
 * Utilities for cleaning and validating LLM responses to ensure data quality.
 */

import type { LLMResponse, ToolCall } from './types';

/**
 * Check if a string is empty or contains only whitespace
 */
function isEmptyOrWhitespace(str: string | undefined): boolean {
  return !str || str.trim().length === 0;
}

/**
 * Sanitize tool call - remove invalid or malformed tool calls
 */
function sanitizeToolCall(toolCall: ToolCall): ToolCall | null {
  // Check required fields
  if (!toolCall.id || isEmptyOrWhitespace(toolCall.id)) {
    return null;
  }

  if (
    !toolCall.function ||
    !toolCall.function.name ||
    isEmptyOrWhitespace(toolCall.function.name)
  ) {
    return null;
  }

  // Ensure arguments is a valid object
  let args = toolCall.function.arguments;
  if (!args || typeof args !== 'object') {
    args = {};
  }

  return {
    ...toolCall,
    function: {
      ...toolCall.function,
      arguments: args,
    },
  };
}

/**
 * Sanitize message content based on whether tool calls are present
 */
function sanitizeMessageContent(
  message: LLMResponse['message'],
  hasToolCalls: boolean
): LLMResponse['message'] {
  if (!message) return message;

  const content = message.content;
  let sanitizedContent = content;

  // If content is empty/whitespace and there are tool calls, clear it
  if (isEmptyOrWhitespace(content) && hasToolCalls) {
    sanitizedContent = '';
  } else if (content && content.trim() !== content) {
    // Trim whitespace
    sanitizedContent = content.trim();
  }

  return {
    ...message,
    content: sanitizedContent,
  };
}

/**
 * Sanitize LLM response
 *
 * Cleans up common issues:
 * - Empty or whitespace-only messages when tool calls are present
 * - Invalid tool calls
 * - Inconsistent finish reasons
 */
export function sanitizeLLMResponse(response: LLMResponse): LLMResponse {
  // Step 1: Sanitize tool calls
  let validToolCalls: ToolCall[] | undefined;
  if (response.toolCalls && response.toolCalls.length > 0) {
    const sanitizedCalls = response.toolCalls
      .map(sanitizeToolCall)
      .filter((tc): tc is ToolCall => tc !== null);

    validToolCalls = sanitizedCalls.length > 0 ? sanitizedCalls : undefined;
  }

  const hasToolCalls = validToolCalls && validToolCalls.length > 0;

  // Step 2: Sanitize message
  const sanitizedMessage = sanitizeMessageContent(response.message, !!hasToolCalls);

  // Step 3: Add toolCalls to message if needed
  const messageWithToolCalls =
    hasToolCalls && sanitizedMessage && !sanitizedMessage.toolCalls
      ? { ...sanitizedMessage, toolCalls: validToolCalls }
      : sanitizedMessage;

  // Step 4: Ensure consistent finish reason
  const finishReason = hasToolCalls ? 'tool_calls' : response.finishReason;
  const finished = hasToolCalls ? false : response.finished;

  return {
    ...response,
    message: messageWithToolCalls,
    toolCalls: validToolCalls,
    finishReason,
    finished,
  };
}

/**
 * Validate LLM response has minimum required fields
 */
export function validateLLMResponse(response: LLMResponse): boolean {
  if (!response) {
    return false;
  }

  // Must have a message
  if (!response.message) {
    return false;
  }

  // Must have finish reason
  if (!response.finishReason) {
    return false;
  }

  // If tool calls present, validate them
  if (response.toolCalls && response.toolCalls.length > 0) {
    const hasValidToolCall = response.toolCalls.some(
      (tc) => tc.id && tc.function && tc.function.name
    );
    if (!hasValidToolCall) {
      return false;
    }
  }

  return true;
}
