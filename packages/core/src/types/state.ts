import type { LLMResponse } from './llm';
import type { LLMMessage } from './message';
import type { ToolCall, ToolDefinition, ToolResult } from './tools';

/**
 * Persisted loop state for resumption
 */
export interface PersistedLoopState {
  taskId: string;
  agentId: string;
  parentTaskId?: string;
  contextId: string;

  messages: LLMMessage[];
  systemPrompt: string;
  iteration: number;
  completed: boolean;

  availableTools: ToolDefinition[];
  pendingToolCalls: ToolCall[];
  completedToolCalls: Record<string, ToolResult>;

  artifactIds: string[];

  lastLLMResponse?: LLMResponse;
  lastActivity: string;

  resumeFrom: 'llm-call' | 'tool-execution' | 'sub-agent' | 'completed';
  checkpointMetadata?: Record<string, unknown>;
}

/**
 * Task state store interface
 *
 * Manages per-task checkpoint state for AgentLoop resumption after crashes.
 * This is separate from ContextStore (session-level) and MessageStore (conversation history).
 *
 * Use case: Resume mid-turn execution after server restart during LLM reasoning loop.
 */
export interface TaskStateStore {
  save(taskId: string, state: PersistedLoopState): Promise<void>;
  load(taskId: string): Promise<PersistedLoopState | null>;
  exists(taskId: string): Promise<boolean>;
  delete(taskId: string): Promise<void>;
  listTasks(filter?: {
    agentId?: string;
    contextId?: string;
    completedAfter?: Date;
  }): Promise<string[]>;
  setTTL(taskId: string, ttlSeconds: number): Promise<void>;
}

/**
 * Context/Session state for agent instances
 *
 * This represents the persistent state of an agent conversation session,
 * separate from individual turn state (PersistedLoopState) and messages.
 */
export interface ContextState {
  contextId: string;
  agentId: string;

  // Metadata for discovery and organization
  title?: string; // Auto-generated or user-provided
  description?: string;
  tags?: string[]; // For categorization and search

  // Lifecycle
  status: 'active' | 'paused' | 'locked' | 'completed' | 'abandoned';
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
  lastActivityAt: string; // ISO 8601

  // Turn tracking
  turnCount: number;
  currentTurnId?: string; // If a turn is in progress

  // Pending operations (for resumption)
  pendingToolCalls?: ToolCall[]; // Awaiting client response
  pendingSubAgents?: string[]; // Sub-agent task IDs in progress

  // Locking (for concurrency control)
  lockedBy?: string; // Instance/process ID that owns the lock
  lockedAt?: string; // ISO 8601
  lockExpiresAt?: string; // ISO 8601 (auto-release after timeout)

  // Access control
  ownerId?: string; // Primary user/tenant
  sharedWith?: string[]; // Other users with access
  permissions?: Record<string, string[]>; // userId -> ['read', 'write', etc.]

  // Configuration
  systemPrompt?: string;
  preferredModel?: string;

  // Statistics
  messageCount?: number;
  artifactCount?: number;
  totalTokensUsed?: number;

  // Custom metadata
  metadata?: Record<string, unknown>;
}

/**
 * Context store interface
 *
 * Manages session-level state for agent contexts, including metadata,
 * locking, and lifecycle management.
 */
export interface ContextStore {
  /**
   * Save or update context state
   */
  save(state: ContextState): Promise<void>;

  /**
   * Load context state
   */
  load(contextId: string): Promise<ContextState | null>;

  /**
   * Check if context exists
   */
  exists(contextId: string): Promise<boolean>;

  /**
   * Delete context (cleanup)
   */
  delete(contextId: string): Promise<void>;

  /**
   * List contexts with filtering
   */
  list(filter?: {
    agentId?: string;
    ownerId?: string;
    status?: ContextState['status'];
    tags?: string[];
    createdAfter?: Date;
    createdBefore?: Date;
    updatedAfter?: Date;
    limit?: number;
    offset?: number;
  }): Promise<ContextState[]>;

  /**
   * Search contexts by title/description
   */
  search(query: string, filter?: { agentId?: string; ownerId?: string }): Promise<ContextState[]>;

  /**
   * Acquire lock on context (for concurrency control)
   * Returns true if lock acquired, false if already locked
   */
  acquireLock(contextId: string, lockOwnerId: string, ttlSeconds?: number): Promise<boolean>;

  /**
   * Release lock on context
   */
  releaseLock(contextId: string, lockOwnerId: string): Promise<void>;

  /**
   * Refresh lock (extend expiry)
   */
  refreshLock(contextId: string, lockOwnerId: string, ttlSeconds?: number): Promise<boolean>;

  /**
   * Check if context is locked
   */
  isLocked(contextId: string): Promise<boolean>;

  /**
   * Update specific fields (partial update)
   */
  update(
    contextId: string,
    updates: Partial<Omit<ContextState, 'contextId' | 'agentId' | 'createdAt'>>,
  ): Promise<void>;
}
