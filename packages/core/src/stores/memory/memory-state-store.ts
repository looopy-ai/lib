/**
 * In-Memory State Store Implementation
 *
 * Lightweight in-memory storage for testing and development.
 * Includes automatic cleanup of expired entries.
 *
 * Design Reference: design/agent-loop.md#state-store-implementations
 */

import type { PersistedLoopState, TaskStateStore } from '../../types/state';

export class InMemoryStateStore implements TaskStateStore {
  private states = new Map<string, { state: PersistedLoopState; expiresAt: number }>();

  async save(taskId: string, state: PersistedLoopState): Promise<void> {
    this.states.set(taskId, {
      state: JSON.parse(JSON.stringify(state)),
      expiresAt: Date.now() + 24 * 60 * 60 * 1000,
    });
  }

  async load(taskId: string): Promise<PersistedLoopState | null> {
    this.cleanup();
    const entry = this.states.get(taskId);
    return entry ? JSON.parse(JSON.stringify(entry.state)) : null;
  }

  async exists(taskId: string): Promise<boolean> {
    this.cleanup();
    return this.states.has(taskId);
  }

  async delete(taskId: string): Promise<void> {
    this.states.delete(taskId);
  }

  async listTasks(filter?: {
    agentId?: string;
    contextId?: string;
    completedAfter?: Date;
  }): Promise<string[]> {
    this.cleanup();

    const taskIds: string[] = [];
    for (const [taskId, entry] of this.states.entries()) {
      const state = entry.state;

      if (filter) {
        if (filter.agentId && state.agentId !== filter.agentId) continue;
        if (filter.contextId && state.contextId !== filter.contextId) continue;
        if (filter.completedAfter) {
          const lastActivity = new Date(state.lastActivity);
          if (lastActivity <= filter.completedAfter) continue;
        }
      }

      taskIds.push(taskId);
    }

    return taskIds;
  }

  async setTTL(taskId: string, ttlSeconds: number): Promise<void> {
    const entry = this.states.get(taskId);
    if (entry) {
      entry.expiresAt = Date.now() + ttlSeconds * 1000;
    }
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [taskId, entry] of this.states.entries()) {
      if (entry.expiresAt < now) {
        this.states.delete(taskId);
      }
    }
  }
}
