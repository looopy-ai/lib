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

import type { ArtifactStore, DatasetSchema, StoredArtifact } from '../../core/types';

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
    contextId: string,
    artifactId: string,
    chunk: string,
    options?: { isLastChunk?: boolean; encoding?: 'utf-8' | 'base64' },
  ): Promise<void> {
    return this.scheduleOperation(artifactId, () =>
      this.store.appendFileChunk(contextId, artifactId, chunk, options),
    );
  }

  async getFileContent(contextId: string, artifactId: string): Promise<string> {
    return this.scheduleOperation(artifactId, () =>
      this.store.getFileContent(contextId, artifactId),
    );
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

  async writeData(
    contextId: string,
    artifactId: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    return this.scheduleOperation(artifactId, () =>
      this.store.writeData(contextId, artifactId, data),
    );
  }

  async getDataContent(contextId: string, artifactId: string): Promise<Record<string, unknown>> {
    return this.scheduleOperation(artifactId, () =>
      this.store.getDataContent(contextId, artifactId),
    );
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
      this.store.createDatasetArtifact(params),
    );
  }

  async appendDatasetBatch(
    contextId: string,
    artifactId: string,
    rows: Record<string, unknown>[],
    options?: { isLastBatch?: boolean },
  ): Promise<void> {
    return this.scheduleOperation(artifactId, () =>
      this.store.appendDatasetBatch(contextId, artifactId, rows, options),
    );
  }

  async getDatasetRows(contextId: string, artifactId: string): Promise<Record<string, unknown>[]> {
    return this.scheduleOperation(artifactId, () =>
      this.store.getDatasetRows(contextId, artifactId),
    );
  }

  // ============================================================================
  // Common Methods
  // ============================================================================

  /**
   * Get artifact metadata (scheduled for consistency)
   */
  async getArtifact(contextId: string, artifactId: string): Promise<StoredArtifact | null> {
    return this.scheduleOperation(artifactId, () => this.store.getArtifact(contextId, artifactId));
  }

  /**
   * List all artifacts for a context, optionally filtered by task (no scheduling - read-only query)
   */
  async listArtifacts(contextId: string, taskId?: string): Promise<string[]> {
    return this.store.listArtifacts(contextId, taskId);
  }

  /**
   * Delete an artifact (scheduled)
   */
  async deleteArtifact(contextId: string, artifactId: string): Promise<void> {
    return this.scheduleOperation(artifactId, () =>
      this.store.deleteArtifact(contextId, artifactId),
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
