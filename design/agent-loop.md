# Agent Loop Design

> **Note**: This document describes the **AgentLoop** class, the core single-turn execution engine. AgentLoop is designed to be operated by the **Agent** class (see [agent-lifecycle.md](./agent-lifecycle.md)), which handles multi-turn conversations, message persistence, and session management.

## Overview

**AgentLoop** is a reactive RxJS-based execution engine that powers a single conversational turn. It orchestrates LLM calls and tool executions until the LLM indicates completion.

### Key Responsibilities

- **Single-turn execution**: Execute one complete LLM reasoning cycle
- **LLM orchestration**: Call LLM with full message history and available tools
- **Tool execution**: Execute tools requested by LLM (parallel with concurrency limits)
- **Iteration control**: Loop until LLM finishes or max iterations reached
- **Event streaming**: Emit A2A-compliant events for client observation
- **Observability**: Create distributed tracing spans for all operations
- **State persistence**: Optional checkpointing via StateStore
- **Error handling**: Graceful error recovery with proper span recording

### What AgentLoop Does NOT Do

- ❌ Manage conversation history across turns (Agent does this)
- ❌ Persist messages to storage (Agent does this)
- ❌ Handle user sessions or context IDs (Agent does this)
- ❌ Decide when to start/stop conversations (Agent does this)

### Relationship to Agent

```
┌─────────────────────────────────────────────────────────┐
│                        Agent                            │
│                  (Multi-turn Manager)                   │
│                                                         │
│  - Manages conversation history (MessageStore)          │
│  - Persists artifacts (ArtifactStore)                   │
│  - Handles lifecycle (created → ready → busy → ready)   │
│  - Coordinates turns (startTurn)                        │
│                                                         │
│  ┌──────────────────────────────────────────────────┐   │
│  │         For each turn: startTurn()               │   │
│  │                                                  │   │
│  │  1. Load message history                         │   │
│  │  2. Call AgentLoop.startTurn(messages)  ◄────────┼───┼─ AgentLoop
│  │  3. Collect events from Observable               │   │   operates here
│  │  4. Save new messages to MessageStore            │   │
│  │  5. Return to ready state                        │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

## Implementation Status

### ✅ Fully Implemented
- Core agent loop execution (`src/core/agent-loop.ts`)
- RxJS operator-based pipeline architecture
- LLM integration via provider interface
- Tool execution (parallel with concurrency)
- Checkpointing and state persistence (via StateStore)
- Session resumption from persisted state
- Error handling with proper span recording
- OpenTelemetry distributed tracing
- A2A event emission (task, status-update)
- State store interface and implementations (Redis + In-Memory)
- Store factory pattern
- shareReplay() for hot observables
- Operator-based architecture (execute, iteration, LLM operators)

### 🚧 Partially Implemented
- Artifact management (interface defined, basic implementation exists)
- Tool result aggregation (working but basic)
- Streaming LLM responses (structure exists, needs provider support)

### ❌ Not Yet Implemented
- Sub-agent invocation as tools
- Advanced artifact store implementations (S3 backend, etc.)
- Built-in artifact management tools
- Extension hooks (beforeRequest, beforeLLMCall, etc.)
- Tool execution caching
- Tool execution batching/optimization
- LLM response caching

## Core Concepts

### Reactive Execution

The agent loop is built on RxJS observables, enabling:
- **Streaming**: Events emitted as they happen (LLM responses, tool results)
- **Composition**: Complex flows built from simple operators
- **Error handling**: Graceful recovery with catchError operators
- **Cancellation**: Unsubscribe to stop execution mid-turn
- **Hot observables**: shareReplay() prevents duplicate executions

### Single-Turn Execution

AgentLoop executes **one complete turn**:
1. Receive message history from Agent
2. Call LLM with full context
3. Execute any requested tools
4. Repeat steps 2-3 until LLM indicates completion
5. Emit events throughout for client observation

### Operator-Based Architecture

The execution pipeline uses **factory functions** that create RxJS operators:

```
src/core/
├── agent-loop.ts              # Main orchestrator
├── operators/
│   ├── execute-operators.ts   # Root span, initial/final events
│   ├── iteration-operators.ts # Loop iteration management
│   └── llm-operators.ts       # LLM calls and response processing
└── types.ts                   # Core interfaces
```

**Pattern**:
```typescript
// Factory creates operator with closures over shared refs
export function tapBeforeExecute(
  spanRef: { current: Span | undefined },
  logger: Logger,
  context: Context
): OperatorFunction<Context, Context> {
  return tap((ctx) => {
    spanRef.current = startExecutionSpan(ctx);
    logger.trace({ taskId: ctx.taskId }, 'Started execution span');
  });
}
```

Benefits:
- **Span sharing**: Nested operators access parent spans via refs
- **Clean separation**: Each file handles one concern
- **Testability**: Pure factory functions are easily tested
- **Logger injection**: Consistent logging across pipeline

### Checkpointing

State is automatically persisted (if StateStore configured):
- Before each iteration
- After LLM calls
- On completion or error

Enables:
- **Resumption**: Continue from last checkpoint after crash
- **Debugging**: Inspect state at any point in execution
- **Auditing**: Full execution history

### Tool Execution

Tools execute in **parallel with concurrency limits** (default: 5 concurrent). Results are collected and passed to the next LLM call.

### System Prompt Injection

System prompts are **injected at LLM call time**, not stored in message history. This keeps message arrays clean while still providing instructions to the LLM.

---

## Architecture

### Core Interfaces

```typescript
// Configuration
interface AgentLoopConfig {
  agentId: string;
  llmProvider: LLMProvider;
  toolProviders: ToolProvider[];      // Array of tool sources
  stateStore?: StateStore;             // Optional state persistence
  artifactStore?: ArtifactStore;       // Optional artifact storage
  maxIterations?: number;              // Default: 10
  systemPrompt?: string;               // Injected at LLM call time
  enableTracing?: boolean;             // Default: true
}

// Execution context
interface Context {
  taskId: string;
  agentId: string;
  contextId: string;
  messages: Message[];                 // Full history from Agent
  traceContext?: Record<string, string>; // OpenTelemetry propagation
  authContext?: AuthContext;
}

// Internal loop state
interface LoopState {
  iteration: number;
  messages: Message[];                 // Growing during execution
  availableTools: ToolDefinition[];    // Merged from all providers
  pendingToolCalls?: ToolCall[];       // LLM-requested calls
  isComplete: boolean;
  finalMessage?: string;
  error?: Error;
}

// Persisted state for resumption
interface PersistedLoopState {
  taskId: string;
  agentId: string;
  contextId: string;
  iteration: number;
  messages: Message[];
  createdAt: string;                   // ISO 8601
  updatedAt: string;
}
```

### Primary APIs

```typescript
class AgentLoop {
  constructor(private config: AgentLoopConfig) {}

  /**
   * Execute a turn (called by Agent)
   *
   * Agent loads message history and calls this for each turn.
   */
  startTurn(
    messages: Message[],
    context: Partial<Context>
  ): Observable<AgentEvent>

  /**
   * Resume from persisted state (static method)
   */
  static resume(
    taskId: string,
    config: AgentLoopConfig,
    context?: Partial<Context>
  ): Observable<AgentEvent>

  // Internal execution (not for external use)
  private execute(context: Context): Observable<AgentEvent>
}
```

### Execution Pipeline

High-level flow:

```
startTurn(messages, context)
  ↓
Build Context { taskId, agentId, messages, traceContext, ... }
  ↓
execute(context) → Observable<AgentEvent>
  ↓
Pipeline:
  defer(() => of(context))
  → tap(beforeExecute)           # Start root span, emit TaskEvent
  → switchMap(runLoop)            # Iteration loop
  → tap(afterExecuteEvents)       # Final StatusUpdate, complete span
  → catchError(handleExecuteError) # Handle errors, fail span
  → shareReplay(1)                # Hot observable
```

**Operator Factories**:

**Execute Operators** (`execute-operators.ts`):
- `tapBeforeExecute()` - Create root execution span, emit TaskEvent
- `tapAfterExecuteEvents()` - Complete span, emit final StatusUpdate
- `catchExecuteError()` - Fail span, emit error StatusUpdate

**Iteration Operators** (`iteration-operators.ts`):
- `startIterationSpan()` - Create iteration span, inject trace context
- `completeIteration()` - Update iteration count, complete span
- `catchIterationError()` - Fail iteration span with error

**LLM Operators** (`llm-operators.ts`):
- `prepareLLMCall()` - Build messages (inject system prompt), start LLM span
- `tapLLMResponse()` - Log response, complete span with metrics
- `mapLLMResponseToState()` - Sanitize tool calls, map to LoopState
- `catchLLMError()` - Fail LLM span

### Iteration Loop

The `runLoop()` method orchestrates iterations:

```typescript
private runLoop(initialContext: Context): Observable<AgentEvent> {
  // Initialize state from context
  const initialState = this.prepareInitialState(initialContext);

  return new Observable((subscriber) => {
    // Recursive iteration
    const iterate = (state: LoopState) => {
      // Check termination
      if (state.isComplete || state.iteration >= this.config.maxIterations) {
        subscriber.complete();
        return;
      }

      // Build iteration pipeline
      const iteration$ = of(state).pipe(
        startIterationSpan(iterationSpanRef, this.logger, initialContext),

        // LLM call
        prepareLLMCall(llmSpanRef, this.logger, this.config),
        switchMap(state => this.callLLM(state)),
        tapLLMResponse(llmSpanRef, this.logger),
        mapLLMResponseToState(this.logger),

        // Tool execution if needed
        switchMap(state =>
          state.pendingToolCalls?.length
            ? this.executeTools(state, initialContext)
            : of(state)
        ),

        completeIteration(iterationSpanRef, this.logger),
        catchIterationError(iterationSpanRef, this.logger)
      );

      // Subscribe and recurse
      iteration$.subscribe({
        next: (newState) => {
          // Emit events for client observation
          subscriber.next(this.stateToEvent(newState));

          // Continue to next iteration
          iterate(newState);
        },
        error: (err) => subscriber.error(err)
      });
    };

    // Start first iteration
    iterate(initialState);
  });
}
```

### Span Hierarchy

OpenTelemetry spans are nested for distributed tracing:

```
agent.turn (created by Agent)
  └─ agent.execute (root span in AgentLoop)
      ├─ iteration[0]
      │   ├─ llm.call
      │   └─ tools.execute (parallel)
      │       ├─ tool[weather]
      │       └─ tool[calculate]
      ├─ iteration[1]
      │   └─ llm.call
      └─ iteration[2]
          └─ llm.call (finished)
```

Trace context propagation:
1. Agent creates `agent.turn` span
2. Agent extracts trace context and passes to `startTurn()`
3. AgentLoop creates `agent.execute` span as child
4. Iteration operators create nested iteration spans
5. LLM/tool operators create spans under current iteration
6. All spans linked via trace context in Context object

---

## LLM Integration

### LLM Provider Interface

```typescript
interface LLMProvider {
  /**
   * Call the LLM with conversation context and available tools
   */
  call(params: LLMCallParams): Promise<LLMResponse>;

  /**
   * Stream LLM response chunks (optional)
   */
  stream?(params: LLMCallParams): Observable<LLMChunk>;
}

interface LLMCallParams {
  messages: Message[];
  tools?: ToolDefinition[];
  temperature?: number;
  maxTokens?: number;
  metadata?: Record<string, unknown>;
}

interface LLMResponse {
  message: Message;                // Assistant's response
  toolCalls?: ToolCall[];          // Requested tool executions
  finishReason?: 'stop' | 'length' | 'tool_calls' | 'content_filter';
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;  // JSON string
  };
}
```

**Current Implementation**: See [`src/providers/litellm-provider.ts`](../src/providers/litellm-provider.ts) for production LLM integration using LiteLLM proxy.

### Streaming Support

Streaming LLM responses emit chunks as they arrive, enabling real-time user feedback. The AgentLoop can emit `ArtifactUpdateEvent` events for each chunk received.

**Design Note**: Full streaming support depends on LLM provider capabilities. Current implementation has structure in place but requires provider-specific streaming implementation.

---

## Tool Execution

### Tool Provider Interface

```typescript
interface ToolProvider {
  /**
   * Get available tools
   */
  getTools(): Promise<ToolDefinition[]>;

  /**
   * Execute a tool call
   */
  executeTool(call: ToolCall, context: ToolContext): Promise<ToolResult>;
}

interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: JSONSchema;  // JSON Schema for parameters
  };
}

interface ToolResult {
  toolCallId: string;
  content: string;           // Result as string
  success: boolean;
  error?: string;
}
```

**Current Implementations**:
- [`LocalToolProvider`](../src/tools/local-tools.ts) - Register functions locally
- [`ClientToolProvider`](../src/tools/client-tool-provider.ts) - Tools provided by client via A2A
- **MCP Support**: Planned for future integration

### Parallel Execution

Tools execute in parallel with configurable concurrency (default: 5 concurrent executions). This improves turn latency when LLM requests multiple tools.

```typescript
// Conceptual pattern
const executeTools$ = (toolCalls: ToolCall[], context): Observable<ToolResult[]> => {
  return from(toolCalls).pipe(
    mergeMap(call => executeSingleTool(call, context), 5), // Concurrency: 5
    toArray()  // Collect all results
  );
};
```

**Implementation**: See [`src/core/agent-loop.ts`](../src/core/agent-loop.ts) `executeTools()` method.

---

## Event Emission

AgentLoop emits A2A-compliant events throughout execution. Events are emitted via RxJS Observable for client subscription.

### Event Types

**A2A Protocol Events** (emitted to clients):
- **TaskEvent** (`kind: "task"`) - Initial task created
- **StatusUpdateEvent** (`kind: "status-update"`) - State transitions (working, completed, failed)
- **ArtifactUpdateEvent** (`kind: "artifact-update"`) - Streaming content chunks

**Internal Events** (observability only, not sent via A2A):
- `internal:llm-call` - LLM invocation started
- `internal:tool-start` - Tool execution started
- `internal:tool-complete` - Tool execution finished
- `internal:checkpoint` - State persisted

**Implementation**: See [`src/core/types.ts`](../src/core/types.ts) for event type definitions and [`A2A_ALIGNMENT.md`](../A2A_ALIGNMENT.md) for protocol compliance details.

---

## Error Handling

AgentLoop handles errors at multiple pipeline stages:

- **Execute errors**: Root span failed, emit `StatusUpdateEvent` with `state: "failed"`
- **Iteration errors**: Iteration span failed, retry or propagate
- **LLM errors**: LLM span failed, log and propagate
- **Tool errors**: Individual tool failures don't stop execution; error returned as tool result

All errors are recorded in OpenTelemetry spans with proper attributes.

**Implementation**: Error handling is in operator catch blocks. See `catchExecuteError`, `catchIterationError`, `catchLLMError` in [`src/core/operators/`](../src/core/operators/).

---

## Loop Control

### Termination Conditions

The loop terminates when:
1. LLM finish reason is `stop` (natural completion)
2. Max iterations reached (default: 10)
3. Unrecoverable error occurs
4. User cancels (unsubscribe from Observable)

### Iteration Limits

```typescript
// In AgentLoopConfig
{
  maxIterations: 10  // Default
}
```

Prevents infinite loops from LLM misbehavior or circular tool dependencies.

---

## State Persistence

### StateStore Interface

```typescript
interface StateStore {
  save(taskId: string, state: PersistedLoopState): Promise<void>;
  load(taskId: string): Promise<PersistedLoopState | null>;
  delete(taskId: string): Promise<void>;
}
```

**Implementations**:
- **RedisStateStore** - Production Redis storage with TTL
- **InMemoryStateStore** - Testing and development

**Factory Pattern**:
```typescript
const stateStore = StoreFactory.createStateStore({
  type: 'redis',
  redis: redisClient,
  ttl: 86400
});
```

### Resumption

Resume execution from persisted state:

```typescript
// Static method on AgentLoop
const events$ = AgentLoop.resume(taskId, config, {
  contextId: 'session-123',
  authContext: userAuth
});

events$.subscribe({
  next: (event) => console.log('Resumed event:', event),
  complete: () => console.log('Task completed')
});
```

**Implementation**: See [`src/core/agent-loop.ts`](../src/core/agent-loop.ts) `resume()` static method.

---

## Artifact Management

**Design Note**: Artifact management is partially implemented. Basic interface exists but advanced features are not complete.

### ArtifactStore Interface

```typescript
interface ArtifactStore {
  create(artifact: Artifact): Promise<string>;  // Returns artifactId
  update(artifactId: string, artifact: Partial<Artifact>): Promise<void>;
  get(artifactId: string): Promise<Artifact | null>;
  list(taskId: string): Promise<Artifact[]>;
  delete(artifactId: string): Promise<void>;
}
```

### Planned Features

- **Streaming artifacts**: Real-time updates as artifacts are created
- **Large file support**: S3/blob storage for large artifacts
- **Artifact tools**: Built-in tools for LLM to create/modify artifacts
- **A2A artifact events**: Emit `ArtifactUpdateEvent` for streaming

**Current Status**: Basic in-memory implementation exists. See [`src/stores/artifacts/`](../src/stores/artifacts/).

---

## Implementation Reference

For complete implementation details, see:

**Core Implementation**:
- [`src/core/agent-loop.ts`](../src/core/agent-loop.ts) - Main AgentLoop class
- [`src/core/types.ts`](../src/core/types.ts) - Type definitions
- [`src/core/config.ts`](../src/core/config.ts) - Configuration interface

**Operator Factories**:
- [`src/core/operators/execute-operators.ts`](../src/core/operators/execute-operators.ts) - Root execution span management
- [`src/core/operators/iteration-operators.ts`](../src/core/operators/iteration-operators.ts) - Iteration loop operators
- [`src/core/operators/llm-operators.ts`](../src/core/operators/llm-operators.ts) - LLM call and response processing

**Storage**:
- [`src/stores/interfaces.ts`](../src/stores/interfaces.ts) - StateStore and ArtifactStore interfaces
- [`src/stores/factory.ts`](../src/stores/factory.ts) - Store creation factory
- [`src/stores/redis/`](../src/stores/redis/) - Redis implementations
- [`src/stores/memory/`](../src/stores/memory/) - In-memory implementations

**Tools**:
- [`src/tools/interfaces.ts`](../src/tools/interfaces.ts) - ToolProvider interface
- [`src/tools/local-tools.ts`](../src/tools/local-tools.ts) - Local tool registration
- [`src/tools/client-tool-provider.ts`](../src/tools/client-tool-provider.ts) - Client-provided tools

**Observability**:
- [`src/observability/tracing.ts`](../src/observability/tracing.ts) - OpenTelemetry setup
- [`src/observability/spans/`](../src/observability/spans/) - Span helper functions

---

## Testing

See [`tests/agent-loop.test.ts`](../tests/agent-loop.test.ts) for comprehensive test suite covering:

- Basic execution flow
- Tool execution (single and parallel)
- Error handling
- State persistence and resumption
- Event emission
- Span creation and hierarchy

**Test Coverage**: 103 tests passing across the project (as of last run).

---

## Related Documentation

- **[Agent Lifecycle](./agent-lifecycle.md)** - How Agent class operates AgentLoop
- **[A2A Protocol](./a2a-protocol.md)** - Event format and protocol compliance
- **[Tool Integration](./tool-integration.md)** - Tool provider patterns
- **[Observability](./observability.md)** - Tracing and logging details
- **[A2A Alignment](../A2A_ALIGNMENT.md)** - Event type mapping and compliance
