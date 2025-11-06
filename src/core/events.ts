/**
 * Event Factory Functions
 *
 * Functions for creating internal event protocol events.
 * These replace the old A2A-specific events with the new internal event protocol.
 *
 * Design: design/internal-event-protocol.md
 */

import {
  createInternalCheckpointEvent,
  createTaskCompleteEvent,
  createTaskCreatedEvent,
  createTaskStatusEvent,
} from '../events';
import type { AgentEvent, LoopState, Message } from './types';

/**
 * Create initial task event
 */
export const createTaskEvent = (
  taskId: string,
  contextId: string,
  history: Message[]
): AgentEvent => {
  return createTaskCreatedEvent({
    contextId,
    taskId,
    initiator: 'user', // Default to user; can be overridden
    metadata: {
      historyLength: history.length,
    },
  }) as AgentEvent;
};

/**
 * Create working status event
 */
export const createWorkingEvent = (taskId: string, contextId: string): AgentEvent => {
  return createTaskStatusEvent({
    contextId,
    taskId,
    status: 'working',
    metadata: {},
  }) as AgentEvent;
};

/**
 * Create completed status event
 */
export const createCompletedEvent = (
  taskId: string,
  contextId: string,
  message?: Message
): AgentEvent => {
  return createTaskCompleteEvent({
    contextId,
    taskId,
    content: message?.content,
    metadata: {},
  }) as AgentEvent;
};

/**
 * Create failed status event
 */
export const createFailedEvent = (taskId: string, contextId: string, error: string): AgentEvent => {
  return createTaskStatusEvent({
    contextId,
    taskId,
    status: 'failed',
    message: error,
    metadata: { error },
  }) as AgentEvent;
};

/**
 * Create internal checkpoint event (for debugging/observability)
 */
export const createCheckpointEvent = (
  taskId: string,
  contextId: string,
  iteration: number
): AgentEvent => {
  return createInternalCheckpointEvent({
    contextId,
    taskId,
    iteration,
  }) as AgentEvent;
};

/**
 * Convert loop state to appropriate events
 */
export const stateToEvents = (state: LoopState): AgentEvent[] => {
  if (state.completed) {
    return [createCompletedEvent(state.taskId, state.contextId, state.lastLLMResponse?.message)];
  }

  return [createCheckpointEvent(state.taskId, state.contextId, state.iteration)];
};
