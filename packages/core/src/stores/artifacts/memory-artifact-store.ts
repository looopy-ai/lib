/**
 * In-Memory Artifact Store
 *
 * Implementation using discriminated unions with separate types for each artifact kind.
 * Artifacts are scoped per-context.
 *
 * Artifact Types:
 * - FileArtifact: Text or binary files with chunked streaming
 * - DataArtifact: Structured JSON data (atomic updates)
 * - DatasetArtifact: Tabular data with batch streaming
 *
 * Design: design/artifact-management.md
 */

import { randomUUID } from 'node:crypto';
import type {
  ArtifactChunk,
  ArtifactStore,
  DataArtifact,
  DatasetArtifact,
  DatasetSchema,
  FileArtifact,
  StoredArtifact,
} from '../../core/types';

/**
 * In-memory artifact store using discriminated unions
 * Artifacts are stored per-context to ensure proper scoping
 */
export class InMemoryArtifactStore implements ArtifactStore {
  // Storage: contextId -> artifactId -> artifact
  private artifacts = new Map<string, Map<string, StoredArtifact>>();

  /**
   * Get or create context storage
   */
  private getContextStore(contextId: string): Map<string, StoredArtifact> {
    let contextStore = this.artifacts.get(contextId);
    if (!contextStore) {
      contextStore = new Map();
      this.artifacts.set(contextId, contextStore);
    }
    return contextStore;
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
    const contextStore = this.getContextStore(params.contextId);
    const existing = contextStore.get(params.artifactId);

    if (existing && !params.override) {
      throw new Error(
        `Artifact already exists: ${params.artifactId} in context ${params.contextId}. ` +
          `Use override: true to replace it, or use a different artifactId.`,
      );
    }

    const now = new Date().toISOString();
    const createdAt = existing ? existing.createdAt : now;

    const artifact: FileArtifact = {
      type: 'file',
      artifactId: params.artifactId,
      taskId: params.taskId,
      contextId: params.contextId,
      name: params.name,
      description: params.description,
      mimeType: params.mimeType || 'text/plain',
      encoding: params.encoding || 'utf-8',
      chunks: [],
      totalChunks: 0,
      totalSize: 0,
      status: 'building',
      version: existing && params.override ? existing.version + 1 : 1,
      operations: [
        {
          operationId: randomUUID(),
          type: params.override ? 'reset' : 'create',
          timestamp: now,
        },
      ],
      createdAt,
      updatedAt: now,
    };

    contextStore.set(params.artifactId, artifact);
    return params.artifactId;
  }

  async appendFileChunk(
    contextId: string,
    artifactId: string,
    chunk: string,
    options?: { isLastChunk?: boolean; encoding?: 'utf-8' | 'base64' },
  ): Promise<void> {
    const contextStore = this.getContextStore(contextId);
    const artifact = contextStore.get(artifactId);
    if (!artifact) {
      throw new Error(`Artifact not found: ${artifactId} in context ${contextId}`);
    }

    if (artifact.type !== 'file') {
      throw new Error(`Artifact ${artifactId} is not a file artifact (type: ${artifact.type})`);
    }

    const now = new Date().toISOString();

    if (chunk && chunk.length > 0) {
      const encoding = options?.encoding || artifact.encoding || 'utf-8';
      const chunkSize = Buffer.byteLength(chunk, encoding);

      const artifactChunk: ArtifactChunk = {
        index: artifact.chunks.length,
        data: chunk,
        size: chunkSize,
        timestamp: now,
      };

      artifact.chunks.push(artifactChunk);
      artifact.totalChunks = artifact.chunks.length;
      artifact.totalSize += chunkSize;

      artifact.operations.push({
        operationId: randomUUID(),
        type: 'append',
        timestamp: now,
        chunkIndex: artifactChunk.index,
      });
    }

    artifact.updatedAt = now;
    artifact.version += 1;

    if (options?.isLastChunk) {
      artifact.status = 'complete';
      artifact.completedAt = now;
    }
  }

  async getFileContent(contextId: string, artifactId: string): Promise<string> {
    const contextStore = this.getContextStore(contextId);
    const artifact = contextStore.get(artifactId);
    if (!artifact) {
      throw new Error(`Artifact not found: ${artifactId} in context ${contextId}`);
    }

    if (artifact.type !== 'file') {
      throw new Error(`Artifact ${artifactId} is not a file artifact (type: ${artifact.type})`);
    }

    return artifact.chunks.map((chunk) => chunk.data).join('');
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
    const contextStore = this.getContextStore(params.contextId);
    const existing = contextStore.get(params.artifactId);

    if (existing && !params.override) {
      throw new Error(
        `Artifact already exists: ${params.artifactId} in context ${params.contextId}. ` +
          `Use override: true to replace it, or use a different artifactId.`,
      );
    }

    const now = new Date().toISOString();
    const createdAt = existing ? existing.createdAt : now;

    const artifact: DataArtifact = {
      type: 'data',
      artifactId: params.artifactId,
      taskId: params.taskId,
      contextId: params.contextId,
      name: params.name,
      description: params.description,
      data: {},
      status: 'building',
      version: existing && params.override ? existing.version + 1 : 1,
      operations: [
        {
          operationId: randomUUID(),
          type: params.override ? 'reset' : 'create',
          timestamp: now,
        },
      ],
      createdAt,
      updatedAt: now,
    };

    contextStore.set(params.artifactId, artifact);
    return params.artifactId;
  }

  async writeData(
    contextId: string,
    artifactId: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    const contextStore = this.getContextStore(contextId);
    const artifact = contextStore.get(artifactId);
    if (!artifact) {
      throw new Error(`Artifact not found: ${artifactId} in context ${contextId}`);
    }

    if (artifact.type !== 'data') {
      throw new Error(`Artifact ${artifactId} is not a data artifact (type: ${artifact.type})`);
    }

    const now = new Date().toISOString();

    artifact.data = data;
    artifact.updatedAt = now;
    artifact.version += 1;
    artifact.status = 'complete';
    artifact.completedAt = now;

    artifact.operations.push({
      operationId: randomUUID(),
      type: 'replace',
      timestamp: now,
    });
  }

  async getDataContent(contextId: string, artifactId: string): Promise<Record<string, unknown>> {
    const contextStore = this.getContextStore(contextId);
    const artifact = contextStore.get(artifactId);
    if (!artifact) {
      throw new Error(`Artifact not found: ${artifactId} in context ${contextId}`);
    }

    if (artifact.type !== 'data') {
      throw new Error(`Artifact ${artifactId} is not a data artifact (type: ${artifact.type})`);
    }

    return artifact.data;
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
    const contextStore = this.getContextStore(params.contextId);
    const existing = contextStore.get(params.artifactId);

    if (existing && !params.override) {
      throw new Error(
        `Artifact already exists: ${params.artifactId} in context ${params.contextId}. ` +
          `Use override: true to replace it, or use a different artifactId.`,
      );
    }

    const now = new Date().toISOString();
    const createdAt = existing ? existing.createdAt : now;

    const artifact: DatasetArtifact = {
      type: 'dataset',
      artifactId: params.artifactId,
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
          operationId: randomUUID(),
          type: params.override ? 'reset' : 'create',
          timestamp: now,
        },
      ],
      createdAt,
      updatedAt: now,
    };

    contextStore.set(params.artifactId, artifact);
    return params.artifactId;
  }

  async appendDatasetBatch(
    contextId: string,
    artifactId: string,
    rows: Record<string, unknown>[],
    options?: { isLastBatch?: boolean },
  ): Promise<void> {
    const contextStore = this.getContextStore(contextId);
    const artifact = contextStore.get(artifactId);
    if (!artifact) {
      throw new Error(`Artifact not found: ${artifactId} in context ${contextId}`);
    }

    if (artifact.type !== 'dataset') {
      throw new Error(`Artifact ${artifactId} is not a dataset artifact (type: ${artifact.type})`);
    }

    const now = new Date().toISOString();

    if (rows && rows.length > 0) {
      artifact.rows.push(...rows);
      artifact.totalChunks += 1;
      artifact.totalSize = artifact.rows.length;

      artifact.operations.push({
        operationId: randomUUID(),
        type: 'append',
        timestamp: now,
        chunkIndex: artifact.totalChunks - 1,
      });
    }

    artifact.updatedAt = now;
    artifact.version += 1;

    if (options?.isLastBatch) {
      artifact.status = 'complete';
      artifact.completedAt = now;
    }
  }

  async getDatasetRows(contextId: string, artifactId: string): Promise<Record<string, unknown>[]> {
    const contextStore = this.getContextStore(contextId);
    const artifact = contextStore.get(artifactId);
    if (!artifact) {
      throw new Error(`Artifact not found: ${artifactId} in context ${contextId}`);
    }

    if (artifact.type !== 'dataset') {
      throw new Error(`Artifact ${artifactId} is not a dataset artifact (type: ${artifact.type})`);
    }

    return artifact.rows;
  }

  // ============================================================================
  // Common Methods
  // ============================================================================

  async getArtifact(contextId: string, artifactId: string): Promise<StoredArtifact | null> {
    const contextStore = this.getContextStore(contextId);
    return contextStore.get(artifactId) || null;
  }

  async listArtifacts(contextId: string, taskId?: string): Promise<string[]> {
    const contextStore = this.getContextStore(contextId);
    const ids: string[] = [];

    for (const [id, artifact] of contextStore.entries()) {
      if (!taskId || artifact.taskId === taskId) {
        ids.push(id);
      }
    }

    return ids;
  }

  async deleteArtifact(contextId: string, artifactId: string): Promise<void> {
    const contextStore = this.getContextStore(contextId);
    contextStore.delete(artifactId);
  }

  // ============================================================================
  // Legacy Methods (backward compatibility)
  // ============================================================================

  async queryArtifacts(params: { contextId: string; taskId?: string }): Promise<string[]> {
    return this.listArtifacts(params.contextId, params.taskId);
  }

  async getArtifactByContext(
    contextId: string,
    artifactId: string,
  ): Promise<StoredArtifact | null> {
    return this.getArtifact(contextId, artifactId);
  }

  async getTaskArtifacts(taskId: string): Promise<string[]> {
    // Scan all contexts for this taskId (inefficient, but backward compatible)
    const ids: string[] = [];
    for (const contextStore of this.artifacts.values()) {
      for (const [id, artifact] of contextStore.entries()) {
        if (artifact.taskId === taskId) {
          ids.push(id);
        }
      }
    }
    return ids;
  }
}
