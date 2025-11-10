/**
 * In-Memory Artifact Store
 *
 * Implementation using discriminated unions with separate types for each artifact kind.
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
  ArtifactPart,
  ArtifactStore,
  DataArtifact,
  DatasetArtifact,
  DatasetSchema,
  FileArtifact,
  StoredArtifact,
} from '../../core/types';

/**
 * In-memory artifact store using discriminated unions
 */
export class InMemoryArtifactStore implements ArtifactStore {
  private artifacts = new Map<string, StoredArtifact>();

  // ============================================================================
  // File Artifact Methods
  // ============================================================================

  /**
   * Create a new file artifact
   */
  async createFileArtifact(params: {
    artifactId: string;
    taskId: string;
    contextId: string;
    name?: string;
    description?: string;
    mimeType?: string;
    encoding?: 'utf-8' | 'base64';
  }): Promise<string> {
    const now = new Date().toISOString();

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
      version: 1,
      operations: [
        {
          operationId: randomUUID(),
          type: 'create',
          timestamp: now,
        },
      ],
      createdAt: now,
      updatedAt: now,
    };

    this.artifacts.set(params.artifactId, artifact);
    return params.artifactId;
  }

  /**
   * Append a chunk to a file artifact
   */
  async appendFileChunk(
    artifactId: string,
    chunk: string,
    options?: { isLastChunk?: boolean; encoding?: 'utf-8' | 'base64' }
  ): Promise<void> {
    const artifact = this.artifacts.get(artifactId);
    if (!artifact) {
      throw new Error(`Artifact not found: ${artifactId}`);
    }

    if (artifact.type !== 'file') {
      throw new Error(`Artifact ${artifactId} is not a file artifact (type: ${artifact.type})`);
    }

    const now = new Date().toISOString();

    // Only append chunk if there's content
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

    // Always update metadata
    artifact.updatedAt = now;
    artifact.version += 1;

    // Mark as complete if requested (even with empty chunk)
    if (options?.isLastChunk) {
      artifact.status = 'complete';
      artifact.completedAt = now;
    }
  }

  /**
   * Get file content (concatenate all chunks)
   */
  async getFileContent(artifactId: string): Promise<string> {
    const artifact = this.artifacts.get(artifactId);
    if (!artifact) {
      throw new Error(`Artifact not found: ${artifactId}`);
    }

    if (artifact.type !== 'file') {
      throw new Error(`Artifact ${artifactId} is not a file artifact (type: ${artifact.type})`);
    }

    return artifact.chunks.map((chunk) => chunk.data).join('');
  }

  // ============================================================================
  // Data Artifact Methods
  // ============================================================================

  /**
   * Create a new data artifact
   */
  async createDataArtifact(params: {
    artifactId: string;
    taskId: string;
    contextId: string;
    name?: string;
    description?: string;
  }): Promise<string> {
    const now = new Date().toISOString();

    const artifact: DataArtifact = {
      type: 'data',
      artifactId: params.artifactId,
      taskId: params.taskId,
      contextId: params.contextId,
      name: params.name,
      description: params.description,
      data: {},
      status: 'building',
      version: 1,
      operations: [
        {
          operationId: randomUUID(),
          type: 'create',
          timestamp: now,
        },
      ],
      createdAt: now,
      updatedAt: now,
    };

    this.artifacts.set(params.artifactId, artifact);
    return params.artifactId;
  }

  /**
   * Write or update data artifact (atomic replacement)
   */
  async writeData(artifactId: string, data: Record<string, unknown>): Promise<void> {
    const artifact = this.artifacts.get(artifactId);
    if (!artifact) {
      throw new Error(`Artifact not found: ${artifactId}`);
    }

    if (artifact.type !== 'data') {
      throw new Error(`Artifact ${artifactId} is not a data artifact (type: ${artifact.type})`);
    }

    const now = new Date().toISOString();

    // Atomic replacement
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

  /**
   * Get data artifact content
   */
  async getDataContent(artifactId: string): Promise<Record<string, unknown>> {
    const artifact = this.artifacts.get(artifactId);
    if (!artifact) {
      throw new Error(`Artifact not found: ${artifactId}`);
    }

    if (artifact.type !== 'data') {
      throw new Error(`Artifact ${artifactId} is not a data artifact (type: ${artifact.type})`);
    }

    return artifact.data;
  }

  // ============================================================================
  // Dataset Artifact Methods
  // ============================================================================

  /**
   * Create a new dataset artifact
   */
  async createDatasetArtifact(params: {
    artifactId: string;
    taskId: string;
    contextId: string;
    name?: string;
    description?: string;
    schema?: DatasetSchema;
  }): Promise<string> {
    const now = new Date().toISOString();

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
      version: 1,
      operations: [
        {
          operationId: randomUUID(),
          type: 'create',
          timestamp: now,
        },
      ],
      createdAt: now,
      updatedAt: now,
    };

    this.artifacts.set(params.artifactId, artifact);
    return params.artifactId;
  }

  /**
   * Append a batch of rows to a dataset artifact
   */
  async appendDatasetBatch(
    artifactId: string,
    rows: Record<string, unknown>[],
    options?: { isLastBatch?: boolean }
  ): Promise<void> {
    const artifact = this.artifacts.get(artifactId);
    if (!artifact) {
      throw new Error(`Artifact not found: ${artifactId}`);
    }

    if (artifact.type !== 'dataset') {
      throw new Error(`Artifact ${artifactId} is not a dataset artifact (type: ${artifact.type})`);
    }

    const now = new Date().toISOString();

    // Only append rows if there are any
    if (rows && rows.length > 0) {
      artifact.rows.push(...rows);
      artifact.totalChunks += 1; // Batch count
      artifact.totalSize = artifact.rows.length; // Total rows

      artifact.operations.push({
        operationId: randomUUID(),
        type: 'append',
        timestamp: now,
        chunkIndex: artifact.totalChunks - 1,
      });
    }

    // Always update metadata
    artifact.updatedAt = now;
    artifact.version += 1;

    // Mark as complete if requested (even with empty batch)
    if (options?.isLastBatch) {
      artifact.status = 'complete';
      artifact.completedAt = now;
    }
  }

  /**
   * Get dataset rows
   */
  async getDatasetRows(artifactId: string): Promise<Record<string, unknown>[]> {
    const artifact = this.artifacts.get(artifactId);
    if (!artifact) {
      throw new Error(`Artifact not found: ${artifactId}`);
    }

    if (artifact.type !== 'dataset') {
      throw new Error(`Artifact ${artifactId} is not a dataset artifact (type: ${artifact.type})`);
    }

    return artifact.rows;
  }

  // ============================================================================
  // Common Methods
  // ============================================================================

  /**
   * Get artifact metadata
   */
  async getArtifact(artifactId: string): Promise<StoredArtifact | null> {
    return this.artifacts.get(artifactId) || null;
  }

  /**
   * List all artifacts for a task
   */
  async getTaskArtifacts(taskId: string): Promise<string[]> {
    const ids: string[] = [];
    for (const [id, artifact] of this.artifacts.entries()) {
      if (artifact.taskId === taskId) {
        ids.push(id);
      }
    }
    return ids;
  }

  /**
   * Query artifacts by context and optional task
   */
  async queryArtifacts(params: { contextId: string; taskId?: string }): Promise<string[]> {
    const ids: string[] = [];
    for (const [id, artifact] of this.artifacts.entries()) {
      if (artifact.contextId === params.contextId) {
        if (!params.taskId || artifact.taskId === params.taskId) {
          ids.push(id);
        }
      }
    }
    return ids;
  }

  /**
   * Get artifact by context (scoped lookup)
   */
  async getArtifactByContext(
    contextId: string,
    artifactId: string
  ): Promise<StoredArtifact | null> {
    const artifact = this.artifacts.get(artifactId);
    if (artifact && artifact.contextId === contextId) {
      return artifact;
    }
    return null;
  }

  /**
   * Delete an artifact
   */
  async deleteArtifact(artifactId: string): Promise<void> {
    this.artifacts.delete(artifactId);
  }

  // ============================================================================
  // Legacy Methods (backward compatibility)
  // ============================================================================

  /**
   * @deprecated Use createFileArtifact, createDataArtifact, or createDatasetArtifact
   */
  async createArtifact(params: {
    artifactId: string;
    taskId: string;
    contextId: string;
    type: 'file' | 'data' | 'dataset';
    name?: string;
    description?: string;
    mimeType?: string;
    schema?: DatasetSchema;
  }): Promise<string> {
    if (params.type === 'file') {
      return this.createFileArtifact({
        ...params,
        mimeType: params.mimeType,
      });
    } else if (params.type === 'data') {
      return this.createDataArtifact(params);
    } else if (params.type === 'dataset') {
      return this.createDatasetArtifact({
        ...params,
        schema: params.schema,
      });
    }
    throw new Error(`Unknown artifact type: ${params.type}`);
  }

  /**
   * @deprecated Use getFileContent, getDataContent, or getDatasetRows
   */
  async getArtifactContent(
    artifactId: string
  ): Promise<string | Record<string, unknown> | Record<string, unknown>[]> {
    const artifact = this.artifacts.get(artifactId);
    if (!artifact) {
      throw new Error(`Artifact not found: ${artifactId}`);
    }

    if (artifact.type === 'file') {
      return this.getFileContent(artifactId);
    } else if (artifact.type === 'data') {
      return this.getDataContent(artifactId);
    } else {
      return this.getDatasetRows(artifactId);
    }
  }

  /**
   * @deprecated Use type-specific methods
   */
  async appendPart(
    artifactId: string,
    part: Omit<ArtifactPart, 'index'>,
    isLastChunk?: boolean
  ): Promise<void> {
    const artifact = this.artifacts.get(artifactId);
    if (!artifact) {
      throw new Error(`Artifact not found: ${artifactId}`);
    }

    // Map old part API to new type-specific methods
    if (artifact.type === 'file' && part.kind === 'text' && part.content) {
      await this.appendFileChunk(artifactId, part.content, { isLastChunk });
    } else if (artifact.type === 'data' && part.kind === 'data' && part.data) {
      await this.writeData(artifactId, part.data);
    } else if (artifact.type === 'dataset' && part.kind === 'data' && part.data) {
      // Assume data is an array of rows
      const rows = Array.isArray(part.data) ? part.data : [part.data];
      await this.appendDatasetBatch(artifactId, rows as Record<string, unknown>[], {
        isLastBatch: isLastChunk,
      });
    } else {
      throw new Error(
        `Cannot append part of kind '${part.kind}' to artifact type '${artifact.type}'`
      );
    }
  }
}
