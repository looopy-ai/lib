/**
 * Artifact type discriminator
 */
export type ArtifactType = 'file' | 'data' | 'dataset';

/**
 * Artifact store interface
 *
 * Supports three types of artifacts:
 * - file: Text or binary files with chunked streaming
 * - data: Structured JSON data (atomic updates)
 * - dataset: Tabular data with batch streaming (rows)
 */
export interface ArtifactStore {
  /**
   * Create a new file artifact
   */
  createFileArtifact(params: {
    artifactId: string;
    taskId: string;
    contextId: string;
    name?: string;
    description?: string;
    mimeType?: string;
    encoding?: 'utf-8' | 'base64';
    override?: boolean;
  }): Promise<string>;

  /**
   * Create a new data artifact
   */
  createDataArtifact(params: {
    artifactId: string;
    taskId: string;
    contextId: string;
    name?: string;
    description?: string;
    override?: boolean;
  }): Promise<string>;

  /**
   * Create a new dataset artifact
   */
  createDatasetArtifact(params: {
    artifactId: string;
    taskId: string;
    contextId: string;
    name?: string;
    description?: string;
    schema?: DatasetSchema;
    override?: boolean;
  }): Promise<string>;

  /**
   * Append a chunk to a file artifact (streaming)
   * Requires contextId to ensure artifact exists within the context
   */
  appendFileChunk(
    contextId: string,
    artifactId: string,
    chunk: string,
    options?: {
      isLastChunk?: boolean;
      encoding?: 'utf-8' | 'base64';
    },
  ): Promise<void>;

  /**
   * Write or update data artifact (atomic)
   * Requires contextId to ensure artifact exists within the context
   */
  writeData(contextId: string, artifactId: string, data: Record<string, unknown>): Promise<void>;

  /**
   * Append a batch of rows to a dataset artifact (streaming)
   * Requires contextId to ensure artifact exists within the context
   */
  appendDatasetBatch(
    contextId: string,
    artifactId: string,
    rows: Record<string, unknown>[],
    options?: {
      isLastBatch?: boolean;
    },
  ): Promise<void>;

  /**
   * Get artifact metadata (context-scoped lookup)
   * Requires contextId to ensure artifact exists within the context
   */
  getArtifact(contextId: string, artifactId: string): Promise<StoredArtifact | null>;

  /**
   * Get file artifact content (full text)
   * Requires contextId to ensure artifact exists within the context
   */
  getFileContent(contextId: string, artifactId: string): Promise<string>;

  /**
   * Get data artifact content
   * Requires contextId to ensure artifact exists within the context
   */
  getDataContent(contextId: string, artifactId: string): Promise<Record<string, unknown>>;

  /**
   * Get dataset artifact rows
   * Requires contextId to ensure artifact exists within the context
   */
  getDatasetRows(contextId: string, artifactId: string): Promise<Record<string, unknown>[]>;

  /**
   * List all artifacts for a context
   * Optionally filter by taskId within that context
   */
  listArtifacts(contextId: string, taskId?: string): Promise<string[]>;

  /**
   * Delete an artifact and its external storage
   * Requires contextId to ensure artifact exists within the context
   */
  deleteArtifact(contextId: string, artifactId: string): Promise<void>;
}

/**
 * Dataset schema definition
 */
export interface DatasetSchema {
  columns: DatasetColumn[];
  primaryKey?: string[];
  indexes?: string[][];
}

export interface DatasetColumn {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'date' | 'json' | 'null';
  nullable?: boolean;
  description?: string;
}

/**
 * Base artifact with shared properties across all artifact types
 */
export interface BaseArtifact {
  artifactId: string;
  taskId: string;
  contextId: string;
  name?: string;
  description?: string;
  status: 'building' | 'complete' | 'failed';
  version: number;
  operations: ArtifactOperation[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;

  // External storage reference (for large files/datasets)
  externalStorage?: {
    provider: 'local' | 's3' | 'gcs' | 'azure';
    key: string;
    bucket?: string;
    region?: string;
    checksum?: string;
  };
}

/**
 * File artifact - stores text or binary content as chunks (for streaming)
 */
export interface FileArtifact extends BaseArtifact {
  type: 'file';
  chunks: ArtifactChunk[];
  mimeType?: string;
  encoding?: 'utf-8' | 'base64';
  totalChunks: number; // Number of chunks
  totalSize: number; // Total bytes
}

/**
 * Data artifact - stores a single JSON object with atomic updates
 */
export interface DataArtifact extends BaseArtifact {
  type: 'data';
  data: Record<string, unknown>;
}

/**
 * Dataset artifact - stores tabular data as rows (batch streaming)
 */
export interface DatasetArtifact extends BaseArtifact {
  type: 'dataset';
  rows: Record<string, unknown>[];
  schema?: DatasetSchema;
  totalChunks: number; // Number of batches
  totalSize: number; // Total rows
}

/**
 * Discriminated union of all artifact types
 *
 * Use type narrowing to access type-specific properties:
 * ```
 * if (artifact.type === 'file') {
 *   console.log(artifact.chunks); // TypeScript knows chunks exists
 * }
 * ```
 */
export type StoredArtifact = FileArtifact | DataArtifact | DatasetArtifact;

/**
 * Artifact chunk (for file streaming)
 */
export interface ArtifactChunk {
  index: number;
  data: string;
  size: number;
  checksum?: string;
  timestamp: string;
}

/**
 * Artifact part
 */
export interface ArtifactPart {
  index: number;
  kind: 'text' | 'file' | 'data';
  content?: string;
  data?: Record<string, unknown>;
  fileReference?: {
    storageKey: string;
    size: number;
    checksum?: string;
  };
  metadata?: {
    mimeType?: string;
    fileName?: string;
    [key: string]: unknown;
  };
}

/**
 * Artifact operation
 */
export interface ArtifactOperation {
  operationId: string;
  type: 'create' | 'append' | 'replace' | 'complete' | 'reset';
  timestamp: string;
  partIndex?: number;
  chunkIndex?: number;
  replacedPartIndexes?: number[];
}
