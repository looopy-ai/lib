/**
 * Filesystem Artifact Store Implementation
 *
 * Stores artifacts in the filesystem with appropriate organization by artifact ID.
 *
 * Directory structure:
 * ./_agent_store/agent={agentId}/context={contextId}/artifacts/{artifactId}/
 *   - metadata.json (artifact metadata)
 *   - parts/{partIndex}.json (individual parts)
 *   - content.txt or content.json (concatenated content)
 *
 * Design: design/artifact-management.md
 */

import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ArtifactPart, ArtifactStore, StoredArtifact } from '../interfaces';

export interface FileSystemArtifactStoreConfig {
  /** Base path for storage (default: ./_agent_store) */
  basePath?: string;

  /** Agent ID for path construction */
  agentId: string;
}

export class FileSystemArtifactStore implements ArtifactStore {
  private basePath: string;
  private agentId: string;

  constructor(config: FileSystemArtifactStoreConfig) {
    this.basePath = config.basePath || './_agent_store';
    this.agentId = config.agentId;
  }

  async createArtifact(params: {
    artifactId: string;
    taskId: string;
    contextId: string;
    name?: string;
    description?: string;
    mimeType?: string;
  }): Promise<string> {
    const artifactDir = this.getArtifactDir(params.contextId, params.artifactId);
    await mkdir(join(artifactDir, 'parts'), { recursive: true });

    const artifact: StoredArtifact = {
      artifactId: params.artifactId,
      taskId: params.taskId,
      contextId: params.contextId,
      name: params.name,
      description: params.description,
      mimeType: params.mimeType,
      parts: [],
      totalParts: 0,
      version: 1,
      operations: [
        {
          operationId: `op-${Date.now()}`,
          type: 'create',
          timestamp: new Date().toISOString(),
        },
      ],
      status: 'building',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      storageBackend: 'local',
      lastChunkIndex: -1,
      isLastChunk: false,
    };

    await this.saveMetadata(artifactDir, artifact);
    return params.artifactId;
  }

  async appendPart(
    artifactId: string,
    part: Omit<ArtifactPart, 'index'>,
    isLastChunk?: boolean
  ): Promise<void> {
    const artifact = await this.loadArtifactByIdScan(artifactId);
    if (!artifact) {
      throw new Error(`Artifact not found: ${artifactId}`);
    }

    const artifactDir = this.getArtifactDir(artifact.contextId, artifactId);
    const partIndex = artifact.parts.length;

    const fullPart: ArtifactPart = {
      ...part,
      index: partIndex,
    };

    artifact.parts.push(fullPart);
    artifact.totalParts = artifact.parts.length;
    artifact.lastChunkIndex = partIndex;
    artifact.isLastChunk = isLastChunk || false;
    artifact.updatedAt = new Date().toISOString();

    if (isLastChunk) {
      artifact.status = 'complete';
      artifact.completedAt = new Date().toISOString();
    }

    artifact.operations.push({
      operationId: `op-${Date.now()}`,
      type: isLastChunk ? 'complete' : 'append',
      timestamp: new Date().toISOString(),
      partIndex,
      chunkIndex: partIndex,
    });

    // Save part
    const partPath = join(artifactDir, 'parts', `${partIndex}.json`);
    await writeFile(partPath, JSON.stringify(fullPart, null, 2), 'utf-8');

    // Update metadata
    await this.saveMetadata(artifactDir, artifact);

    // Save consolidated content if complete
    if (isLastChunk) {
      await this.saveConsolidatedContent(artifactDir, artifact);
    }
  }

  async replacePart(
    artifactId: string,
    partIndex: number,
    part: Omit<ArtifactPart, 'index'>
  ): Promise<void> {
    const artifact = await this.loadArtifactByIdScan(artifactId);
    if (!artifact) {
      throw new Error(`Artifact not found: ${artifactId}`);
    }

    const artifactDir = this.getArtifactDir(artifact.contextId, artifactId);

    const fullPart: ArtifactPart = {
      ...part,
      index: partIndex,
    };

    artifact.parts[partIndex] = fullPart;
    artifact.updatedAt = new Date().toISOString();
    artifact.version += 1;

    artifact.operations.push({
      operationId: `op-${Date.now()}`,
      type: 'replace',
      timestamp: new Date().toISOString(),
      partIndex,
    });

    // Save part
    const partPath = join(artifactDir, 'parts', `${partIndex}.json`);
    await writeFile(partPath, JSON.stringify(fullPart, null, 2), 'utf-8');

    // Update metadata
    await this.saveMetadata(artifactDir, artifact);

    // Update consolidated content if complete
    if (artifact.status === 'complete') {
      await this.saveConsolidatedContent(artifactDir, artifact);
    }
  }

  async replaceParts(
    artifactId: string,
    parts: Omit<ArtifactPart, 'index'>[],
    isLastChunk?: boolean
  ): Promise<void> {
    const artifact = await this.loadArtifactByIdScan(artifactId);
    if (!artifact) {
      throw new Error(`Artifact not found: ${artifactId}`);
    }

    const artifactDir = this.getArtifactDir(artifact.contextId, artifactId);
    const replacedIndexes = artifact.parts.map((p) => p.index);

    // Clear old parts
    const partsDir = join(artifactDir, 'parts');
    await rm(partsDir, { recursive: true, force: true });
    await mkdir(partsDir, { recursive: true });

    // Save new parts
    const fullParts: ArtifactPart[] = parts.map((part, index) => ({
      ...part,
      index,
    }));

    artifact.parts = fullParts;
    artifact.totalParts = fullParts.length;
    artifact.lastChunkIndex = fullParts.length - 1;
    artifact.isLastChunk = isLastChunk || false;
    artifact.updatedAt = new Date().toISOString();
    artifact.version += 1;

    if (isLastChunk) {
      artifact.status = 'complete';
      artifact.completedAt = new Date().toISOString();
    }

    artifact.operations.push({
      operationId: `op-${Date.now()}`,
      type: 'replace',
      timestamp: new Date().toISOString(),
      replacedPartIndexes: replacedIndexes,
    });

    for (const part of fullParts) {
      const partPath = join(partsDir, `${part.index}.json`);
      await writeFile(partPath, JSON.stringify(part, null, 2), 'utf-8');
    }

    // Update metadata
    await this.saveMetadata(artifactDir, artifact);

    // Save consolidated content if complete
    if (isLastChunk) {
      await this.saveConsolidatedContent(artifactDir, artifact);
    }
  }

  async getArtifact(artifactId: string): Promise<StoredArtifact | null> {
    return await this.loadArtifactByIdScan(artifactId);
  }

  async getArtifactParts(artifactId: string, _resolveExternal?: boolean): Promise<ArtifactPart[]> {
    const artifact = await this.loadArtifactByIdScan(artifactId);
    if (!artifact) {
      return [];
    }

    // Parts are already loaded in the metadata
    return artifact.parts;
  }

  async getTaskArtifacts(taskId: string): Promise<string[]> {
    const artifactIds: string[] = [];

    try {
      const agentDirs = await this.getAgentDirectories();

      for (const agentDir of agentDirs) {
        const contextArtifacts = await this.getTaskArtifactsFromAgentDir(agentDir, taskId);
        artifactIds.push(...contextArtifacts);
      }
    } catch {
      // Base directory doesn't exist
    }

    return artifactIds;
  }

  private async getTaskArtifactsFromAgentDir(agentDir: string, taskId: string): Promise<string[]> {
    const artifactIds: string[] = [];
    const contextDirs = await this.getContextDirectories(agentDir);

    for (const contextDir of contextDirs) {
      const contextArtifacts = await this.getTaskArtifactsFromContextDir(contextDir, taskId);
      artifactIds.push(...contextArtifacts);
    }

    return artifactIds;
  }

  private async getTaskArtifactsFromContextDir(contextDir: string, taskId: string): Promise<string[]> {
    const artifactIds: string[] = [];
    const artifactsDir = join(contextDir, 'artifacts');

    try {
      const artifactDirs = await readdir(artifactsDir);

      for (const artifactId of artifactDirs) {
        const metadataPath = join(artifactsDir, artifactId, 'metadata.json');

        try {
          const content = await readFile(metadataPath, 'utf-8');
          const artifact = JSON.parse(content) as StoredArtifact;

          if (artifact.taskId === taskId) {
            artifactIds.push(artifact.artifactId);
          }
        } catch {
          // Invalid metadata, skip
        }
      }
    } catch {
      // Artifacts directory doesn't exist
    }

    return artifactIds;
  }

  async deleteArtifact(artifactId: string): Promise<void> {
    const artifact = await this.loadArtifactByIdScan(artifactId);
    if (!artifact) {
      return;
    }

    const artifactDir = this.getArtifactDir(artifact.contextId, artifactId);
    await rm(artifactDir, { recursive: true, force: true });
  }

  async getArtifactContent(artifactId: string): Promise<string | object> {
    const artifact = await this.loadArtifactByIdScan(artifactId);
    if (!artifact) {
      throw new Error(`Artifact not found: ${artifactId}`);
    }

    // Try to load consolidated content first
    const artifactDir = this.getArtifactDir(artifact.contextId, artifactId);

    try {
      const contentPath = join(artifactDir, 'content.json');
      const content = await readFile(contentPath, 'utf-8');
      return JSON.parse(content);
    } catch {
      // Not JSON, try text
    }

    try {
      const contentPath = join(artifactDir, 'content.txt');
      return await readFile(contentPath, 'utf-8');
    } catch {
      // No consolidated content, build from parts
    }

    // Build from parts
    const textParts: string[] = [];
    const dataParts: unknown[] = [];

    for (const part of artifact.parts) {
      if (part.kind === 'text' && part.content) {
        textParts.push(part.content);
      } else if (part.kind === 'data' && part.data) {
        dataParts.push(part.data);
      }
    }

    if (dataParts.length > 0) {
      return (dataParts.length === 1 ? dataParts[0] : dataParts) as string | object;
    }

    return textParts.join('');
  }

  async queryArtifacts(params: { contextId: string; taskId?: string }): Promise<string[]> {
    const artifactIds: string[] = [];
    const safeContextId = this.sanitizeName(params.contextId);

    try {
      const agentDirs = await this.getAgentDirectories();

      for (const agentDir of agentDirs) {
        const contextDir = join(agentDir, `context=${safeContextId}`);
        const artifactsDir = join(contextDir, 'artifacts');

        try {
          const artifactDirs = await readdir(artifactsDir);

          for (const artifactId of artifactDirs) {
            const metadataPath = join(artifactsDir, artifactId, 'metadata.json');

            try {
              const content = await readFile(metadataPath, 'utf-8');
              const artifact = JSON.parse(content) as StoredArtifact;

              if (params.taskId && artifact.taskId !== params.taskId) {
                continue;
              }

              artifactIds.push(artifact.artifactId);
            } catch {
              // Invalid metadata, skip
            }
          }
        } catch {
          // Artifacts directory doesn't exist
        }
      }
    } catch {
      // Base directory doesn't exist
    }

    return artifactIds;
  }

  async getArtifactByContext(contextId: string, artifactId: string): Promise<StoredArtifact | null> {
    const safeContextId = this.sanitizeName(contextId);
    const safeArtifactId = this.sanitizeName(artifactId);

    try {
      const agentDirs = await this.getAgentDirectories();

      for (const agentDir of agentDirs) {
        const artifactDir = join(agentDir, `context=${safeContextId}`, 'artifacts', safeArtifactId);
        const metadataPath = join(artifactDir, 'metadata.json');

        try {
          const content = await readFile(metadataPath, 'utf-8');
          return JSON.parse(content) as StoredArtifact;
        } catch {
          // Metadata doesn't exist in this agent dir, continue
        }
      }
    } catch {
      // Base directory doesn't exist
    }

    return null;
  }

  // Helper methods

  private getArtifactDir(contextId: string, artifactId: string): string {
    const safeAgentId = this.sanitizeName(this.agentId);
    const safeContextId = this.sanitizeName(contextId);
    const safeArtifactId = this.sanitizeName(artifactId);
    return join(
      this.basePath,
      `agent=${safeAgentId}`,
      `context=${safeContextId}`,
      'artifacts',
      safeArtifactId
    );
  }

  private async saveMetadata(artifactDir: string, artifact: StoredArtifact): Promise<void> {
    const metadataPath = join(artifactDir, 'metadata.json');
    await writeFile(metadataPath, JSON.stringify(artifact, null, 2), 'utf-8');
  }

  private async saveConsolidatedContent(artifactDir: string, artifact: StoredArtifact): Promise<void> {
    const textParts: string[] = [];
    const dataParts: unknown[] = [];

    for (const part of artifact.parts) {
      if (part.kind === 'text' && part.content) {
        textParts.push(part.content);
      } else if (part.kind === 'data' && part.data) {
        dataParts.push(part.data);
      }
    }

    if (dataParts.length > 0) {
      const contentPath = join(artifactDir, 'content.json');
      const content = dataParts.length === 1 ? dataParts[0] : dataParts;
      await writeFile(contentPath, JSON.stringify(content, null, 2), 'utf-8');
    } else if (textParts.length > 0) {
      const contentPath = join(artifactDir, 'content.txt');
      await writeFile(contentPath, textParts.join(''), 'utf-8');
    }
  }

  private async loadArtifactByIdScan(artifactId: string): Promise<StoredArtifact | null> {
    const safeArtifactId = this.sanitizeName(artifactId);

    try {
      const agentDirs = await this.getAgentDirectories();

      for (const agentDir of agentDirs) {
        const contextDirs = await this.getContextDirectories(agentDir);

        for (const contextDir of contextDirs) {
          const artifactDir = join(contextDir, 'artifacts', safeArtifactId);
          const metadataPath = join(artifactDir, 'metadata.json');

          try {
            const content = await readFile(metadataPath, 'utf-8');
            return JSON.parse(content) as StoredArtifact;
          } catch {
            // Metadata doesn't exist, continue searching
          }
        }
      }
    } catch {
      // Base directory doesn't exist
    }

    return null;
  }

  private async getAgentDirectories(): Promise<string[]> {
    try {
      const entries = await readdir(this.basePath);
      const agentDirs: string[] = [];

      for (const entry of entries) {
        if (entry.startsWith('agent=')) {
          agentDirs.push(join(this.basePath, entry));
        }
      }

      return agentDirs;
    } catch {
      return [];
    }
  }

  private async getContextDirectories(agentDir: string): Promise<string[]> {
    try {
      const entries = await readdir(agentDir);
      const contextDirs: string[] = [];

      for (const entry of entries) {
        if (entry.startsWith('context=')) {
          contextDirs.push(join(agentDir, entry));
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
