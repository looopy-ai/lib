/**
 * Artifact Operation Scheduler
 *
 * Ensures operations on the same artifact execute sequentially while
 * allowing parallel execution across different artifacts.
 *
 * Design Pattern: Per-partition sequential queue
 *
 * This solves the problem where LLM emits create + append tool calls in
 * the same response, which execute in parallel and cause the append to
 * fail because the artifact hasn't been created yet.
 *
 * Design: design/artifact-management.md
 */

import type { ArtifactPart, ArtifactStore, DatasetSchema, StoredArtifact } from '../../core/types';

type Operation<T> = () => Promise<T>;

interface QueuedOperation<T> {
  operation: Operation<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
}

/**
 * Wraps an ArtifactStore to enforce sequential operations per artifact
 *
 * Operations on the same artifact (same artifactId) execute sequentially.
 * Operations on different artifacts execute in parallel.
 */
export class ArtifactScheduler implements ArtifactStore {
  // Map of artifactId -> operation queue
  private queues = new Map<string, QueuedOperation<unknown>[]>();

  // Map of artifactId -> currently processing flag
  private processing = new Map<string, boolean>();

  constructor(private store: ArtifactStore) {}

  // ============================================================================
  // File Artifact Methods (scheduled)
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
    return this.scheduleOperation(params.artifactId, () => this.store.createFileArtifact(params));
  }

  async appendFileChunk(
    artifactId: string,
    chunk: string,
    options?: { isLastChunk?: boolean; encoding?: 'utf-8' | 'base64' }
  ): Promise<void> {
    return this.scheduleOperation(artifactId, () =>
      this.store.appendFileChunk(artifactId, chunk, options)
    );
  }

  async getFileContent(artifactId: string): Promise<string> {
    return this.scheduleOperation(artifactId, () => this.store.getFileContent(artifactId));
  }

  // ============================================================================
  // Data Artifact Methods (scheduled)
  // ============================================================================

  async createDataArtifact(params: {
    artifactId: string;
    taskId: string;
    contextId: string;
    name?: string;
    description?: string;
    override?: boolean;
  }): Promise<string> {
    return this.scheduleOperation(params.artifactId, () => this.store.createDataArtifact(params));
  }

  async writeData(artifactId: string, data: Record<string, unknown>): Promise<void> {
    return this.scheduleOperation(artifactId, () => this.store.writeData(artifactId, data));
  }

  async getDataContent(artifactId: string): Promise<Record<string, unknown>> {
    return this.scheduleOperation(artifactId, () => this.store.getDataContent(artifactId));
  }

  // ============================================================================
  // Dataset Artifact Methods (scheduled)
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
    return this.scheduleOperation(params.artifactId, () =>
      this.store.createDatasetArtifact(params)
    );
  }

  async appendDatasetBatch(
    artifactId: string,
    rows: Record<string, unknown>[],
    options?: { isLastBatch?: boolean }
  ): Promise<void> {
    return this.scheduleOperation(artifactId, () =>
      this.store.appendDatasetBatch(artifactId, rows, options)
    );
  }

  async getDatasetRows(artifactId: string): Promise<Record<string, unknown>[]> {
    return this.scheduleOperation(artifactId, () => this.store.getDatasetRows(artifactId));
  }

  // ============================================================================
  // Common Methods
  // ============================================================================

  /**
   * Get artifact metadata (scheduled for consistency)
   */
  async getArtifact(artifactId: string): Promise<StoredArtifact | null> {
    return this.scheduleOperation(artifactId, () => this.store.getArtifact(artifactId));
  }

  /**
   * List all artifacts for a task (no scheduling - read-only query)
   */
  async getTaskArtifacts(taskId: string): Promise<string[]> {
    return this.store.getTaskArtifacts(taskId);
  }

  /**
   * Query artifacts by context (no scheduling - read-only query)
   */
  async queryArtifacts(params: { contextId: string; taskId?: string }): Promise<string[]> {
    return this.store.queryArtifacts(params);
  }

  /**
   * Get artifact by context (scheduled for consistency)
   */
  async getArtifactByContext(
    contextId: string,
    artifactId: string
  ): Promise<StoredArtifact | null> {
    return this.scheduleOperation(artifactId, () =>
      this.store.getArtifactByContext(contextId, artifactId)
    );
  }

  /**
   * Delete an artifact (scheduled)
   */
  async deleteArtifact(artifactId: string): Promise<void> {
    return this.scheduleOperation(artifactId, () => this.store.deleteArtifact(artifactId));
  }

  // ============================================================================
  // Legacy Methods (scheduled)
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
    const method = this.store.createArtifact;
    if (!method) {
      throw new Error('createArtifact is not implemented in underlying store');
    }
    return this.scheduleOperation(params.artifactId, () => method.call(this.store, params));
  }

  /**
   * @deprecated Use getFileContent, getDataContent, or getDatasetRows
   */
  async getArtifactContent(
    artifactId: string
  ): Promise<string | Record<string, unknown> | Record<string, unknown>[]> {
    const method = this.store.getArtifactContent;
    if (!method) {
      throw new Error('getArtifactContent is not implemented in underlying store');
    }
    return this.scheduleOperation(artifactId, () => method.call(this.store, artifactId));
  }

  /**
   * @deprecated Use type-specific methods
   */
  async appendPart(
    artifactId: string,
    part: Omit<ArtifactPart, 'index'>,
    isLastChunk?: boolean
  ): Promise<void> {
    const method = this.store.appendPart;
    if (!method) {
      throw new Error('appendPart is not implemented in underlying store');
    }
    return this.scheduleOperation(artifactId, () =>
      method.call(this.store, artifactId, part, isLastChunk)
    );
  }

  // ============================================================================
  // Scheduler Implementation
  // ============================================================================

  /**
   * Schedule an operation to run sequentially for the given artifactId
   *
   * Operations on the same artifactId are queued and executed one at a time.
   * Operations on different artifactIds run in parallel.
   */
  private scheduleOperation<T>(artifactId: string, operation: Operation<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      // Get or create queue for this artifact
      if (!this.queues.has(artifactId)) {
        this.queues.set(artifactId, []);
      }

      const queue = this.queues.get(artifactId);
      if (!queue) {
        reject(new Error(`Failed to get queue for artifact ${artifactId}`));
        return;
      }

      // Add operation to queue
      queue.push({ operation, resolve, reject } as QueuedOperation<unknown>);

      // Start processing if not already running
      if (!this.processing.get(artifactId)) {
        this.processQueue(artifactId);
      }
    });
  }

  /**
   * Process all queued operations for an artifact sequentially
   */
  private async processQueue(artifactId: string): Promise<void> {
    this.processing.set(artifactId, true);

    const queue = this.queues.get(artifactId);
    if (!queue) {
      this.processing.set(artifactId, false);
      return;
    }

    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) {
        break;
      }

      try {
        const result = await item.operation();
        item.resolve(result);
      } catch (error) {
        item.reject(error as Error);
      }
    }

    // Cleanup
    this.processing.set(artifactId, false);
    if (queue.length === 0) {
      this.queues.delete(artifactId);
      this.processing.delete(artifactId);
    }
  }
}
