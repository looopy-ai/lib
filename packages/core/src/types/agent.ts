import type { MessageStore } from '../stores/messages';
import type { SerializedError } from '../utils/error';
import type { FilterPlugins, Plugin } from './core';
import type { InputType, JSONSchema } from './event';
import type { LLMProvider } from './llm';

/**
 * A pending tool-input-required entry — saved to AgentState so it survives across turns.
 */
export interface PendingToolInput {
  /** The public-facing ID the consumer uses to supply the resolved value */
  inputId: string;
  /** The internal tool call ID; used to re-call the tool on resume */
  toolCallId: string;
  toolName: string;
  /** Original arguments; passed back to the tool on resume */
  toolArguments: Record<string, unknown>;
  taskId: string;
  inputType: InputType;
  prompt: string;
  schema?: JSONSchema;
  options?: unknown[];
  /**
   * When `true`, the interrupt was originated by an intercepted `request_input`
   * LLM tool call.  On resume the agent injects a synthetic `tool-complete`
   * carrying the resolved value rather than re-calling the tool.
   */
  isLlmRequest?: boolean;
}

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
  status: 'created' | 'idle' | 'busy' | 'waiting-input' | 'shutdown' | 'error';

  /** Total turns executed */
  turnCount: number;

  /** Last activity timestamp */
  lastActivity: Date;

  /** Creation timestamp */
  createdAt: Date;

  /** Error if in error state */
  error?: SerializedError;

  /**
   * Tool input requests that are paused waiting for upstream resolution.
   * Present only when status === 'waiting-input'.
   */
  pendingToolInputs?: PendingToolInput[];

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
