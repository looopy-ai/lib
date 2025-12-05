import type { ToolCall } from './tools';

/**
 * Message in the conversation
 */
export type SystemLLMMessage = {
  role: 'system';
  content: string;
  name?: string;
};

export type UserLLMMessage = {
  role: 'user';
  content: string;
  name?: string;
};

export type AssistantLLMMessage = {
  role: 'assistant';
  content: string;
  name?: string;
  toolCalls?: ToolCall[];
};

export type ToolLLMMessage = {
  role: 'tool';
  content: string;
  name?: string;
  toolCallId: string;
};

export type LLMMessage = SystemLLMMessage | UserLLMMessage | AssistantLLMMessage | ToolLLMMessage;
