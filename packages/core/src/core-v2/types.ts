import type pino from 'pino';
import type { AuthContext } from '../types/context';
import type { LLMProvider } from '../types/llm';
import type { ToolProvider } from '../types/tools';

export type AgentContext = {
  agentId: string;
  contextId: string;
  parentContext: import('@opentelemetry/api').Context;
  authContext?: AuthContext;
  toolProviders: ToolProvider[];
  logger: pino.Logger;
  systemPrompt?: string;
  skillPrompts?: Record<string, string>;
  metadata?: Record<string, unknown>;
};

export type TurnContext = AgentContext & {
  taskId: string;
  turnNumber: number;
};

export type LoopContext = TurnContext;

export type IterationContext = TurnContext;

export type LoopConfig = {
  llmProvider: LLMProvider;
  maxIterations: number;
  stopOnToolError: boolean;
};

export type IterationConfig = {
  llmProvider: LLMProvider;
  iterationNumber: number;
};

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

/**
 * Tool call from LLM
 */
export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: Record<string, unknown>;
  };
}
