# Architecture Overview

This document provides a high-level overview of the Looopy AI agent framework architecture.

## System Design Principles

Looopy is built on the following core principles:

1. **Reactive First**: All asynchronous operations use RxJS observables for composability and control
2. **Separation of Concerns**: Clear boundaries between Agent (multi-turn), AgentLoop (single-turn), and support components
3. **Streaming Native**: Updates flow in real-time through Server-Sent Events (SSE)
4. **Distributed by Default**: OpenTelemetry tracing across all operations
5. **A2A Protocol Compliant**: Events follow the A2A (Agent-to-Agent) protocol specification
6. **Operator-Based Pipeline**: Modular, testable operators for clean execution flow

## High-Level Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                           Client Layer                               │
│  ┌──────────────┐    ┌──────────────┐   ┌──────────────┐             │
│  │ Web Client   │    │ CLI Client   │   │ Other Agent  │             │
│  └──────┬───────┘    └──────┬───────┘   └──────┬───────┘             │
│         │                   │                  │                     │
│         └───────────────────┴──────────────────┘                     │
│                             │                                        │
│                     A2A SSE Protocol                                 │
└─────────────────────────────┼────────────────────────────────────────┘
                              │
┌─────────────────────────────┼────────────────────────────────────────┐
│                    A2A Server Layer (Not Yet Implemented)            │
│  ┌──────────────────────────▼───────────────────────────┐            │
│  │            A2A Request Handler                       │            │
│  │  • Authentication/Authorization                      │            │
│  │  • Request validation                                │            │
│  │  • SSE connection management                         │            │
│  │  • Event routing                                     │            │
│  └──────────────────────────┬───────────────────────────┘            │
└─────────────────────────────┼────────────────────────────────────────┘
                              │
┌─────────────────────────────┼────────────────────────────────────────┐
│                    Agent Layer (Multi-turn Manager)                  │
│  ┌──────────────────────────▼───────────────────────────┐            │
│  │                   Agent Class                        │            │
│  │                                                      │            │
│  │  Responsibilities:                                   │            │
│  │  • Manage conversation history (MessageStore)        │            │
│  │  • Persist artifacts (ArtifactStore)                 │            │
│  │  • Lifecycle management (created→ready→busy→ready)   │            │
│  │  • Coordinate turns via startTurn()                  │            │
│  │  • Lazy initialization on first turn                 │            │
│  │                                                      │            │
│  │  For each user message:                              │            │
│  │    1. Load message history from store                │            │
│  │    2. Call AgentLoop.startTurn(messages)             │            │
│  │    3. Collect events from Observable                 │            │
│  │    4. Save new messages to MessageStore              │            │
│  │    5. Return to ready state                          │            │
│  └──────────────────────────┬───────────────────────────┘            │
└─────────────────────────────┼────────────────────────────────────────┘
                              │
┌─────────────────────────────┼────────────────────────────────────────┐
│              AgentLoop Core (Single-turn Execution)                  │
│  ┌──────────────────────────▼───────────────────────────┐            │
│  │          AgentLoop Orchestrator (RxJS)               │            │
│  │                                                      │            │
│  │  Operator-Based Pipeline:                            │            │
│  │  ┌────────────────────────────────────────────────┐  │            │
│  │  │ defer(() => of(context))                       │  │            │
│  │  │  → tap(beforeExecute)  [root span, TaskEvent]  │  │            │
│  │  │  → switchMap(runLoop)  [iteration recursion]   │  │            │
│  │  │  → tap(afterExecute)   [final StatusUpdate]    │  │            │
│  │  │  → catchError()        [error handling]        │  │            │
│  │  │  → shareReplay(1)      [hot observable]        │  │            │
│  │  └────────────────────────────────────────────────┘  │            │
│  │                                                      │            │
│  │  Per Iteration:                                      │            │
│  │  • Start iteration span                              │            │
│  │  • Call LLM with messages + tools                    │            │
│  │  • Execute requested tools (parallel, max 5)         │            │
│  │  • Aggregate tool results                            │            │
│  │  • Loop or complete                                  │            │
│  │                                                      │            │
│  │  Operator Factories (src/core/operators/):           │            │
│  │  • execute-operators.ts  (root span management)      │            │
│  │  • iteration-operators.ts (iteration spans)          │            │
│  │  • llm-operators.ts     (LLM calls, responses)       │            │
│  └──────────────────────────┬───────────────────────────┘            │
└─────────────────────────────┼────────────────────────────────────────┘
                              │
┌─────────────────────────────┼────────────────────────────────────────┐
│                    Tool Execution Layer                              │
│  ┌──────────────────────────▼──────────────────────────┐             │
│  │           Tool Providers (Array)                    │             │
│  │  • Merged tool definitions before LLM call          │             │
│  │  • Routed execution to correct provider             │             │
│  └──┬───────────────┬──────────────────────────────────┘             │
│     │               │                                                │
│     ▼               ▼                                                │
│  ┌────────┐   ┌──────────────┐                                       │
│  │ Local  │   │   Client     │                                       │
│  │  Tool  │   │     Tool     │                                       │
│  │Provider│   │   Provider   │                                       │
│  └────────┘   └──────────────┘                                       │
│                      │                                               │
│                      ▼                                               │
│           ┌──────────────────┐                                       │
│           │  A2A Input Req   │                                       │
│           │ (client provides) │                                      │
│           └──────────────────┘                                       │
│                                                                      │
│  Future: MCP Tool Provider (planned)                                 │
└──────────────────────────────────────────────────────────────────────┘
                             │
┌────────────────────────────┼─────────────────────────────────────────┐
│               Observability Layer                                    │
│  ┌──────────────────────────▼───────────────────────────┐            │
│  │         OpenTelemetry Integration                    │            │
│  │                                                      │            │
│  │  Span Hierarchy:                                     │            │
│  │  agent.turn                                          │            │
│  │    └─ agent.initialize (first turn only)             │            │
│  │    └─ agent.execute                                  │            │
│  │        ├─ iteration[0]                               │            │
│  │        │   ├─ llm.call                               │            │
│  │        │   └─ tools.execute                          │            │
│  │        │       ├─ tool[name1]                        │            │
│  │        │       └─ tool[name2]                        │            │
│  │        └─ iteration[1]...                            │            │
│  │                                                      │            │
│  │  Context Propagation:                                │            │
│  │  • W3C Trace Context in Context object               │            │
│  │  • Span refs passed via operator factories           │            │
│  │  • Parent-child relationships via OpenTelemetry API  │            │
│  └──────────────────────────────────────────────────────┘            │
└──────────────────────────────────────────────────────────────────────┘
```

## Component Responsibilities

### A2A Server Layer
**Status**: ❌ Not yet implemented

Planned responsibilities:
- **Request Authentication**: Validate incoming A2A requests
- **SSE Management**: Maintain long-lived connections for streaming
- **Event Routing**: Route task updates to correct SSE streams
- **Protocol Compliance**: Ensure A2A protocol adherence

### Agent Layer
**Status**: ✅ Fully implemented

See [`src/core/agent.ts`](../src/core/agent.ts)

- **Conversation Management**: Maintain message history across turns via MessageStore
- **Lifecycle Management**: Handle state transitions (created → ready → busy → ready)
- **Turn Coordination**: Load history, call AgentLoop.startTurn(), save new messages
- **Lazy Initialization**: Defer expensive setup until first turn
- **Artifact Persistence**: Store artifacts via ArtifactStore
- **Event Aggregation**: Collect and process events from AgentLoop Observable

### AgentLoop Core
**Status**: ✅ Fully implemented

See [`src/core/agent-loop.ts`](../src/core/agent-loop.ts) and [`src/core/operators/`](../src/core/operators/)

- **Single-turn Execution**: Execute one complete reasoning cycle (LLM calls + tool execution)
- **Operator Pipeline**: Modular RxJS operators for clean execution flow
- **Iteration Control**: Loop until LLM finishes or max iterations reached
- **State Management**: Track iteration state and tool calls
- **Event Emission**: Emit A2A-compliant events (TaskEvent, StatusUpdateEvent, etc.)
- **Span Management**: Create nested OpenTelemetry spans via operator factories
- **Error Handling**: Graceful error recovery at multiple pipeline stages
- **Checkpointing**: Optional state persistence via StateStore
- **Resumption**: Resume from persisted state (static method)

### Tool Execution Layer
**Status**: ✅ Fully implemented (LocalToolProvider, ClientToolProvider); 🚧 MCP support planned

See [`src/tools/`](../src/tools/)

- **Tool Provider Interface**: Uniform interface across tool types (ToolProvider)
- **Local Tools**: Register JavaScript/TypeScript functions as tools
- **Client Tools**: Accept tools from client via A2A protocol
- **Parallel Execution**: Execute multiple tools concurrently (default: 5 concurrent)
- **Error Isolation**: Individual tool failures don't stop execution
- **Result Normalization**: Consistent ToolResult format

### Observability Layer
**Status**: ✅ Fully implemented

See [`src/observability/`](../src/observability/)

- **Span Creation**: OpenTelemetry spans for all operations
- **Span Hierarchy**: Nested spans with parent-child relationships
- **Context Propagation**: Trace context through Context object
- **Span Helpers**: Centralized helper functions for span operations
- **Selective Logging**: Trace-level logs for span operations, appropriate levels for application logs
- **Error Recording**: Capture errors in span attributes

## Data Flow

### Standard Turn Flow

```
1. User sends message to Agent
   ↓
2. Agent loads message history from MessageStore
   ↓
3. Agent calls AgentLoop.startTurn(messages, context)
   ↓
4. AgentLoop builds Context { taskId, agentId, messages, traceContext, ... }
   ↓
5. AgentLoop.execute(context) creates Observable pipeline
   ↓
6. Iteration 0:
   - Start iteration span
   - Prepare LLM call (inject system prompt)
   - Call LLM with messages + available tools
   - LLM returns tool calls
   ↓
7. Execute tools in parallel (max 5 concurrent)
   - Local tool executes locally
   - Client tool sends input-required request
   ↓
8. Aggregate tool results as messages
   ↓
9. Iteration 1:
   - Call LLM with updated messages (including tool results)
   - LLM returns final response with finish_reason: "stop"
   ↓
10. Complete iteration span, complete execution span
   ↓
11. Emit final StatusUpdateEvent (state: "completed")
   ↓
12. Agent receives events, saves new messages to MessageStore
   ↓
13. Agent returns to ready state
```

### Event Flow

AgentLoop emits events throughout execution:

```
Observable<AgentEvent> emits:

1. TaskEvent
   kind: "task"
   status.state: "submitted"

2. StatusUpdateEvent
   kind: "status-update"
   status.state: "working"

3. (Internal events - not sent to clients)
   kind: "internal:llm-call"
   kind: "internal:tool-start"
   kind: "internal:tool-complete"

4. (Optional) ArtifactUpdateEvent
   kind: "artifact-update"
   For streaming LLM responses

5. StatusUpdateEvent (final)
   kind: "status-update"
   status.state: "completed" | "failed"
   final: true
```

Agent subscribes to this Observable and:
- Saves messages to MessageStore
- May emit events to A2A server (future)
- Updates internal state

## Technology Choices

### RxJS for Orchestration
- **Observables**: Natural fit for streaming events
- **Operators**: Rich set for async composition (switchMap, mergeMap, tap, catchError)
- **Factory Pattern**: Operator factories create closures for span refs and loggers
- **Hot Observables**: shareReplay() prevents duplicate executions
- **Testing**: Excellent testability with Vitest

**Usage**: Core execution pipeline in AgentLoop

### Server-Sent Events (SSE)
- **Unidirectional**: Perfect for status updates from agent to client
- **Reconnection**: Automatic reconnection with Last-Event-ID
- **Browser Native**: No additional client libraries needed
- **Simple Protocol**: Text-based, easy to debug

**Status**: Planned for A2A server layer (not yet implemented)

### OpenTelemetry
- **Vendor Neutral**: Works with any backend (Jaeger, Zipkin, etc.)
- **Distributed**: Trace context propagates through system
- **Span Hierarchy**: Parent-child relationships via context API
- **Industry Standard**: W3C Trace Context

**Usage**: All operations create spans; trace context in Context object

### Pino Logger
- **Structured Logging**: JSON-formatted logs for easy parsing
- **Performance**: Fast, low-overhead logging
- **Log Levels**: trace, debug, info, warn, error
- **Contextual**: Child loggers with bound context

**Pattern**: Trace-level for span operations, appropriate levels for application logic

### TypeScript
- **Type Safety**: Catch errors at compile time
- **Developer Experience**: Excellent IDE support and autocomplete
- **Strict Mode**: Enforced strictNullChecks and other safety features
- **Interface-Driven**: Clear contracts between components

**Usage**: All code is TypeScript with strict mode enabled

## Key Design Patterns

### Separation: Agent vs AgentLoop

**Agent** (multi-turn, stateful):
- Manages conversation across multiple user turns
- Owns MessageStore for history persistence
- Owns ArtifactStore for artifact persistence
- Lifecycle: created → ready → busy → ready
- Lazy initialization on first turn

**AgentLoop** (single-turn, stateless):
- Executes one complete reasoning cycle
- Receives full message history per turn
- Returns Observable of events
- No conversation memory between calls
- Operated by Agent class

This separation enables:
- Clear responsibilities
- Easy testing (AgentLoop is pure function)
- Flexible deployment (Agent could delegate to remote AgentLoop)
- Independent scaling

### Operator Factory Pattern

Operator factories create RxJS operators with closures:

```typescript
// Factory function
export function tapBeforeExecute(
  spanRef: { current: Span | undefined },
  logger: Logger,
  context: Context
): OperatorFunction<Context, Context> {
  return tap((ctx) => {
    // Access spanRef via closure
    spanRef.current = startExecutionSpan(ctx);
    logger.trace({ taskId: ctx.taskId }, 'Started execution span');
  });
}

// Usage in AgentLoop
const rootSpanRef = { current: undefined };
const pipeline = defer(() => of(context)).pipe(
  tapBeforeExecute(rootSpanRef, this.logger, context),
  // ... other operators can access rootSpanRef
);
```

Benefits:
- Span references shared across operators
- Clean separation of concerns (one file per stage)
- Easy to test (factories are pure functions)
- Logger and config injection

### Store Factory Pattern

Unified interface for creating storage implementations:

```typescript
// Create state store
const stateStore = StoreFactory.createStateStore({
  type: 'redis',
  redis: redisClient,
  ttl: 86400
});

// Create artifact store
const artifactStore = StoreFactory.createArtifactStore({
  type: 'memory'
});
```

Implementations:
- **Redis**: Production-ready with TTL
- **In-Memory**: Testing and development

### Provider Pattern

Uniform interfaces for pluggable components:

**LLMProvider**: Abstracts LLM integration
- Current: LiteLLM proxy provider
- Future: Direct OpenAI, Anthropic, etc.

**ToolProvider**: Abstracts tool sources
- Current: LocalToolProvider, ClientToolProvider
- Future: MCPToolProvider

**StateStore**: Abstracts state persistence
- Current: Redis, In-Memory
- Future: PostgreSQL, DynamoDB, etc.

**ArtifactStore**: Abstracts artifact storage
- Current: In-Memory (basic)
- Future: S3, filesystem, database

## Implementation Status Overview

### ✅ Fully Implemented
- **Agent class**: Multi-turn conversation management
- **AgentLoop class**: Single-turn execution engine
- **Operator-based pipeline**: Modular RxJS operators
- **Tool execution**: Local and client-provided tools (parallel with concurrency)
- **LLM integration**: LiteLLM provider
- **State persistence**: Redis and in-memory StateStore
- **OpenTelemetry tracing**: Complete span hierarchy
- **A2A event types**: TaskEvent, StatusUpdateEvent, ArtifactUpdateEvent
- **Checkpointing and resumption**: Save/restore execution state
- **Error handling**: Multi-stage error recovery
- **Logging**: Pino with selective trace-level for observability

### 🚧 Partially Implemented
- **Artifact management**: Interface defined, basic implementation exists
- **Streaming LLM responses**: Structure in place, needs provider support
- **Tool result aggregation**: Working but basic

### ❌ Not Yet Implemented
- **A2A Server**: SSE endpoint for A2A protocol
- **MCP Tool Provider**: Model Context Protocol integration
- **Sub-agent invocation**: Hierarchical agent calls
- **Extension hooks**: beforeLLMCall, afterToolExecution, etc.
- **Advanced artifact stores**: S3, filesystem backends
- **Tool execution caching**: Cache tool results
- **LLM response caching**: Cache LLM outputs

## Future Architecture Considerations

### A2A Server Implementation
When implemented, the A2A server will:
- Accept HTTP POST to `/api/a2a` with JSON-RPC 2.0 requests
- Authenticate requests (bearer token, API key, etc.)
- Create Agent instance per session
- Call `agent.startTurn()` and subscribe to Observable
- Stream events to client via SSE
- Filter internal events (keep only A2A protocol events)

### Sub-Agent Invocation
Planned pattern:
- Sub-agents exposed as tools to parent agent
- Parent agent invokes via A2A client
- Trace context propagated across agent boundaries
- Events namespaced: `parent-task-id/child-task-id`
- Auth context passed or re-issued

### MCP Integration
Model Context Protocol support:
- MCPToolProvider implementation
- Connect to MCP servers via stdio or HTTP
- Expose MCP tools to LLM
- Handle MCP-specific features (prompts, resources)

## Related Documentation

Detailed design documents:
- **[Agent Lifecycle](./agent-lifecycle.md)** - Agent class design and multi-turn management
- **[Agent Loop](./agent-loop.md)** - AgentLoop class and single-turn execution
- **[A2A Protocol](./a2a-protocol.md)** - Event format and protocol compliance
- **[Tool Integration](./tool-integration.md)** - Tool provider patterns and interfaces
- **[Observability](./observability.md)** - Tracing, logging, and span management
- **[Artifact Management](./artifact-management.md)** - Artifact storage and streaming

Implementation references:
- **[A2A Alignment](../A2A_ALIGNMENT.md)** - Event type mapping and migration guide
- **[Project Guidelines](../PROJECT.md)** - Documentation-first approach and way of working
- **[Quick Reference](../QUICK_REFERENCE.md)** - Design vs implementation separation
