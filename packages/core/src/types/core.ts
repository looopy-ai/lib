import type pino from 'pino';
import type { Observable } from 'rxjs';
import type { LLMProvider } from '../types/llm';
import type { AnyEvent, ContextAnyEvent } from './event';
import type { ToolCall, ToolDefinition } from './tools';

export type AgentContext<AuthContext> = Readonly<{
  agentId: string;
  contextId: string;
  parentContext: import('@opentelemetry/api').Context;
  authContext?: AuthContext;
  /** Logger */
  logger: pino.Logger;
  /** Plugins */
  plugins: readonly Plugin<AuthContext>[];
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

export type Plugin<AuthContext> = SystemPromptPlugin<AuthContext> | ToolPlugin<AuthContext>;

type BasePlugin = {
  readonly name: string;
  readonly version?: string;
};

// TODO: agents, skills, ?message store?

// TODO: state persistence hooks

export type SystemPromptPlugin<AuthContext> = BasePlugin & {
  /**
   * Generate system prompts for the iteration
   */
  generateSystemPrompts: (
    context: IterationContext<AuthContext>,
  ) => SystemPrompt[] | Promise<SystemPrompt[]>;
};

export const isSystemPromptPlugin = <AuthContext>(
  plugin: Plugin<AuthContext>,
): plugin is BasePlugin & SystemPromptPlugin<AuthContext> => {
  return typeof (plugin as SystemPromptPlugin<AuthContext>).generateSystemPrompts === 'function';
};

export type ToolPlugin<AuthContext> = BasePlugin & {
  /**
   * Get available tools from this provider
   */
  listTools: () => Promise<ToolDefinition[]>;

  /**
   * Get tool definition by ID
   */
  getTool: (toolId: string) => Promise<ToolDefinition | undefined>;

  /**
   * Execute a tool call
   */
  executeTool: (
    toolCall: ToolCall,
    context: IterationContext<AuthContext>,
  ) => Observable<ContextAnyEvent | AnyEvent>;
};

export const isToolPlugin = <AuthContext>(
  plugin: Plugin<AuthContext>,
): plugin is BasePlugin & ToolPlugin<AuthContext> => {
  return (
    typeof (plugin as ToolPlugin<AuthContext>).listTools === 'function' &&
    typeof (plugin as ToolPlugin<AuthContext>).getTool === 'function' &&
    typeof (plugin as ToolPlugin<AuthContext>).executeTool === 'function'
  );
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
