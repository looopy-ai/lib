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

import {
  type CreateDatasetWriteEventOptions,
  type CreateDataWriteEventOptions,
  type CreateFileWriteEventOptions,
  createDatasetWriteEvent,
  createDataWriteEvent,
  createFileWriteEvent,
} from '../../events';
import type { ArtifactStore, DatasetSchema, StoredArtifact } from '../../types/artifact';
import type { AnyEvent } from '../../types/event';

/**
 * Event emitter interface
 */
export interface InternalEventEmitter {
  emit(event: AnyEvent): void;
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
    contextId: string,
    artifactId: string,
    chunk: string,
    options?: {
      isLastChunk?: boolean;
      encoding?: 'utf-8' | 'base64';
    },
  ): Promise<void> {
    // Execute the operation
    await this.delegate.appendFileChunk(contextId, artifactId, chunk, options);

    // Emit event if enabled
    if (this.enableEvents) {
      const artifact = await this.delegate.getArtifact(contextId, artifactId);
      if (artifact && artifact.type === 'file') {
        const chunkIndex = artifact.chunks.length - 1; // Last chunk index

        const eventOptions: CreateFileWriteEventOptions = {
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

  async getFileContent(contextId: string, artifactId: string): Promise<string> {
    return this.delegate.getFileContent(contextId, artifactId);
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

  async writeData(
    contextId: string,
    artifactId: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    // Execute the operation
    await this.delegate.writeData(contextId, artifactId, data);

    // Emit event if enabled
    if (this.enableEvents) {
      const artifact = await this.delegate.getArtifact(contextId, artifactId);
      if (artifact && artifact.type === 'data') {
        const eventOptions: CreateDataWriteEventOptions = {
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

  async getDataContent(contextId: string, artifactId: string): Promise<Record<string, unknown>> {
    return this.delegate.getDataContent(contextId, artifactId);
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
    contextId: string,
    artifactId: string,
    rows: Record<string, unknown>[],
    options?: {
      isLastBatch?: boolean;
    },
  ): Promise<void> {
    // Execute the operation
    await this.delegate.appendDatasetBatch(contextId, artifactId, rows, options);

    // Emit event if enabled
    if (this.enableEvents) {
      const artifact = await this.delegate.getArtifact(contextId, artifactId);
      if (artifact && artifact.type === 'dataset') {
        const batchIndex = artifact.totalChunks - 1; // Last batch index

        const eventOptions: CreateDatasetWriteEventOptions = {
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
                  ]),
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

  async getDatasetRows(contextId: string, artifactId: string): Promise<Record<string, unknown>[]> {
    return this.delegate.getDatasetRows(contextId, artifactId);
  }

  // ============================================================================
  // Common Methods
  // ============================================================================

  async getArtifact(contextId: string, artifactId: string): Promise<StoredArtifact | null> {
    return this.delegate.getArtifact(contextId, artifactId);
  }

  async listArtifacts(contextId: string, taskId?: string): Promise<string[]> {
    return this.delegate.listArtifacts(contextId, taskId);
  }

  async deleteArtifact(contextId: string, artifactId: string): Promise<void> {
    return this.delegate.deleteArtifact(contextId, artifactId);
  }
}
