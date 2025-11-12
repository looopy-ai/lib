/**
 * Agent Loop Configuration
 *
 * Design Reference: design/agent-loop.md
 */

import type pino from 'pino';
import type { ArtifactStore, LLMProvider, TaskStateStore, ToolProvider } from './types';

export interface AgentLoopConfig {
  /**
   * Unique identifier for this agent
   */
  agentId: string;

  /**
   * LLM provider for generating responses
   */
  llmProvider: LLMProvider;

  /**
   * Tool providers for tool execution
   */
  toolProviders: ToolProvider[];

  /**
   * State store for persistence
   */
  taskStateStore: TaskStateStore;

  /**
   * Artifact store for multi-part artifacts
   */
  artifactStore: ArtifactStore;

  /**
   * Maximum iterations before forcing completion
   * @default 20
   */
  maxIterations?: number;

  /**
   * System prompt template
   */
  systemPrompt?: string;

  /**
   * Enable checkpoint/resume support
   * @default true
   */
  enableCheckpoints?: boolean;

  /**
   * Checkpoint interval (iterations)
   * @default 3
   */
  checkpointInterval?: number;

  /**
   * Enable think_aloud tool for explicit thought emission
   * When disabled, only <thinking> tags are supported for streaming thoughts
   * @default false
   */
  enableThoughtTools?: boolean;

  /**
   * Logger instance (optional)
   * If not provided, a default logger will be used
   */
  logger?: pino.Logger;
}
