/**
 * Internal Event Protocol
 *
 * Core event types and utilities for the Looopy event system.
 *
 * Design: design/internal-event-protocol.md
 */

// Export type guards
export {
  isArtifactEvent,
  isAuthenticationEvent,
  isContentStreamingEvent,
  isDebugEvent,
  isExternalEvent,
  isInputRequestEvent,
  isSubAgentEvent,
  isTaskLifecycleEvent,
  isThoughtStreamEvent,
  isToolExecutionEvent,
} from '../types/event';
// Export options types for event creators
export type {
  CreateAuthCompletedEventOptions,
  CreateAuthRequiredEventOptions,
  CreateContentCompleteEventOptions,
  CreateContentDeltaEventOptions,
  CreateDatasetWriteEventOptions,
  CreateDataWriteEventOptions,
  CreateFileWriteEventOptions,
  CreateInputReceivedEventOptions,
  CreateInputRequiredEventOptions,
  CreateInternalCheckpointEventOptions,
  CreateInternalLLMCallEventOptions,
  CreateInternalThoughtProcessEventOptions,
  CreateSubtaskCreatedEventOptions,
  CreateTaskCompleteEventOptions,
  CreateTaskCreatedEventOptions,
  CreateTaskStatusEventOptions,
  CreateThoughtStreamEventOptions,
  CreateToolCompleteEventOptions,
  CreateToolProgressEventOptions,
  CreateToolStartEventOptions,
} from './utils';
// Export event creators
export {
  createAuthCompletedEvent,
  // Authentication
  createAuthRequiredEvent,
  createContentCompleteEvent,
  // Content Streaming
  createContentDeltaEvent,
  createDatasetWriteEvent,
  createDataWriteEvent,
  // Artifacts
  createFileWriteEvent,
  createInputReceivedEvent,
  // Input Requests
  createInputRequiredEvent,
  createInternalCheckpointEvent,
  // Internal/Debug
  createInternalLLMCallEvent,
  createInternalThoughtProcessEvent,
  // Sub-agents
  createSubtaskCreatedEvent,
  createTaskCompleteEvent,
  // Task Lifecycle
  createTaskCreatedEvent,
  createTaskStatusEvent,
  // Thought Streaming
  createThoughtStreamEvent,
  createToolCompleteEvent,
  createToolProgressEvent,
  // Tool Execution
  createToolStartEvent,
  filterByContextId,
  filterByKind,
  filterByTaskId,
  // Filtering
  filterExternalEvents,
  generateEventId,
} from './utils';
