import type pino from 'pino';
import type { SkillRegistry } from '../skills';
import type { LLMProvider } from '../types/llm';
import type { ToolProvider } from '../types/tools';
import type { SystemPromptProp } from '../utils';

export type AgentContext<AuthContext> = {
  agentId: string;
  contextId: string;
  parentContext: import('@opentelemetry/api').Context;
  authContext?: AuthContext;
  toolProviders: ToolProvider<AuthContext>[];
  logger: pino.Logger;
  systemPrompt?: SystemPromptProp;
  skillRegistry?: SkillRegistry;
  metadata?: Record<string, unknown>;
};

export type TurnContext<AuthContext> = AgentContext<AuthContext> & {
  taskId: string;
  turnNumber: number;
};

export type LoopContext<AuthContext> = TurnContext<AuthContext>;

export type IterationContext<AuthContext> = TurnContext<AuthContext>;

export type LoopConfig = {
  llmProvider: LLMProvider;
  maxIterations: number;
  stopOnToolError: boolean;
};

export type IterationConfig = {
  llmProvider: LLMProvider;
  iterationNumber: number;
};
