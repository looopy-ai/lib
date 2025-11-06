/**
 * Internal Event Protocol
 *
 * Core event types and utilities for the Looopy event system.
 *
 * Design: design/internal-event-protocol.md
 */

// Export all types
export type {
  // Common Types
  TaskStatus,
  TaskInitiator,
  InputType,
  InputProvider,
  AuthType,
  ThoughtType,
  ThoughtVerbosity,
  JSONSchema,
  // Task Lifecycle Events
  TaskCreatedEvent,
  TaskStatusEvent,
  TaskCompleteEvent,
  TaskLifecycleEvent,
  // Content Streaming Events
  ContentDeltaEvent,
  ContentCompleteEvent,
  ContentStreamingEvent,
  // Tool Execution Events
  ToolStartEvent,
  ToolProgressEvent,
  ToolCompleteEvent,
  ToolExecutionEvent,
  // Input Request Events
  InputRequiredEvent,
  InputReceivedEvent,
  InputRequestEvent,
  // Authentication Events
  AuthRequiredEvent,
  AuthCompletedEvent,
  AuthenticationEvent,
  // Artifact Events
  FileWriteEvent,
  DataWriteEvent,
  DatasetWriteEvent,
  ArtifactEvent,
  // Sub-agent Events
  SubtaskCreatedEvent,
  SubAgentEvent,
  // Thought Streaming Events
  ThoughtStreamEvent,
  // Internal Debug Events
  InternalThoughtProcessEvent,
  InternalLLMCallEvent,
  InternalCheckpointEvent,
  InternalDebugEvent,
  // Union Types
  InternalEvent,
  ExternalEvent,
  DebugEvent,
} from './types';

// Export type guards
export {
  isExternalEvent,
  isDebugEvent,
  isTaskLifecycleEvent,
  isContentStreamingEvent,
  isToolExecutionEvent,
  isInputRequestEvent,
  isAuthenticationEvent,
  isArtifactEvent,
  isSubAgentEvent,
  isThoughtStreamEvent,
} from './types';

// Export event creators
export {
  generateEventId,
  // Task Lifecycle
  createTaskCreatedEvent,
  createTaskStatusEvent,
  createTaskCompleteEvent,
  // Content Streaming
  createContentDeltaEvent,
  createContentCompleteEvent,
  // Tool Execution
  createToolStartEvent,
  createToolProgressEvent,
  createToolCompleteEvent,
  // Input Requests
  createInputRequiredEvent,
  createInputReceivedEvent,
  // Authentication
  createAuthRequiredEvent,
  createAuthCompletedEvent,
  // Artifacts
  createFileWriteEvent,
  createDataWriteEvent,
  createDatasetWriteEvent,
  // Sub-agents
  createSubtaskCreatedEvent,
  // Thought Streaming
  createThoughtStreamEvent,
  createInternalThoughtProcessEvent,
  // Internal/Debug
  createInternalLLMCallEvent,
  createInternalCheckpointEvent,
  // Filtering
  filterExternalEvents,
  filterByTaskId,
  filterByContextId,
  filterByKind,
} from './utils';

// Export options types for event creators
export type {
  CreateTaskCreatedEventOptions,
  CreateTaskStatusEventOptions,
  CreateTaskCompleteEventOptions,
  CreateContentDeltaEventOptions,
  CreateContentCompleteEventOptions,
  CreateToolStartEventOptions,
  CreateToolProgressEventOptions,
  CreateToolCompleteEventOptions,
  CreateInputRequiredEventOptions,
  CreateInputReceivedEventOptions,
  CreateAuthRequiredEventOptions,
  CreateAuthCompletedEventOptions,
  CreateFileWriteEventOptions,
  CreateDataWriteEventOptions,
  CreateDatasetWriteEventOptions,
  CreateSubtaskCreatedEventOptions,
  CreateThoughtStreamEventOptions,
  CreateInternalThoughtProcessEventOptions,
  CreateInternalLLMCallEventOptions,
  CreateInternalCheckpointEventOptions,
} from './utils';
