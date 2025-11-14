/**
 * Filesystem State Store Implementation
 *
 * Stores agent loop state as JSON files on the filesystem.
 *
 * Directory structure:
 * ./_agent_store/agent={agentId}/context={contextId}/task/{taskId}.json
 */

import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { PersistedLoopState, TaskStateStore } from '../../types/state';

export interface FileSystemStateStoreConfig {
  /** Base path for storage (default: ./_agent_store) */
  basePath?: string;

  /** Default TTL in seconds (default: 24 hours) */
  defaultTTL?: number;
}

export class FileSystemStateStore implements TaskStateStore {
  private basePath: string;
  private defaultTTL: number;

  constructor(config: FileSystemStateStoreConfig = {}) {
    this.basePath = config.basePath || './_agent_store';
    this.defaultTTL = config.defaultTTL || 24 * 60 * 60; // 24 hours
  }

  async save(taskId: string, state: PersistedLoopState): Promise<void> {
    const filePath = this.getStateFilePath(state.agentId, state.contextId, taskId);

    // Ensure directory exists
    await mkdir(join(filePath, '..'), { recursive: true });

    // Save state with TTL metadata
    const stateWithMeta = {
      ...state,
      _metadata: {
        savedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + this.defaultTTL * 1000).toISOString(),
      },
    };

    await writeFile(filePath, JSON.stringify(stateWithMeta, null, 2), 'utf-8');
  }

  async load(taskId: string): Promise<PersistedLoopState | null> {
    try {
      // Find the file by scanning all agent/context directories
      const filePath = await this.findStateFile(taskId);
      if (!filePath) {
        return null;
      }

      const content = await readFile(filePath, 'utf-8');
      const stateWithMeta = JSON.parse(content);

      // Check if expired
      if (stateWithMeta._metadata?.expiresAt) {
        const expiresAt = new Date(stateWithMeta._metadata.expiresAt);
        if (expiresAt < new Date()) {
          // Expired - delete and return null
          await rm(filePath);
          return null;
        }
      }

      // Remove metadata before returning
      const { _metadata, ...state } = stateWithMeta;
      return state as PersistedLoopState;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  async exists(taskId: string): Promise<boolean> {
    const filePath = await this.findStateFile(taskId);
    if (!filePath) {
      return false;
    }

    try {
      const content = await readFile(filePath, 'utf-8');
      const stateWithMeta = JSON.parse(content);

      // Check if expired
      if (stateWithMeta._metadata?.expiresAt) {
        const expiresAt = new Date(stateWithMeta._metadata.expiresAt);
        if (expiresAt < new Date()) {
          await rm(filePath);
          return false;
        }
      }

      return true;
    } catch {
      return false;
    }
  }

  async delete(taskId: string): Promise<void> {
    const filePath = await this.findStateFile(taskId);
    if (filePath) {
      await rm(filePath);
    }
  }

  async listTasks(filter?: {
    agentId?: string;
    contextId?: string;
    completedAfter?: Date;
  }): Promise<string[]> {
    const taskIds: string[] = [];

    try {
      const agentDirs = await this.getAgentDirectories(filter?.agentId);

      for (const agentDir of agentDirs) {
        const contextDirs = await this.getContextDirectories(agentDir, filter?.contextId);

        for (const contextDir of contextDirs) {
          const dirTaskIds = await this.getTaskIdsFromDir(contextDir, filter);
          taskIds.push(...dirTaskIds);
        }
      }
    } catch {
      // Base directory doesn't exist, return empty list
    }

    return taskIds;
  }

  private async getTaskIdsFromDir(
    contextDir: string,
    filter?: { completedAfter?: Date },
  ): Promise<string[]> {
    const taskIds: string[] = [];
    const taskDir = join(contextDir, 'task');

    try {
      const files = await readdir(taskDir);

      for (const file of files) {
        if (!file.endsWith('.json')) continue;

        const taskId = await this.processStateFile(join(taskDir, file), filter);
        if (taskId) {
          taskIds.push(taskId);
        }
      }
    } catch {
      // Task directory doesn't exist, skip
    }

    return taskIds;
  }

  private async processStateFile(
    filePath: string,
    filter?: { completedAfter?: Date },
  ): Promise<string | null> {
    try {
      const content = await readFile(filePath, 'utf-8');
      const stateWithMeta = JSON.parse(content);

      // Check expiration
      if (stateWithMeta._metadata?.expiresAt) {
        const expiresAt = new Date(stateWithMeta._metadata.expiresAt);
        if (expiresAt < new Date()) {
          await rm(filePath);
          return null;
        }
      }

      // Apply filters
      if (filter?.completedAfter && stateWithMeta.completed) {
        const lastActivity = new Date(stateWithMeta.lastActivity);
        if (lastActivity < filter.completedAfter) {
          return null;
        }
      }

      return stateWithMeta.taskId;
    } catch {
      return null;
    }
  }

  async setTTL(taskId: string, ttlSeconds: number): Promise<void> {
    const filePath = await this.findStateFile(taskId);
    if (!filePath) {
      return;
    }

    const content = await readFile(filePath, 'utf-8');
    const stateWithMeta = JSON.parse(content);

    stateWithMeta._metadata = {
      ...stateWithMeta._metadata,
      expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
    };

    await writeFile(filePath, JSON.stringify(stateWithMeta, null, 2), 'utf-8');
  }

  // Helper methods

  private getStateFilePath(agentId: string, contextId: string, taskId: string): string {
    const safeAgentId = this.sanitizeName(agentId);
    const safeContextId = this.sanitizeName(contextId);
    const safeTaskId = this.sanitizeName(taskId);

    return join(
      this.basePath,
      `agent=${safeAgentId}`,
      `context=${safeContextId}`,
      'task',
      `${safeTaskId}.json`,
    );
  }

  private async findStateFile(taskId: string): Promise<string | null> {
    try {
      const agentDirs = await this.getAgentDirectories();

      for (const agentDir of agentDirs) {
        const contextDirs = await this.getContextDirectories(agentDir);

        for (const contextDir of contextDirs) {
          const safeTaskId = this.sanitizeName(taskId);
          const filePath = join(contextDir, 'task', `${safeTaskId}.json`);

          try {
            await stat(filePath);
            return filePath;
          } catch {
            // File doesn't exist, continue
          }
        }
      }
    } catch {
      // Base directory doesn't exist
    }

    return null;
  }

  private async getAgentDirectories(agentId?: string): Promise<string[]> {
    try {
      const entries = await readdir(this.basePath);
      const agentDirs: string[] = [];

      for (const entry of entries) {
        if (entry.startsWith('agent=')) {
          if (agentId) {
            const safeAgentId = this.sanitizeName(agentId);
            if (entry === `agent=${safeAgentId}`) {
              agentDirs.push(join(this.basePath, entry));
            }
          } else {
            agentDirs.push(join(this.basePath, entry));
          }
        }
      }

      return agentDirs;
    } catch {
      return [];
    }
  }

  private async getContextDirectories(agentDir: string, contextId?: string): Promise<string[]> {
    try {
      const entries = await readdir(agentDir);
      const contextDirs: string[] = [];

      for (const entry of entries) {
        if (entry.startsWith('context=')) {
          if (contextId) {
            const safeContextId = this.sanitizeName(contextId);
            if (entry === `context=${safeContextId}`) {
              contextDirs.push(join(agentDir, entry));
            }
          } else {
            contextDirs.push(join(agentDir, entry));
          }
        }
      }

      return contextDirs;
    } catch {
      return [];
    }
  }

  private sanitizeName(name: string): string {
    return name.replace(/[^a-zA-Z0-9_-]/g, '_');
  }
}
