import type { SerializedError } from '../utils/error';

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
