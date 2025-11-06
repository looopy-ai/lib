# Internal Event Protocol Implementation Plan

## Overview

This document outlines the implementation plan for Looopy's comprehensive internal event protocol, designed to extend beyond A2A protocol requirements to support multi-agent orchestration, tool execution, thought streaming, and rich client interaction patterns.

**Design Document**: [`design/internal-event-protocol.md`](../design/internal-event-protocol.md)

**Status**: 📋 Planning Phase

**Target Completion**: TBD

---

## Goals

1. ✅ Implement SSE-based event streaming for all agent operations
2. ✅ Support hierarchical task/subtask relationships
3. ✅ Enable rich tool execution lifecycle tracking
4. ✅ Provide thought streaming for transparency and user expectation management
5. ✅ Support three artifact types (file, data, dataset) with optimized streaming
6. ✅ Map internal events to A2A protocol where applicable
7. ✅ Enable input routing (user-required vs coordinator-optional)
8. ✅ Provide internal debug events for observability

---

## Event Types Summary

### External Events (10 categories, sent to clients):
1. **Task Lifecycle** - task-created, task-status, task-complete
2. **Content Streaming** - content-delta, content-complete
3. **Tool Execution** - tool-start, tool-progress, tool-complete
4. **Input Requests** - input-required, input-received
5. **Authentication** - auth-required, auth-completed
6. **Artifacts** - file-write, data-write, dataset-write
7. **Sub-agents** - subtask-created
8. **Thought Streaming** - thought-stream (6 types × 3 verbosity levels)

### Internal Events (observability/debugging only):
9. **Thought Process** - internal:thought-process
10. **Debug Events** - internal:llm-call, internal:checkpoint

---

## Phase 1: Core Type Definitions ✅ **COMPLETE**

**Status**: ✅ Completed January 2025
**Estimated**: 4-6 hours | **Actual**: ~2 hours

**Objective**: Define TypeScript types for all event interfaces

**Tasks**:
- ✅ Create `src/events/types.ts` with all event interfaces (649 lines)
- ✅ Define union types for event categorization
- ✅ Add JSDoc comments for all event types
- ✅ Export types from `src/events/index.ts` (127 lines)
- ✅ Create `src/events/utils.ts` with event helpers (650 lines)

**Deliverables**:
- ✅ `src/events/types.ts` - All 21 event type definitions
- ✅ `src/events/utils.ts` - 20 event creator functions + utilities
- ✅ `src/events/index.ts` - Public API exports
- ✅ Total: 1,426 lines of production-ready TypeScript
- ✅ 0 lint errors, 0 type errors

**Completion Report**: See [PHASE_1_COMPLETE.md](./PHASE_1_COMPLETE.md)

**Files Created**:
```
src/events/
├── types.ts              # All event type definitions (649 lines)
├── utils.ts              # Event creation helpers (650 lines)
└── index.ts              # Exports (127 lines)
```

**Key Types Defined**:
```typescript
// Core event union
type InternalEvent =
  | TaskLifecycleEvent
  | ContentStreamingEvent
  | ToolExecutionEvent
  | InputRequestEvent
  | AuthenticationEvent
  | ArtifactEvent
  | SubAgentEvent
  | ThoughtStreamEvent
  | InternalDebugEvent;

// Category unions
type TaskLifecycleEvent = TaskCreatedEvent | TaskStatusEvent | TaskCompleteEvent;
type ContentStreamingEvent = ContentDeltaEvent | ContentCompleteEvent;
type ToolExecutionEvent = ToolStartEvent | ToolProgressEvent | ToolCompleteEvent;
type InputRequestEvent = InputRequiredEvent | InputReceivedEvent;
type AuthenticationEvent = AuthRequiredEvent | AuthCompletedEvent;
type ArtifactEvent = FileWriteEvent | DataWriteEvent | DatasetWriteEvent;
type SubAgentEvent = SubtaskCreatedEvent;
type ThoughtStreamEvent = ThoughtStreamEvent;
type InternalDebugEvent = InternalLLMCallEvent | InternalCheckpointEvent | InternalThoughtProcessEvent;

// External vs Internal
type ExternalEvent = Exclude<InternalEvent, InternalDebugEvent>;
type DebugEvent = InternalDebugEvent;
```

---

## Phase 2: Event Emission in AgentLoop ⏳ **NEXT**

**Objective**: Integrate event emission throughout AgentLoop execution pipeline

**Tasks**:
- [ ] Add event emitter to AgentLoop class
- [ ] Emit task-created at execution start
- [ ] Emit task-status transitions (working, waiting-*, completed, failed)
- [ ] Emit content-delta during LLM streaming
- [ ] Emit tool events (start, progress, complete)
- [ ] Emit thought-stream events during reasoning
- [ ] Emit internal debug events for observability
- [ ] Add event filtering (external vs internal)

**Files to Modify**:
```
src/core/
├── agent-loop.ts         # Add event emission
├── operators/
│   ├── execute-operators.ts   # Task lifecycle events
│   ├── iteration-operators.ts # Iteration and checkpoint events
│   └── llm-operators.ts       # LLM and thought events
```

**Key Integration Points**:

### 2.1 Task Lifecycle Events
```typescript
// In execute-operators.ts
export function tapBeforeExecute(...): OperatorFunction<Context, Context> {
  return tap((ctx) => {
    // Emit task-created
    ctx.events$.next({
      kind: 'task-created',
      contextId: ctx.contextId,
      taskId: ctx.taskId,
      initiator: 'user',
      timestamp: new Date().toISOString(),
      metadata: { agentId: ctx.agentId }
    });

    // Emit task-status: working
    ctx.events$.next({
      kind: 'task-status',
      contextId: ctx.contextId,
      taskId: ctx.taskId,
      status: 'working',
      timestamp: new Date().toISOString()
    });
  });
}
```

### 2.2 Tool Execution Events
```typescript
// In agent-loop.ts executeTools()
private executeTools(state: LoopState, context: Context): Observable<LoopState> {
  return from(state.pendingToolCalls || []).pipe(
    mergeMap(toolCall => {
      // Emit tool-start
      context.events$.next({
        kind: 'tool-start',
        contextId: context.contextId,
        taskId: context.taskId,
        toolCallId: toolCall.id,
        toolName: toolCall.function.name,
        arguments: JSON.parse(toolCall.function.arguments),
        timestamp: new Date().toISOString()
      });

      return this.executeSingleTool(toolCall, context).pipe(
        tap(result => {
          // Emit tool-complete
          context.events$.next({
            kind: 'tool-complete',
            contextId: context.contextId,
            taskId: context.taskId,
            toolCallId: toolCall.id,
            toolName: toolCall.function.name,
            success: result.success,
            result: result.result,
            error: result.error,
            timestamp: new Date().toISOString()
          });
        })
      );
    }, 5)
  );
}
```

### 2.3 Thought Streaming Events
```typescript
// In llm-operators.ts prepareLLMCall()
export function prepareLLMCall(...): OperatorFunction<LoopState, LoopState> {
  return tap((state) => {
    // Emit planning thought (normal verbosity)
    context.events$.next({
      kind: 'thought-stream',
      contextId: context.contextId,
      taskId: context.taskId,
      thoughtId: generateId(),
      thoughtType: 'planning',
      verbosity: 'normal',
      content: `Calling LLM with ${state.messages.length} messages and ${state.availableTools.length} tools`,
      index: state.thoughtIndex++,
      timestamp: new Date().toISOString(),
      metadata: { confidence: 0.9 }
    });
  });
}
```

### 2.4 Content Streaming
```typescript
// In llm-operators.ts (when streaming is implemented)
export function streamLLMResponse(...): OperatorFunction<LLMResponse, LLMResponse> {
  return switchMap(response => {
    if (!response.stream) {
      return of(response);
    }

    return response.stream.pipe(
      scan((acc, chunk, index) => {
        // Emit content-delta
        context.events$.next({
          kind: 'content-delta',
          contextId: context.contextId,
          taskId: context.taskId,
          delta: chunk.delta,
          index,
          timestamp: new Date().toISOString()
        });

        return { ...acc, content: acc.content + chunk.delta };
      }, { content: '' })
    );
  });
}
```

**Estimated Time**: 12-16 hours

---

## Phase 3: SSE Server Implementation

**Objective**: Create SSE endpoint for event streaming to clients

**Tasks**:
- [ ] Create SSE server module (`src/server/sse.ts`)
- [ ] Implement context-scoped event subscriptions
- [ ] Add event filtering (external vs internal)
- [ ] Support client reconnection with event replay
- [ ] Add event buffering and backpressure handling
- [ ] Implement heartbeat/keep-alive

**Files to Create**:
```
src/server/
├── sse.ts                # SSE server implementation
├── event-router.ts       # Route events to subscribers
└── event-buffer.ts       # Buffer events for reconnection
```

**Key Implementation**:
```typescript
// src/server/sse.ts
export class SSEServer {
  private subscribers = new Map<string, Set<SSEConnection>>();

  subscribe(contextId: string, res: Response): SSEConnection {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const connection = new SSEConnection(contextId, res);

    if (!this.subscribers.has(contextId)) {
      this.subscribers.set(contextId, new Set());
    }
    this.subscribers.get(contextId)!.add(connection);

    return connection;
  }

  emit(contextId: string, event: InternalEvent): void {
    const subscribers = this.subscribers.get(contextId);
    if (!subscribers) return;

    // Filter internal events
    if (event.kind.startsWith('internal:')) {
      return; // Don't send to clients
    }

    for (const connection of subscribers) {
      connection.send(event);
    }
  }
}

class SSEConnection {
  constructor(
    private contextId: string,
    private res: Response
  ) {}

  send(event: InternalEvent): void {
    this.res.write(`event: ${event.kind}\n`);
    this.res.write(`data: ${JSON.stringify(event)}\n\n`);
  }
}
```

**Estimated Time**: 8-12 hours

---

## Phase 4: Artifact Event Implementation

**Objective**: Implement three artifact types with optimized streaming

**Tasks**:
- [ ] Implement file-write streaming (chunked)
- [ ] Implement data-write atomic updates
- [ ] Implement dataset-write batch streaming
- [ ] Update ArtifactStore to emit events
- [ ] Add artifact event helpers

**Files to Modify**:
```
src/stores/artifacts/
├── artifact-store-with-events.ts  # Add event emission
└── helpers.ts                     # NEW: Artifact event helpers
```

**Key Implementation**:
```typescript
// In artifact-store-with-events.ts
export class ArtifactStoreWithEvents implements ArtifactStore {
  async createFile(
    contextId: string,
    taskId: string,
    artifactId: string,
    content: string | AsyncIterable<string>,
    metadata: FileMetadata
  ): Promise<void> {
    if (typeof content === 'string') {
      // Emit single file-write event
      this.events$.next({
        kind: 'file-write',
        contextId,
        taskId,
        artifactId,
        data: content,
        index: 0,
        complete: true,
        name: metadata.name,
        mimeType: metadata.mimeType,
        timestamp: new Date().toISOString()
      });
    } else {
      // Stream chunks
      let index = 0;
      for await (const chunk of content) {
        this.events$.next({
          kind: 'file-write',
          contextId,
          taskId,
          artifactId,
          data: chunk,
          index,
          complete: false,
          ...(index === 0 ? { name: metadata.name, mimeType: metadata.mimeType } : {}),
          timestamp: new Date().toISOString()
        });
        index++;
      }

      // Emit final chunk with complete: true
      this.events$.next({
        kind: 'file-write',
        contextId,
        taskId,
        artifactId,
        data: '',
        index,
        complete: true,
        timestamp: new Date().toISOString()
      });
    }
  }

  async createData(
    contextId: string,
    taskId: string,
    artifactId: string,
    data: Record<string, unknown>,
    metadata?: DataMetadata
  ): Promise<void> {
    // Emit atomic data-write event
    this.events$.next({
      kind: 'data-write',
      contextId,
      taskId,
      artifactId,
      data,
      name: metadata?.name,
      description: metadata?.description,
      timestamp: new Date().toISOString()
    });
  }

  async createDataset(
    contextId: string,
    taskId: string,
    artifactId: string,
    rows: AsyncIterable<Record<string, unknown>[]>,
    metadata: DatasetMetadata
  ): Promise<void> {
    let index = 0;
    let isFirst = true;

    for await (const batch of rows) {
      this.events$.next({
        kind: 'dataset-write',
        contextId,
        taskId,
        artifactId,
        rows: batch,
        index,
        complete: false,
        ...(isFirst ? {
          name: metadata.name,
          schema: metadata.schema,
          description: metadata.description
        } : {}),
        timestamp: new Date().toISOString(),
        metadata: isFirst ? { totalRows: metadata.totalRows, batchSize: batch.length } : undefined
      });

      isFirst = false;
      index++;
    }

    // Emit final batch with complete: true
    this.events$.next({
      kind: 'dataset-write',
      contextId,
      taskId,
      artifactId,
      rows: [],
      index,
      complete: true,
      timestamp: new Date().toISOString()
    });
  }
}
```

**Estimated Time**: 10-14 hours

---

## Phase 5: Input Routing & Auth Events

**Objective**: Implement input-required/input-received and auth events

**Tasks**:
- [ ] Add requireUser field to input-required events
- [ ] Implement coordinator vs user routing logic
- [ ] Add auth-required/auth-completed events
- [ ] Integrate with ClientToolProvider for tool-execution inputs
- [ ] Add input timeout handling

**Files to Modify**:
```
src/tools/client-tool-provider.ts  # Emit input-required for client tools
src/core/agent-loop.ts             # Handle auth-required scenarios
```

**Key Implementation**:
```typescript
// In client-tool-provider.ts
async execute(toolCall: ToolCall, context: Context): Promise<ToolResult> {
  const inputId = generateId();

  // Emit input-required (coordinator can handle)
  context.events$.next({
    kind: 'input-required',
    contextId: context.contextId,
    taskId: context.taskId,
    inputId,
    requireUser: false, // Coordinator can try first
    inputType: 'tool-execution',
    prompt: `Execute client-side tool: ${toolCall.function.name}`,
    timestamp: new Date().toISOString(),
    metadata: { toolCall }
  });

  // Wait for input
  const result = await this.waitForInput(inputId, 30000);

  // Emit input-received
  context.events$.next({
    kind: 'input-received',
    contextId: context.contextId,
    taskId: context.taskId,
    inputId,
    providedBy: result.providedBy,
    userId: result.userId,
    agentId: result.agentId,
    timestamp: new Date().toISOString(),
    metadata: { duration: result.duration }
  });

  return result.toolResult;
}
```

**Estimated Time**: 6-8 hours

---

## Phase 6: Sub-agent Event Support

**Objective**: Support hierarchical task relationships with subtask events

**Tasks**:
- [ ] Add parentTaskId to task-created events
- [ ] Emit subtask-created when invoking sub-agents
- [ ] Implement event forwarding from subtasks to parent
- [ ] Add task hierarchy tracking

**Files to Modify**:
```
src/core/agent-loop.ts  # Add subtask invocation support
```

**Key Implementation**:
```typescript
// When invoking sub-agent
async invokeSubAgent(
  agentId: string,
  prompt: string,
  context: Context
): Promise<string> {
  const subtaskId = generateId();

  // Emit subtask-created
  context.events$.next({
    kind: 'subtask-created',
    contextId: context.contextId,
    taskId: context.taskId,
    subtaskId,
    agentId,
    prompt,
    timestamp: new Date().toISOString()
  });

  // Create sub-context with parentTaskId
  const subContext = {
    ...context,
    taskId: subtaskId,
    parentTaskId: context.taskId
  };

  // Subscribe to sub-agent events and forward to parent
  const subAgent = getAgent(agentId);
  const events$ = await subAgent.startTurn(prompt, { context: subContext });

  events$.subscribe(event => {
    // Forward events with subtask taskId
    context.events$.next(event);
  });

  return await lastValueFrom(events$);
}
```

**Estimated Time**: 6-8 hours

---

## Phase 7: Thought Streaming Implementation

**Objective**: Emit thought-stream events with verbosity levels

**Tasks**:
- [ ] Identify thought emission points in execution flow
- [ ] Implement thought generation at key decision points
- [ ] Add verbosity control (brief/normal/detailed)
- [ ] Emit planning thoughts before major operations
- [ ] Emit reasoning thoughts after LLM responses
- [ ] Emit reflection thoughts during iteration
- [ ] Emit decision thoughts when choosing between options
- [ ] Add internal:thought-process for debugging

**Files to Modify**:
```
src/core/
├── agent-loop.ts         # Add thought emission logic
├── operators/
│   ├── execute-operators.ts   # Planning thoughts
│   ├── iteration-operators.ts # Reflection thoughts
│   └── llm-operators.ts       # Reasoning/decision thoughts
```

**Key Implementation Examples**:

```typescript
// Planning thought (brief)
context.events$.next({
  kind: 'thought-stream',
  contextId: context.contextId,
  taskId: context.taskId,
  thoughtId: generateId(),
  thoughtType: 'planning',
  verbosity: 'brief',
  content: 'Preparing LLM call',
  index: thoughtIndex++,
  timestamp: new Date().toISOString(),
  metadata: { confidence: 0.95 }
});

// Decision thought (detailed)
context.events$.next({
  kind: 'thought-stream',
  contextId: context.contextId,
  taskId: context.taskId,
  thoughtId: generateId(),
  thoughtType: 'decision',
  verbosity: 'detailed',
  content: `Choosing to execute ${toolCalls.length} tools in parallel. This should be faster than sequential execution. Trade-off: higher memory usage but better latency for user.`,
  index: thoughtIndex++,
  timestamp: new Date().toISOString(),
  metadata: {
    confidence: 0.8,
    alternatives: ['Execute tools sequentially (lower memory, higher latency)'],
    relatedTo: toolCalls.map(tc => tc.id).join(',')
  }
});

// Internal thought process (debugging)
context.events$.next({
  kind: 'internal:thought-process',
  contextId: context.contextId,
  taskId: context.taskId,
  iteration: state.iteration,
  stage: 'post-llm',
  reasoning: `LLM returned ${toolCalls.length} tool calls. Will execute in parallel with concurrency=5.`,
  state: {
    iteration: state.iteration,
    messageCount: state.messages.length,
    toolCount: state.availableTools.length,
    pendingTools: toolCalls.map(tc => tc.function.name)
  },
  timestamp: new Date().toISOString()
});
```

**Estimated Time**: 10-12 hours

---

## Phase 8: A2A Protocol Mapping

**Objective**: Map internal events to A2A protocol events

**Tasks**:
- [ ] Create A2A event mapper utility
- [ ] Map task-created → A2A Task
- [ ] Map task-status → A2A StatusUpdate
- [ ] Map content-delta → A2A ArtifactUpdate
- [ ] Map file-write/data-write/dataset-write → A2A ArtifactUpdate
- [ ] Add A2A event emission alongside internal events

**Files to Create**:
```
src/events/
└── a2a-mapper.ts  # Map internal events to A2A
```

**Key Implementation**:
```typescript
// src/events/a2a-mapper.ts
export function mapToA2A(event: InternalEvent): A2AEvent | null {
  switch (event.kind) {
    case 'task-created':
      return {
        kind: 'task',
        id: event.taskId,
        contextId: event.contextId,
        status: {
          state: 'submitted',
          timestamp: event.timestamp
        },
        metadata: event.metadata
      };

    case 'task-status':
      return {
        kind: 'status-update',
        taskId: event.taskId,
        contextId: event.contextId,
        status: {
          state: mapTaskStatus(event.status),
          timestamp: event.timestamp
        },
        final: event.status === 'completed' || event.status === 'failed'
      };

    case 'content-delta':
      return {
        kind: 'artifact-update',
        taskId: event.taskId,
        contextId: event.contextId,
        artifact: {
          artifactId: `content-${event.taskId}`,
          parts: [{ kind: 'text', text: event.delta }]
        },
        append: event.index > 0,
        lastChunk: false
      };

    case 'file-write':
      return {
        kind: 'artifact-update',
        taskId: event.taskId,
        contextId: event.contextId,
        artifact: {
          artifactId: event.artifactId,
          ...(event.index === 0 ? { name: event.name } : {}),
          parts: [{ kind: 'text', text: event.data }]
        },
        append: event.index > 0,
        lastChunk: event.complete
      };

    // Internal events don't map to A2A
    case 'internal:llm-call':
    case 'internal:checkpoint':
    case 'internal:thought-process':
      return null;

    default:
      return null;
  }
}

function mapTaskStatus(status: TaskStatus): A2ATaskState {
  const mapping: Record<TaskStatus, A2ATaskState> = {
    'working': 'working',
    'waiting-input': 'input-required',
    'waiting-auth': 'auth-required',
    'waiting-subtask': 'working',
    'completed': 'completed',
    'failed': 'failed',
    'canceled': 'canceled'
  };
  return mapping[status];
}
```

**Estimated Time**: 6-8 hours

---

## Phase 9: Testing

**Objective**: Comprehensive testing of event protocol

**Tasks**:
- [ ] Unit tests for event type definitions
- [ ] Unit tests for event emission in AgentLoop
- [ ] Integration tests for SSE server
- [ ] Integration tests for artifact events
- [ ] E2E tests for complete event flows
- [ ] Test event filtering (external vs internal)
- [ ] Test A2A mapping
- [ ] Test thought streaming with different verbosity levels
- [ ] Test input routing (user vs coordinator)
- [ ] Test subtask event forwarding

**Files to Create**:
```
tests/events/
├── event-types.test.ts       # Type validation tests
├── agent-loop-events.test.ts # AgentLoop event emission
├── sse-server.test.ts        # SSE server tests
├── artifact-events.test.ts   # Artifact event tests
├── thought-streaming.test.ts # Thought event tests
├── a2a-mapping.test.ts       # A2A mapper tests
└── e2e-events.test.ts        # End-to-end event flows
```

**Test Scenarios**:
1. ✅ Task lifecycle (created → working → completed)
2. ✅ Task lifecycle with failure (created → working → failed)
3. ✅ Content streaming (multiple content-delta → content-complete)
4. ✅ Tool execution (start → progress → complete)
5. ✅ File artifact streaming (first chunk with metadata → chunks → final chunk)
6. ✅ Data artifact atomic write
7. ✅ Dataset batch streaming
8. ✅ Input request with user requirement
9. ✅ Input request with coordinator handling
10. ✅ Auth flow (required → completed)
11. ✅ Subtask creation and event forwarding
12. ✅ Thought streaming at all verbosity levels
13. ✅ A2A event mapping for all external events
14. ✅ SSE connection/disconnection/reconnection
15. ✅ Event filtering (internal events not sent to clients)

**Estimated Time**: 16-20 hours

---

## Phase 10: Documentation & Examples

**Objective**: Document event protocol and provide usage examples

**Tasks**:
- [ ] Update README with event protocol overview
- [ ] Create event catalog documentation
- [ ] Add client integration guide
- [ ] Create example SSE client
- [ ] Add event handling examples
- [ ] Document filtering and subscription patterns
- [ ] Add performance considerations

**Files to Create/Update**:
```
docs/
├── EVENT_PROTOCOL.md         # Comprehensive event protocol guide
├── EVENT_CATALOG.md          # All event types with examples
├── CLIENT_INTEGRATION.md     # How to consume events
└── PERFORMANCE.md            # Event streaming performance tips

examples/
├── sse-client.ts             # Example SSE client
├── event-filtering.ts        # Filtering examples
└── thought-streaming.ts      # Thought streaming UI
```

**Estimated Time**: 8-10 hours

---

## Implementation Timeline

### Week 1-2: Foundation (Phase 1-2)
- Define all event types (Phase 1)
- Integrate event emission into AgentLoop (Phase 2)

### Week 3: Infrastructure (Phase 3)
- Implement SSE server

### Week 4: Artifacts & Inputs (Phase 4-5)
- Artifact event implementation
- Input routing and auth events

### Week 5: Advanced Features (Phase 6-7)
- Sub-agent support
- Thought streaming

### Week 6: Integration & Mapping (Phase 8)
- A2A protocol mapping

### Week 7-8: Testing & Documentation (Phase 9-10)
- Comprehensive testing
- Documentation and examples

**Total Estimated Time**: 6-8 weeks (80-120 hours)

---

## Success Criteria

✅ **Event Coverage**: All 10 event categories implemented and emitting correctly

✅ **SSE Streaming**: Events stream to clients via SSE with proper formatting

✅ **Thought Streaming**: Thoughts emit at all verbosity levels (brief, normal, detailed)

✅ **Artifact Events**: Three artifact types (file, data, dataset) working correctly

✅ **Input Routing**: requireUser field properly routes inputs to user vs coordinator

✅ **A2A Compatibility**: Internal events map to A2A protocol where applicable

✅ **Event Filtering**: Internal debug events don't leak to external clients

✅ **Test Coverage**: ≥90% test coverage for event emission and handling

✅ **Performance**: Can handle 1000+ events/second without backpressure

✅ **Documentation**: Complete event catalog and integration guide

---

## Open Questions (to resolve during implementation)

### From Design Document:

1. **Thought Streaming Configuration**:
   - ✅ Verbosity levels implemented (brief, normal, detailed)
   - ❓ Server-side filtering by thoughtType/verbosity, or client-side only?
   - ❓ Should some thoughts be marked as "internal only"?
   - ❓ Confidence threshold: only stream thoughts above certain confidence level?
   - ❓ Adaptive verbosity based on task complexity or user preferences?

2. **Tool Progress Granularity**:
   - ❓ Structured progress: steps, stages, phases?
   - ❓ Can user cancel long-running tools mid-execution?
   - ❓ Progress estimation: time-remaining estimates?

3. **Artifact Syncing**:
   - ❓ OT or CRDT semantics for collaborative editing?
   - ❓ Conflict resolution strategy?
   - ❓ Version tracking for artifacts?

4. **Error Handling**:
   - ❓ Explicit `error` event kind vs embedding in task-status: failed?
   - ❓ Retryable vs terminal errors?
   - ❓ Error codes for programmatic handling?

5. **Event Ordering**:
   - ❓ Per-task ordering guarantees?
   - ❓ Cross-task ordering?
   - ❓ Monotonic event IDs for ordering?

6. **Backpressure**:
   - ❓ How many events to buffer server-side?
   - ❓ Drop events if buffer full (with notification)?
   - ❓ Block agent execution until client catches up?

7. **Reconnection**:
   - ❓ Support resuming from last event?
   - ❓ Use SSE `id:` field for resume?
   - ❓ Server-side event replay support?

**Decision Process**: Address these questions as they arise during implementation, document decisions in design doc.

---

## Dependencies

- ✅ AgentLoop execution pipeline (exists)
- ✅ ArtifactStore interface (exists)
- ✅ ToolProvider interface (exists)
- ✅ OpenTelemetry tracing (exists)
- 🚧 SSE server library (to implement)
- 🚧 Event buffering/replay (to implement)

---

## Risks & Mitigations

### Risk 1: Event Volume Overwhelming Clients
**Impact**: High event volume could overwhelm slow clients

**Mitigation**:
- Implement server-side event buffering
- Add backpressure handling (drop, buffer, or block)
- Support client-side filtering to reduce volume
- Add sampling for high-frequency events (thought streams)

### Risk 2: Thought Streaming Quality
**Impact**: Generated thoughts may not be meaningful or useful

**Mitigation**:
- Start with simple, deterministic thoughts at key decision points
- Iterate based on user feedback
- Allow disabling thought streaming if not valuable
- Add confidence scoring to filter low-quality thoughts

### Risk 3: A2A Mapping Incompleteness
**Impact**: Not all internal events may map cleanly to A2A

**Mitigation**:
- Focus on core event types for A2A compliance
- Accept that some internal events won't have A2A equivalents
- Document which events are internal-only

### Risk 4: Performance Impact
**Impact**: Event emission could slow down AgentLoop execution

**Mitigation**:
- Use non-blocking event emission (fire-and-forget)
- Add event batching for high-frequency events
- Profile and optimize hot paths
- Make event emission optional for performance-critical scenarios

---

## Next Steps

1. **Review & Approve**: Review this implementation plan
2. **Phase 1 Start**: Begin with event type definitions
3. **Prototype**: Build minimal SSE example to validate approach
4. **Iterate**: Adjust plan based on learnings from early phases

---

**Status**: 📋 Ready for Review

**Last Updated**: 2025-11-06
