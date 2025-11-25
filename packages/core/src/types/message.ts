import type { ToolCall } from './tools';

/**
 * Message in the conversation
 */
export type SystemMessage = {
  role: 'system';
  content: string;
  name?: string;
};

export type UserMessage = {
  role: 'user';
  content: string;
  name?: string;
};

export type AssistantMessage = {
  role: 'assistant';
  content: string;
  name?: string;
  toolCalls?: ToolCall[];
};

export type ToolMessage = {
  role: 'tool';
  content: string;
  name?: string;
  toolCallId: string;
};

export type Message = SystemMessage | UserMessage | AssistantMessage | ToolMessage;
