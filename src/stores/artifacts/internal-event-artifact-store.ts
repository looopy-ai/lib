/**
 * Internal Event Artifact Store
 *
 * Decorator that wraps any ArtifactStore implementation and emits internal event
 * protocol events whenever artifact operations occur.
 *
 * This enables transparent event emission without modifying the core artifact store
 * implementations.
 *
 * Design: design/internal-event-protocol.md
 */

import type { ArtifactPart, ArtifactStore, DatasetSchema, StoredArtifact } from '../../core/types';
import {
  type CreateDatasetWriteEventOptions,
  type CreateDataWriteEventOptions,
  type CreateFileWriteEventOptions,
  createDatasetWriteEvent,
  createDataWriteEvent,
  createFileWriteEvent,
} from '../../events';
import type { InternalEvent } from '../../events/types';

/**
 * Event emitter interface
 */
export interface InternalEventEmitter {
  emit(event: InternalEvent): void;
}

/**
 * Configuration for InternalEventArtifactStore
 */
export interface InternalEventArtifactStoreConfig {
  /** The underlying artifact store to wrap */
  delegate: ArtifactStore;

  /** Event emitter for publishing events */
  eventEmitter: InternalEventEmitter;

  /** Enable/disable event emission (default: true) */
  enableEvents?: boolean;
}

/**
 * Decorator that wraps an ArtifactStore and emits internal events
 *
 * Uses the Decorator pattern to add event emission capability to any
 * ArtifactStore implementation without modifying the original store.
 *
 * @example
 * ```typescript
 * const eventEmitter: InternalEventEmitter = {
 *   emit: (event) => console.log(event),
 * };
 *
 * const store = new InternalEventArtifactStore({
 *   delegate: new InMemoryArtifactStore(),
 *   eventEmitter,
 * });
 *
 * // File chunks emit file-write events
 * await store.appendFileChunk('art-1', 'Chunk 1');
 * // Emits: { kind: 'file-write', ... }
 * ```
 */
export class InternalEventArtifactStore implements ArtifactStore {
  private delegate: ArtifactStore;
  private eventEmitter: InternalEventEmitter;
  private enableEvents: boolean;

  constructor(config: InternalEventArtifactStoreConfig) {
    this.delegate = config.delegate;
    this.eventEmitter = config.eventEmitter;
    this.enableEvents = config.enableEvents ?? true;
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
  }): Promise<string> {
    return this.delegate.createFileArtifact(params);
  }

  async appendFileChunk(
    artifactId: string,
    chunk: string,
    options?: {
      isLastChunk?: boolean;
      encoding?: 'utf-8' | 'base64';
    }
  ): Promise<void> {
    // Execute the operation
    await this.delegate.appendFileChunk(artifactId, chunk, options);

    // Emit event if enabled
    if (this.enableEvents) {
      const artifact = await this.delegate.getArtifact(artifactId);
      if (artifact && artifact.type === 'file') {
        const chunkIndex = artifact.chunks.length - 1; // Last chunk index

        const eventOptions: CreateFileWriteEventOptions = {
          contextId: artifact.contextId,
          taskId: artifact.taskId,
          artifactId,
          data: chunk,
          index: chunkIndex,
          complete: options?.isLastChunk ?? false,
          name: artifact.name,
          description: artifact.description,
          mimeType: artifact.mimeType,
          metadata: {
            encoding: options?.encoding || artifact.encoding,
            chunkSize: Buffer.byteLength(chunk, options?.encoding || artifact.encoding || 'utf-8'),
            totalChunks: artifact.chunks.length,
            totalSize: artifact.totalSize,
          },
        };

        this.eventEmitter.emit(createFileWriteEvent(eventOptions));
      }
    }
  }

  async getFileContent(artifactId: string): Promise<string> {
    return this.delegate.getFileContent(artifactId);
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
  }): Promise<string> {
    return this.delegate.createDataArtifact(params);
  }

  async writeData(artifactId: string, data: Record<string, unknown>): Promise<void> {
    // Execute the operation
    await this.delegate.writeData(artifactId, data);

    // Emit event if enabled
    if (this.enableEvents) {
      const artifact = await this.delegate.getArtifact(artifactId);
      if (artifact && artifact.type === 'data') {
        const eventOptions: CreateDataWriteEventOptions = {
          contextId: artifact.contextId,
          taskId: artifact.taskId,
          artifactId,
          data,
          name: artifact.name,
          description: artifact.description,
          metadata: {
            version: artifact.version,
            dataSize: JSON.stringify(data).length,
          },
        };

        this.eventEmitter.emit(createDataWriteEvent(eventOptions));
      }
    }
  }

  async getDataContent(artifactId: string): Promise<Record<string, unknown>> {
    return this.delegate.getDataContent(artifactId);
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
  }): Promise<string> {
    return this.delegate.createDatasetArtifact(params);
  }

  async appendDatasetBatch(
    artifactId: string,
    rows: Record<string, unknown>[],
    options?: {
      isLastBatch?: boolean;
    }
  ): Promise<void> {
    // Execute the operation
    await this.delegate.appendDatasetBatch(artifactId, rows, options);

    // Emit event if enabled
    if (this.enableEvents) {
      const artifact = await this.delegate.getArtifact(artifactId);
      if (artifact && artifact.type === 'dataset') {
        const batchIndex = artifact.totalChunks - 1; // Last batch index

        const eventOptions: CreateDatasetWriteEventOptions = {
          contextId: artifact.contextId,
          taskId: artifact.taskId,
          artifactId,
          rows,
          index: batchIndex,
          complete: options?.isLastBatch ?? false,
          name: artifact.name,
          description: artifact.description,
          schema: artifact.schema
            ? {
                type: 'object',
                properties: Object.fromEntries(
                  artifact.schema.columns.map((col) => [
                    col.name,
                    {
                      type: col.type,
                      description: col.description,
                    },
                  ])
                ),
                required: artifact.schema.columns
                  .filter((col) => !col.nullable)
                  .map((col) => col.name),
              }
            : undefined,
          metadata: {
            batchSize: rows.length,
            totalRows: artifact.totalSize,
            totalBatches: artifact.totalChunks,
          },
        };

        this.eventEmitter.emit(createDatasetWriteEvent(eventOptions));
      }
    }
  }

  async getDatasetRows(artifactId: string): Promise<Record<string, unknown>[]> {
    return this.delegate.getDatasetRows(artifactId);
  }

  // ============================================================================
  // Common Methods
  // ============================================================================

  async getArtifact(artifactId: string): Promise<StoredArtifact | null> {
    return this.delegate.getArtifact(artifactId);
  }

  async getTaskArtifacts(taskId: string): Promise<string[]> {
    return this.delegate.getTaskArtifacts(taskId);
  }

  async queryArtifacts(params: { contextId: string; taskId?: string }): Promise<string[]> {
    return this.delegate.queryArtifacts(params);
  }

  async getArtifactByContext(
    contextId: string,
    artifactId: string
  ): Promise<StoredArtifact | null> {
    return this.delegate.getArtifactByContext(contextId, artifactId);
  }

  async deleteArtifact(artifactId: string): Promise<void> {
    return this.delegate.deleteArtifact(artifactId);
  }

  // ============================================================================
  // Legacy Methods (for backward compatibility)
  // ============================================================================

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
    if (this.delegate.createArtifact) {
      return this.delegate.createArtifact(params);
    }

    // Fallback to type-specific methods
    switch (params.type) {
      case 'file':
        return this.createFileArtifact({
          artifactId: params.artifactId,
          taskId: params.taskId,
          contextId: params.contextId,
          name: params.name,
          description: params.description,
          mimeType: params.mimeType,
        });
      case 'data':
        return this.createDataArtifact({
          artifactId: params.artifactId,
          taskId: params.taskId,
          contextId: params.contextId,
          name: params.name,
          description: params.description,
        });
      case 'dataset':
        return this.createDatasetArtifact({
          artifactId: params.artifactId,
          taskId: params.taskId,
          contextId: params.contextId,
          name: params.name,
          description: params.description,
          schema: params.schema,
        });
      default: {
        const exhaustiveCheck: never = params.type;
        throw new Error(`Unknown artifact type: ${exhaustiveCheck}`);
      }
    }
  }

  async getArtifactContent(
    artifactId: string
  ): Promise<string | Record<string, unknown> | Record<string, unknown>[]> {
    if (this.delegate.getArtifactContent) {
      return this.delegate.getArtifactContent(artifactId);
    }

    // Fallback: determine type and call appropriate method
    const artifact = await this.delegate.getArtifact(artifactId);
    if (!artifact) {
      throw new Error(`Artifact not found: ${artifactId}`);
    }

    switch (artifact.type) {
      case 'file':
        return this.getFileContent(artifactId);
      case 'data':
        return this.getDataContent(artifactId);
      case 'dataset':
        return this.getDatasetRows(artifactId);
    }
  }

  async appendPart(
    artifactId: string,
    part: Omit<ArtifactPart, 'index'>,
    isLastChunk?: boolean
  ): Promise<void> {
    // Always use type-specific methods to ensure events are emitted
    const artifact = await this.delegate.getArtifact(artifactId);
    if (!artifact) {
      throw new Error(`Artifact not found: ${artifactId}`);
    }

    switch (artifact.type) {
      case 'file':
        if (part.content !== undefined) {
          return this.appendFileChunk(artifactId, part.content, { isLastChunk });
        }
        throw new Error('File part must have content');
      case 'data':
        if (part.data !== undefined) {
          return this.writeData(artifactId, part.data);
        }
        throw new Error('Data part must have data');
      case 'dataset':
        if (part.data !== undefined) {
          // Assume data is a single row
          return this.appendDatasetBatch(artifactId, [part.data], { isLastBatch: isLastChunk });
        }
        throw new Error('Dataset part must have data');
    }
  }

  async getArtifactParts(artifactId: string, resolveExternal?: boolean): Promise<ArtifactPart[]> {
    if (this.delegate.getArtifactParts) {
      return this.delegate.getArtifactParts(artifactId, resolveExternal);
    }

    // Fallback: convert from new format to legacy format
    const artifact = await this.delegate.getArtifact(artifactId);
    if (!artifact) {
      throw new Error(`Artifact not found: ${artifactId}`);
    }

    switch (artifact.type) {
      case 'file':
        return artifact.chunks.map((chunk, index) => ({
          index,
          kind: 'file' as const,
          content: chunk.data,
          metadata: {
            mimeType: artifact.mimeType,
            size: chunk.size,
            checksum: chunk.checksum,
          },
        }));
      case 'data':
        return [
          {
            index: 0,
            kind: 'data' as const,
            data: artifact.data,
          },
        ];
      case 'dataset':
        return [
          {
            index: 0,
            kind: 'data' as const,
            data: { rows: artifact.rows },
          },
        ];
    }
  }

  async replacePart(
    artifactId: string,
    partIndex: number,
    part: Omit<ArtifactPart, 'index'>
  ): Promise<void> {
    if (this.delegate.replacePart) {
      return this.delegate.replacePart(artifactId, partIndex, part);
    }

    throw new Error('replacePart not implemented in delegate store');
  }

  async replaceParts(
    artifactId: string,
    parts: Omit<ArtifactPart, 'index'>[],
    isLastChunk?: boolean
  ): Promise<void> {
    if (this.delegate.replaceParts) {
      return this.delegate.replaceParts(artifactId, parts, isLastChunk);
    }

    throw new Error('replaceParts not implemented in delegate store');
  }
}
