/**
 * Filesystem Artifact Store
 *
 * Implementation using discriminated unions with separate types for each artifact kind.
 *
 * Directory structure:
 * ./_agent_store/agent={agentId}/context={contextId}/artifacts/{artifactId}/
 *   - metadata.json (FileArtifact | DataArtifact | DatasetArtifact)
 *   - content.txt (for FileArtifact only - chunks appended to single file)
 *   - data.json (for DataArtifact only)
 *   - rows.jsonl (for DatasetArtifact only - newline-delimited JSON)
 *
 * Design: design/artifact-management.md
 */

import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  ArtifactStore,
  DataArtifact,
  DatasetArtifact,
  DatasetSchema,
  FileArtifact,
  StoredArtifact,
} from '../../types/artifact';

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

  // ============================================================================
  // File Artifact Methods
  // ============================================================================

  async createFileArtifact(params: {
    artifactId: string;
    taskId: string;
    contextId: string;
    name?: string;
    description?: string;
    mimeType?: string;
    encoding?: 'utf-8' | 'base64';
    override?: boolean;
  }): Promise<string> {
    const artifactId = params.artifactId || randomUUID();
    const artifactDir = this.getArtifactDir(params.contextId, artifactId);

    // Check if artifact already exists
    const existing = await this.getArtifact(params.contextId, artifactId);
    if (existing && !params.override) {
      throw new Error(
        `Artifact already exists: ${artifactId}. ` +
          `Use override: true to replace it, or use a different artifactId.`,
      );
    }

    // If overriding, remove existing directory
    if (existing && params.override) {
      try {
        await rm(artifactDir, { recursive: true, force: true });
      } catch {
        // Ignore errors if directory doesn't exist
      }
    }

    await mkdir(artifactDir, { recursive: true });

    // Create empty content file
    const contentPath = join(artifactDir, 'content.txt');
    await writeFile(contentPath, '', 'utf-8');

    const now = new Date().toISOString();
    const artifact: FileArtifact = {
      type: 'file',
      artifactId,
      taskId: params.taskId,
      contextId: params.contextId,
      name: params.name,
      description: params.description,
      mimeType: params.mimeType,
      encoding: params.encoding || 'utf-8',
      chunks: [],
      totalChunks: 0,
      totalSize: 0,
      status: 'building',
      version: existing && params.override ? existing.version + 1 : 1,
      operations: [
        {
          operationId: `op-${Date.now()}`,
          type: params.override ? 'reset' : 'create',
          timestamp: now,
        },
      ],
      createdAt: existing ? existing.createdAt : now,
      updatedAt: now,
    };

    await this.saveMetadata(artifactDir, artifact);
    return artifactId;
  }

  async appendFileChunk(
    contextId: string,
    artifactId: string,
    chunk: string,
    options?: { isLastChunk?: boolean },
  ): Promise<void> {
    const artifact = await this.getArtifact(contextId, artifactId);
    if (!artifact || artifact.type !== 'file') {
      throw new Error(`File artifact not found: ${artifactId} in context ${contextId}`);
    }

    const artifactDir = this.getArtifactDir(contextId, artifactId);
    const contentPath = join(artifactDir, 'content.txt');
    const chunkIndex = artifact.chunks.length;

    // Append chunk to single content file
    await appendFile(contentPath, chunk, 'utf-8');

    // Update metadata
    const now = new Date().toISOString();
    const chunkSize = Buffer.byteLength(chunk, 'utf-8');

    artifact.chunks.push({
      index: chunkIndex,
      data: chunk,
      size: chunkSize,
      timestamp: now,
    });
    artifact.totalChunks++;
    artifact.totalSize += chunkSize;
    artifact.updatedAt = now;

    if (options?.isLastChunk) {
      artifact.status = 'complete';
      artifact.completedAt = now;
    }

    artifact.operations.push({
      operationId: `op-${Date.now()}`,
      type: 'append',
      timestamp: now,
    });

    await this.saveMetadata(artifactDir, artifact);
  }

  async getFileContent(contextId: string, artifactId: string): Promise<string> {
    const artifact = await this.getArtifact(contextId, artifactId);
    if (!artifact || artifact.type !== 'file') {
      throw new Error(`File artifact not found: ${artifactId} in context ${contextId}`);
    }

    const artifactDir = this.getArtifactDir(contextId, artifactId);
    const contentPath = join(artifactDir, 'content.txt');

    try {
      // Read entire content from single file
      return await readFile(contentPath, 'utf-8');
    } catch (error) {
      // Fallback: reconstruct from metadata chunks if file doesn't exist
      if (artifact.chunks.length > 0) {
        return artifact.chunks.map((c) => c.data).join('');
      }
      throw error;
    }
  }

  // ============================================================================
  // Data Artifact Methods
  // ============================================================================

  async createDataArtifact(params: {
    artifactId: string;
    taskId: string;
    contextId: string;
    name?: string;
    description?: string;
    override?: boolean;
  }): Promise<string> {
    const artifactId = params.artifactId || randomUUID();
    const artifactDir = this.getArtifactDir(params.contextId, artifactId);

    // Check if artifact already exists
    const existing = await this.getArtifact(params.contextId, artifactId);
    if (existing && !params.override) {
      throw new Error(
        `Artifact already exists: ${artifactId}. ` +
          `Use override: true to replace it, or use a different artifactId.`,
      );
    }

    // If overriding, remove existing directory
    if (existing && params.override) {
      try {
        await rm(artifactDir, { recursive: true, force: true });
      } catch {
        // Ignore errors if directory doesn't exist
      }
    }

    await mkdir(artifactDir, { recursive: true });

    const now = new Date().toISOString();
    const artifact: DataArtifact = {
      type: 'data',
      artifactId,
      taskId: params.taskId,
      contextId: params.contextId,
      name: params.name,
      description: params.description,
      data: {},
      status: 'building',
      version: existing && params.override ? existing.version + 1 : 1,
      operations: [
        {
          operationId: `op-${Date.now()}`,
          type: params.override ? 'reset' : 'create',
          timestamp: now,
        },
      ],
      createdAt: existing ? existing.createdAt : now,
      updatedAt: now,
    };

    await this.saveMetadata(artifactDir, artifact);

    // Create empty data file
    await writeFile(join(artifactDir, 'data.json'), '{}', 'utf-8');

    return artifactId;
  }

  async writeData(
    contextId: string,
    artifactId: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    const artifact = await this.getArtifact(contextId, artifactId);
    if (!artifact || artifact.type !== 'data') {
      throw new Error(`Data artifact not found: ${artifactId} in context ${contextId}`);
    }

    const artifactDir = this.getArtifactDir(contextId, artifactId);
    const now = new Date().toISOString();

    // Write data to file
    await writeFile(join(artifactDir, 'data.json'), JSON.stringify(data, null, 2), 'utf-8');

    // Update metadata
    artifact.data = data;
    artifact.status = 'complete';
    artifact.updatedAt = now;
    artifact.completedAt = now;
    artifact.operations.push({
      operationId: `op-${Date.now()}`,
      type: 'replace',
      timestamp: now,
    });

    await this.saveMetadata(artifactDir, artifact);
  }

  async getDataContent(contextId: string, artifactId: string): Promise<Record<string, unknown>> {
    const artifact = await this.getArtifact(contextId, artifactId);
    if (!artifact || artifact.type !== 'data') {
      throw new Error(`Data artifact not found: ${artifactId} in context ${contextId}`);
    }

    const artifactDir = this.getArtifactDir(contextId, artifactId);

    try {
      const dataPath = join(artifactDir, 'data.json');
      const content = await readFile(dataPath, 'utf-8');
      return JSON.parse(content);
    } catch {
      // Fallback to metadata if file not found
      return artifact.data;
    }
  }

  // ============================================================================
  // Dataset Artifact Methods
  // ============================================================================

  async createDatasetArtifact(params: {
    artifactId: string;
    taskId: string;
    contextId: string;
    name?: string;
    description?: string;
    schema?: DatasetSchema;
    override?: boolean;
  }): Promise<string> {
    const artifactId = params.artifactId || randomUUID();
    const artifactDir = this.getArtifactDir(params.contextId, artifactId);

    // Check if artifact already exists
    const existing = await this.getArtifact(params.contextId, artifactId);
    if (existing && !params.override) {
      throw new Error(
        `Artifact already exists: ${artifactId}. ` +
          `Use override: true to replace it, or use a different artifactId.`,
      );
    }

    // If overriding, remove existing directory
    if (existing && params.override) {
      try {
        await rm(artifactDir, { recursive: true, force: true });
      } catch {
        // Ignore errors if directory doesn't exist
      }
    }

    await mkdir(artifactDir, { recursive: true });

    const now = new Date().toISOString();
    const artifact: DatasetArtifact = {
      type: 'dataset',
      artifactId,
      taskId: params.taskId,
      contextId: params.contextId,
      name: params.name,
      description: params.description,
      schema: params.schema,
      rows: [],
      totalChunks: 0,
      totalSize: 0,
      status: 'building',
      version: existing && params.override ? existing.version + 1 : 1,
      operations: [
        {
          operationId: `op-${Date.now()}`,
          type: params.override ? 'reset' : 'create',
          timestamp: now,
        },
      ],
      createdAt: existing ? existing.createdAt : now,
      updatedAt: now,
    };

    await this.saveMetadata(artifactDir, artifact);

    // Create empty rows file (newline-delimited JSON)
    await writeFile(join(artifactDir, 'rows.jsonl'), '', 'utf-8');

    return artifactId;
  }

  async appendDatasetBatch(
    contextId: string,
    artifactId: string,
    rows: Record<string, unknown>[],
    options?: { isLastBatch?: boolean },
  ): Promise<void> {
    const artifact = await this.getArtifact(contextId, artifactId);
    if (!artifact || artifact.type !== 'dataset') {
      throw new Error(`Dataset artifact not found: ${artifactId} in context ${contextId}`);
    }

    const artifactDir = this.getArtifactDir(contextId, artifactId);
    const now = new Date().toISOString();

    // Append rows to JSONL file
    const rowsPath = join(artifactDir, 'rows.jsonl');
    const lines = `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`;
    await appendFile(rowsPath, lines, 'utf-8');

    // Update metadata
    artifact.rows.push(...rows);
    artifact.totalChunks++;
    artifact.totalSize += rows.length;
    artifact.updatedAt = now;

    if (options?.isLastBatch) {
      artifact.status = 'complete';
      artifact.completedAt = now;
    }

    artifact.operations.push({
      operationId: `op-${Date.now()}`,
      type: 'append',
      timestamp: now,
    });

    await this.saveMetadata(artifactDir, artifact);
  }

  async getDatasetRows(contextId: string, artifactId: string): Promise<Record<string, unknown>[]> {
    const artifact = await this.getArtifact(contextId, artifactId);
    if (!artifact || artifact.type !== 'dataset') {
      throw new Error(`Dataset artifact not found: ${artifactId} in context ${contextId}`);
    }

    const artifactDir = this.getArtifactDir(contextId, artifactId);

    try {
      const rowsPath = join(artifactDir, 'rows.jsonl');
      const content = await readFile(rowsPath, 'utf-8');
      const lines = content
        .trim()
        .split('\n')
        .filter((line) => line.length > 0);
      return lines.map((line) => JSON.parse(line));
    } catch {
      // Fallback to metadata if file not found
      return artifact.rows;
    }
  }

  // ============================================================================
  // Common Methods
  // ============================================================================

  async getArtifact(contextId: string, artifactId: string): Promise<StoredArtifact | null> {
    const artifactDir = this.getArtifactDir(contextId, artifactId);
    return this.loadMetadata(artifactDir);
  }

  async deleteArtifact(contextId: string, artifactId: string): Promise<void> {
    const artifact = await this.getArtifact(contextId, artifactId);
    if (!artifact) {
      throw new Error(`Artifact not found: ${artifactId} in context ${contextId}`);
    }

    const artifactDir = this.getArtifactDir(contextId, artifactId);
    await rm(artifactDir, { recursive: true, force: true });
  }

  async listArtifacts(contextId: string, taskId?: string): Promise<string[]> {
    const results: string[] = [];

    const contextDir = join(
      this.basePath,
      `agent=${this.agentId}`,
      `context=${contextId}`,
      'artifacts',
    );

    try {
      const entries = await readdir(contextDir);

      for (const artifactId of entries) {
        const artifact = await this.getArtifact(contextId, artifactId);
        if (!artifact) continue;

        if (taskId && artifact.taskId !== taskId) continue;

        results.push(artifactId);
      }
    } catch {
      // Directory doesn't exist - no artifacts
      return [];
    }

    return results;
  }

  // Legacy compatibility methods
  async queryArtifacts(query: {
    taskId?: string;
    contextId?: string;
    status?: 'building' | 'complete' | 'failed';
  }): Promise<string[]> {
    if (!query.contextId) {
      throw new Error('contextId is required for queryArtifacts');
    }
    return this.listArtifacts(query.contextId, query.taskId);
  }

  async getTaskArtifacts(_taskId: string): Promise<string[]> {
    // This requires scanning all contexts - not efficient for filesystem
    // Recommend using listArtifacts with contextId instead
    throw new Error(
      'getTaskArtifacts not supported for filesystem store. Use listArtifacts with contextId instead.',
    );
  }

  // ============================================================================
  // Private Helper Methods
  // ============================================================================

  private getArtifactDir(contextId: string, artifactId: string): string {
    return join(
      this.basePath,
      `agent=${this.agentId}`,
      `context=${contextId}`,
      'artifacts',
      artifactId,
    );
  }

  private async saveMetadata(artifactDir: string, artifact: StoredArtifact): Promise<void> {
    const metadataPath = join(artifactDir, 'metadata.json');
    await writeFile(metadataPath, JSON.stringify(artifact, null, 2), 'utf-8');
  }

  private async loadMetadata(artifactDir: string): Promise<StoredArtifact | null> {
    try {
      const metadataPath = join(artifactDir, 'metadata.json');
      const content = await readFile(metadataPath, 'utf-8');
      return JSON.parse(content) as StoredArtifact;
    } catch {
      return null;
    }
  }
}
