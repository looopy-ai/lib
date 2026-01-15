import type { MessageStore } from '../stores/messages';
import type { SerializedError } from '../utils/error';
import type { FilterPlugins, Plugin } from './core';
import type { LLMProvider } from './llm';

/**
 * Agent configuration
 */
export interface AgentConfig<AuthContext> {
  /** Agent ID for tracing */
  agentId: string;

  /** Unique identifier for this agent/session */
  contextId: string;

  /** LLM provider for generating responses */
  llmProvider: LLMProvider;

  /** Optional filter for plugins */
  filterPlugins?: FilterPlugins<AuthContext>;

  /** Message store for conversation history */
  messageStore: MessageStore;

  /** Agent store for persisting AgentState */
  agentStore?: AgentStore;

  /** Auto-compact messages when exceeding limit (default: false) */
  autoCompact?: boolean;

  /** Maximum messages to keep before compaction warning */
  maxMessages?: number;

  /** Plugins */
  plugins?: Plugin<AuthContext>[];

  /** Logger */
  logger?: import('pino').Logger;
}

/**
 * Agent state
 */
export interface AgentState {
  /** Agent lifecycle status */
  status: 'created' | 'idle' | 'busy' | 'shutdown' | 'error';

  /** Total turns executed */
  turnCount: number;

  /** Last activity timestamp */
  lastActivity: Date;

  /** Creation timestamp */
  createdAt: Date;

  /** Error if in error state */
  error?: SerializedError;

  /** Metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Persists AgentState between process restarts.
 *
 * Implementations can use any durable medium (filesystem, database, etc)
 * as long as they can persist and restore the full AgentState object.
 */
export interface AgentStore {
  /**
   * Load persisted state for a contextId.
   *
   * Returns null when no state exists.
   */
  load(contextId: string): Promise<AgentState | null>;

  /**
   * Persist the latest state for a contextId.
   */
  save(contextId: string, state: AgentState): Promise<void>;

  /**
   * Optional helper to remove persisted state.
   */
  delete?(contextId: string): Promise<void>;
}
