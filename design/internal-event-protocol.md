# Internal Event Protocol Design

## Overview

This document defines Looopy's internal event protocol - a comprehensive SSE-based eventing system that extends beyond A2A protocol requirements to support the full needs of multi-agent orchestration, tool execution, and client interaction.

**Key Principle**: While A2A protocol defines external agent-to-agent communication, our internal protocol needs richer semantics for orchestration, debugging, tool management, and client interaction patterns.

## Motivation

### Why Not Just Use A2A Events?

Initial design assumed A2A protocol events would suffice for internal use. However, as the system evolved, we identified gaps:

1. **Sub-agent orchestration**: Need to track hierarchical task relationships
2. **Tool execution lifecycle**: More granular tool events than A2A provides
3. **Input routing**: Distinguish user-required vs coordinator-handled inputs
4. **Authentication flows**: Explicit auth request/response pattern
5. **Artifact streaming**: Incremental artifact updates and editing
6. **Progress tracking**: Tool-specific progress updates (e.g., workflow steps)
7. **Debugging**: Internal observability events not meant for external clients

### Design Goals

- ✅ **SSE-compatible**: All events stream via Server-Sent Events
- ✅ **Hierarchical tasks**: Support task/subtask relationships
- ✅ **Context-scoped**: All events tied to a `contextId` (session/conversation)
- ✅ **Task-scoped**: Events include `taskId` for multiplexing
- ✅ **Input routing**: Explicit targeting for input requirements
- ✅ **Lifcycle-aware**: Rich agent-task lifecycle and progress events
- ✅ **Artifact-centric**: First-class artifact creation/editing support
- ✅ **Auth-explicit**: Clear authentication request/response pattern
- ✅ **A2A-compatible**: Can map to A2A events for external communication

## Core Concepts

### Context and Tasks

```
Context (contextId)
  └─ Conversation/Session scope
      └─ Task 1 (taskId, parentTaskId=null)
          ├─ Subtask 1.1 (taskId, parentTaskId=task1)
          ├─ Subtask 1.2 (taskId, parentTaskId=task1)
          └─ ...
      └─ Task 2 (taskId, parentTaskId=null)
          └─ ...
```

**Context** (`contextId`):
- Represents a conversation/session
- Long-lived (days/weeks)
- Contains message history, artifacts, state
- One context can have many tasks over time

**Task** (`taskId`):
- Represents a single "turn" or agent invocation
- Created by user input OR sub-agent invocation
- Has lifecycle: created → working → completed/failed
- Can spawn subtasks (hierarchical)
- Short-lived (seconds/minutes)

**Relationship**:
- User sends message → creates new Task in Context
- Agent invokes sub-agent → creates Subtask with `parentTaskId`
- All tasks in same conversation share `contextId`

### Event Stream Model

```
Client → Agent Server (HTTP POST)
  {
    contextId: "ctx-123",
    message: { role: "user", content: "Do something" }
  }

Agent Server → Client (SSE Stream)
  data: {"kind":"task-created","contextId":"ctx-123","taskId":"task-456",...}
  data: {"kind":"task-status","contextId":"ctx-123","taskId":"task-456","status":"working",...}
  data: {"kind":"tool-start","contextId":"ctx-123","taskId":"task-456","toolName":"search",...}
  data: {"kind":"tool-progress","contextId":"ctx-123","taskId":"task-456","progress":0.5,...}
  data: {"kind":"tool-complete","contextId":"ctx-123","taskId":"task-456","result":{...},...}
  data: {"kind":"content-delta","contextId":"ctx-123","taskId":"task-456","delta":"Hello",...}
  data: {"kind":"content-delta","contextId":"ctx-123","taskId":"task-456","delta":" world",...}
  data: {"kind":"task-complete","contextId":"ctx-123","taskId":"task-456","content":"Hello world",...}
```

**Key Properties**:
- All events include `contextId` and `taskId`
- Events stream in real-time as they occur
- Client can multiplex multiple tasks in same context
- Events are ordered within a task but may interleave across tasks

## Context Stamping in Code

In TypeScript, base payloads are defined as **contextless** `AnyEvent` objects. The runtime stamps identifiers via:

```typescript
type ContextEvent<T> = T & { contextId: string; taskId: string };
type ContextAnyEvent = ContextEvent<AnyEvent>;
```

LLM providers and tool-executing plugins emit contextless events; the agent loop wraps them with `contextId` and `taskId` before streaming to clients. The interface examples below illustrate the external shape (with context fields) that consumers receive.

## Event Types

### 1. Task Lifecycle Events

#### `task-created`

Emitted when a new task begins (user message or sub-agent invocation).

```typescript
interface TaskCreatedEvent {
  kind: 'task-created';
  contextId: string;
  taskId: string;
  parentTaskId?: string;        // If this is a subtask
  initiator: 'user' | 'agent';  // Who initiated this task
  timestamp: string;             // ISO 8601
  metadata?: {
    agentId?: string;            // Which agent is handling this
    model?: string;              // LLM model being used
    [key: string]: unknown;
  };
}
```

**Example**:
```json
{
  "kind": "task-created",
  "contextId": "ctx-abc123",
  "taskId": "task-xyz789",
  "initiator": "user",
  "timestamp": "2025-11-06T10:30:00Z",
  "metadata": {
    "agentId": "assistant-v1",
    "model": "gpt-4"
  }
}
```

#### `task-status`

Status transitions during task execution.

```typescript
type TaskStatus =
  | 'working'           // Agent is processing
  | 'waiting-input'     // Waiting for input (user or coordinator)
  | 'waiting-auth'      // Waiting for authentication
  | 'waiting-subtask'   // Waiting for subtask to complete
  | 'completed'         // Task finished successfully
  | 'failed'            // Task failed with error
  | 'canceled';         // Task canceled by user/system

interface TaskStatusEvent {
  kind: 'task-status';
  contextId: string;
  taskId: string;
  status: TaskStatus;
  message?: string;              // Human-readable status message
  timestamp: string;
  metadata?: {
    reason?: string;             // For failed/canceled
    blockedBy?: string;          // For waiting-* states (taskId or 'user')
    [key: string]: unknown;
  };
}
```

**Example - Working**:
```json
{
  "kind": "task-status",
  "contextId": "ctx-abc123",
  "taskId": "task-xyz789",
  "status": "working",
  "message": "Processing your request",
  "timestamp": "2025-11-06T10:30:01Z"
}
```

**Example - Waiting for Subtask**:
```json
{
  "kind": "task-status",
  "contextId": "ctx-abc123",
  "taskId": "task-xyz789",
  "status": "waiting-subtask",
  "message": "Waiting for data analyzer",
  "timestamp": "2025-11-06T10:30:05Z",
  "metadata": {
    "blockedBy": "subtask-abc456"
  }
}
```

#### `task-complete`

Final task completion with result.

```typescript
interface TaskCompleteEvent {
  kind: 'task-complete';
  contextId: string;
  taskId: string;
  content?: string;              // Final text response
  artifacts?: string[];          // Created artifact IDs
  timestamp: string;
  metadata?: {
    duration?: number;           // Execution time in ms
    iterations?: number;         // Number of LLM iterations
    tokensUsed?: number;         // Total tokens consumed
    [key: string]: unknown;
  };
}
```

**Example**:
```json
{
  "kind": "task-complete",
  "contextId": "ctx-abc123",
  "taskId": "task-xyz789",
  "content": "Based on the analysis, sales increased by 15% in Q4.",
  "artifacts": ["artifact-report-1", "artifact-chart-2"],
  "timestamp": "2025-11-06T10:30:45Z",
  "metadata": {
    "duration": 44250,
    "iterations": 3,
    "tokensUsed": 1547
  }
}
```

### 2. Content Streaming Events

#### `content-delta`

Incremental content updates (streaming LLM response).

```typescript
interface ContentDeltaEvent {
  kind: 'content-delta';
  contextId: string;
  taskId: string;
  delta: string;                 // Text chunk to append
  index: number;                 // Chunk sequence number (0-based)
  timestamp: string;
}
```

**Example**:
```json
{
  "kind": "content-delta",
  "contextId": "ctx-abc123",
  "taskId": "task-xyz789",
  "delta": "Based on ",
  "index": 0,
  "timestamp": "2025-11-06T10:30:30.123Z"
}
```

#### `content-complete`

Indicates streaming content is finished.

```typescript
interface ContentCompleteEvent {
  kind: 'content-complete';
  contextId: string;
  taskId: string;
  content: string;               // Full assembled content
  timestamp: string;
}
```

### 3. Tool Execution Events

#### `tool-start`

Tool execution begins.

```typescript
interface ToolStartEvent {
  kind: 'tool-start';
  contextId: string;
  taskId: string;
  toolCallId: string;            // Unique ID for this tool invocation
  toolName: string;
  arguments: Record<string, unknown>;
  timestamp: string;
  metadata?: {
    provider?: string;           // 'local' | 'client' | 'mcp' | agentId
    concurrent?: boolean;        // Is this parallel with other tools?
    [key: string]: unknown;
  };
}
```

**Example**:
```json
{
  "kind": "tool-start",
  "contextId": "ctx-abc123",
  "taskId": "task-xyz789",
  "toolCallId": "call-tool-001",
  "toolName": "search_database",
  "arguments": {
    "query": "Q4 sales data",
    "limit": 100
  },
  "timestamp": "2025-11-06T10:30:05Z",
  "metadata": {
    "provider": "local",
    "concurrent": false
  }
}
```

#### `tool-progress`

Tool execution progress update (for long-running tools).

```typescript
interface ToolProgressEvent {
  kind: 'tool-progress';
  contextId: string;
  taskId: string;
  toolCallId: string;
  progress: number;              // 0.0 to 1.0
  message?: string;              // Progress description
  timestamp: string;
  metadata?: {
    step?: string;               // Current step name
    stepsCompleted?: number;     // For multi-step tools
    stepsTotal?: number;
    [key: string]: unknown;
  };
}
```

**Example - Workflow Tool**:
```json
{
  "kind": "tool-progress",
  "contextId": "ctx-abc123",
  "taskId": "task-xyz789",
  "toolCallId": "call-workflow-001",
  "progress": 0.6,
  "message": "Processing step 3 of 5: Data aggregation",
  "timestamp": "2025-11-06T10:30:20Z",
  "metadata": {
    "step": "aggregate_data",
    "stepsCompleted": 3,
    "stepsTotal": 5
  }
}
```

#### `tool-complete`

Tool execution finished.

```typescript
interface ToolCompleteEvent {
  kind: 'tool-complete';
  contextId: string;
  taskId: string;
  toolCallId: string;
  toolName: string;
  success: boolean;
  result?: unknown;              // Tool result data
  error?: string;                // Error message if failed
  timestamp: string;
  metadata?: {
    duration?: number;           // Execution time in ms
    cached?: boolean;            // Was result cached?
    retries?: number;            // Number of retry attempts
    [key: string]: unknown;
  };
}
```

**Example - Success**:
```json
{
  "kind": "tool-complete",
  "contextId": "ctx-abc123",
  "taskId": "task-xyz789",
  "toolCallId": "call-tool-001",
  "toolName": "search_database",
  "success": true,
  "result": {
    "count": 42,
    "records": [...]
  },
  "timestamp": "2025-11-06T10:30:08Z",
  "metadata": {
    "duration": 2847,
    "cached": false
  }
}
```

### 4. Input Request Events

#### `input-required`

Agent needs input to continue.

```typescript
interface InputRequiredEvent {
  kind: 'input-required';
  contextId: string;
  taskId: string;
  inputId: string;               // Unique ID for this input request
  requireUser?: boolean;         // If true, MUST go to user; if false/undefined, coordinator can handle
  inputType: 'tool-execution' | 'confirmation' | 'clarification' | 'selection' | 'custom';
  prompt: string;                // What is being requested
  schema?: JSONSchema;           // Expected input structure
  options?: unknown[];           // For selection type
  timestamp: string;
  metadata?: {
    toolCall?: ToolCall;         // If inputType is 'tool-execution'
    urgency?: 'low' | 'medium' | 'high';
    timeout?: number;            // Timeout in seconds
    [key: string]: unknown;
  };
}
```

**Input Routing Semantics**:
- `requireUser: true` - **MUST** propagate to originating user (e.g., OAuth, payments, sensitive confirmations)
- `requireUser: false` or `undefined` (default) - Coordinator can handle OR forward to user (coordinator tries first, falls back to user if needed)

**Example - Requires User (OAuth)**:
```json
{
  "kind": "input-required",
  "contextId": "ctx-abc123",
  "taskId": "task-xyz789",
  "inputId": "input-oauth-001",
  "requireUser": true,
  "inputType": "confirmation",
  "prompt": "Please authorize access to your Google Calendar",
  "timestamp": "2025-11-06T10:30:10Z",
  "metadata": {
    "urgency": "high",
    "timeout": 300
  }
}
```

**Example - Coordinator Can Handle (Tool Execution)**:
```json
{
  "kind": "input-required",
  "contextId": "ctx-abc123",
  "taskId": "task-xyz789",
  "inputId": "input-tool-002",
  "requireUser": false,
  "inputType": "tool-execution",
  "prompt": "Execute client-side tool: get_user_profile",
  "schema": {
    "type": "object",
    "properties": {
      "userId": {"type": "integer"}
    }
  },
  "timestamp": "2025-11-06T10:30:12Z",
  "metadata": {
    "toolCall": {
      "id": "call-001",
      "function": {
        "name": "get_user_profile",
        "arguments": "{\"userId\":123}"
      }
    }
  }
}
```

#### `input-received`

Input was provided (for tracking/logging).

```typescript
interface InputReceivedEvent {
  kind: 'input-received';
  contextId: string;
  taskId: string;
  inputId: string;               // Matches input-required.inputId
  providedBy: 'user' | 'agent';  // Type of provider
  userId?: string;               // If providedBy='user', which user
  agentId?: string;              // If providedBy='agent', which agent (coordinator)
  timestamp: string;
  metadata?: {
    duration?: number;           // Time to provide input (ms)
    [key: string]: unknown;
  };
}
```

**Example - User Provided**:
```json
{
  "kind": "input-received",
  "contextId": "ctx-abc123",
  "taskId": "task-xyz789",
  "inputId": "input-oauth-001",
  "providedBy": "user",
  "userId": "user-john-456",
  "timestamp": "2025-11-06T10:30:45Z",
  "metadata": {
    "duration": 35000
  }
}
```

**Example - Coordinator Provided**:
```json
{
  "kind": "input-received",
  "contextId": "ctx-abc123",
  "taskId": "task-xyz789",
  "inputId": "input-tool-002",
  "providedBy": "agent",
  "agentId": "coordinator-v1",
  "timestamp": "2025-11-06T10:30:15Z",
  "metadata": {
    "duration": 3200
  }
}
```

### 5. Authentication Events

#### `auth-required`

Authentication is needed (always targets user).

```typescript
interface AuthRequiredEvent {
  kind: 'auth-required';
  contextId: string;
  taskId: string;
  authId: string;                // Unique ID for this auth request
  authType: 'oauth2' | 'api-key' | 'password' | 'biometric' | 'custom';
  provider?: string;             // e.g., 'google', 'github', 'stripe'
  scopes?: string[];             // Requested permissions/scopes
  prompt: string;                // User-facing message
  authUrl?: string;              // OAuth redirect URL
  timestamp: string;
  metadata?: {
    expiresIn?: number;          // How long until auth expires (seconds)
    [key: string]: unknown;
  };
}
```

**Note**: Auth events **always** propagate to user. No coordinator can handle auth on user's behalf.

**Example - OAuth**:
```json
{
  "kind": "auth-required",
  "contextId": "ctx-abc123",
  "taskId": "task-xyz789",
  "authId": "auth-github-001",
  "authType": "oauth2",
  "provider": "github",
  "scopes": ["repo", "user"],
  "prompt": "Please authorize access to your GitHub repositories",
  "authUrl": "https://github.com/login/oauth/authorize?client_id=...",
  "timestamp": "2025-11-06T10:30:15Z",
  "metadata": {
    "expiresIn": 600
  }
}
```

#### `auth-completed`

Authentication succeeded.

```typescript
interface AuthCompletedEvent {
  kind: 'auth-completed';
  contextId: string;
  taskId: string;
  authId: string;                // Matches auth-required.authId
  userId: string;                // Which user completed authentication
  timestamp: string;
  metadata?: {
    expiresAt?: string;          // When auth token expires (ISO 8601)
    [key: string]: unknown;
  };
}
```

**Example**:
```json
{
  "kind": "auth-completed",
  "contextId": "ctx-abc123",
  "taskId": "task-xyz789",
  "authId": "auth-github-001",
  "userId": "user-john-456",
  "timestamp": "2025-11-06T10:30:50Z",
  "metadata": {
    "expiresAt": "2025-11-06T18:30:50Z"
  }
}
```

### 6. Artifact Events

Looopy supports three distinct artifact types, each with optimized event patterns:

1. **File Artifacts** - Text/binary with MIME types (Markdown, HTML, PDFs) - **streamable**
2. **Data Artifacts** - Single structured records (JSON objects, API responses) - **atomic**
3. **Dataset Artifacts** - Collections/tables (query results, CSVs, time series) - **batchable**

#### `file-write`

File artifact content streaming (Option C: single event type with metadata on first chunk).

```typescript
interface FileWriteEvent {
  kind: 'file-write';
  contextId: string;
  taskId: string;
  artifactId: string;
  data: string;                  // Text or base64-encoded binary chunk
  index: number;                 // Chunk sequence (0-based)
  complete: boolean;             // true if this is the final chunk
  timestamp: string;

  // Metadata only present on first chunk (index === 0)
  name?: string;                 // File name (first chunk only)
  description?: string;          // Description (first chunk only)
  mimeType?: string;             // e.g., 'text/markdown', 'application/pdf' (first chunk only)
  encoding?: 'utf-8' | 'base64'; // Data encoding (first chunk only)

  metadata?: {
    toolCallId?: string;         // If created by a tool
    totalSize?: number;          // Expected total size in bytes (if known)
    [key: string]: unknown;
  };
}
```

**Example - Streaming Markdown Report**:

First chunk (with metadata):
```json
{
  "kind": "file-write",
  "contextId": "ctx-abc123",
  "taskId": "task-xyz789",
  "artifactId": "artifact-report-1",
  "data": "# Sales Report\n\nExecutive Summary:\n",
  "index": 0,
  "complete": false,
  "timestamp": "2025-11-06T10:30:20.100Z",
  "name": "Q4-sales-report.md",
  "description": "Quarterly sales analysis",
  "mimeType": "text/markdown",
  "encoding": "utf-8",
  "metadata": {
    "toolCallId": "call-001",
    "totalSize": 4096
  }
}
```

Subsequent chunk:
```json
{
  "kind": "file-write",
  "contextId": "ctx-abc123",
  "taskId": "task-xyz789",
  "artifactId": "artifact-report-1",
  "data": "Based on the analysis, Q4 sales increased by 15%.\n\n",
  "index": 1,
  "complete": false,
  "timestamp": "2025-11-06T10:30:20.250Z"
}
```

Final chunk:
```json
{
  "kind": "file-write",
  "contextId": "ctx-abc123",
  "taskId": "task-xyz789",
  "artifactId": "artifact-report-1",
  "data": "## Recommendations\n\n- Continue current strategy\n- Expand to new markets",
  "index": 2,
  "complete": true,
  "timestamp": "2025-11-06T10:30:20.400Z"
}
```

#### `data-write`

Data artifact write (atomic, no streaming).

```typescript
interface DataWriteEvent {
  kind: 'data-write';
  contextId: string;
  taskId: string;
  artifactId: string;
  name?: string;                 // Artifact name
  description?: string;          // Description
  data: Record<string, unknown>; // Complete structured data
  timestamp: string;
  metadata?: {
    toolCallId?: string;         // If created by a tool
    version?: number;            // Version number (for updates)
    [key: string]: unknown;
  };
}
```

**Example - API Response**:
```json
{
  "kind": "data-write",
  "contextId": "ctx-abc123",
  "taskId": "task-xyz789",
  "artifactId": "artifact-user-profile",
  "name": "user-profile",
  "description": "User profile from API",
  "data": {
    "id": 12345,
    "name": "John Doe",
    "email": "john@example.com",
    "preferences": {
      "theme": "dark",
      "notifications": true
    }
  },
  "timestamp": "2025-11-06T10:30:25.000Z",
  "metadata": {
    "toolCallId": "call-002",
    "version": 1
  }
}
```

**Example - Update Existing Data Artifact**:
```json
{
  "kind": "data-write",
  "contextId": "ctx-abc123",
  "taskId": "task-xyz789",
  "artifactId": "artifact-user-profile",
  "data": {
    "id": 12345,
    "name": "John Doe",
    "email": "john@example.com",
    "preferences": {
      "theme": "light",
      "notifications": false
    }
  },
  "timestamp": "2025-11-06T10:35:00.000Z",
  "metadata": {
    "version": 2
  }
}
```

#### `dataset-write`

Dataset artifact batch streaming (Option C: single event type with metadata on first batch).

```typescript
interface DatasetWriteEvent {
  kind: 'dataset-write';
  contextId: string;
  taskId: string;
  artifactId: string;
  rows: Record<string, unknown>[]; // Batch of rows
  index: number;                 // Batch sequence (0-based)
  complete: boolean;             // true if this is the final batch
  timestamp: string;

  // Metadata only present on first batch (index === 0)
  name?: string;                 // Dataset name (first batch only)
  description?: string;          // Description (first batch only)
  schema?: JSONSchema;           // Row schema (first batch only)

  metadata?: {
    toolCallId?: string;         // If created by a tool
    totalRows?: number;          // Expected total rows (if known)
    batchSize?: number;          // Rows per batch
    [key: string]: unknown;
  };
}
```

**Example - Query Results Streaming**:

First batch (with metadata):
```json
{
  "kind": "dataset-write",
  "contextId": "ctx-abc123",
  "taskId": "task-xyz789",
  "artifactId": "artifact-sales-data",
  "rows": [
    {"date": "2025-10-01", "amount": 1250.50, "region": "north"},
    {"date": "2025-10-02", "amount": 980.00, "region": "south"}
  ],
  "index": 0,
  "complete": false,
  "timestamp": "2025-11-06T10:30:30.100Z",
  "name": "q4-sales-data",
  "description": "Q4 sales by date and region",
  "schema": {
    "type": "object",
    "properties": {
      "date": {"type": "string", "format": "date"},
      "amount": {"type": "number"},
      "region": {"type": "string"}
    }
  },
  "metadata": {
    "toolCallId": "call-003",
    "totalRows": 92,
    "batchSize": 50
  }
}
```

Subsequent batch:
```json
{
  "kind": "dataset-write",
  "contextId": "ctx-abc123",
  "taskId": "task-xyz789",
  "artifactId": "artifact-sales-data",
  "rows": [
    {"date": "2025-10-03", "amount": 1450.75, "region": "east"},
    {"date": "2025-10-04", "amount": 1120.00, "region": "west"}
  ],
  "index": 1,
  "complete": false,
  "timestamp": "2025-11-06T10:30:30.250Z"
}
```

Final batch:
```json
{
  "kind": "dataset-write",
  "contextId": "ctx-abc123",
  "taskId": "task-xyz789",
  "artifactId": "artifact-sales-data",
  "rows": [
    {"date": "2025-12-30", "amount": 2100.00, "region": "north"},
    {"date": "2025-12-31", "amount": 1890.50, "region": "south"}
  ],
  "index": 45,
  "complete": true,
  "timestamp": "2025-11-06T10:30:35.000Z"
}
```

**Design Rationale**:

1. **File artifacts** (`file-write`):
   - Single event type for all chunks
   - Metadata on first chunk (`index === 0`)
   - `complete: true` on final chunk
   - Efficient: 1 event per chunk (no separate created/complete events)

2. **Data artifacts** (`data-write`):
   - Atomic updates (no streaming/chunking)
   - Complete record in every event
   - Can be used for create or update (use `metadata.version` to track)
   - No `complete` flag needed (every write is complete)

3. **Dataset artifacts** (`dataset-write`):
   - Batch streaming for large collections
   - Metadata on first batch (`index === 0`)
   - `complete: true` on final batch
   - Efficient: 1 event per batch (no separate created/complete events)

### 7. Sub-agent Events

#### `subtask-created`

Sub-agent invoked (creates subtask).

```typescript
interface SubtaskCreatedEvent {
  kind: 'subtask-created';
  contextId: string;
  taskId: string;                // Parent task
  subtaskId: string;             // New subtask ID
  agentId?: string;              // Which sub-agent
  prompt: string;                // What was requested
  timestamp: string;
}
```

**Example**:
```json
{
  "kind": "subtask-created",
  "contextId": "ctx-abc123",
  "taskId": "task-xyz789",
  "subtaskId": "subtask-abc456",
  "agentId": "data-analyzer-v1",
  "prompt": "Analyze Q4 sales trends",
  "timestamp": "2025-11-06T10:30:25Z"
}
```

**Note**: After this event, subsequent events with `taskId: "subtask-abc456"` are from the sub-agent.

### 9. Thought Streaming Events

These events expose the agent's internal reasoning process for transparency and user expectation management.

#### `thought-stream`

Agent's reasoning/planning steps as they occur.

```typescript
type ThoughtVerbosity = 'brief' | 'normal' | 'detailed';

interface ThoughtStreamEvent {
  kind: 'thought-stream';
  contextId: string;
  taskId: string;
  thoughtId: string;             // Unique ID for this thought
  thoughtType: 'planning' | 'reasoning' | 'reflection' | 'decision' | 'observation' | 'strategy';
  verbosity: ThoughtVerbosity;   // Granularity level of this thought
  content: string;               // The thought content
  index: number;                 // Sequence number (0-based)
  timestamp: string;
  metadata?: {
    confidence?: number;         // 0.0 to 1.0 - agent's confidence in this thought
    alternatives?: string[];     // Alternative thoughts considered
    relatedTo?: string;          // Related thoughtId or toolCallId
    [key: string]: unknown;
  };
}
```

**Thought Types**:
- **planning** - Agent is planning next steps ("I need to first check the database, then analyze the results")
- **reasoning** - Agent is reasoning about information ("Since the sales data shows an increase, this suggests...")
- **reflection** - Agent is reflecting on progress ("I've gathered the data, but I'm missing the regional breakdown")
- **decision** - Agent is making a decision ("I'll use the search tool instead of the database query")
- **observation** - Agent noticed something important ("The user mentioned 'urgent', so I should prioritize speed")
- **strategy** - Agent is adjusting strategy ("This approach isn't working, I'll try a different method")

**Verbosity Levels**:
- **brief** - High-level summary thoughts (e.g., "Planning to query database")
- **normal** - Standard reasoning with context (e.g., "I'll query the sales database to get Q4 data")
- **detailed** - Comprehensive reasoning with alternatives and rationale (e.g., "I need Q4 sales data. I'll use the sales_db query tool instead of the API because it's faster and we have recent data in the cache. Alternative: call the external API for real-time data, but that would be slower.")

**Example - Planning (Brief)**:
```json
{
  "kind": "thought-stream",
  "contextId": "ctx-abc123",
  "taskId": "task-xyz789",
  "thoughtId": "thought-001",
  "thoughtType": "planning",
  "verbosity": "brief",
  "content": "Querying sales database",
  "index": 0,
  "timestamp": "2025-11-06T10:30:02Z",
  "metadata": {
    "confidence": 0.9
  }
}
```

**Example - Planning (Normal)**:
```json
{
  "kind": "thought-stream",
  "contextId": "ctx-abc123",
  "taskId": "task-xyz789",
  "thoughtId": "thought-002",
  "thoughtType": "planning",
  "verbosity": "normal",
  "content": "I'll need to gather Q4 sales data from the database, then analyze trends by region.",
  "index": 1,
  "timestamp": "2025-11-06T10:30:02Z",
  "metadata": {
    "confidence": 0.9
  }
}
```

**Example - Planning (Detailed)**:
```json
{
  "kind": "thought-stream",
  "contextId": "ctx-abc123",
  "taskId": "task-xyz789",
  "thoughtId": "thought-003",
  "thoughtType": "planning",
  "verbosity": "detailed",
  "content": "I need Q4 sales data to answer the user's question. I'll use the search_database tool to query the sales_data table filtered by date range Q4 2025. After retrieving the data, I'll need to aggregate by region and calculate percentage changes. Alternative approaches: (1) use the pre-computed sales_summary table for faster results but less granular data, (2) call the external analytics API for real-time data but higher latency.",
  "index": 2,
  "timestamp": "2025-11-06T10:30:02Z",
  "metadata": {
    "confidence": 0.85,
    "alternatives": [
      "Use sales_summary table (faster but less detailed)",
      "Call analytics API (real-time but slower)"
    ]
  }
}
```

**Example - Reasoning (Normal)**:
```json
{
  "kind": "thought-stream",
  "contextId": "ctx-abc123",
  "taskId": "task-xyz789",
  "thoughtId": "thought-004",
  "thoughtType": "reasoning",
  "verbosity": "normal",
  "content": "The data shows a 15% increase in Q4. This is likely due to the holiday season promotions.",
  "index": 3,
  "timestamp": "2025-11-06T10:30:15Z",
  "metadata": {
    "confidence": 0.75,
    "relatedTo": "call-tool-001"
  }
}
```

**Example - Reflection (Normal)**:
```json
{
  "kind": "thought-stream",
  "contextId": "ctx-abc123",
  "taskId": "task-xyz789",
  "thoughtId": "thought-005",
  "thoughtType": "reflection",
  "verbosity": "normal",
  "content": "I have the sales totals, but I'm missing the regional breakdown. I should query that separately.",
  "index": 4,
  "timestamp": "2025-11-06T10:30:20Z",
  "metadata": {
    "confidence": 0.85
  }
}
```

**Example - Decision (Detailed)**:
```json
{
  "kind": "thought-stream",
  "contextId": "ctx-abc123",
  "taskId": "task-xyz789",
  "thoughtId": "thought-006",
  "thoughtType": "decision",
  "verbosity": "detailed",
  "content": "I'll use the fast_search tool instead of the full database query since the user marked this as urgent. The fast_search uses indexed lookups and should return in <2s vs 10-15s for the full query. Trade-off: might miss some edge cases in the data, but for the user's 'urgent' request, speed is more important than exhaustive accuracy.",
  "index": 5,
  "timestamp": "2025-11-06T10:30:25Z",
  "metadata": {
    "confidence": 0.8,
    "alternatives": [
      "Use full database query (more accurate but 10-15s)",
      "Ask user to confirm speed vs accuracy preference"
    ],
    "relatedTo": "call-tool-002"
  }
}
```

#### `internal:thought-process`

Internal version with more detailed reasoning (not sent to clients by default, used for debugging).

```typescript
interface InternalThoughtProcessEvent {
  kind: 'internal:thought-process';
  contextId: string;
  taskId: string;
  iteration: number;             // Which iteration in the loop
  stage: 'pre-llm' | 'post-llm' | 'pre-tool' | 'post-tool';
  reasoning: string;             // Internal reasoning
  state: Record<string, unknown>; // Current execution state
  timestamp: string;
}
```

**Example - Internal Reasoning**:
```json
{
  "kind": "internal:thought-process",
  "contextId": "ctx-abc123",
  "taskId": "task-xyz789",
  "iteration": 2,
  "stage": "post-llm",
  "reasoning": "LLM requested 3 tools. Prioritizing database query first since other tools depend on its results.",
  "state": {
    "pendingTools": ["search_db", "analyze_data", "generate_chart"],
    "messagesCount": 5,
    "tokensUsed": 1247
  },
  "timestamp": "2025-11-06T10:30:18Z"
}
```

### 10. Internal/Debug Events

These events are for observability and debugging - not typically sent to clients.

#### `internal:llm-call`

LLM API call started.

```typescript
interface InternalLLMCallEvent {
  kind: 'internal:llm-call';
  contextId: string;
  taskId: string;
  iteration: number;             // Which iteration in loop
  model: string;
  messageCount: number;
  toolCount: number;
  timestamp: string;
}
```

#### `internal:checkpoint`

State checkpoint saved.

```typescript
interface InternalCheckpointEvent {
  kind: 'internal:checkpoint';
  contextId: string;
  taskId: string;
  iteration: number;
  timestamp: string;
}
```

### Client Event Filtering

Clients can subscribe to specific event kinds or patterns:

```typescript
// Subscribe to all events in context
eventSource.addEventListener('*', handler);

// Subscribe to specific event kinds
eventSource.addEventListener('task-status', handler);
eventSource.addEventListener('content-delta', handler);

// Programmatic filtering
events$.pipe(
  filter(event => event.kind === 'tool-progress'),
  filter(event => event.taskId === myTaskId)
).subscribe(handler);

// Filter thought streams by verbosity
events$.pipe(
  filter(event => event.kind === 'thought-stream'),
  filter(event => event.verbosity === 'brief' || event.verbosity === 'normal')
).subscribe(handler);

// Filter by thought type
events$.pipe(
  filter(event => event.kind === 'thought-stream'),
  filter(event => ['planning', 'decision'].includes(event.thoughtType))
).subscribe(handler);
```

### Internal vs External Events

**External Events** (sent to clients):
- All task lifecycle events
- Content streaming events
- Tool events (start, progress, complete)
- Input/auth required events
- Artifact events
- Subtask events
- **Thought streaming events** (thought-stream)

**Internal Events** (not sent to clients):
- `internal:*` events (including `internal:thought-process`)
- Used for observability, metrics, debugging
- Logged to OpenTelemetry/application logs

### Event Routing Rules

1. **User-Required Input**: `input-required` with `requireUser: true` → **MUST** propagate to originating user
2. **Coordinator-Optional Input**: `input-required` with `requireUser: false` or `undefined` → Coordinator can handle OR forward to user
3. **Authentication**: `auth-required` events **always** propagate to user (no coordinator handling)
4. **Subtask Events**: Events from subtasks (`parentTaskId` set) → Sent to parent agent, optionally forwarded to user
5. **Broadcast**: Most events sent to all subscribers of the context

## SSE Format

### Wire Format

```
HTTP/1.1 200 OK
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive

event: task-created
data: {"kind":"task-created","contextId":"ctx-123","taskId":"task-456",...}

event: task-status
data: {"kind":"task-status","contextId":"ctx-123","taskId":"task-456","status":"working",...}

event: content-delta
data: {"kind":"content-delta","contextId":"ctx-123","taskId":"task-456","delta":"Hello",...}

event: task-complete
data: {"kind":"task-complete","contextId":"ctx-123","taskId":"task-456",...}

```

**Notes**:
- `event:` field = event kind (without `internal:` prefix for internal events)
- `data:` field = JSON-encoded event object
- Each event is a complete JSON object (no partial parsing needed)

### Client Subscription

```typescript
const eventSource = new EventSource(`/api/contexts/${contextId}/stream`);

eventSource.addEventListener('task-status', (e) => {
  const event = JSON.parse(e.data) as TaskStatusEvent;
  console.log(`Task ${event.taskId} is ${event.status}`);
});

eventSource.addEventListener('content-delta', (e) => {
  const event = JSON.parse(e.data) as ContentDeltaEvent;
  appendToDisplay(event.delta);
});

eventSource.addEventListener('input-required', (e) => {
  const event = JSON.parse(e.data) as InputRequiredEvent;
  if (event.requireUser) {
    promptUser(event);
  } else {
    // Coordinator can try to handle, fall back to user if needed
    tryCoordinatorHandle(event) || promptUser(event);
  }
});
```

## Mapping to A2A Protocol

For external A2A communication, internal events are mapped:

| Internal Event | A2A Event |
|---------------|-----------|
| `task-created` | `task` (initial) |
| `task-status: working` | `status-update: working` |
| `task-status: completed` | `status-update: completed` |
| `task-status: failed` | `status-update: failed` |
| `content-delta` | `artifact-update` (text part) |
| `artifact-delta` | `artifact-update` (with append flag) |
| `input-required: tool-execution` | `status-update: input-required` |
| Internal events (`internal:*`) | *(not mapped)* |

## Open Questions for Collaboration

### 1. Thought Streaming Configuration

For thought streaming, should we support:
- ✅ **Verbosity levels**: Brief, normal, detailed thought streams (IMPLEMENTED)
- **Filtering**: Server-side filtering by thoughtType/verbosity, or client-side only?
- **Privacy**: Should some thoughts be marked as "internal only"?
- **Confidence threshold**: Only stream thoughts above certain confidence level?
- **Adaptive verbosity**: Should verbosity adapt based on task complexity or user preferences?

### 2. Tool Progress Granularity?

For long-running tools, should we support:
- **Structured progress**: Steps, stages, phases?
- **Cancelation**: Can user cancel long-running tools mid-execution?
- **Progress estimation**: Time-remaining estimates?

### 3. Artifact Syncing?

For collaborative editing of artifacts:
- **Operational Transform (OT)** or **CRDT** semantics?
- **Conflict resolution**: How to handle concurrent edits?
- **Version tracking**: Track artifact versions?

### 4. Error Handling?

Should we have explicit error events, or embed errors in existing events?
- **`error`** event kind vs `task-status: failed`?
- **Retryable** vs **terminal** errors?
- **Error codes** for programmatic handling?

### 5. Event Ordering Guarantees?

- **Per-task ordering**: Guaranteed within a task?
- **Cross-task ordering**: Best-effort across tasks?
- **Event IDs**: Should events have monotonic IDs for ordering?

### 6. Backpressure?

If client is slow consuming events:
- **Buffer**: How many events to buffer server-side?
- **Drop**: Drop events if buffer full (with notification)?
- **Block**: Block agent execution until client catches up?

### 7. Reconnection?

If SSE connection drops:
- **Resume**: Can client resume from last event?
- **Event IDs**: Use SSE `id:` field for resume?
- **Replay**: Should server support event replay?

## Implementation Notes

### Event Emission in AgentLoop

```typescript
class AgentLoop {
  startTurn(messages: Message[], context: TurnContext): Observable<InternalEvent> {
    return defer(() => this.execute(context)).pipe(
      // Emit events throughout execution
      tap(state => this.emitTaskCreated(state)),
      tap(state => this.emitTaskStatus(state, 'working')),
      switchMap(state => this.runIteration(state)),
      tap(result => this.emitTaskComplete(result)),
      catchError(err => this.emitTaskFailed(err))
    );
  }
}
```

### Event Filtering for Clients

```typescript
// Server filters internal events before sending to client
function filterForClient(event: InternalEvent): InternalEvent | null {
  if (event.kind.startsWith('internal:')) {
    return null; // Don't send to client
  }
  return event;
}
```

### A2A Mapping

```typescript
function mapToA2AEvent(internalEvent: InternalEvent): A2AEvent | null {
  switch (internalEvent.kind) {
    case 'task-created':
      return { kind: 'task', id: internalEvent.taskId, ... };
    case 'task-status':
      return { kind: 'status-update', status: internalEvent.status, ... };
    case 'content-delta':
      return { kind: 'artifact-update', artifact: { parts: [{ kind: 'text', text: internalEvent.delta }] }, ... };
    // ... other mappings
    default:
      return null; // No A2A equivalent
  }
}
```

## Next Steps

1. **Review & Discuss**: Review this design and discuss open questions
2. **Prototype**: Implement core event types in AgentLoop
3. **Test**: Test with example scenarios (tool execution, subtasks, etc.)
4. **Iterate**: Refine based on real usage patterns
5. **Document**: Update implementation docs with event catalog

---

**Status**: 🚧 Draft - Open for Collaboration

**Contributors**: [Your names here]

**Last Updated**: 2025-11-06
