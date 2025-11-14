import type { ToolCall } from './tools';

/**
 * Message in the conversation
 */
export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  toolCallId?: string;
  toolCalls?: ToolCall[]; // For assistant messages that make tool calls
  contentDelta?: string; // For streaming: the new content chunk (not accumulated)
}
