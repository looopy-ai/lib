# A2A Protocol Alignment

## Summary

**Issue Identified**: Our internal `AgentEvent` types were not aligned with the A2A protocol event specification.

**Resolution**: Refactored `AgentEvent` to use A2A protocol event types directly, ensuring complete compatibility.

## Benefits

### 1. **Protocol Compliance**
Events emitted by `AgentLoop` are now **A2A-compliant by design**. No transformation needed.

### 2. **Simpler A2A Server**
The A2A server can relay events directly instead of mapping between internal and protocol types:

```typescript
// Before (transformation needed):
agentLoop.execute(prompt).subscribe(event => {
  const a2aEvent = transformToA2A(event); // mapping layer
  res.write(`data: ${JSON.stringify(a2aEvent)}\n\n`);
});

// After (direct relay):
agentLoop.execute(prompt).subscribe(event => {
  res.write(`data: ${JSON.stringify({ jsonrpc: "2.0", id: 1, result: event })}\n\n`);
});
```

### 3. **Consistency**
Same event model used internally and externally. No impedance mismatch.

### 4. **Interoperability**
Other A2A-compliant agents can consume our events without custom adapters.

## Event Type Changes

### A2A Protocol Events (Primary)

These are the main events that align with A2A specification:

#### 1. **TaskEvent** (`kind: "task"`)
Initial task response sent when execution begins.

```typescript
interface TaskEvent {
  kind: "task";
  id: string;                    // Task ID
  contextId: string;             // Context/session ID
  status: TaskStatus;
  history?: Message[];
  artifacts?: A2AArtifact[];
  metadata?: Record<string, unknown>;
}
```

**Example**:
```json
{
  "kind": "task",
  "id": "task-123",
  "contextId": "ctx-456",
  "status": {
    "state": "submitted",
    "timestamp": "2025-10-30T10:00:00Z"
  },
  "history": [...]
}
```

#### 2. **StatusUpdateEvent** (`kind: "status-update"`)
State transitions during execution.

```typescript
interface StatusUpdateEvent {
  kind: "status-update";
  taskId: string;
  contextId: string;
  status: TaskStatus;
  final: boolean;               // true if last event
  metadata?: Record<string, unknown>;
}
```

**Task States** (from A2A spec):
- `submitted` - Task received
- `working` - Agent is processing
- `input-required` - Waiting for user input
- `completed` - Task finished successfully
- `canceled` - Task canceled by user
- `failed` - Task failed with error
- `rejected` - Task rejected (e.g., policy violation)
- `auth-required` - Authentication needed
- `unknown` - State cannot be determined

**Examples**:
```json
// Working
{
  "kind": "status-update",
  "taskId": "task-123",
  "contextId": "ctx-456",
  "status": {
    "state": "working",
    "timestamp": "2025-10-30T10:00:01Z"
  },
  "final": false
}

// Completed
{
  "kind": "status-update",
  "taskId": "task-123",
  "contextId": "ctx-456",
  "status": {
    "state": "completed",
    "message": { "role": "assistant", "content": "Done!" },
    "timestamp": "2025-10-30T10:00:15Z"
  },
  "final": true
}

// Failed
{
  "kind": "status-update",
  "taskId": "task-123",
  "contextId": "ctx-456",
  "status": {
    "state": "failed",
    "timestamp": "2025-10-30T10:00:15Z"
  },
  "final": true,
  "metadata": { "error": "Connection timeout" }
}
```

#### 3. **ArtifactUpdateEvent** (`kind: "artifact-update"`)
Streaming content updates (e.g., LLM output chunks).

```typescript
interface ArtifactUpdateEvent {
  kind: "artifact-update";
  taskId: string;
  contextId: string;
  artifact: A2AArtifact;
  append?: boolean;             // true = append to existing
  lastChunk?: boolean;          // true = final chunk
  metadata?: Record<string, unknown>;
}
```

**Example - LLM Streaming**:
```json
// First chunk
{
  "kind": "artifact-update",
  "taskId": "task-123",
  "contextId": "ctx-456",
  "artifact": {
    "artifactId": "art-1",
    "parts": [{ "kind": "text", "text": "Based on " }]
  },
  "append": false,
  "lastChunk": false
}

// Subsequent chunk
{
  "kind": "artifact-update",
  "taskId": "task-123",
  "contextId": "ctx-456",
  "artifact": {
    "artifactId": "art-1",
    "parts": [{ "kind": "text", "text": "the analysis" }]
  },
  "append": true,
  "lastChunk": false
}

// Final chunk
{
  "kind": "artifact-update",
  "taskId": "task-123",
  "contextId": "ctx-456",
  "artifact": {
    "artifactId": "art-1",
    "parts": [{ "kind": "text", "text": ", sales increased 15%" }]
  },
  "append": true,
  "lastChunk": true
}
```

### Internal Events (Observability)

These events are for **internal observability only** and are NOT sent over A2A:

```typescript
type InternalEvent =
  | {
      kind: "internal:llm-call";
      taskId: string;
      iteration: number;
      timestamp: string;
    }
  | {
      kind: "internal:tool-start";
      taskId: string;
      toolName: string;
      toolCallId: string;
      timestamp: string;
    }
  | {
      kind: "internal:tool-complete";
      taskId: string;
      toolCallId: string;
      success: boolean;
      timestamp: string;
    }
  | {
      kind: "internal:checkpoint";
      taskId: string;
      iteration: number;
      timestamp: string;
    };
```

**Usage**: Debugging, metrics, tracing. Filtered out before sending to A2A clients.

## Migration Guide

### Old Event Types → New Event Types

| Old Type        | New Type              | A2A Kind                 | Notes                                              |
| --------------- | --------------------- | ------------------------ | -------------------------------------------------- |
| `started`       | `TaskEvent`           | `task`                   | Initial response with `status.state = "submitted"` |
| N/A             | `StatusUpdateEvent`   | `status-update`          | Working state `status.state = "working"`           |
| `llm-call`      | `InternalEvent`       | `internal:llm-call`      | Internal only                                      |
| `llm-chunk`     | `ArtifactUpdateEvent` | `artifact-update`        | Streaming content with `append = true`             |
| `llm-complete`  | N/A                   | N/A                      | Removed (redundant with artifact-update)           |
| `tool-start`    | `InternalEvent`       | `internal:tool-start`    | Internal only                                      |
| `tool-complete` | `InternalEvent`       | `internal:tool-complete` | Internal only                                      |
| `agent-invoke`  | `StatusUpdateEvent`   | `status-update`          | Sub-agent invocation                               |
| `iteration`     | `InternalEvent`       | `internal:checkpoint`    | Internal only                                      |
| `checkpoint`    | `InternalEvent`       | `internal:checkpoint`    | Internal only                                      |
| `complete`      | `StatusUpdateEvent`   | `status-update`          | `status.state = "completed"`, `final = true`       |
| `error`         | `StatusUpdateEvent`   | `status-update`          | `status.state = "failed"`, `final = true`          |

### Code Changes

**Before**:
```typescript
const events$ = agentLoop.execute(prompt);
events$.subscribe(event => {
  switch (event.type) {
    case 'started':
      console.log('Task started');
      break;
    case 'complete':
      console.log('Result:', event.result);
      break;
  }
});
```

**After**:
```typescript
const events$ = agentLoop.execute(prompt);
events$.subscribe(event => {
  switch (event.kind) {
    case 'task':
      console.log('Task created:', event.id);
      break;
    case 'status-update':
      if (event.status.state === 'completed') {
        console.log('Result:', event.status.message?.content);
      }
      break;
    case 'artifact-update':
      console.log('Content chunk:', event.artifact.parts[0]);
      break;
  }
});
```

## A2A Server Implementation

With aligned events, the A2A server becomes trivial:

```typescript
app.post('/api/a2a', async (req, res) => {
  const { method, params } = req.body;

  if (method === 'message/stream') {
    res.setHeader('Content-Type', 'text/event-stream');

    const events$ = agentLoop.execute(params.message.parts[0].text, {
      contextId: params.message.contextId
    });

    events$.subscribe({
      next: (event) => {
        // Direct relay - no transformation!
        if (!event.kind.startsWith('internal:')) {
          const response = {
            jsonrpc: '2.0',
            id: req.body.id,
            result: event
          };
          res.write(`data: ${JSON.stringify(response)}\n\n`);
        }
      },
      complete: () => res.end()
    });
  }
});
```

**Key Point**: The server just filters out `internal:*` events and wraps in JSON-RPC. No type mapping!

## Type Definitions

### A2A Artifact Types

```typescript
export type A2APart = A2ATextPart | A2AFilePart | A2ADataPart;

export interface A2ATextPart {
  kind: "text";
  text: string;
  metadata?: Record<string, unknown>;
}

export interface A2AFilePart {
  kind: "file";
  file: {
    name?: string;
    mimeType?: string;
    bytes?: string;  // Base64 encoded
    uri?: string;
  };
  metadata?: Record<string, unknown>;
}

export interface A2ADataPart {
  kind: "data";
  data: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface A2AArtifact {
  artifactId: string;
  name?: string;
  description?: string;
  parts: A2APart[];
  metadata?: Record<string, unknown>;
  extensions?: string[];
}
```

### Task State & Status

```typescript
export type TaskState =
  | "submitted"
  | "working"
  | "input-required"
  | "completed"
  | "canceled"
  | "failed"
  | "rejected"
  | "auth-required"
  | "unknown";

export interface TaskStatus {
  state: TaskState;
  message?: Message;
  timestamp?: string;  // ISO 8601
}
```

## Execution Flow

```
AgentLoop.execute()
  ↓
Emit: TaskEvent (kind: "task", status.state: "submitted")
  ↓
Emit: StatusUpdateEvent (kind: "status-update", status.state: "working")
  ↓
[Iterations]
  ↓
  LLM Call → Emit: InternalEvent (kind: "internal:llm-call") [internal only]
  ↓
  LLM Streaming → Emit: ArtifactUpdateEvent (kind: "artifact-update", append: true)
  ↓
  Tool Execution → Emit: InternalEvent (kind: "internal:tool-start") [internal only]
  ↓
  Tool Complete → Emit: InternalEvent (kind: "internal:tool-complete") [internal only]
  ↓
[Loop Complete]
  ↓
Emit: StatusUpdateEvent (kind: "status-update", status.state: "completed", final: true)
```

## Testing

### A2A Compliance

To verify A2A compliance:

```typescript
import { agentLoop } from './agent-loop';

const events$ = agentLoop.execute('Test prompt');
const a2aEvents: AgentEvent[] = [];

events$.subscribe({
  next: (event) => {
    // Filter internal events
    if (!event.kind.startsWith('internal:')) {
      a2aEvents.push(event);
    }
  },
  complete: () => {
    // Verify all events are A2A-compliant
    a2aEvents.forEach(event => {
      expect(['task', 'status-update', 'artifact-update']).toContain(event.kind);
    });

    // Verify first event is TaskEvent
    expect(a2aEvents[0].kind).toBe('task');

    // Verify last event is final status-update
    const lastEvent = a2aEvents[a2aEvents.length - 1];
    expect(lastEvent.kind).toBe('status-update');
    expect(lastEvent.final).toBe(true);
  }
});
```

## Files Changed

1. **`packages/core/src/types.ts`**
   - Added `TaskState`, `TaskStatus` types
   - Added `A2APart`, `A2ATextPart`, `A2AFilePart`, `A2ADataPart` types
   - Added `A2AArtifact` interface
   - Refactored `AgentEvent` to A2A event types
   - Added `TaskEvent`, `StatusUpdateEvent`, `ArtifactUpdateEvent`
   - Added `InternalEvent` for observability

2. **`packages/core/src/agent-loop.ts`**
   - Updated `execute()` error handling to emit `StatusUpdateEvent` with `state: "failed"`
   - Updated `resume()` to emit `StatusUpdateEvent` with `state: "completed"`
   - Updated `runLoop()` to emit `TaskEvent` and initial `StatusUpdateEvent`
   - Updated `stateToEvents()` to emit A2A-compliant events

3. **`packages/core/src/index.ts`**
   - Exported new A2A types

## References

- [A2A Protocol Specification v0.3.0](https://a2a-protocol.org/latest/specification/)
- [JSON-RPC 2.0 Specification](https://www.jsonrpc.org/specification)
- `design/a2a-protocol.md` - Our implementation design
