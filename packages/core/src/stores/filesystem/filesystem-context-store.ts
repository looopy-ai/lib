/**
 * Filesystem Context Store Implementation
 *
 * Stores agent context/session state as JSON files on the filesystem.
 *
 * Directory structure:
 * ./_agent_store/agent={agentId}/context={contextId}/context.json
 * ./_agent_store/agent={agentId}/context={contextId}/context.lock
 */

/** biome-ignore-all lint/style/noNonNullAssertion: non-prod code */

import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ContextState, ContextStore } from '../../types/state';

export interface FileSystemContextStoreConfig {
  /** Base path for storage (default: ./_agent_store) */
  basePath?: string;

  /** Default lock TTL in seconds (default: 5 minutes) */
  defaultLockTTL?: number;
}

interface LockFile {
  lockOwnerId: string;
  lockedAt: string;
  expiresAt: string;
}

export class FileSystemContextStore implements ContextStore {
  private basePath: string;
  private defaultLockTTL: number;

  constructor(config: FileSystemContextStoreConfig = {}) {
    this.basePath = config.basePath || './_agent_store';
    this.defaultLockTTL = config.defaultLockTTL || 5 * 60; // 5 minutes
  }

  async save(state: ContextState): Promise<void> {
    const contextDir = this.getContextDir(state.agentId, state.contextId);
    const filePath = join(contextDir, 'context.json');

    // Ensure directory exists
    await mkdir(contextDir, { recursive: true });

    // Update timestamps
    const now = new Date().toISOString();
    const stateWithTimestamps: ContextState = {
      ...state,
      updatedAt: now,
      lastActivityAt: now,
    };

    await writeFile(filePath, JSON.stringify(stateWithTimestamps, null, 2), 'utf-8');
  }

  async load(contextId: string): Promise<ContextState | null> {
    try {
      // Try to find the context directory across all agents
      const contextDirs = await this.findContextDirs(contextId);

      if (contextDirs.length === 0) {
        return null;
      }

      // Read the first matching context
      const filePath = join(contextDirs[0], 'context.json');
      const content = await readFile(filePath, 'utf-8');
      const state = JSON.parse(content) as ContextState;

      // Clean up expired lock
      if (state.lockExpiresAt && new Date(state.lockExpiresAt) < new Date()) {
        state.lockedBy = undefined;
        state.lockedAt = undefined;
        state.lockExpiresAt = undefined;
        await this.save(state);
      }

      return state;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  async exists(contextId: string): Promise<boolean> {
    const contextDirs = await this.findContextDirs(contextId);
    return contextDirs.length > 0;
  }

  async delete(contextId: string): Promise<void> {
    const contextDirs = await this.findContextDirs(contextId);

    for (const contextDir of contextDirs) {
      await rm(contextDir, { recursive: true, force: true });
    }
  }

  async list(filter?: {
    agentId?: string;
    ownerId?: string;
    status?: ContextState['status'];
    tags?: string[];
    createdAfter?: Date;
    createdBefore?: Date;
    updatedAfter?: Date;
    limit?: number;
    offset?: number;
  }): Promise<ContextState[]> {
    const allContexts: ContextState[] = [];

    // Determine which agent directories to search
    const agentDirs = filter?.agentId
      ? [join(this.basePath, `agent=${filter.agentId}`)]
      : await this.getAllAgentDirs();

    // Collect all context files
    for (const agentDir of agentDirs) {
      try {
        const entries = await readdir(agentDir, { withFileTypes: true });

        for (const entry of entries) {
          if (entry.isDirectory() && entry.name.startsWith('context=')) {
            const contextDir = join(agentDir, entry.name);
            const filePath = join(contextDir, 'context.json');

            try {
              const content = await readFile(filePath, 'utf-8');
              const state = JSON.parse(content) as ContextState;
              allContexts.push(state);
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
                throw error;
              }
            }
          }
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error;
        }
      }
    }

    // Apply filters
    let filtered = allContexts;

    if (filter?.ownerId) {
      filtered = filtered.filter((c) => c.ownerId === filter.ownerId);
    }

    if (filter?.status) {
      filtered = filtered.filter((c) => c.status === filter.status);
    }

    if (filter?.tags && filter.tags.length > 0) {
      filtered = filtered.filter((c) => filter.tags?.some((tag) => c.tags?.includes(tag)));
    }

    if (filter?.createdAfter) {
      filtered = filtered.filter((c) => new Date(c.createdAt) >= filter.createdAfter!);
    }

    if (filter?.createdBefore) {
      filtered = filtered.filter((c) => new Date(c.createdAt) <= filter.createdBefore!);
    }

    if (filter?.updatedAfter) {
      filtered = filtered.filter((c) => new Date(c.updatedAt) >= filter.updatedAfter!);
    }

    // Sort by lastActivityAt descending (most recent first)
    filtered.sort(
      (a, b) => new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime(),
    );

    // Apply pagination
    const offset = filter?.offset || 0;
    const limit = filter?.limit || filtered.length;

    return filtered.slice(offset, offset + limit);
  }

  async search(
    query: string,
    filter?: { agentId?: string; ownerId?: string },
  ): Promise<ContextState[]> {
    const allContexts = await this.list(filter);

    const queryLower = query.toLowerCase();

    return allContexts.filter((context) => {
      const titleMatch = context.title?.toLowerCase().includes(queryLower);
      const descriptionMatch = context.description?.toLowerCase().includes(queryLower);
      const tagMatch = context.tags?.some((tag) => tag.toLowerCase().includes(queryLower));

      return titleMatch || descriptionMatch || tagMatch;
    });
  }

  async acquireLock(contextId: string, lockOwnerId: string, ttlSeconds?: number): Promise<boolean> {
    const state = await this.load(contextId);

    if (!state) {
      throw new Error(`Context not found: ${contextId}`);
    }

    // Check if already locked by someone else
    if (state.lockedBy && state.lockedBy !== lockOwnerId) {
      // Check if lock is expired
      if (state.lockExpiresAt && new Date(state.lockExpiresAt) > new Date()) {
        return false; // Lock is still valid
      }
    }

    // Acquire lock
    const now = new Date();
    const ttl = ttlSeconds || this.defaultLockTTL;
    const expiresAt = new Date(now.getTime() + ttl * 1000);

    state.lockedBy = lockOwnerId;
    state.lockedAt = now.toISOString();
    state.lockExpiresAt = expiresAt.toISOString();
    state.status = 'locked';

    await this.save(state);

    // Also create a lock file for easy detection
    const contextDir = this.getContextDir(state.agentId, contextId);
    const lockPath = join(contextDir, 'context.lock');

    const lockFile: LockFile = {
      lockOwnerId,
      lockedAt: state.lockedAt,
      expiresAt: state.lockExpiresAt,
    };

    await writeFile(lockPath, JSON.stringify(lockFile, null, 2), 'utf-8');

    return true;
  }

  async releaseLock(contextId: string, lockOwnerId: string): Promise<void> {
    const state = await this.load(contextId);

    if (!state) {
      throw new Error(`Context not found: ${contextId}`);
    }

    // Only the lock owner can release
    if (state.lockedBy !== lockOwnerId) {
      throw new Error(`Lock is owned by ${state.lockedBy}, cannot release`);
    }

    // Release lock
    state.lockedBy = undefined;
    state.lockedAt = undefined;
    state.lockExpiresAt = undefined;
    state.status = 'active';

    await this.save(state);

    // Remove lock file
    const contextDir = this.getContextDir(state.agentId, contextId);
    const lockPath = join(contextDir, 'context.lock');
    await rm(lockPath, { force: true });
  }

  async refreshLock(contextId: string, lockOwnerId: string, ttlSeconds?: number): Promise<boolean> {
    const state = await this.load(contextId);

    if (!state) {
      throw new Error(`Context not found: ${contextId}`);
    }

    // Only the lock owner can refresh
    if (state.lockedBy !== lockOwnerId) {
      return false;
    }

    // Refresh lock
    const ttl = ttlSeconds || this.defaultLockTTL;
    const expiresAt = new Date(Date.now() + ttl * 1000);

    state.lockExpiresAt = expiresAt.toISOString();

    await this.save(state);

    // Update lock file
    const contextDir = this.getContextDir(state.agentId, contextId);
    const lockPath = join(contextDir, 'context.lock');
    const lockFile: LockFile = {
      lockOwnerId,
      lockedAt: state.lockedAt!,
      expiresAt: state.lockExpiresAt,
    };

    await writeFile(lockPath, JSON.stringify(lockFile, null, 2), 'utf-8');

    return true;
  }

  async isLocked(contextId: string): Promise<boolean> {
    const state = await this.load(contextId);

    if (!state || !state.lockedBy || !state.lockExpiresAt) {
      return false;
    }

    // Check if lock is expired
    return new Date(state.lockExpiresAt) > new Date();
  }

  async update(
    contextId: string,
    updates: Partial<Omit<ContextState, 'contextId' | 'agentId' | 'createdAt'>>,
  ): Promise<void> {
    const state = await this.load(contextId);

    if (!state) {
      throw new Error(`Context not found: ${contextId}`);
    }

    // Apply updates
    const updatedState: ContextState = {
      ...state,
      ...updates,
      contextId: state.contextId, // Preserve immutable fields
      agentId: state.agentId,
      createdAt: state.createdAt,
      updatedAt: new Date().toISOString(),
    };

    await this.save(updatedState);
  }

  // Helper methods

  private getContextDir(agentId: string, contextId: string): string {
    return join(this.basePath, `agent=${agentId}`, `context=${contextId}`);
  }

  private async findContextDirs(contextId: string): Promise<string[]> {
    const matches: string[] = [];

    try {
      const agentDirs = await this.getAllAgentDirs();

      for (const agentDir of agentDirs) {
        const contextDir = join(agentDir, `context=${contextId}`);

        try {
          await stat(contextDir);
          matches.push(contextDir);
        } catch {
          // Directory doesn't exist, continue
        }
      }
    } catch {
      // Base directory doesn't exist
    }

    return matches;
  }

  private async getAllAgentDirs(): Promise<string[]> {
    try {
      const entries = await readdir(this.basePath, { withFileTypes: true });

      return entries
        .filter((entry) => entry.isDirectory() && entry.name.startsWith('agent='))
        .map((entry) => join(this.basePath, entry.name));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }
}
