/**
 * Redis State Store Implementation
 *
 * Production-ready state persistence using Redis with TTL support.
 *
 * Design Reference: design/agent-loop.md#state-store-implementations
 */

import type { PersistedLoopState, StateStore } from '../../core/types';
import type { RedisClient } from '../../types';

export class RedisStateStore implements StateStore {
  constructor(
    private redis: RedisClient,
    private ttl: number = 24 * 60 * 60 // 24 hours default
  ) {}

  async save(taskId: string, state: PersistedLoopState): Promise<void> {
    const key = `task:${taskId}:state`;
    await this.redis.setex(key, this.ttl, JSON.stringify(state));
  }

  async load(taskId: string): Promise<PersistedLoopState | null> {
    const data = await this.redis.get(`task:${taskId}:state`);
    return data ? JSON.parse(data) : null;
  }

  async exists(taskId: string): Promise<boolean> {
    return (await this.redis.exists(`task:${taskId}:state`)) === 1;
  }

  async delete(taskId: string): Promise<void> {
    await this.redis.del(`task:${taskId}:state`);
  }

  async listTasks(filter?: {
    agentId?: string;
    contextId?: string;
    completedAfter?: Date;
  }): Promise<string[]> {
    const pattern = 'task:*:state';
    const keys = await this.redis.keys(pattern);

    if (!filter) {
      return keys.map((key) => key.replace('task:', '').replace(':state', ''));
    }

    // Filter by loading and checking each state
    const taskIds: string[] = [];
    for (const key of keys) {
      const taskId = key.replace('task:', '').replace(':state', '');
      const state = await this.load(taskId);

      if (!state) continue;

      if (filter.agentId && state.agentId !== filter.agentId) continue;
      if (filter.contextId && state.contextId !== filter.contextId) continue;
      if (filter.completedAfter) {
        const lastActivity = new Date(state.lastActivity);
        if (lastActivity <= filter.completedAfter) continue;
      }

      taskIds.push(taskId);
    }

    return taskIds;
  }

  async setTTL(taskId: string, ttlSeconds: number): Promise<void> {
    await this.redis.expire(`task:${taskId}:state`, ttlSeconds);
  }
}
