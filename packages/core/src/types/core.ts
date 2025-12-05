import type pino from 'pino';
import type { SkillRegistry } from '../skills';
import type { LLMProvider } from '../types/llm';
import type { ToolProvider } from '../types/tools';

export type AgentContext<AuthContext> = Readonly<{
  agentId: string;
  contextId: string;
  parentContext: import('@opentelemetry/api').Context;
  authContext?: AuthContext;
  toolProviders: readonly ToolProvider<AuthContext>[];
  /** Logger */
  logger: pino.Logger;
  /** Plugins */
  plugins?: readonly Plugin<AuthContext>[];
  skillRegistry?: SkillRegistry;
  metadata?: Record<string, unknown>;
}>;

export type TurnContext<AuthContext> = AgentContext<AuthContext> &
  Readonly<{
    taskId: string;
    turnNumber: number;
  }>;

export type LoopContext<AuthContext> = TurnContext<AuthContext>;

export type IterationContext<AuthContext> = TurnContext<AuthContext>;

export type LoopConfig = {
  llmProvider: LLMProvider;
  maxIterations: number;
  stopOnToolError: boolean;
};

export type IterationConfig<AuthContext> = {
  llmProvider:
    | LLMProvider
    | ((
        context: LoopContext<AuthContext>,
        systemPromptMetadata: Record<string, unknown> | undefined,
      ) => LLMProvider);
  iterationNumber: number;
};

export type Plugin<AuthContext> = {
  name: string;
  version?: string;
  generateSystemPrompts: (
    context: IterationContext<AuthContext>,
  ) => SystemPrompt[] | Promise<SystemPrompt[]>;
  // TODO: prompts, tools, agents, skills, ?message store?

  // TODO: state persistence hooks
};

export type SystemPrompt = {
  /** The content of the system prompt */
  content: string;
  /** Whether to insert before or after the existing system prompt */
  position: 'before' | 'after';
  /** Lower is earlier */
  positionSequence?: number;
  /** Arbitrary metadata for the prompt */
  metadata?: Record<string, unknown>;
  /** Information about the source of the prompt for tracing */
  source?: {
    providerName: string;
    promptName: string;
    promptVersion?: number;
  };
};
