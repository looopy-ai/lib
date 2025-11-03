/**
 * Event Factory Functions
 *
 * Functions for creating A2A protocol events and internal events.
 */

import type { AgentEvent, LoopState, Message } from './types';

/**
 * Create initial task event (A2A protocol)
 */
export const createTaskEvent = (
  taskId: string,
  contextId: string,
  history: Message[]
): AgentEvent => ({
  kind: 'task',
  id: taskId,
  contextId,
  status: {
    state: 'submitted',
    timestamp: new Date().toISOString(),
  },
  history,
  artifacts: [],
});

/**
 * Create working status event
 */
export const createWorkingEvent = (taskId: string, contextId: string): AgentEvent => ({
  kind: 'status-update',
  taskId,
  contextId,
  status: {
    state: 'working',
    timestamp: new Date().toISOString(),
  },
  final: false,
});

/**
 * Create completed status event
 */
export const createCompletedEvent = (
  taskId: string,
  contextId: string,
  message?: Message
): AgentEvent => ({
  kind: 'status-update',
  taskId,
  contextId,
  status: {
    state: 'completed',
    message,
    timestamp: new Date().toISOString(),
  },
  final: true,
});

/**
 * Create failed status event
 */
export const createFailedEvent = (
  taskId: string,
  contextId: string,
  error: string
): AgentEvent => ({
  kind: 'status-update',
  taskId,
  contextId,
  status: {
    state: 'failed',
    timestamp: new Date().toISOString(),
  },
  final: true,
  metadata: { error },
});

/**
 * Create internal checkpoint event (for debugging/observability)
 */
export const createCheckpointEvent = (taskId: string, iteration: number): AgentEvent => ({
  kind: 'internal:checkpoint',
  taskId,
  iteration,
  timestamp: new Date().toISOString(),
});

/**
 * Convert loop state to appropriate events
 */
export const stateToEvents = (state: LoopState): AgentEvent[] => {
  if (state.completed) {
    return [createCompletedEvent(state.taskId, state.contextId, state.lastLLMResponse?.message)];
  }

  return [createCheckpointEvent(state.taskId, state.iteration)];
};
