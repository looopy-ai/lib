/**
 * Stored artifact with multi-part composition
 */
export interface StoredArtifact {
  artifactId: string;
  taskId: string;
  contextId: string;

  // Metadata
  name?: string;
  description?: string;
  mimeType?: string;

  // Parts composition
  parts: ArtifactPart[];
  totalParts: number;

  // Versioning
  version: number;
  operations: ArtifactOperation[];

  // Lifecycle
  status: 'building' | 'complete' | 'failed';
  createdAt: string;
  updatedAt: string;
  completedAt?: string;

  // Storage
  storageBackend: 'redis' | 's3' | 'local';
  storageKey?: string;

  // Streaming state
  lastChunkIndex: number;
  isLastChunk: boolean;
}

export interface ArtifactPart {
  index: number;
  kind: 'text' | 'file' | 'data';
  content?: string;
  data?: Record<string, unknown>;
  fileReference?: {
    storageKey: string;
    size: number;
    mimeType: string;
    checksum?: string;
  };
  metadata?: Record<string, unknown>;
}

export interface ArtifactOperation {
  operationId: string;
  type: 'create' | 'append' | 'replace' | 'complete';
  timestamp: string;
  partIndex?: number;
  chunkIndex?: number;
  replacedPartIndexes?: number[];
}

/**
 * Artifact store interface for multi-part artifact management
 *
 * Implementations:
 * - RedisArtifactStore: Hybrid Redis/S3 storage
 * - InMemoryArtifactStore: Testing and development
 */
export interface ArtifactStore {
  /**
   * Create a new artifact
   *
   * @param params.artifactId - Unique identifier for the artifact (provided by the LLM/client)
   */
  createArtifact(params: {
    artifactId: string;
    taskId: string;
    contextId: string;
    name?: string;
    description?: string;
    mimeType?: string;
  }): Promise<string>;

  /**
   * Append a new part to an artifact
   */
  appendPart(
    artifactId: string,
    part: Omit<ArtifactPart, 'index'>,
    isLastChunk?: boolean
  ): Promise<void>;

  /**
   * Replace a specific part in an artifact
   */
  replacePart(
    artifactId: string,
    partIndex: number,
    part: Omit<ArtifactPart, 'index'>
  ): Promise<void>;

  /**
   * Replace all parts in an artifact
   *
   * Used when parts are grouped and concatenated by kind.
   */
  replaceParts(
    artifactId: string,
    parts: Omit<ArtifactPart, 'index'>[],
    isLastChunk?: boolean
  ): Promise<void>;

  /**
   * Get artifact metadata
   */
  getArtifact(artifactId: string): Promise<StoredArtifact | null>;

  /**
   * Get artifact parts with optional external resolution
   */
  getArtifactParts(artifactId: string, resolveExternal?: boolean): Promise<ArtifactPart[]>;

  /**
   * List all artifacts for a task
   */
  getTaskArtifacts(taskId: string): Promise<string[]>;

  /**
   * Delete an artifact and its external storage
   */
  deleteArtifact(artifactId: string): Promise<void>;

  /**
   * Get artifact content as a complete string or object
   */
  getArtifactContent(artifactId: string): Promise<string | object>;
}
