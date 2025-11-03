# A2A Protocol Specification

## Overview

The Agent-to-Agent (A2A) protocol is a JSON-RPC 2.0 based communication protocol that uses Server-Sent Events (SSE) for real-time task updates. This implementation follows the [official A2A specification](https://a2a-protocol.org/latest/specification/) version 0.3.0, using **JSON-RPC 2.0 transport** as the default.

## Protocol Goals

1. **Interoperability**: Standard agent-to-agent communication
2. **Real-time Updates**: Stream task progress via SSE
3. **JSON-RPC 2.0**: Standard RPC format with SSE streaming
4. **Hierarchical Tasks**: Support nested agent invocations
5. **Standardized**: Compliance with official A2A specification

## Transport Layer

### Request Format (message/stream)

**Endpoint**: `POST /api/a2a` (or agent's declared URL)

**Headers**:
```http
Content-Type: application/json
Authorization: Bearer <token>
Accept: text/event-stream
Traceparent: 00-<trace-id>-<span-id>-01
```

**Body** (JSON-RPC 2.0 format):
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "message/stream",
  "params": {
    "message": {
      "kind": "message",
      "role": "user",
      "parts": [
        {
          "kind": "text",
          "text": "Analyze sales data and generate report"
        }
      ],
      "messageId": "msg-123"
    },
    "configuration": {
      "acceptedOutputModes": ["application/json", "text/plain"],
      "historyLength": 10
    }
  }
}
```

### Response Format (SSE Stream)

```http
HTTP/1.1 200 OK
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
```

**SSE Event Stream** - Each `data:` line contains a complete JSON-RPC 2.0 response:

```
data: {"jsonrpc":"2.0","id":1,"result":{"kind":"task","id":"task-123","contextId":"ctx-456","status":{"state":"submitted","timestamp":"2025-10-30T10:00:00Z"},"history":[...]}}

data: {"jsonrpc":"2.0","id":1,"result":{"kind":"status-update","taskId":"task-123","contextId":"ctx-456","status":{"state":"working","timestamp":"2025-10-30T10:00:01Z"},"final":false}}

data: {"jsonrpc":"2.0","id":1,"result":{"kind":"artifact-update","taskId":"task-123","contextId":"ctx-456","artifact":{"artifactId":"art-1","parts":[{"kind":"text","text":"Analysis: "}]},"append":false,"lastChunk":false}}

data: {"jsonrpc":"2.0","id":1,"result":{"kind":"artifact-update","taskId":"task-123","contextId":"ctx-456","artifact":{"artifactId":"art-1","parts":[{"kind":"text","text":"Sales increased"}]},"append":true,"lastChunk":false}}

data: {"jsonrpc":"2.0","id":1,"result":{"kind":"artifact-update","taskId":"task-123","contextId":"ctx-456","artifact":{"artifactId":"art-1","parts":[{"kind":"text","text":", by 15%"}]},"append":true,"lastChunk":true}}

data: {"jsonrpc":"2.0","id":1,"result":{"kind":"status-update","taskId":"task-123","contextId":"ctx-456","status":{"state":"completed","timestamp":"2025-10-30T10:00:15Z"},"final":true}}

```

## Message Specifications

### Initial Task Response

The first event contains the complete Task object:

```typescript
interface Task {
  kind: "task";
  id: string;                    // Task ID
  contextId: string;             // Context/session ID
  status: TaskStatus;
  history?: Message[];
  artifacts?: Artifact[];
  metadata?: Record<string, any>;
}

interface TaskStatus {
  state: TaskState;
  message?: Message;
  timestamp?: string;            // ISO 8601
}

type TaskState =
  | "submitted"
  | "working"
  | "input-required"
  | "completed"
  | "canceled"
  | "failed"
  | "rejected"
  | "auth-required"
  | "unknown";
```

**Example**:
```
data: {"jsonrpc":"2.0","id":1,"result":{"kind":"task","id":"task-123","contextId":"ctx-456","status":{"state":"submitted","timestamp":"2025-10-30T10:00:00Z"}}}

```

### Status Update Events

```typescript
interface TaskStatusUpdateEvent {
  kind: "status-update";
  taskId: string;
  contextId: string;
  status: TaskStatus;
  final: boolean;              // true if last event in stream
  metadata?: Record<string, any>;
}
```

**Examples**:

Working State:
```
data: {"jsonrpc":"2.0","id":1,"result":{"kind":"status-update","taskId":"task-123","contextId":"ctx-456","status":{"state":"working","timestamp":"2025-10-30T10:00:01Z"},"final":false}}

```

Completed State (Final):
```
data: {"jsonrpc":"2.0","id":1,"result":{"kind":"status-update","taskId":"task-123","contextId":"ctx-456","status":{"state":"completed","timestamp":"2025-10-30T10:00:15Z"},"final":true}}

```

### Artifact Update Events

Used for streaming content (e.g., LLM output chunks):

```typescript
interface TaskArtifactUpdateEvent {
  kind: "artifact-update";
  taskId: string;
  contextId: string;
  artifact: Artifact;
  append?: boolean;            // If true, append to existing artifact
  lastChunk?: boolean;         // If true, final chunk of artifact
  metadata?: Record<string, any>;
}

interface Artifact {
  artifactId: string;
  name?: string;
  description?: string;
  parts: Part[];
  metadata?: Record<string, any>;
  extensions?: string[];
}

type Part = TextPart | FilePart | DataPart;

interface TextPart {
  kind: "text";
  text: string;
  metadata?: Record<string, any>;
}

interface FilePart {
  kind: "file";
  file: {
    name?: string;
    mimeType?: string;
    bytes?: string;              // Base64 encoded
    uri?: string;
  };
  metadata?: Record<string, any>;
}

interface DataPart {
  kind: "data";
  data: Record<string, any>;
  metadata?: Record<string, any>;
}
```

**Examples**:

First Chunk:
```
data: {"jsonrpc":"2.0","id":1,"result":{"kind":"artifact-update","taskId":"task-123","contextId":"ctx-456","artifact":{"artifactId":"art-1","parts":[{"kind":"text","text":"Based on "}]},"append":false,"lastChunk":false}}

```

Subsequent Chunk (Append):
```
data: {"jsonrpc":"2.0","id":1,"result":{"kind":"artifact-update","taskId":"task-123","contextId":"ctx-456","artifact":{"artifactId":"art-1","parts":[{"kind":"text","text":"the analysis"}]},"append":true,"lastChunk":false}}

```

Final Chunk:
```
data: {"jsonrpc":"2.0","id":1,"result":{"kind":"artifact-update","taskId":"task-123","contextId":"ctx-456","artifact":{"artifactId":"art-1","parts":[{"kind":"text","text":", sales increased 15%"}]},"append":true,"lastChunk":true}}

```

### Error Responses

```typescript
interface JSONRPCErrorResponse {
  jsonrpc: "2.0";
  id: number | string | null;
  error: {
    code: number;
    message: string;
    data?: any;
  };
}
```

**Example**:
```
data: {"jsonrpc":"2.0","id":1,"error":{"code":-32001,"message":"Task not found","data":{"taskId":"task-999"}}}

```
```

## Message Types Reference

### Task Object (Initial Response)

Returned as the first event in `message/stream`:

```typescript
interface Message {
  kind: "message";
  role: "user" | "agent";
  parts: Part[];
  metadata?: Record<string, any>;
  extensions?: string[];
  referenceTaskIds?: string[];
  messageId: string;
  taskId?: string;
  contextId?: string;
}
```

## Sub-Agent Communication

In A2A, sub-agent invocation is handled through the `referenceTaskIds` field in messages. When an agent needs to invoke another agent:

1. **Parent agent creates a new message/stream request** to the sub-agent
2. **Parent includes its taskId** in the `referenceTaskIds` array
3. **Sub-agent responds** with its own task stream
4. **Parent agent includes sub-agent result** in its status message

### Flow Example

1. **Client invokes main agent**:
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "message/stream",
  "params": {
    "message": {
      "kind": "message",
      "role": "user",
      "parts": [{"kind": "text", "text": "Analyze sales and create report"}],
      "messageId": "msg-1"
    }
  }
}
```

2. **Main agent status** (needs sub-agent):
```
data: {"jsonrpc":"2.0","id":1,"result":{"kind":"status-update","taskId":"main-123","contextId":"ctx-1","status":{"state":"working","message":{"kind":"message","role":"agent","parts":[{"kind":"text","text":"Invoking data analyzer..."}],"messageId":"msg-2"},"timestamp":"2025-10-30T10:00:01Z"},"final":false}}

```

3. **Main agent invokes sub-agent** (new message/stream to sub-agent endpoint):
```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "message/stream",
  "params": {
    "message": {
      "kind": "message",
      "role": "user",
      "parts": [{"kind": "text", "text": "Analyze Q4 sales data"}],
      "messageId": "msg-3",
      "referenceTaskIds": ["main-123"]  // Links to parent task
    }
  }
}
```

4. **Sub-agent returns results** via its own stream (taskId: "sub-456")

5. **Main agent continues** with sub-agent results:
```
data: {"jsonrpc":"2.0","id":1,"result":{"kind":"status-update","taskId":"main-123","contextId":"ctx-1","status":{"state":"working","message":{"kind":"message","role":"agent","parts":[{"kind":"text","text":"Received analysis results, generating report..."}],"messageId":"msg-4"},"timestamp":"2025-10-30T10:00:05Z"},"final":false}}

```

### Client Handling

```typescript
// Track related tasks
const taskRelations = new Map<string, string[]>();

async function invokeWithSubAgents(prompt: string) {
  const mainResponse = await streamMessage({
    jsonrpc: "2.0",
    id: 1,
    method: "message/stream",
    params: {
      message: {
        kind: "message",
        role: "user",
        parts: [{ kind: "text", text: prompt }],
        messageId: generateId()
      }
    }
  });

  for await (const event of mainResponse) {
    if (event.result.kind === "status-update") {
      // Check if agent needs to invoke sub-agent
      const message = event.result.status.message;
      if (message?.referenceTaskIds) {
        // Track relationship
        taskRelations.set(event.result.taskId, message.referenceTaskIds);
      }
    }
  }
}
```

## Client Tool Invocation

The A2A protocol supports client-side tool execution through the `input-required` state. When an agent needs the client to execute a tool or provide input:

If the agent requires user input, it returns `input-required` state:

```
data: {"jsonrpc":"2.0","id":1,"result":{"kind":"status-update","taskId":"task-789","contextId":"ctx-1","status":{"state":"input-required","message":{"kind":"message","role":"agent","parts":[{"kind":"text","text":"Please provide your API key"}],"messageId":"msg-5","inputRequest":{"kind":"input-request","prompt":"Enter API key:","sensitive":true,"requestId":"input-1"}},"timestamp":"2025-10-30T10:00:02Z"},"final":false}}

```

Client tool invocation (via `parts` in a message):

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "message/stream",
  "params": {
    "message": {
      "kind": "message",
      "role": "user",
      "parts": [
        {"kind": "text", "text": "Here is the requested input:"},
        {
          "kind": "tool-result",
          "toolUseId": "input-1",
          "result": {"value": "secret-key-123"}
        }
      ],
      "messageId": "msg-6",
      "referenceTaskIds": ["task-789"]
    }
  }
}
```

### Implementation Example

```typescript
async function handleInputRequired(event: StatusUpdateEvent) {
  if (event.result.status.state === "input-required") {
    const inputRequest = event.result.status.message?.inputRequest;
    if (inputRequest) {
      // Execute client-side tool or get user input
      const result = await executeClientTool(inputRequest);

      // Send result back via new message
      await fetch("/api/a2a", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 3,
          method: "message/stream",
          params: {
            message: {
              kind: "message",
              role: "user",
              parts: [
                { kind: "text", text: "Tool result:" },
                {
                  kind: "tool-result",
                  toolUseId: inputRequest.requestId,
                  result: result
                }
              ],
              messageId: generateId(),
              referenceTaskIds: [event.result.taskId]
            }
          }
        })
      });
    }
  }
}
```

## Connection Management

### Task Resubscription

Clients can reconnect to an existing task after disconnection:

**Request**:
```json
{
  "jsonrpc": "2.0",
  "id": 4,
  "method": "tasks/get",
  "params": {
    "taskId": "task-123"
  }
}
```

**Response** (SSE stream from current state):
```
data: {"jsonrpc":"2.0","id":4,"result":{"kind":"status-update","taskId":"task-123","contextId":"ctx-1","status":{"state":"working","message":{"kind":"message","role":"agent","parts":[{"kind":"text","text":"Processing..."}],"messageId":"msg-7"},"timestamp":"2025-10-30T10:00:10Z"},"final":false}}

```

### Timeout Handling (Connection Management)

If client doesn't respond within a reasonable time, agent may:

1. **Continue without the result**:
```
data: {"jsonrpc":"2.0","id":1,"result":{"kind":"status-update","taskId":"task-123","contextId":"ctx-1","status":{"state":"working","message":{"kind":"message","role":"agent","parts":[{"kind":"text","text":"Continuing without client input..."}],"messageId":"msg-8"},"timestamp":"2025-10-30T10:05:00Z"},"final":false}}

```

2. **Fail the task**:
```
data: {"jsonrpc":"2.0","id":1,"error":{"code":-32001,"message":"Input timeout","data":{"taskId":"task-123","timeoutSeconds":300}}}

```

## Error Handling

### JSON-RPC Error Codes

The protocol uses standard JSON-RPC 2.0 error codes plus A2A-specific extensions:

| Code   | Message               | Meaning                 |
| ------ | --------------------- | ----------------------- |
| -32700 | Parse error           | Invalid JSON            |
| -32600 | Invalid request       | Missing required fields |
| -32601 | Method not found      | Unknown method          |
| -32602 | Invalid params        | Malformed parameters    |
| -32603 | Internal error        | Server-side failure     |
| -32001 | Input timeout         | Client didn't respond   |
| -32002 | Tool execution failed | Tool invocation error   |
| -32003 | Context not found     | Invalid contextId       |
| -32004 | Task not found        | Invalid taskId          |

## Task Lifecycle

### Complete Flow Diagram

```
Client                           Agent
  |                                |
  |-- message/stream (JSON-RPC) ->|
  |<---- task (initial) ----------|
  |                                |
  |<---- status: working ---------|
  |<---- artifact: chunk ---------|
  |<---- artifact: chunk ---------|
  |                                |
  |<---- status: input-required --|
  |-- message/stream (result) --->|
  |                                |
  |<---- status: working ---------|
  |<---- artifact: final ---------|
  |<---- status: completed -------|
  |                                |
```

### State Transitions

```
[started] -> [working] -> [completed]
            |         |
            v         v
     [input-required] [failed]
            |
            v
         [working]
```

## Implementation

### Server-Side (TypeScript)

```typescript
import { Router, Request, Response } from "express";
import { Observable, Subject } from "rxjs";

interface JSONRPCRequest {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: any;
}

interface JSONRPCResponse {
  jsonrpc: "2.0";
  id: number | string;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

const router = Router();

// JSON-RPC 2.0 endpoint
router.post("/api/a2a", async (req: Request, res: Response) => {
  const request: JSONRPCRequest = req.body;

  // Validate JSON-RPC 2.0 format
  if (request.jsonrpc !== "2.0" || !request.method || request.id === undefined) {
    return res.status(400).json({
      jsonrpc: "2.0",
      id: request.id || null,
      error: {
        code: -32600,
        message: "Invalid Request",
        data: { reason: "Must be valid JSON-RPC 2.0" }
      }
    });
  }

  // Route by method
  if (request.method === "message/stream") {
    return handleMessageStream(req, res, request);
  } else if (request.method === "tasks/get") {
    return handleTasksGet(req, res, request);
  } else {
    return res.status(200).json({
      jsonrpc: "2.0",
      id: request.id,
      error: {
        code: -32601,
        message: "Method not found",
        data: { method: request.method }
      }
    });
  }
});

async function handleMessageStream(
  req: Request,
  res: Response,
  rpcRequest: JSONRPCRequest
) {
  const { message } = rpcRequest.params || {};

  if (!message || message.kind !== "message") {
    return res.status(200).json({
      jsonrpc: "2.0",
      id: rpcRequest.id,
      error: {
        code: -32602,
        message: "Invalid params",
        data: { reason: "message.kind must be 'message'" }
      }
    });
  }

  // Set up SSE
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const taskId = generateTaskId();
  const contextId = message.contextId || generateContextId();

  // Send initial task response
  res.write(
    `data: ${JSON.stringify({
      jsonrpc: "2.0",
      id: rpcRequest.id,
      result: {
        kind: "task",
        id: taskId,
        contextId,
        status: { state: "started", timestamp: new Date().toISOString() }
      }
    })}\n\n`
  );

  // Create agent processing observable
  const events$ = processMessage(message, taskId, contextId);

  // Stream events
  events$.subscribe({
    next: (event) => {
      res.write(
        `data: ${JSON.stringify({
          jsonrpc: "2.0",
          id: rpcRequest.id,
          result: event
        })}\n\n`
      );
    },
    error: (err) => {
      res.write(
        `data: ${JSON.stringify({
          jsonrpc: "2.0",
          id: rpcRequest.id,
          error: {
            code: -32603,
            message: "Internal error",
            data: { error: err.message }
          }
        })}\n\n`
      );
      res.end();
    },
    complete: () => {
      res.end();
    }
  });

  // Handle client disconnect
  req.on("close", () => {
    // Client disconnected, keep task state for potential resubscription
  });
}

function processMessage(
  message: any,
  taskId: string,
  contextId: string
): Observable<any> {
  return new Observable((subscriber) => {
    // Status update
    subscriber.next({
      kind: "status-update",
      taskId,
      contextId,
      status: {
        state: "working",
        message: {
          kind: "message",
          role: "agent",
          parts: [{ kind: "text", text: "Processing..." }],
          messageId: generateId()
        },
        timestamp: new Date().toISOString()
      },
      final: false
    });

    // Artifact updates
    subscriber.next({
      kind: "artifact-update",
      taskId,
      contextId,
      index: 0,
      part: {
        kind: "text",
        text: "Result content here...",
        index: 0,
        append: false
      },
      timestamp: new Date().toISOString()
    });

    // Final status
    subscriber.next({
      kind: "status-update",
      taskId,
      contextId,
      status: {
        state: "completed",
        timestamp: new Date().toISOString()
      },
      final: true
    });

    subscriber.complete();
  });
}
```

### Client-Side (TypeScript)

```typescript
interface A2AEvent {
  kind: "task" | "status-update" | "artifact-update";
  taskId?: string;
  contextId?: string;
  [key: string]: any;
}

async function* streamMessage(message: any): AsyncGenerator<A2AEvent> {
  const response = await fetch("/api/a2a", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "message/stream",
      params: { message }
    })
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || "Request failed");
  }

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        const data = JSON.parse(line.slice(6));
        // Unwrap JSON-RPC response
        if (data.result) {
          yield data.result;
        } else if (data.error) {
          throw new Error(data.error.message);
        }
      }
    }
  }
}

// Usage
async function example() {
  const events = streamMessage({
    kind: "message",
    role: "user",
    parts: [{ kind: "text", text: "Hello!" }],
    messageId: "msg-1"
  });

  for await (const event of events) {
    if (event.kind === "status-update") {
      console.log("Status:", event.status.state);
    } else if (event.kind === "artifact-update") {
      console.log("Artifact:", event.part);
    }
  }
}
```

## Summary

### Key Protocol Features

1. **JSON-RPC 2.0 Transport**: All requests/responses use JSON-RPC 2.0 format
2. **SSE Streaming**: Server-Sent Events for real-time updates
3. **Task-Based**: All operations tracked via unique task IDs
4. **Context Preservation**: Conversations maintained via context IDs
5. **Sub-Agent Support**: Hierarchical agent invocation via `referenceTaskIds`
6. **Client Tools**: Input requests for client-side tool execution
7. **Error Handling**: Standard JSON-RPC error codes + A2A extensions
8. **Reconnection**: Task resubscription after disconnection

### Compliance with A2A v0.3.0

This implementation follows the official A2A specification v0.3.0:
- ✅ JSON-RPC 2.0 as default transport
- ✅ `kind` property first in all result objects
- ✅ SSE for streaming responses
- ✅ Task lifecycle states (started, working, input-required, completed, failed)
- ✅ Message parts structure (text, data, tool-result, tool-use)
- ✅ Artifact streaming with chunking support
- ✅ Error responses with proper codes
- ✅ Context and task ID management
- ✅ Sub-agent communication pattern
- ✅ Client tool invocation via input-required

### Integration with RxJS Agent

The A2A protocol integration in this project:

1. **AgentLoop**: Processes messages and emits A2A events via Observable streams
2. **ToolProviders**: Execute tools (local, MCP, client) and format results as A2A messages
3. **Authentication**: Validates JWT/API keys before accepting A2A requests
4. **Observability**: Emits OpenTelemetry spans for each A2A event
5. **Extension Points**: Allows custom A2A event handlers and transformers

See [architecture.md](./architecture.md) for overall system design.
```

## Security

### Authentication

All requests must include authentication via HTTP headers:

```http
Authorization: Bearer <JWT-token>
```

Authentication is declared in the Agent Card:

```json
{
  "securitySchemes": {
    "bearer": {
      "type": "http",
      "scheme": "bearer",
      "bearerFormat": "JWT"
    }
  },
  "security": [
    {"bearer": []}
  ]
}
```

### Authorization

Agents implement authorization based on:
- Authenticated user identity
- Requested skills (from Agent Card)
- OAuth scopes (if applicable)

Failed authorization returns:
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "error": {
    "code": -32603,
    "message": "Forbidden: Insufficient permissions for skill 'admin-tools'"
  }
}
```

### Rate Limiting

Standard HTTP rate limit headers:

```http
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1698662400
```

## Tracing

### W3C Trace Context

Propagate trace context via standard W3C headers:

**Request**:
```http
POST /v1/message:stream
Traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
Tracestate: vendor=value
```

**Response** (include trace info in metadata):
```
data: {"kind":"status-update","taskId":"task-123","contextId":"ctx-1","status":{"state":"working"},"metadata":{"traceId":"4bf92f3577b34da6a3ce929d0e0e4736","spanId":"53995c3f42cd8ad8"},"final":false}

```

## Implementation Example

### Server (TypeScript/Express + RxJS)

```typescript
import { Router } from 'express';
import { AgentLoop } from './agent-loop';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

router.post('/v1/message:stream', async (req, res) => {
  const { message, configuration } = req.body;

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const taskId = uuidv4();
  const contextId = message.contextId || uuidv4();

  // Create initial Task response
  const initialTask = {
    kind: 'task',
    id: taskId,
    contextId,
    status: {
      state: 'submitted',
      timestamp: new Date().toISOString()
    },
    history: [message]
  };

  // Send initial task
  res.write(`data: ${JSON.stringify(initialTask)}\n\n`);

  // Create agent loop and subscribe
  const agent = new AgentLoop();

  agent.invoke(message.parts, { taskId, contextId }).subscribe({
    next: (event) => {
      // Map internal events to A2A format
      let a2aEvent;

      if (event.type === 'status-update') {
        a2aEvent = {
          kind: 'status-update',
          taskId,
          contextId,
          status: {
            state: event.state,
            timestamp: new Date().toISOString()
          },
          final: event.final || false
        };
      } else if (event.type === 'artifact-chunk') {
        a2aEvent = {
          kind: 'artifact-update',
          taskId,
          contextId,
          artifact: {
            artifactId: event.artifactId,
            parts: [{ kind: 'text', text: event.chunk }]
          },
          append: event.append,
          lastChunk: event.lastChunk
        };
      }

      if (a2aEvent) {
        res.write(`data: ${JSON.stringify(a2aEvent)}\n\n`);
      }
    },
    complete: () => {
      // Send final status update
      const finalEvent = {
        kind: 'status-update',
        taskId,
        contextId,
        status: {
          state: 'completed',
          timestamp: new Date().toISOString()
        },
        final: true
      };
      res.write(`data: ${JSON.stringify(finalEvent)}\n\n`);
      res.end();
    },
    error: (error) => {
      const errorEvent = {
        error: {
          code: 500,
          message: error.message,
          data: { taskId }
        }
      };
      res.write(`data: ${JSON.stringify(errorEvent)}\n\n`);
      res.end();
    }
  });

  // Keep-alive interval
  const keepAlive = setInterval(() => {
    res.write(': keep-alive\n\n');
  }, 30000);

  req.on('close', () => {
    clearInterval(keepAlive);
    agent.cancel(taskId);
  });
});

// Non-streaming message/send endpoint
router.post('/v1/message:send', async (req, res) => {
  const { message } = req.body;

  const agent = new AgentLoop();
  const taskId = message.taskId || uuidv4();
  const contextId = message.contextId || uuidv4();

  try {
    const result = await agent.invokeSync(message.parts, { taskId, contextId });

    res.json({
      kind: 'task',
      id: taskId,
      contextId,
      status: {
        state: 'completed',
        timestamp: new Date().toISOString()
      },
      artifacts: result.artifacts
    });
  } catch (error) {
    res.status(500).json({
      error: {
        code: 500,
        message: error.message
      }
    });
  }
});

export default router;
```

### Client (TypeScript)

```typescript
interface A2AClient {
  streamMessage(params: MessageSendParams): AsyncIterableIterator<A2AStreamEvent>;
  sendMessage(params: MessageSendParams): Promise<Task>;
}

interface MessageSendParams {
  message: Message;
  configuration?: {
    acceptedOutputModes?: string[];
    historyLength?: number;
  };
}

type A2AStreamEvent =
  | Task
  | TaskStatusUpdateEvent
  | TaskArtifactUpdateEvent
  | { error: { code: number; message: string; data?: any } };

class A2AClientImpl implements A2AClient {
  constructor(
    private baseUrl: string,
    private token: string
  ) {}

  async *streamMessage(params: MessageSendParams): AsyncIterableIterator<A2AStreamEvent> {
    const response = await fetch(`${this.baseUrl}/v1/message:stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.token}`,
        'Accept': 'text/event-stream'
      },
      body: JSON.stringify(params)
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`HTTP ${response.status}: ${error.error?.message || 'Unknown error'}`);
      const error = await response.json();
      throw new Error(`Request failed: ${error.error?.message || 'Unknown error'}`);
    }

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();

      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Parse SSE events
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';  // Keep incomplete line in buffer

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data.trim()) {
            try {
              const rpcResponse = JSON.parse(data);

              // Unwrap JSON-RPC response
              if (rpcResponse.result) {
                yield rpcResponse.result;

                // Stop if final event
                if (rpcResponse.result.kind === 'status-update' && rpcResponse.result.final === true) {
                  return;
                }
              } else if (rpcResponse.error) {
                throw new Error(rpcResponse.error.message);
              }
            } catch (e) {
              console.warn('Failed to parse SSE data:', data);
            }
          }
        }
      }
    }
  }

  async sendMessage(params: MessageSendParams): Promise<Task> {
    const response = await fetch(`${this.baseUrl}/api/a2a`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.token}`
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: Date.now(),
        method: "message/send",
        params
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`HTTP ${response.status}: ${error.error?.message || 'Unknown error'}`);
    }

    const rpcResponse = await response.json();
    if (rpcResponse.error) {
      throw new Error(rpcResponse.error.message);
    }

    return rpcResponse.result;
  }
}

// Usage example
async function example() {
  const client = new A2AClientImpl('https://agent.example.com', 'token-123');

  // Streaming
  for await (const event of client.streamMessage({
    message: {
      kind: 'message',
      role: 'user',
      parts: [{ kind: 'text', text: 'Analyze sales data' }],
      messageId: uuidv4()
    }
  })) {
    if (event.kind === 'artifact-update') {
      console.log('Artifact chunk:', event.part);
    } else if (event.kind === 'status-update') {
      console.log('Status:', event.status.state);
    } else if (event.kind === 'task') {
      console.log('Task started:', event.id);
    }
  }

  // Non-streaming
  const task = await client.sendMessage({
    message: {
      kind: 'message',
      role: 'user',
      parts: [{ kind: 'text', text: 'Quick question' }],
      messageId: uuidv4()
    }
  });
  console.log('Result:', task);
}
```

## Reference

- **Specification**: https://a2a-protocol.org/latest/specification/
- **Version**: 0.3.0
- **Default Transport**: JSON-RPC 2.0 with SSE Streaming
- **Alternative Transport**: HTTP+JSON/REST with SSE Streaming
- **Sections Referenced**: 3.2 (JSON-RPC), 3.3.2 (SSE), 6 (Data Objects)
