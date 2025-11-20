/**
 * Internal Event Protocol Type Definitions
 *
 * This module defines all event types for Looopy's internal event protocol.
 * The protocol extends beyond A2A requirements to support multi-agent orchestration,
 * tool execution, thought streaming, and rich client interaction.
 *
 * Design: design/internal-event-protocol.md
 */

import type { ToolCall } from './tools';

// ============================================================================
// Common Types
// ============================================================================

/**
 * Task status values for task lifecycle
 */
export type TaskStatus =
  | 'working' // Agent is processing
  | 'waiting-input' // Waiting for input (user or coordinator)
  | 'waiting-auth' // Waiting for authentication
  | 'waiting-subtask' // Waiting for subtask to complete
  | 'completed' // Task finished successfully
  | 'failed' // Task failed with error
  | 'canceled'; // Task canceled by user/system

/**
 * Thought verbosity levels
 */
export type ThoughtVerbosity = 'brief' | 'normal' | 'detailed';

/**
 * Thought types for semantic categorization
 */
export type ThoughtType =
  | 'analysis' // Analyzing information
  | 'planning' // Planning next steps
  | 'reasoning' // Reasoning about information
  | 'reflection' // Reflecting on progress
  | 'thinking' // General thinking
  | 'decision' // Making a decision
  | 'observation' // Observing important context
  | 'strategy'; // Adjusting strategy

/**
 * Input types for input-required events
 */
export type InputType =
  | 'tool-execution'
  | 'confirmation'
  | 'clarification'
  | 'selection'
  | 'custom';

/**
 * Authentication types
 */
export type AuthType = 'oauth2' | 'api-key' | 'password' | 'biometric' | 'custom';

/**
 * Task initiator
 */
export type TaskInitiator = 'user' | 'agent';

/**
 * Input provider type
 */
export type InputProvider = 'user' | 'agent';

/**
 * JSON Schema type (simplified)
 */
export interface JSONSchema {
  type?: string;
  properties?: Record<string, JSONSchema>;
  required?: string[];
  items?: JSONSchema;
  format?: string;
  [key: string]: unknown;
}

// ============================================================================
// 1. Task Lifecycle Events
// ============================================================================

/**
 * Emitted when a new task begins (user message or sub-agent invocation)
 */
export interface TaskCreatedEvent {
  kind: 'task-created';
  contextId: string;
  taskId: string;
  parentTaskId?: string; // If this is a subtask
  initiator: TaskInitiator;
  timestamp: string; // ISO 8601
  metadata?: {
    agentId?: string;
    model?: string;
    [key: string]: unknown;
  };
}

/**
 * Status transitions during task execution
 */
export interface TaskStatusEvent {
  kind: 'task-status';
  contextId: string;
  taskId: string;
  status: TaskStatus;
  message?: string; // Human-readable status message
  timestamp: string;
  metadata?: {
    reason?: string; // For failed/canceled
    blockedBy?: string; // For waiting-* states (taskId or 'user')
    [key: string]: unknown;
  };
}

/**
 * Final task completion with result
 */
export interface TaskCompleteEvent {
  kind: 'task-complete';
  contextId: string;
  taskId: string;
  content?: string; // Final text response
  artifacts?: string[]; // Created artifact IDs
  timestamp: string;
  metadata?: {
    duration?: number; // Execution time in ms
    iterations?: number; // Number of LLM iterations
    tokensUsed?: number; // Total tokens consumed
    [key: string]: unknown;
  };
}

/**
 * Union of all task lifecycle events
 */
export type TaskLifecycleEvent = TaskCreatedEvent | TaskStatusEvent | TaskCompleteEvent;

// ============================================================================
// 2. Content Streaming Events
// ============================================================================

/**
 * Incremental content updates (streaming LLM response)
 */
export interface ContentDeltaEvent {
  kind: 'content-delta';
  contextId: string;
  taskId: string;
  delta: string; // Text chunk to append
  index: number; // Chunk sequence number (0-based)
  timestamp: string;
}

export type FinishReason = 'stop' | 'length' | 'tool_calls' | 'content_filter';

/**
 * Indicates streaming content is finished
 */
export interface ContentCompleteEvent {
  kind: 'content-complete';
  contextId: string;
  taskId: string;
  content: string; // Full assembled content
  finishReason: FinishReason; // Why generation ended
  toolCalls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: Record<string, unknown> };
  }>; // Tool calls from LLM (if any)
  timestamp: string;
}

/**
 * Union of all content streaming events
 */
export type ContentStreamingEvent = ContentDeltaEvent | ContentCompleteEvent;

// ============================================================================
// 3. Tool Execution Events
// ============================================================================

/**
 * Tool execution requested by llm
 */
export interface ToolCallEvent {
  kind: 'tool-call';
  contextId: string;
  taskId: string;
  toolCallId: string; // Unique ID for this tool invocation
  toolName: string;
  arguments: Record<string, unknown>;
  timestamp: string;
  metadata?: {
    [key: string]: unknown;
  };
}

/**
 * Tool execution begins
 */
export interface ToolStartEvent {
  kind: 'tool-start';
  contextId: string;
  taskId: string;
  toolCallId: string; // Unique ID for this tool invocation
  icon?: string;
  toolName: string;
  arguments: Record<string, unknown>;
  timestamp: string;
  metadata?: {
    provider?: string; // 'local' | 'client' | 'mcp' | agentId
    concurrent?: boolean; // Is this parallel with other tools?
    [key: string]: unknown;
  };
}

/**
 * Tool execution progress update (for long-running tools)
 */
export interface ToolProgressEvent {
  kind: 'tool-progress';
  contextId: string;
  taskId: string;
  toolCallId: string;
  icon?: string;
  progress: number; // 0.0 to 1.0
  message?: string; // Progress description
  timestamp: string;
  metadata?: {
    step?: string; // Current step name
    stepsCompleted?: number; // For multi-step tools
    stepsTotal?: number;
    [key: string]: unknown;
  };
}

/**
 * Tool execution finished
 */
export interface ToolCompleteEvent {
  kind: 'tool-complete';
  contextId: string;
  taskId: string;
  toolCallId: string;
  icon?: string;
  toolName: string;
  success: boolean;
  result?: unknown; // Tool result data
  error?: string; // Error message if failed
  timestamp: string;
  metadata?: {
    duration?: number; // Execution time in ms
    cached?: boolean; // Was result cached?
    retries?: number; // Number of retry attempts
    [key: string]: unknown;
  };
}

/**
 * Union of all tool execution events
 */
export type ToolExecutionEvent =
  | ToolCallEvent
  | ToolStartEvent
  | ToolProgressEvent
  | ToolCompleteEvent;

// ============================================================================
// 4. Input Request Events
// ============================================================================

/**
 * Agent needs input to continue
 */
export interface InputRequiredEvent {
  kind: 'input-required';
  contextId: string;
  taskId: string;
  inputId: string; // Unique ID for this input request
  requireUser?: boolean; // If true, MUST go to user; if false/undefined, coordinator can handle
  inputType: InputType;
  prompt: string; // What is being requested
  schema?: JSONSchema; // Expected input structure
  options?: unknown[]; // For selection type
  timestamp: string;
  metadata?: {
    toolCall?: ToolCall; // If inputType is 'tool-execution'
    urgency?: 'low' | 'medium' | 'high';
    timeout?: number; // Timeout in seconds
    [key: string]: unknown;
  };
}

/**
 * Input was provided (for tracking/logging)
 */
export interface InputReceivedEvent {
  kind: 'input-received';
  contextId: string;
  taskId: string;
  inputId: string; // Matches input-required.inputId
  providedBy: InputProvider;
  userId?: string; // If providedBy='user', which user
  agentId?: string; // If providedBy='agent', which agent (coordinator)
  timestamp: string;
  metadata?: {
    duration?: number; // Time to provide input (ms)
    [key: string]: unknown;
  };
}

/**
 * Union of all input request events
 */
export type InputRequestEvent = InputRequiredEvent | InputReceivedEvent;

// ============================================================================
// 5. Authentication Events
// ============================================================================

/**
 * Authentication is needed (always targets user)
 */
export interface AuthRequiredEvent {
  kind: 'auth-required';
  contextId: string;
  taskId: string;
  authId: string; // Unique ID for this auth request
  authType: AuthType;
  provider?: string; // e.g., 'google', 'github', 'stripe'
  scopes?: string[]; // Requested permissions/scopes
  prompt: string; // User-facing message
  authUrl?: string; // OAuth redirect URL
  timestamp: string;
  metadata?: {
    expiresIn?: number; // How long until auth expires (seconds)
    [key: string]: unknown;
  };
}

/**
 * Authentication succeeded
 */
export interface AuthCompletedEvent {
  kind: 'auth-completed';
  contextId: string;
  taskId: string;
  authId: string; // Matches auth-required.authId
  userId: string; // Which user completed authentication
  timestamp: string;
  metadata?: {
    expiresAt?: string; // When auth token expires (ISO 8601)
    [key: string]: unknown;
  };
}

/**
 * Union of all authentication events
 */
export type AuthenticationEvent = AuthRequiredEvent | AuthCompletedEvent;

// ============================================================================
// 6. Artifact Events
// ============================================================================

/**
 * File artifact content streaming
 * Metadata only present on first chunk (index === 0)
 */
export interface FileWriteEvent {
  kind: 'file-write';
  contextId: string;
  taskId: string;
  artifactId: string;
  data: string; // Text or base64-encoded binary chunk
  index: number; // Chunk sequence (0-based)
  complete: boolean; // true if this is the final chunk
  timestamp: string;

  // Metadata only present on first chunk (index === 0)
  name?: string; // File name (first chunk only)
  description?: string; // Description (first chunk only)
  mimeType?: string; // e.g., 'text/markdown', 'application/pdf' (first chunk only)
  encoding?: 'utf-8' | 'base64'; // Data encoding (first chunk only)

  metadata?: {
    toolCallId?: string; // If created by a tool
    totalSize?: number; // Expected total size in bytes (if known)
    [key: string]: unknown;
  };
}

/**
 * Data artifact write (atomic, no streaming)
 */
export interface DataWriteEvent {
  kind: 'data-write';
  contextId: string;
  taskId: string;
  artifactId: string;
  name?: string; // Artifact name
  description?: string; // Description
  data: Record<string, unknown>; // Complete structured data
  timestamp: string;
  metadata?: {
    toolCallId?: string; // If created by a tool
    version?: number; // Version number (for updates)
    [key: string]: unknown;
  };
}

/**
 * Dataset artifact batch streaming
 * Metadata only present on first batch (index === 0)
 */
export interface DatasetWriteEvent {
  kind: 'dataset-write';
  contextId: string;
  taskId: string;
  artifactId: string;
  rows: Record<string, unknown>[]; // Batch of rows
  index: number; // Batch sequence (0-based)
  complete: boolean; // true if this is the final batch
  timestamp: string;

  // Metadata only present on first batch (index === 0)
  name?: string; // Dataset name (first batch only)
  description?: string; // Description (first batch only)
  schema?: JSONSchema; // Row schema (first batch only)

  metadata?: {
    toolCallId?: string; // If created by a tool
    totalRows?: number; // Expected total rows (if known)
    batchSize?: number; // Rows per batch
    [key: string]: unknown;
  };
}

/**
 * Union of all artifact events
 */
export type ArtifactEvent = FileWriteEvent | DataWriteEvent | DatasetWriteEvent;

// ============================================================================
// 7. Sub-agent Events
// ============================================================================

/**
 * Sub-agent invoked (creates subtask)
 */
export interface SubtaskCreatedEvent {
  kind: 'subtask-created';
  contextId: string;
  taskId: string; // Parent task
  subtaskId: string; // New subtask ID
  agentId?: string; // Which sub-agent
  prompt: string; // What was requested
  timestamp: string;
}

/**
 * Union of all sub-agent events
 */
export type SubAgentEvent = SubtaskCreatedEvent;

// ============================================================================
// 8. Thought Streaming Events
// ============================================================================

/**
 * Agent's reasoning/planning steps as they occur
 */
export interface ThoughtStreamEvent {
  kind: 'thought-stream';
  contextId: string;
  taskId: string;
  thoughtId: string; // Unique ID for this thought
  thoughtType: ThoughtType;
  verbosity: ThoughtVerbosity; // Granularity level of this thought
  content: string; // The thought content
  index: number; // Sequence number (0-based)
  timestamp: string;
  metadata?: {
    source?: 'content' | 'content-delta' | 'tool-call'; // Where the thought was extracted from
    confidence?: number; // 0.0 to 1.0 - agent's confidence in this thought
    alternatives?: string[]; // Alternative thoughts considered
    relatedTo?: string; // Related thoughtId or toolCallId
    [key: string]: unknown;
  };
}

/**
 * Internal version with more detailed reasoning (not sent to clients by default)
 */
export interface InternalThoughtProcessEvent {
  kind: 'internal:thought-process';
  contextId: string;
  taskId: string;
  iteration: number; // Which iteration in the loop
  stage: 'pre-llm' | 'post-llm' | 'pre-tool' | 'post-tool';
  reasoning: string; // Internal reasoning
  state: Record<string, unknown>; // Current execution state
  timestamp: string;
}

// ============================================================================
// 9. Internal/Debug Events
// ============================================================================

/**
 * LLM API call started
 */
export interface InternalLLMCallEvent {
  kind: 'internal:llm-call';
  contextId: string;
  taskId: string;
  iteration: number; // Which iteration in loop
  messageCount: number;
  toolCount: number;
  timestamp: string;
}

/**
 * State checkpoint saved
 */
export interface InternalCheckpointEvent {
  kind: 'internal:checkpoint';
  contextId: string;
  taskId: string;
  iteration: number;
  timestamp: string;
}

/**
 * Tool execution started
 */
export interface InternalToolStartEvent {
  kind: 'internal:tool-start';
  contextId: string;
  taskId: string;
  toolCallId: string;
  toolName: string;
  timestamp: string;
}

/**
 * Tool execution completed
 */
export interface InternalToolCompleteEvent {
  kind: 'internal:tool-complete';
  contextId: string;
  taskId: string;
  toolCallId: string;
  toolName: string;
  success: boolean;
  error?: string;
  timestamp: string;
}

/**
 * Union of all internal/debug events
 */
export type InternalDebugEvent =
  | InternalLLMCallEvent
  | InternalCheckpointEvent
  | InternalToolStartEvent
  | InternalToolCompleteEvent
  | InternalThoughtProcessEvent;

// ============================================================================
// 10. LLM Usage Events
// ============================================================================

/**
 * LLM API call started
 */
export interface LLMUsageEvent {
  kind: 'llm-usage';
  contextId: string;
  taskId: string;
  model: string;
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  completion_tokens_details?: Record<string, number>;
  prompt_tokens_details?: Record<string, number>;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  timestamp: string;
}

/**
 * Union of all usage events
 */
export type UsageEvent = LLMUsageEvent;

// ============================================================================
// Event Unions
// ============================================================================

/**
 * All internal events (both external and internal)
 */
export type AnyEvent =
  | TaskLifecycleEvent
  | ContentStreamingEvent
  | ToolExecutionEvent
  | InputRequestEvent
  | AuthenticationEvent
  | ArtifactEvent
  | SubAgentEvent
  | ThoughtStreamEvent
  | InternalDebugEvent
  | UsageEvent;

export type LLMEvent<T> = Omit<T, 'contextId' | 'taskId'>;

/**
 * External events (sent to clients)
 */
export type ExternalEvent = Exclude<AnyEvent, InternalDebugEvent>;

/**
 * Debug events (internal only)
 */
export type DebugEvent = InternalDebugEvent;

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Check if an event is external (should be sent to clients)
 */
export function isExternalEvent(event: AnyEvent): event is ExternalEvent {
  return !event.kind.startsWith('internal:');
}

/**
 * Check if an event is internal/debug only
 */
export function isDebugEvent(event: AnyEvent): event is DebugEvent {
  return event.kind.startsWith('internal:');
}

/**
 * Check if an event is a task lifecycle event
 */
export function isTaskLifecycleEvent(event: AnyEvent): event is TaskLifecycleEvent {
  return (
    event.kind === 'task-created' || event.kind === 'task-status' || event.kind === 'task-complete'
  );
}

/**
 * Check if an event is a content streaming event
 */
export function isContentStreamingEvent(event: AnyEvent): event is ContentStreamingEvent {
  return event.kind === 'content-delta' || event.kind === 'content-complete';
}

/**
 * Check if an event is a tool execution event
 */
export function isToolExecutionEvent(event: AnyEvent): event is ToolExecutionEvent {
  return (
    event.kind === 'tool-start' || event.kind === 'tool-progress' || event.kind === 'tool-complete'
  );
}

/**
 * Check if an event is an input request event
 */
export function isInputRequestEvent(event: AnyEvent): event is InputRequestEvent {
  return event.kind === 'input-required' || event.kind === 'input-received';
}

/**
 * Check if an event is an authentication event
 */
export function isAuthenticationEvent(event: AnyEvent): event is AuthenticationEvent {
  return event.kind === 'auth-required' || event.kind === 'auth-completed';
}

/**
 * Check if an event is an artifact event
 */
export function isArtifactEvent(event: AnyEvent): event is ArtifactEvent {
  return (
    event.kind === 'file-write' || event.kind === 'data-write' || event.kind === 'dataset-write'
  );
}

/**
 * Check if an event is a sub-agent event
 */
export function isSubAgentEvent(event: AnyEvent): event is SubAgentEvent {
  return event.kind === 'subtask-created';
}

/**
 * Check if an event is a thought streaming event
 */
export function isThoughtStreamEvent(event: AnyEvent): event is ThoughtStreamEvent {
  return event.kind === 'thought-stream';
}
