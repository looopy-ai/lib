/**
 * State Cleanup Service
 *
 * Periodically cleans up expired task state and associated artifacts.
 *
 * Design Reference: design/agent-loop.md#state-cleanup-and-expiration
 */

import type { ArtifactStore } from '../types/artifact';
import type { TaskStateStore } from '../types/state';

export class StateCleanupService {
  private intervalHandle?: NodeJS.Timeout;

  constructor(
    private taskStateStore: TaskStateStore,
    private artifactStore: ArtifactStore,
    private intervalMs: number = 60 * 60 * 1000, // 1 hour
  ) {}

  start(): void {
    if (this.intervalHandle) {
      throw new Error('Cleanup service already started');
    }

    this.intervalHandle = setInterval(() => this.cleanupExpiredTasks(), this.intervalMs);
  }

  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = undefined;
    }
  }

  async cleanupExpiredTasks(): Promise<void> {
    // Get all tasks completed more than 24 hours ago
    const cutoffDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const taskIds = await this.taskStateStore.listTasks({
      completedAfter: cutoffDate,
    });

    for (const taskId of taskIds) {
      try {
        const state = await this.taskStateStore.load(taskId);
        if (!state) continue;

        // Delete artifacts first
        if (state.artifactIds && state.contextId) {
          for (const artifactId of state.artifactIds) {
            await this.artifactStore.deleteArtifact(state.contextId, artifactId);
          }
        }

        // Then delete state
        await this.taskStateStore.delete(taskId);
      } catch (error) {
        console.error(`Failed to cleanup task ${taskId}:`, error);
      }
    }
  }
}
