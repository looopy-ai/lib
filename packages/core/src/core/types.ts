import type pino from 'pino';
import type { SkillRegistry } from '../skills';
import type { AuthContext } from '../types/context';
import type { LLMProvider } from '../types/llm';
import type { ToolProvider } from '../types/tools';
import type { SystemPromptProp } from '../utils';

export type AgentContext = {
  agentId: string;
  contextId: string;
  parentContext: import('@opentelemetry/api').Context;
  authContext?: AuthContext;
  toolProviders: ToolProvider[];
  logger: pino.Logger;
  systemPrompt?: SystemPromptProp;
  skillRegistry?: SkillRegistry;
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
