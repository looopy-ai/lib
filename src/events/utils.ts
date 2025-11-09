/**
 * Event Utility Functions
 *
 * Helper functions for creating and manipulating internal events.
 *
 * Design: design/internal-event-protocol.md
 */

import type {
  AnyEvent,
  AuthCompletedEvent,
  AuthRequiredEvent,
  AuthType,
  ContentCompleteEvent,
  ContentDeltaEvent,
  DatasetWriteEvent,
  DataWriteEvent,
  FileWriteEvent,
  InputProvider,
  InputReceivedEvent,
  InputRequiredEvent,
  InputType,
  InternalCheckpointEvent,
  InternalLLMCallEvent,
  InternalThoughtProcessEvent,
  JSONSchema,
  SubtaskCreatedEvent,
  TaskCompleteEvent,
  TaskCreatedEvent,
  TaskInitiator,
  TaskStatus,
  TaskStatusEvent,
  ThoughtStreamEvent,
  ThoughtType,
  ThoughtVerbosity,
  ToolCompleteEvent,
  ToolProgressEvent,
  ToolStartEvent,
} from './types';

// ============================================================================
// ID Generation
// ============================================================================

/**
 * Generate a unique ID for events
 */
export function generateEventId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

// ============================================================================
// Task Lifecycle Event Creators
// ============================================================================

export interface CreateTaskCreatedEventOptions {
  contextId: string;
  taskId: string;
  parentTaskId?: string;
  initiator: TaskInitiator;
  metadata?: {
    agentId?: string;
    model?: string;
    [key: string]: unknown;
  };
}

export function createTaskCreatedEvent(options: CreateTaskCreatedEventOptions): TaskCreatedEvent {
  return {
    kind: 'task-created',
    contextId: options.contextId,
    taskId: options.taskId,
    parentTaskId: options.parentTaskId,
    initiator: options.initiator,
    timestamp: new Date().toISOString(),
    metadata: options.metadata,
  };
}

export interface CreateTaskStatusEventOptions {
  contextId: string;
  taskId: string;
  status: TaskStatus;
  message?: string;
  metadata?: {
    reason?: string;
    blockedBy?: string;
    [key: string]: unknown;
  };
}

export function createTaskStatusEvent(options: CreateTaskStatusEventOptions): TaskStatusEvent {
  return {
    kind: 'task-status',
    contextId: options.contextId,
    taskId: options.taskId,
    status: options.status,
    message: options.message,
    timestamp: new Date().toISOString(),
    metadata: options.metadata,
  };
}

export interface CreateTaskCompleteEventOptions {
  contextId: string;
  taskId: string;
  content?: string;
  artifacts?: string[];
  metadata?: {
    duration?: number;
    iterations?: number;
    tokensUsed?: number;
    [key: string]: unknown;
  };
}

export function createTaskCompleteEvent(
  options: CreateTaskCompleteEventOptions
): TaskCompleteEvent {
  return {
    kind: 'task-complete',
    contextId: options.contextId,
    taskId: options.taskId,
    content: options.content,
    artifacts: options.artifacts,
    timestamp: new Date().toISOString(),
    metadata: options.metadata,
  };
}

// ============================================================================
// Content Streaming Event Creators
// ============================================================================

export interface CreateContentDeltaEventOptions {
  contextId: string;
  taskId: string;
  delta: string;
  index: number;
}

export function createContentDeltaEvent(
  options: CreateContentDeltaEventOptions
): ContentDeltaEvent {
  return {
    kind: 'content-delta',
    contextId: options.contextId,
    taskId: options.taskId,
    delta: options.delta,
    index: options.index,
    timestamp: new Date().toISOString(),
  };
}

export interface CreateContentCompleteEventOptions {
  contextId: string;
  taskId: string;
  content: string;
}

export function createContentCompleteEvent(
  options: CreateContentCompleteEventOptions
): ContentCompleteEvent {
  return {
    kind: 'content-complete',
    contextId: options.contextId,
    taskId: options.taskId,
    content: options.content,
    timestamp: new Date().toISOString(),
  };
}

// ============================================================================
// Tool Execution Event Creators
// ============================================================================

export interface CreateToolStartEventOptions {
  contextId: string;
  taskId: string;
  toolCallId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  metadata?: {
    provider?: string;
    concurrent?: boolean;
    [key: string]: unknown;
  };
}

export function createToolStartEvent(options: CreateToolStartEventOptions): ToolStartEvent {
  return {
    kind: 'tool-start',
    contextId: options.contextId,
    taskId: options.taskId,
    toolCallId: options.toolCallId,
    toolName: options.toolName,
    arguments: options.arguments,
    timestamp: new Date().toISOString(),
    metadata: options.metadata,
  };
}

export interface CreateToolProgressEventOptions {
  contextId: string;
  taskId: string;
  toolCallId: string;
  progress: number;
  message?: string;
  metadata?: {
    step?: string;
    stepsCompleted?: number;
    stepsTotal?: number;
    [key: string]: unknown;
  };
}

export function createToolProgressEvent(
  options: CreateToolProgressEventOptions
): ToolProgressEvent {
  return {
    kind: 'tool-progress',
    contextId: options.contextId,
    taskId: options.taskId,
    toolCallId: options.toolCallId,
    progress: options.progress,
    message: options.message,
    timestamp: new Date().toISOString(),
    metadata: options.metadata,
  };
}

export interface CreateToolCompleteEventOptions {
  contextId: string;
  taskId: string;
  toolCallId: string;
  toolName: string;
  success: boolean;
  result?: unknown;
  error?: string;
  metadata?: {
    duration?: number;
    cached?: boolean;
    retries?: number;
    [key: string]: unknown;
  };
}

export function createToolCompleteEvent(
  options: CreateToolCompleteEventOptions
): ToolCompleteEvent {
  return {
    kind: 'tool-complete',
    contextId: options.contextId,
    taskId: options.taskId,
    toolCallId: options.toolCallId,
    toolName: options.toolName,
    success: options.success,
    result: options.result,
    error: options.error,
    timestamp: new Date().toISOString(),
    metadata: options.metadata,
  };
}

// ============================================================================
// Input Request Event Creators
// ============================================================================

export interface CreateInputRequiredEventOptions {
  contextId: string;
  taskId: string;
  inputId: string;
  requireUser?: boolean;
  inputType: InputType;
  prompt: string;
  schema?: JSONSchema;
  options?: unknown[];
  metadata?: Record<string, unknown>;
}

export function createInputRequiredEvent(
  options: CreateInputRequiredEventOptions
): InputRequiredEvent {
  return {
    kind: 'input-required',
    contextId: options.contextId,
    taskId: options.taskId,
    inputId: options.inputId,
    requireUser: options.requireUser,
    inputType: options.inputType,
    prompt: options.prompt,
    schema: options.schema,
    options: options.options,
    timestamp: new Date().toISOString(),
    metadata: options.metadata,
  };
}

export interface CreateInputReceivedEventOptions {
  contextId: string;
  taskId: string;
  inputId: string;
  providedBy: InputProvider;
  userId?: string;
  agentId?: string;
  metadata?: {
    duration?: number;
    [key: string]: unknown;
  };
}

export function createInputReceivedEvent(
  options: CreateInputReceivedEventOptions
): InputReceivedEvent {
  return {
    kind: 'input-received',
    contextId: options.contextId,
    taskId: options.taskId,
    inputId: options.inputId,
    providedBy: options.providedBy,
    userId: options.userId,
    agentId: options.agentId,
    timestamp: new Date().toISOString(),
    metadata: options.metadata,
  };
}

// ============================================================================
// Authentication Event Creators
// ============================================================================

export interface CreateAuthRequiredEventOptions {
  contextId: string;
  taskId: string;
  authId: string;
  authType: AuthType;
  provider?: string;
  scopes?: string[];
  prompt: string;
  authUrl?: string;
  metadata?: {
    expiresIn?: number;
    [key: string]: unknown;
  };
}

export function createAuthRequiredEvent(
  options: CreateAuthRequiredEventOptions
): AuthRequiredEvent {
  return {
    kind: 'auth-required',
    contextId: options.contextId,
    taskId: options.taskId,
    authId: options.authId,
    authType: options.authType,
    provider: options.provider,
    scopes: options.scopes,
    prompt: options.prompt,
    authUrl: options.authUrl,
    timestamp: new Date().toISOString(),
    metadata: options.metadata,
  };
}

export interface CreateAuthCompletedEventOptions {
  contextId: string;
  taskId: string;
  authId: string;
  userId: string;
  metadata?: {
    expiresAt?: string;
    [key: string]: unknown;
  };
}

export function createAuthCompletedEvent(
  options: CreateAuthCompletedEventOptions
): AuthCompletedEvent {
  return {
    kind: 'auth-completed',
    contextId: options.contextId,
    taskId: options.taskId,
    authId: options.authId,
    userId: options.userId,
    timestamp: new Date().toISOString(),
    metadata: options.metadata,
  };
}

// ============================================================================
// Artifact Event Creators
// ============================================================================

export interface CreateFileWriteEventOptions {
  contextId: string;
  taskId: string;
  artifactId: string;
  data: string;
  index: number;
  complete: boolean;
  name?: string;
  description?: string;
  mimeType?: string;
  encoding?: 'utf-8' | 'base64';
  metadata?: {
    toolCallId?: string;
    totalSize?: number;
    [key: string]: unknown;
  };
}

export function createFileWriteEvent(options: CreateFileWriteEventOptions): FileWriteEvent {
  return {
    kind: 'file-write',
    contextId: options.contextId,
    taskId: options.taskId,
    artifactId: options.artifactId,
    data: options.data,
    index: options.index,
    complete: options.complete,
    timestamp: new Date().toISOString(),
    name: options.name,
    description: options.description,
    mimeType: options.mimeType,
    encoding: options.encoding,
    metadata: options.metadata,
  };
}

export interface CreateDataWriteEventOptions {
  contextId: string;
  taskId: string;
  artifactId: string;
  data: Record<string, unknown>;
  name?: string;
  description?: string;
  metadata?: {
    toolCallId?: string;
    version?: number;
    [key: string]: unknown;
  };
}

export function createDataWriteEvent(options: CreateDataWriteEventOptions): DataWriteEvent {
  return {
    kind: 'data-write',
    contextId: options.contextId,
    taskId: options.taskId,
    artifactId: options.artifactId,
    data: options.data,
    name: options.name,
    description: options.description,
    timestamp: new Date().toISOString(),
    metadata: options.metadata,
  };
}

export interface CreateDatasetWriteEventOptions {
  contextId: string;
  taskId: string;
  artifactId: string;
  rows: Record<string, unknown>[];
  index: number;
  complete: boolean;
  name?: string;
  description?: string;
  schema?: JSONSchema;
  metadata?: {
    toolCallId?: string;
    totalRows?: number;
    batchSize?: number;
    [key: string]: unknown;
  };
}

export function createDatasetWriteEvent(
  options: CreateDatasetWriteEventOptions
): DatasetWriteEvent {
  return {
    kind: 'dataset-write',
    contextId: options.contextId,
    taskId: options.taskId,
    artifactId: options.artifactId,
    rows: options.rows,
    index: options.index,
    complete: options.complete,
    timestamp: new Date().toISOString(),
    name: options.name,
    description: options.description,
    schema: options.schema,
    metadata: options.metadata,
  };
}

// ============================================================================
// Sub-agent Event Creators
// ============================================================================

export interface CreateSubtaskCreatedEventOptions {
  contextId: string;
  taskId: string;
  subtaskId: string;
  agentId?: string;
  prompt: string;
}

export function createSubtaskCreatedEvent(
  options: CreateSubtaskCreatedEventOptions
): SubtaskCreatedEvent {
  return {
    kind: 'subtask-created',
    contextId: options.contextId,
    taskId: options.taskId,
    subtaskId: options.subtaskId,
    agentId: options.agentId,
    prompt: options.prompt,
    timestamp: new Date().toISOString(),
  };
}

// ============================================================================
// Thought Streaming Event Creators
// ============================================================================

export interface CreateThoughtStreamEventOptions {
  contextId: string;
  taskId: string;
  thoughtId: string;
  thoughtType: ThoughtType;
  verbosity: ThoughtVerbosity;
  content: string;
  index: number;
  metadata?: {
    confidence?: number;
    alternatives?: string[];
    relatedTo?: string;
    [key: string]: unknown;
  };
}

export function createThoughtStreamEvent(
  options: CreateThoughtStreamEventOptions
): ThoughtStreamEvent {
  return {
    kind: 'thought-stream',
    contextId: options.contextId,
    taskId: options.taskId,
    thoughtId: options.thoughtId,
    thoughtType: options.thoughtType,
    verbosity: options.verbosity,
    content: options.content,
    index: options.index,
    timestamp: new Date().toISOString(),
    metadata: options.metadata,
  };
}

export interface CreateInternalThoughtProcessEventOptions {
  contextId: string;
  taskId: string;
  iteration: number;
  stage: 'pre-llm' | 'post-llm' | 'pre-tool' | 'post-tool';
  reasoning: string;
  state: Record<string, unknown>;
}

export function createInternalThoughtProcessEvent(
  options: CreateInternalThoughtProcessEventOptions
): InternalThoughtProcessEvent {
  return {
    kind: 'internal:thought-process',
    contextId: options.contextId,
    taskId: options.taskId,
    iteration: options.iteration,
    stage: options.stage,
    reasoning: options.reasoning,
    state: options.state,
    timestamp: new Date().toISOString(),
  };
}

// ============================================================================
// Internal/Debug Event Creators
// ============================================================================

export interface CreateInternalLLMCallEventOptions {
  contextId: string;
  taskId: string;
  iteration: number;
  model: string;
  messageCount: number;
  toolCount: number;
}

export function createInternalLLMCallEvent(
  options: CreateInternalLLMCallEventOptions
): InternalLLMCallEvent {
  return {
    kind: 'internal:llm-call',
    contextId: options.contextId,
    taskId: options.taskId,
    iteration: options.iteration,
    model: options.model,
    messageCount: options.messageCount,
    toolCount: options.toolCount,
    timestamp: new Date().toISOString(),
  };
}

export interface CreateInternalCheckpointEventOptions {
  contextId: string;
  taskId: string;
  iteration: number;
}

export function createInternalCheckpointEvent(
  options: CreateInternalCheckpointEventOptions
): InternalCheckpointEvent {
  return {
    kind: 'internal:checkpoint',
    contextId: options.contextId,
    taskId: options.taskId,
    iteration: options.iteration,
    timestamp: new Date().toISOString(),
  };
}

// ============================================================================
// Event Filtering
// ============================================================================

/**
 * Filter out internal events that should not be sent to clients
 */
export function filterExternalEvents(events: AnyEvent[]): AnyEvent[] {
  return events.filter((event) => !event.kind.startsWith('internal:'));
}

/**
 * Filter events by task ID
 */
export function filterByTaskId(events: AnyEvent[], taskId: string): AnyEvent[] {
  return events.filter((event) => event.taskId === taskId);
}

/**
 * Filter events by context ID
 */
export function filterByContextId(events: AnyEvent[], contextId: string): AnyEvent[] {
  return events.filter((event) => event.contextId === contextId);
}

/**
 * Filter events by kind
 */
export function filterByKind<K extends AnyEvent['kind']>(
  events: AnyEvent[],
  kind: K
): Extract<AnyEvent, { kind: K }>[] {
  return events.filter((event) => event.kind === kind) as Extract<AnyEvent, { kind: K }>[];
}
