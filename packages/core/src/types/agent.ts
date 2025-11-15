import type { SerializedError } from '../utils/error';

/**
 * Agent state
 */
export interface AgentState {
  /** Agent lifecycle status */
  status: 'created' | 'ready' | 'busy' | 'shutdown' | 'error';

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
