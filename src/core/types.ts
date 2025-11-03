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
  stateStore: StateStore;
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
 * Aligned with A2A protocol event types
 */
export type AgentEvent = TaskEvent | StatusUpdateEvent | ArtifactUpdateEvent | InternalEvent;

/**
 * Initial task response (A2A protocol)
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
 * Status update event (A2A protocol)
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
 * Artifact update event (A2A protocol)
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
 * State store interface
 */
export interface StateStore {
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
 * Artifact store interface
 */
export interface ArtifactStore {
  createArtifact(params: {
    artifactId: string;
    taskId: string;
    contextId: string;
    name?: string;
    description?: string;
  }): Promise<string>;

  appendPart(
    artifactId: string,
    part: Omit<ArtifactPart, 'index'>,
    isLastChunk?: boolean
  ): Promise<void>;

  replacePart(
    artifactId: string,
    partIndex: number,
    part: Omit<ArtifactPart, 'index'>
  ): Promise<void>;

  replaceParts(
    artifactId: string,
    parts: Omit<ArtifactPart, 'index'>[],
    isLastChunk?: boolean
  ): Promise<void>;

  getArtifact(artifactId: string): Promise<StoredArtifact | null>;
  getArtifactParts(artifactId: string, resolveExternal?: boolean): Promise<ArtifactPart[]>;
  getTaskArtifacts(taskId: string): Promise<string[]>;
  queryArtifacts(params: { contextId: string; taskId?: string }): Promise<string[]>;
  getArtifactByContext(contextId: string, artifactId: string): Promise<StoredArtifact | null>;
  deleteArtifact(artifactId: string): Promise<void>;
  getArtifactContent(artifactId: string): Promise<string | object>;
}

/**
 * Stored artifact
 */
export interface StoredArtifact {
  artifactId: string;
  taskId: string;
  contextId: string;
  name?: string;
  description?: string;
  parts: ArtifactPart[];
  totalParts: number;
  version: number;
  operations: ArtifactOperation[];
  status: 'building' | 'complete' | 'failed';
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  lastChunkIndex: number;
  isLastChunk: boolean;
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
