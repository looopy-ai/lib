/**
 * Core Agent Loop Types and Interfaces
 *
 * Design Reference: design/agent-loop.md
 */

import type { Observable } from 'rxjs';

/**
 * Context passed to agent loop execution
 */
export interface Context {
  taskId?: string;
  agentId: string;
  contextId: string;
  parentTaskId?: string;
  systemPrompt?: string;
  maxIterations?: number;
  traceContext?: TraceContext;
  authContext?: AuthContext;
  messages?: Message[]; // Full conversation history (optional, for Agent integration)
  metadata?: Record<string, unknown>;
}

/**
 * Trace context for distributed tracing
 */
export interface TraceContext {
  traceId: string;
  spanId: string;
  traceFlags?: number;
  traceState?: string;
}

/**
 * Authentication context
 */
export interface AuthContext {
  userId?: string;
  credentials?: Record<string, unknown>;
  scopes?: string[];
}

/**
 * Message in the conversation
 */
export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  toolCallId?: string;
  toolCalls?: ToolCall[]; // For assistant messages that make tool calls
}

/**
 * Tool definition
 *
 * Note: LLM providers may need to wrap this in provider-specific formats
 * (e.g., OpenAI requires { type: 'function', function: {...} })
 */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
}

/**
 * Tool call from LLM
 */
export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: Record<string, unknown>;
  };
}

/**
 * Result of tool execution
 */
export interface ToolResult {
  toolCallId: string;
  toolName: string;
  success: boolean;
  result: unknown;
  error?: string;
}

/**
 * LLM response
 */
export interface LLMResponse {
  message: Message;
  toolCalls?: ToolCall[];
  finished: boolean;
  finishReason?: 'stop' | 'length' | 'tool_calls' | 'content_filter';
  model?: string; // Model used for this response
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
}

/**
 * Internal loop state
 */
export interface LoopState {
  taskId: string;
  agentId: string;
  parentTaskId?: string;
  contextId: string;

  messages: Message[];
  systemPrompt: string;
  availableTools: ToolDefinition[];
  toolResults: Map<string, ToolResult>;

  subAgents: SubAgentState[];
  activeSubAgents: Set<string>;

  completed: boolean;
  iteration: number;
  maxIterations: number;

  context: Context;
  traceContext?: TraceContext;
  authContext?: AuthContext;

  lastLLMResponse?: LLMResponse;

  // Injected dependencies
  taskStateStore: TaskStateStore;
  artifactStore: ArtifactStore;
}

/**
 * Sub-agent state tracking
 */
export interface SubAgentState {
  agentId: string;
  taskId: string;
  status: 'running' | 'completed' | 'failed';
  result?: unknown;
  error?: string;
}

/**
 * Task state as defined by A2A protocol
 */
export type TaskState =
  | 'submitted'
  | 'working'
  | 'input-required'
  | 'completed'
  | 'canceled'
  | 'failed'
  | 'rejected'
  | 'auth-required'
  | 'unknown';

/**
 * Task status for A2A protocol
 */
export interface TaskStatus {
  state: TaskState;
  message?: Message;
  timestamp?: string; // ISO 8601
}

/**
 * Part types for A2A protocol artifacts
 */
export type A2APart = A2ATextPart | A2AFilePart | A2ADataPart;

export interface A2ATextPart {
  kind: 'text';
  text: string;
  metadata?: Record<string, unknown>;
}

export interface A2AFilePart {
  kind: 'file';
  file: {
    name?: string;
    mimeType?: string;
    bytes?: string; // Base64 encoded
    uri?: string;
  };
  metadata?: Record<string, unknown>;
}

export interface A2ADataPart {
  kind: 'data';
  data: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

/**
 * A2A Artifact structure
 */
export interface A2AArtifact {
  artifactId: string;
  name?: string;
  description?: string;
  parts: A2APart[];
  metadata?: Record<string, unknown>;
  extensions?: string[];
}

/**
 * Events emitted during agent loop execution
 * Now using the internal event protocol (design/internal-event-protocol.md)
 *
 * AgentEvent is a union of all internal events from the event protocol.
 * This includes both external events (sent to clients) and internal events (debug/observability).
 */
export type AgentEvent = import('../events').InternalEvent;

/**
 * @deprecated Legacy A2A protocol types - kept for backward compatibility
 * Use the new internal event protocol types from src/events instead
 */

/**
 * Initial task response (A2A protocol) - DEPRECATED
 * @deprecated Use TaskCreatedEvent from src/events instead
 */
export interface TaskEvent {
  kind: 'task';
  id: string;
  contextId: string;
  status: TaskStatus;
  history?: Message[];
  artifacts?: A2AArtifact[];
  metadata?: Record<string, unknown>;
}

/**
 * Status update event (A2A protocol) - DEPRECATED
 * @deprecated Use TaskStatusEvent or TaskCompleteEvent from src/events instead
 */
export interface StatusUpdateEvent {
  kind: 'status-update';
  taskId: string;
  contextId: string;
  status: TaskStatus;
  final: boolean; // true if last event in stream
  metadata?: Record<string, unknown>;
}

/**
 * Artifact update event (A2A protocol) - DEPRECATED
 * @deprecated Use FileWriteEvent, DataWriteEvent, or DatasetWriteEvent from src/events instead
 */
export interface ArtifactUpdateEvent {
  kind: 'artifact-update';
  taskId: string;
  contextId: string;
  artifact: A2AArtifact;
  append?: boolean; // If true, append to existing artifact
  lastChunk?: boolean; // If true, final chunk of artifact
  metadata?: Record<string, unknown>;
}

/**
 * Internal events for observability (not sent over A2A)
 * These provide additional debugging/monitoring info
 */
export type InternalEvent =
  | {
      kind: 'internal:llm-call';
      taskId: string;
      iteration: number;
      timestamp: string;
    }
  | {
      kind: 'internal:tool-start';
      taskId: string;
      toolName: string;
      toolCallId: string;
      timestamp: string;
    }
  | {
      kind: 'internal:tool-complete';
      taskId: string;
      toolCallId: string;
      success: boolean;
      timestamp: string;
    }
  | {
      kind: 'internal:checkpoint';
      taskId: string;
      iteration: number;
      timestamp: string;
    };

/**
 * LLM Provider interface
 */
export interface LLMProvider {
  call(request: {
    messages: Message[];
    tools?: ToolDefinition[];
    stream?: boolean;
    sessionId?: string;
  }): Observable<LLMResponse>;
}

/**
 * Tool Provider interface
 */
export interface ToolProvider {
  getTools(): Promise<ToolDefinition[]>;
  execute(toolCall: ToolCall, context: ExecutionContext): Promise<ToolResult>;
  canHandle(toolName: string): boolean;
  supportsBatch?: boolean;
  executeBatch?(toolCalls: ToolCall[], context: ExecutionContext): Promise<ToolResult[]>;
}

/**
 * Execution context passed to tools
 */
export interface ExecutionContext {
  taskId: string;
  contextId: string;
  agentId: string;
  traceContext?: TraceContext;
  authContext?: AuthContext;
  metadata?: Record<string, unknown>;
}

/**
 * Task state store interface
 *
 * Manages per-task checkpoint state for AgentLoop resumption after crashes.
 * This is separate from ContextStore (session-level) and MessageStore (conversation history).
 *
 * Use case: Resume mid-turn execution after server restart during LLM reasoning loop.
 */
export interface TaskStateStore {
  save(taskId: string, state: PersistedLoopState): Promise<void>;
  load(taskId: string): Promise<PersistedLoopState | null>;
  exists(taskId: string): Promise<boolean>;
  delete(taskId: string): Promise<void>;
  listTasks(filter?: {
    agentId?: string;
    contextId?: string;
    completedAfter?: Date;
  }): Promise<string[]>;
  setTTL(taskId: string, ttlSeconds: number): Promise<void>;
}

/**
 * Persisted loop state for resumption
 */
export interface PersistedLoopState {
  taskId: string;
  agentId: string;
  parentTaskId?: string;
  contextId: string;

  messages: Message[];
  systemPrompt: string;
  iteration: number;
  completed: boolean;

  availableTools: ToolDefinition[];
  pendingToolCalls: ToolCall[];
  completedToolCalls: Record<string, ToolResult>;

  artifactIds: string[];

  activeSubAgents: SubAgentState[];

  lastLLMResponse?: LLMResponse;
  lastActivity: string;

  resumeFrom: 'llm-call' | 'tool-execution' | 'sub-agent' | 'completed';
  checkpointMetadata?: Record<string, unknown>;
}

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
  }): Promise<string>;

  /**
   * Append a chunk to a file artifact (streaming)
   */
  appendFileChunk(
    artifactId: string,
    chunk: string,
    options?: {
      isLastChunk?: boolean;
      encoding?: 'utf-8' | 'base64';
    }
  ): Promise<void>;

  /**
   * Write or update data artifact (atomic)
   */
  writeData(artifactId: string, data: Record<string, unknown>): Promise<void>;

  /**
   * Append a batch of rows to a dataset artifact (streaming)
   */
  appendDatasetBatch(
    artifactId: string,
    rows: Record<string, unknown>[],
    options?: {
      isLastBatch?: boolean;
    }
  ): Promise<void>;

  /**
   * Get artifact metadata
   */
  getArtifact(artifactId: string): Promise<StoredArtifact | null>;

  /**
   * Get file artifact content (full text)
   */
  getFileContent(artifactId: string): Promise<string>;

  /**
   * Get data artifact content
   */
  getDataContent(artifactId: string): Promise<Record<string, unknown>>;

  /**
   * Get dataset artifact rows
   */
  getDatasetRows(artifactId: string): Promise<Record<string, unknown>[]>;

  /**
   * List all artifacts for a task
   */
  getTaskArtifacts(taskId: string): Promise<string[]>;

  /**
   * Query artifacts by context and optional task
   */
  queryArtifacts(params: { contextId: string; taskId?: string }): Promise<string[]>;

  /**
   * Get artifact by context (scoped lookup)
   */
  getArtifactByContext(contextId: string, artifactId: string): Promise<StoredArtifact | null>;

  /**
   * Delete an artifact and its external storage
   */
  deleteArtifact(artifactId: string): Promise<void>;

  // Legacy methods for backward compatibility
  /** @deprecated Use createFileArtifact, createDataArtifact, or createDatasetArtifact instead */
  createArtifact?(params: {
    artifactId: string;
    taskId: string;
    contextId: string;
    type: ArtifactType;
    name?: string;
    description?: string;
    mimeType?: string;
    schema?: DatasetSchema;
  }): Promise<string>;

  /** @deprecated Use getFileContent, getDataContent, or getDatasetRows instead */
  getArtifactContent?(
    artifactId: string
  ): Promise<string | Record<string, unknown> | Record<string, unknown>[]>;

  /** @deprecated Use appendFileChunk, writeData, or appendDatasetBatch instead */
  appendPart?(
    artifactId: string,
    part: Omit<ArtifactPart, 'index'>,
    isLastChunk?: boolean
  ): Promise<void>;

  /** @deprecated Use type-specific methods instead */
  getArtifactParts?(artifactId: string, resolveExternal?: boolean): Promise<ArtifactPart[]>;

  /** @deprecated Use type-specific methods instead */
  replacePart?(
    artifactId: string,
    partIndex: number,
    part: Omit<ArtifactPart, 'index'>
  ): Promise<void>;

  /** @deprecated Use type-specific methods instead */
  replaceParts?(
    artifactId: string,
    parts: Omit<ArtifactPart, 'index'>[],
    isLastChunk?: boolean
  ): Promise<void>;
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
  type: 'create' | 'append' | 'replace' | 'complete';
  timestamp: string;
  partIndex?: number;
  chunkIndex?: number;
  replacedPartIndexes?: number[];
}

/**
 * Context/Session state for agent instances
 *
 * This represents the persistent state of an agent conversation session,
 * separate from individual turn state (PersistedLoopState) and messages.
 */
export interface ContextState {
  contextId: string;
  agentId: string;

  // Metadata for discovery and organization
  title?: string; // Auto-generated or user-provided
  description?: string;
  tags?: string[]; // For categorization and search

  // Lifecycle
  status: 'active' | 'paused' | 'locked' | 'completed' | 'abandoned';
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
  lastActivityAt: string; // ISO 8601

  // Turn tracking
  turnCount: number;
  currentTurnId?: string; // If a turn is in progress

  // Pending operations (for resumption)
  pendingToolCalls?: ToolCall[]; // Awaiting client response
  pendingSubAgents?: string[]; // Sub-agent task IDs in progress

  // Locking (for concurrency control)
  lockedBy?: string; // Instance/process ID that owns the lock
  lockedAt?: string; // ISO 8601
  lockExpiresAt?: string; // ISO 8601 (auto-release after timeout)

  // Access control
  ownerId?: string; // Primary user/tenant
  sharedWith?: string[]; // Other users with access
  permissions?: Record<string, string[]>; // userId -> ['read', 'write', etc.]

  // Configuration
  systemPrompt?: string;
  preferredModel?: string;

  // Statistics
  messageCount?: number;
  artifactCount?: number;
  totalTokensUsed?: number;

  // Custom metadata
  metadata?: Record<string, unknown>;
}

/**
 * Context store interface
 *
 * Manages session-level state for agent contexts, including metadata,
 * locking, and lifecycle management.
 */
export interface ContextStore {
  /**
   * Save or update context state
   */
  save(state: ContextState): Promise<void>;

  /**
   * Load context state
   */
  load(contextId: string): Promise<ContextState | null>;

  /**
   * Check if context exists
   */
  exists(contextId: string): Promise<boolean>;

  /**
   * Delete context (cleanup)
   */
  delete(contextId: string): Promise<void>;

  /**
   * List contexts with filtering
   */
  list(filter?: {
    agentId?: string;
    ownerId?: string;
    status?: ContextState['status'];
    tags?: string[];
    createdAfter?: Date;
    createdBefore?: Date;
    updatedAfter?: Date;
    limit?: number;
    offset?: number;
  }): Promise<ContextState[]>;

  /**
   * Search contexts by title/description
   */
  search(query: string, filter?: { agentId?: string; ownerId?: string }): Promise<ContextState[]>;

  /**
   * Acquire lock on context (for concurrency control)
   * Returns true if lock acquired, false if already locked
   */
  acquireLock(contextId: string, lockOwnerId: string, ttlSeconds?: number): Promise<boolean>;

  /**
   * Release lock on context
   */
  releaseLock(contextId: string, lockOwnerId: string): Promise<void>;

  /**
   * Refresh lock (extend expiry)
   */
  refreshLock(contextId: string, lockOwnerId: string, ttlSeconds?: number): Promise<boolean>;

  /**
   * Check if context is locked
   */
  isLocked(contextId: string): Promise<boolean>;

  /**
   * Update specific fields (partial update)
   */
  update(
    contextId: string,
    updates: Partial<Omit<ContextState, 'contextId' | 'agentId' | 'createdAt'>>
  ): Promise<void>;
}
