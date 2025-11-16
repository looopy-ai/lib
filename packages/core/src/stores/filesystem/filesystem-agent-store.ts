/**
 * Filesystem Agent Store
 *
 * Persists AgentState per context as a single JSON blob.
 *
 * Directory structure:
 * ./_agent_store/agent={agentId}/context={contextId}/agent-state.json
 */

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AgentState, AgentStore } from '../../types/agent';

export interface FileSystemAgentStoreConfig {
  /** Base path for storage (defaults to ./_agent_store) */
  basePath?: string;

  /** Agent identifier used for namespacing the filesystem layout */
  agentId: string;

  /** Optional custom filename for the persisted state */
  stateFileName?: string;
}

type SerializableAgentState = Omit<AgentState, 'createdAt' | 'lastActivity'> & {
  createdAt: string;
  lastActivity: string;
};

export class FileSystemAgentStore implements AgentStore {
  private readonly basePath: string;
  private readonly agentId: string;
  private readonly stateFileName: string;

  constructor(config: FileSystemAgentStoreConfig) {
    this.basePath = config.basePath || './_agent_store';
    this.agentId = config.agentId;
    this.stateFileName = config.stateFileName || 'agent-state.json';
  }

  async load(contextId: string): Promise<AgentState | null> {
    try {
      const filePath = this.getStateFilePath(contextId);
      const content = await readFile(filePath, 'utf-8');
      const parsed = JSON.parse(content) as SerializableAgentState;

      return {
        ...parsed,
        createdAt: new Date(parsed.createdAt),
        lastActivity: new Date(parsed.lastActivity),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  async save(contextId: string, state: AgentState): Promise<void> {
    const contextDir = this.getContextDir(contextId);
    await mkdir(contextDir, { recursive: true });

    const filePath = this.getStateFilePath(contextId);
    const serializable: SerializableAgentState = {
      ...state,
      createdAt: state.createdAt.toISOString(),
      lastActivity: state.lastActivity.toISOString(),
    };

    await writeFile(filePath, JSON.stringify(serializable, null, 2), 'utf-8');
  }

  async delete(contextId: string): Promise<void> {
    const filePath = this.getStateFilePath(contextId);
    try {
      await rm(filePath, { force: true });
    } catch {
      // Ignore delete errors
    }
  }

  private getContextDir(contextId: string): string {
    const safeAgentId = this.sanitizeName(this.agentId);
    const safeContextId = this.sanitizeName(contextId);
    return join(this.basePath, `agent=${safeAgentId}`, `context=${safeContextId}`);
  }

  private getStateFilePath(contextId: string): string {
    return join(this.getContextDir(contextId), this.stateFileName);
  }

  private sanitizeName(name: string): string {
    return name.replace(/[^a-zA-Z0-9_-]/g, '_');
  }
}
