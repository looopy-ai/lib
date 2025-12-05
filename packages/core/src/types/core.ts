import type pino from 'pino';
import type { Observable } from 'rxjs';
import type { SkillRegistry } from '../skills';
import type { LLMProvider } from '../types/llm';
import type { ContextAnyEvent } from './event';
import type { ToolCall, ToolDefinition, ToolProvider } from './tools';

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
  readonly name: string;
  readonly version?: string;

  /**
   * Generate system prompts for the iteration
   */
  generateSystemPrompts?: (
    context: IterationContext<AuthContext>,
  ) => SystemPrompt[] | Promise<SystemPrompt[]>;

  tools?: {
    /**
     * Get tool definition by name
     */
    getTool: (toolName: string) => Promise<ToolDefinition | undefined>;

    /**
     * Get available tools from this provider
     */
    listTools: () => Promise<ToolDefinition[]>;

    /**
     * Execute a tool call
     */
    executeTool: (
      toolCall: ToolCall,
      context: IterationContext<AuthContext>,
    ) => Observable<ContextAnyEvent>;
  };

  // TODO: tools, agents, skills, ?message store?

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
