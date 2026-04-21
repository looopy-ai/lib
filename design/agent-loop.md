# Agent Loop Design

> **Note**: This document describes the agent loop execution engine. The loop is designed to be operated by the **Agent** class (see [agent-lifecycle.md](./agent-lifecycle.md)), which handles multi-turn conversations, message persistence, and session management.

## Overview

The agent loop is a reactive RxJS-based execution engine that powers a single conversational turn. It orchestrates LLM calls and tool executions until the LLM indicates completion.

It is implemented as a **set of composable functions** (not a class):

- **`runLoop()`** — Orchestrates the full turn: emits initial events, runs iterations, emits the final summary event.
- **`runIteration()`** — Executes one LLM call + any resulting tool calls.
- **`runToolCall()`** — Executes a single tool call and emits its lifecycle events.
- **`recursiveMerge()`** — Generic RxJS utility that drives the iterative loop.

### Key Responsibilities

- **Single-turn execution**: Execute one complete LLM reasoning cycle from user input to final response
- **LLM orchestration**: Call the LLM with full message history, available tools, and assembled system prompts
- **Tool execution**: Execute tools requested by the LLM in parallel
- **Iteration control**: Loop until the LLM finishes or max iterations is reached
- **Input interruption**: Detect `tool-input-required` stops and surface `waiting-input` to the caller
- **Event streaming**: Emit all lifecycle events for client observation
- **Observability**: Create distributed tracing spans for all operations

### What the Agent Loop Does NOT Do

- ❌ Manage conversation history across turns (the `Agent` class does this)
- ❌ Persist messages to storage (the `Agent` class does this)
- ❌ Handle user sessions or context IDs (the `Agent` class does this)
- ❌ Decide when to start/stop conversations (the `Agent` class does this)

### Relationship to Agent

```
┌─────────────────────────────────────────────────────────┐
│                        Agent                            │
│                  (Multi-turn Manager)                   │
│                                                         │
│  - Manages conversation history (MessageStore)          │
│  - Persists agent state (AgentStore)                    │
│  - Handles lifecycle (created → idle → busy → idle)     │
│  - Coordinates turns (startTurn)                        │
│                                                         │
│  ┌──────────────────────────────────────────────────┐   │
│  │         For each turn: startTurn()               │   │
│  │                                                  │   │
│  │  1. Load message history                         │   │
│  │  2. Call runLoop(context, config, history) ◄─────┼───┼─ Loop
│  │  3. Collect events from Observable               │   │   operates here
│  │  4. Save new messages to MessageStore            │   │
│  │  5. Return to idle state                         │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

---

## Core Interfaces

### Context Types

There is a hierarchy of context types, each extending the previous:

```typescript
// Base context — shared by Agent-level operations
type AgentContext<AuthContext> = {
  agentId: string;
  contextId: string;
  parentContext: import('@opentelemetry/api').Context;
  authContext?: AuthContext;
  logger: pino.Logger;
  plugins: readonly Plugin<AuthContext>[];
  metadata?: Record<string, unknown>;
};

// Turn context — adds taskId and turn number
type TurnContext<AuthContext> = AgentContext<AuthContext> & {
  taskId: string;
  turnNumber: number;
};

// Loop context — same as TurnContext (alias)
type LoopContext<AuthContext> = TurnContext<AuthContext>;

// Iteration context — adds resolved inputs for resumption after interrupts
type IterationContext<AuthContext> = TurnContext<AuthContext> & {
  resolvedInputs?: Map<string, unknown>;
};
```

### Configuration Types

```typescript
type LoopConfig<AuthContext> = {
  llmProvider: LLMProvider;
  filterPlugins?: FilterPlugins<AuthContext>;
  maxIterations: number;
  stopOnToolError: boolean;
};

type IterationConfig<AuthContext> = {
  llmProvider: LLMProvider | ((context, systemPromptMetadata) => LLMProvider);
  iterationNumber: number;
  filterPlugins?: FilterPlugins<AuthContext>;
};
```

### Plugin System

Plugins are the unified extension point for **system prompts** and **tools**. A `Plugin` is a union type:

```typescript
type Plugin<AuthContext> = SystemPromptPlugin<AuthContext> | ToolPlugin<AuthContext>;

// Provides system prompt content
type SystemPromptPlugin<AuthContext> = {
  name: string;
  version?: string;
  generateSystemPrompts(context: IterationContext<AuthContext>): SystemPrompt[] | Promise<SystemPrompt[]>;
};

// Provides tool definitions and execution
type ToolPlugin<AuthContext> = {
  name: string;
  version?: string;
  listTools(context: IterationContext<AuthContext>): Promise<ToolDefinition[]>;
  getTool(toolId: string, context: IterationContext<AuthContext>): Promise<ToolDefinition | undefined>;
  executeTool(toolCall: ToolCall, context: IterationContext<AuthContext>): Observable<ContextAnyEvent | AnyEvent>;
};
```

System prompts are **position-aware** — plugins can insert prompts before or after the base system prompt, with an optional ordering sequence:

```typescript
type SystemPrompt = {
  content: string;
  position: 'before' | 'after';
  positionSequence?: number;  // Lower = earlier; used to order within a position
  metadata?: Record<string, unknown>;
  source?: {
    providerName: string;
    promptName: string;
    promptVersion?: number;
  };
};
```

### LLM Provider Interface

```typescript
interface LLMProvider {
  call(request: {
    messages: LLMMessage[];
    tools?: ToolDefinition[];
    stream?: boolean;
    sessionId?: string;
  }): Observable<AnyEvent>;  // Streaming — emits events as they arrive
}
```

The provider returns an `Observable<AnyEvent>` (not a Promise), enabling real-time streaming of content deltas and tool call events.

---

## Architecture

### File Structure

```
packages/core/src/
├── core/
│   ├── agent.ts           # Agent class (multi-turn, stateful)
│   ├── loop.ts            # runLoop() — main turn orchestrator
│   ├── iteration.ts       # runIteration() — single LLM call + tools
│   ├── tools.ts           # runToolCall() — single tool execution
│   └── logger.ts
├── observability/
│   └── spans/
│       ├── agent-turn.ts  # Agent-level span helpers
│       ├── loop.ts        # Loop span helpers
│       ├── iteration.ts   # Iteration span helpers
│       ├── llm-call.ts    # LLM call span helpers
│       └── tool.ts        # Tool execution span helpers
├── utils/
│   └── recursive-merge.ts # Generic recursive iteration utility
└── types/
    ├── core.ts            # Context, config, and plugin types
    ├── event.ts           # All event types
    ├── llm.ts             # LLMProvider interface
    └── agent.ts           # Agent config and state types
```

### Execution Pipeline

```
runLoop(context, config, history) → Observable<ContextAnyEvent>
  │
  ├── Emit: task-created
  ├── Emit: task-status (working)
  │
  ├── recursiveMerge(
  │     initial: { messages: history, iteration: 0 },
  │     eventsFor: (state) => runIteration(context, config, state.messages),
  │     next: (state, { events }) => ({
  │       messages: [...state.messages, ...eventsToMessages(events)],
  │       iteration: state.iteration + 1
  │     }),
  │     isStop: (e) => content-complete (finishReason !== tool_calls)
  │                  || tool-input-required
  │   )
  │
  └── Emit: task-complete  OR  task-status (waiting-input)
```

### `recursiveMerge()` Utility

`recursiveMerge()` drives the iteration loop using RxJS `expand`. It:

1. Starts with an initial state
2. Generates an event stream for the current state via `eventsFor()`
3. Collects all events from the iteration
4. Checks each event against `isStop()` predicate
5. If no stop event: computes next state via `next()` and recurses
6. If stop event found: halts recursion
7. Merges all iteration event streams into a single output observable

```typescript
// Conceptual signature
function recursiveMerge<S, E>(
  initial: S,
  eventsFor: (state: S & { iteration: number }) => Observable<E>,
  next: (state: S, info: { iteration: number; events: E[] }) => S,
  isStop: (e: E) => boolean,
): Observable<E>
```

See [`packages/core/src/utils/recursive-merge.ts`](../packages/core/src/utils/recursive-merge.ts) for the implementation.

### Single Iteration Execution

Each call to `runIteration()` performs one full LLM call cycle:

```
runIteration(context, config, history)
  │
  ├── getSystemPrompts(plugins, context)   → SystemPrompts { before[], after[] }
  ├── prepareMessages(systemPrompts, history)
  ├── prepareTools(plugins, context)
  │
  ├── llmProvider.call({ messages, tools, stream: true, sessionId })
  │     → Observable<AnyEvent>  (shared via shareReplay)
  │
  └── For each tool-call event from LLM:
        ├── If tool is "request_input": convert to tool-input-required event (no tool call)
        └── Otherwise: runToolCall(context, toolCallEvent) → tool-start, tool-complete
```

Tool calls from a single iteration execute **in parallel** via `mergeMap`.

### Tool Input Interruption

The special `request_input` tool is intercepted by `runIteration()` before routing to `runToolCall()`. When the LLM calls `request_input`:

1. A `tool-input-required` event is emitted (instead of `tool-start`/`tool-complete`)
2. `recursiveMerge()`'s `isStop` predicate matches this event and halts the loop
3. `runLoop()` detects the pending `tool-input-required` and emits `task-status: waiting-input`
4. The `Agent` class saves the pending input state and returns control to the caller
5. When the caller provides the input, the `Agent` resumes from that point

---

## Event Model

### Task Lifecycle Events

| Event | Description |
|-------|-------------|
| `task-created` | Emitted at the start of every turn |
| `task-status` | State transitions: `working`, `waiting-input`, `waiting-auth`, `waiting-subtask`, `completed`, `failed`, `canceled` |
| `task-complete` | Final event with content and metadata; emitted in place of `task-status: completed` |

### Content Streaming Events

| Event | Description |
|-------|-------------|
| `content-delta` | Incremental LLM output chunk (`delta: string`, `index: number`) |
| `content-complete` | Full assembled LLM response with `finishReason` |

### Tool Execution Events

| Event | Description |
|-------|-------------|
| `tool-call` | LLM requested a tool invocation |
| `tool-start` | Tool execution has begun |
| `tool-progress` | Progress update for long-running tools |
| `tool-complete` | Tool finished (`success: boolean`, `result?`, `error?`) |
| `tool-input-required` | Tool (or LLM `request_input`) needs user/caller input to continue |

### Event Flow Diagram

```
turn start
  task-created
  task-status (working)

  ── iteration 0 ──────────────────────────────────────────
  content-delta × N          (streaming LLM text)
  content-complete           (finishReason: tool_calls)
  tool-call                  (LLM requested a tool)
  tool-start
  tool-complete

  ── iteration 1 ──────────────────────────────────────────
  content-delta × N
  content-complete           (finishReason: stop)

turn end (normal)
  task-complete

turn end (interrupted)
  tool-input-required
  task-status (waiting-input)
```

---

## Observability

### Span Hierarchy

OpenTelemetry spans are nested for distributed tracing:

```
agent.turn                (created by Agent)
  └─ agent.loop           (created by runLoop)
      └─ agent.iteration  (created by runIteration, one per loop cycle)
          ├─ agent.llm    (LLM call within the iteration)
          └─ agent.tool   (one per tool call, parallel)
```

### Context Propagation

Each level receives an explicit OpenTelemetry `Context` and creates child spans:

1. **Agent level**: Creates `agent.turn` span, extracts `parentContext`
2. **Loop level**: Receives `parentContext`, creates `agent.loop` span → `loopContext`
3. **Iteration level**: Receives `loopContext`, creates `agent.iteration` span → `iterationContext`
4. **LLM/Tool level**: Receive `iterationContext`, create their child spans

Span helpers live in [`packages/core/src/observability/spans/`](../packages/core/src/observability/spans/).

---

## Loop Termination

The loop terminates when any of the following occur:

| Condition | Final Event Emitted |
|-----------|-------------------|
| LLM `finishReason === 'stop'` | `task-complete` |
| Max iterations reached | `task-complete` (with last response) |
| `tool-input-required` emitted | `task-status: waiting-input` |
| Unrecoverable error | `task-status: failed` |
| Observable unsubscribed | (no event — cancelled in-flight) |

---

## Tool Execution

### Parallel Execution

Tools within a single iteration execute in parallel using `mergeMap`. All tool results are converted to messages and appended to the history before the next LLM call.

### `ToolPlugin` Interface

The `ToolPlugin` contract has three methods:

- `listTools(context)` — returns available `ToolDefinition[]`
- `getTool(toolId, context)` — returns a specific definition (used for validation)
- `executeTool(toolCall, context)` — returns `Observable<AnyEvent>` (the tool emits its own events)

Tools emit `tool-start`, optionally `tool-progress`, and finally `tool-complete` (or `tool-input-required` for interruptible tools). The `runToolCall()` function wraps this and prepends a `tool-start` event if the plugin does not emit one.

---

## Implementation Reference

| File | Purpose |
|------|---------|
| [`core/loop.ts`](../packages/core/src/core/loop.ts) | `runLoop()` — turn orchestrator |
| [`core/iteration.ts`](../packages/core/src/core/iteration.ts) | `runIteration()` — single LLM + tools cycle |
| [`core/tools.ts`](../packages/core/src/core/tools.ts) | `runToolCall()` — single tool execution |
| [`core/agent.ts`](../packages/core/src/core/agent.ts) | `Agent` class — multi-turn stateful manager |
| [`utils/recursive-merge.ts`](../packages/core/src/utils/recursive-merge.ts) | `recursiveMerge()` — recursive RxJS iteration utility |
| [`types/core.ts`](../packages/core/src/types/core.ts) | Context, config, and plugin types |
| [`types/event.ts`](../packages/core/src/types/event.ts) | All event type definitions |
| [`types/llm.ts`](../packages/core/src/types/llm.ts) | `LLMProvider` interface |
| [`types/agent.ts`](../packages/core/src/types/agent.ts) | `AgentConfig`, `AgentState` types |
| [`observability/spans/`](../packages/core/src/observability/spans/) | Span helper functions |

---

## Related Documentation

- **[Agent Lifecycle](./agent-lifecycle.md)** — How `Agent` operates the loop across turns
- **[A2A Protocol](./a2a-protocol.md)** — Event format and protocol compliance
- **[Tool Integration](./tool-integration.md)** — Tool plugin patterns
- **[Observability](./observability.md)** — Tracing and logging details

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
- **State persistence**: Optional checkpointing via TaskStateStore
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
- Core agent loop execution (`packages/core/src/agent-loop.ts`)
- RxJS operator-based pipeline architecture
- LLM integration via provider interface
- Tool execution (parallel with concurrency)
- Checkpointing and state persistence (via TaskStateStore)
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

The execution pipeline uses **factory functions** that create operator callbacks and manage tracing contexts:

```
packages/core/src/
├── agent-loop.ts              # Main orchestrator
├── operators/
│   ├── execute-operators.ts   # Root span lifecycle callbacks
│   ├── iteration-operators.ts # Iteration span management
│   └── llm-operators.ts       # LLM call span management
└── types.ts                   # Core interfaces
```

**Pattern**:
```typescript
// Factory creates operator callbacks that manage spans and trace contexts
export const startIterationSpan = (
  state: LoopState,
  nextIteration: number,
  logger: Logger,
  parentContext: Context  // OpenTelemetry Context
) => {
  // Start iteration span as child of parent context
  const { span, traceContext } = startLoopIterationSpan({
    agentId: state.agentId,
    taskId: state.taskId,
    contextId: state.contextId,
    iteration: nextIteration,
    parentContext,  // Parent OTel context
  });

  return { span, traceContext };
};
```

**Key Changes in Tracing Architecture**:
- **Explicit Context Passing**: OpenTelemetry `Context` objects are explicitly passed through the pipeline
- **No Span Refs**: Instead of mutable span references, functions return `{ span, traceContext }` tuples
- **Parent-Child Relationships**: Each span creation receives its parent context, ensuring proper nesting
- **Cleaner Separation**: Span lifecycle management is separated from RxJS operators

Benefits:
- **Explicit Context Flow**: Trace context is visible in function signatures
- **Type Safety**: OpenTelemetry Context types ensure proper propagation
- **Testability**: Pure functions without mutable shared state
- **Correct Nesting**: Parent-child span relationships are explicit and correct

### Checkpointing

State is automatically persisted (if TaskStateStore configured):
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
  taskStateStore?: TaskStateStore;             // Optional state persistence
  artifactStore?: ArtifactStore;       // Optional artifact storage
  maxIterations?: number;              // Default: 10
  systemPrompt?: string;               // Injected at LLM call time
  enableTracing?: boolean;             // Default: true
}

// Execution context
interface AgentLoopContext {
  taskId: string;
  agentId: string;
  contextId: string;
  messages: Message[];                 // Full history from Agent
  parentContext: Context;              // OpenTelemetry Context for tracing
  authContext?: AuthContext;
  systemPrompt?: string;
  maxIterations?: number;
  metadata?: Record<string, unknown>;
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
execute(context: AgentLoopContext) → Observable<AgentEvent>
  ↓
Create agent loop span with parent context
  { span, traceContext: loopContext } = startAgentLoopSpan({
    agentId, taskId, contextId,
    parentContext: context.parentContext
  })
  ↓
Pipeline:
  defer(() => prepareTurnLoopState(context))
  → switchMap(state => runLoop(state, loopContext))  # Pass loop context
  → tap(tapAfterTurn)                                # Set output, usage
  → catchError(catchTurnError)                       # Handle errors
  → shareReplay()                                    # Hot observable
```

**Tracing Context Flow**:

1. **Execute Level**: Creates root `agent.execute` span with parent context
2. **Loop Level**: `runLoop(state, loopContext)` receives the loop's trace context
3. **Iteration Level**: Each iteration creates a child span of `loopContext`
4. **LLM/Tool Level**: LLM and tool operations create spans under iteration context

**Operator Callbacks**:

**Execute Operators** (`execute-operators.ts`):
- `tapAfterTurn()` - Set span output and usage attributes
- `catchTurnError()` - Fail span with error details

**Iteration Operators** (`iteration-operators.ts`):
- `startIterationSpan()` - Create iteration span, return `{ span, traceContext }`
- `completeIteration()` - Update iteration count, complete span
- `catchIterationError()` - Fail iteration span with error

**LLM Operators** (`llm-operators.ts`):
- `prepareLLMCall()` - Build messages (inject system prompt)
- `tapLLMResponse()` - Log response, complete LLM span with metrics
- `mapLLMResponseToState()` - Sanitize tool calls, map to LoopState
- `catchLLMError()` - Fail LLM span

### Iteration Loop

The `runLoop()` method orchestrates iterations:

```typescript
private runLoop(
  initialState: LoopState,
  loopContext: import('@opentelemetry/api').Context  // Parent trace context
): Observable<AgentEvent> {
  // Subject to collect LLM events from all iterations
  const llmEventsCollector = new Subject<AgentEvent>();

  // Recursive iteration function
  const iterate = (state: LoopState): Observable<LoopState> => {
    // Check termination
    if (state.completed || state.iteration >= state.maxIterations) {
      return of(state);
    }

    // Execute iteration - returns { state$, events$ }
    const { state$, events$ } = this.executeIteration(state, loopContext);

    // Subscribe to iteration events (LLM + tool) and forward to collector
    events$.subscribe({
      next: (event) => llmEventsCollector.next(event),
      error: (err) => llmEventsCollector.error(err),
    });

    // Continue iteration with state pipeline
    return state$.pipe(
      switchMap((nextState) => iterate(nextState))
    );
  };

  const stateLoop$ = defer(() => iterate(initialState)).pipe(
    // Convert final state to status events
    switchMap((state) => this.stateToEvents(state)),
    // Complete the LLM events collector when state loop completes
    finalize(() => llmEventsCollector.complete())
  );

  // Merge initial events, LLM events from iterations, and final state events
  return concat(
    of(taskEvent, workingEvent),
    merge(stateLoop$, llmEventsCollector)
  );
}
```

### Single Iteration Execution

Each iteration executes with its own trace context:

```typescript
private executeIteration(
  state: LoopState,
  loopContext: Context  // Parent context from runLoop
): { state$: Observable<LoopState>; events$: Observable<AgentEvent> } {
  const nextIteration = state.iteration + 1;

  // Create iteration span as child of loop context
  const { span, traceContext: iterationContext } = startIterationSpan(
    state,
    nextIteration,
    this.logger,
    loopContext
  );

  // Call LLM with iteration context
  const { state$: llmState$, events$: llmEvents$ } =
    this.callLLMAndProcessEvents(
      { ...state, iteration: nextIteration },
      nextIteration,
      iterationContext  // Pass to LLM operations
    );

  // Process LLM response and execute tools
  const state$ = llmState$.pipe(
    switchMap((s) =>
      this.processLLMResponse(s, internalEventsCollector, iterationContext)
    ),
    tap(() => completeIterationSpan(span)),
    catchError((err) => {
      failIterationSpan(span, err);
      throw err;
    })
  );

  return { state$, events$: llmEvents$ };
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

**Trace Context Propagation**:

1. **Agent Level**: Creates `agent.turn` span and extracts OpenTelemetry Context
2. **Execute Level**: Receives `parentContext`, creates `agent.execute` span as child
   ```typescript
   const { span, traceContext: loopContext } = startAgentLoopSpan({
     agentId, taskId, contextId,
     parentContext: context.parentContext  // From Agent
   });
   ```
3. **Loop Level**: Passes `loopContext` to `runLoop()` for iteration span creation
4. **Iteration Level**: Each iteration creates span with `loopContext` as parent
   ```typescript
   const { span, traceContext: iterationContext } = startLoopIterationSpan({
     agentId, taskId, contextId, iteration,
     parentContext: loopContext  // From execute
   });
   ```
5. **Operation Level**: LLM/tool operations receive `iterationContext` for their spans
6. **Context Chain**: Each level receives explicit parent context, ensuring correct nesting

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

**Current Implementation**: See [`packages/core/src/providers/litellm-provider.ts`](../packages/core/src/providers/litellm-provider.ts) for production LLM integration using LiteLLM proxy.

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
- [`LocalToolProvider`](../packages/core/src/tools/local-tools.ts) - Register functions locally
- [`ClientToolProvider`](../packages/core/src/tools/client-tool-provider.ts) - Tools provided by client via A2A
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

**Implementation**: See [`packages/core/src/agent-loop.ts`](../packages/core/src/agent-loop.ts) `executeTools()` method.

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

**Implementation**: See [`packages/core/src/types.ts`](../packages/core/src/types.ts) for event type definitions and [`A2A_ALIGNMENT.md`](../A2A_ALIGNMENT.md) for protocol compliance details.

---

## Error Handling

AgentLoop handles errors at multiple pipeline stages:

- **Execute errors**: Root span failed, emit `StatusUpdateEvent` with `state: "failed"`
- **Iteration errors**: Iteration span failed, retry or propagate
- **LLM errors**: LLM span failed, log and propagate
- **Tool errors**: Individual tool failures don't stop execution; error returned as tool result

All errors are recorded in OpenTelemetry spans with proper attributes.

**Implementation**: Error handling is in operator catch blocks. See `catchExecuteError`, `catchIterationError`, `catchLLMError` in [`packages/core/src/operators/`](../packages/core/src/operators/).

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

### TaskStateStore Interface

```typescript
interface TaskStateStore {
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
const taskStateStore = StoreFactory.createStateStore({
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

**Implementation**: See [`packages/core/src/agent-loop.ts`](../packages/core/src/agent-loop.ts) `resume()` static method.

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

**Current Status**: Basic in-memory implementation exists. See [`packages/core/src/stores/artifacts/`](../packages/core/src/stores/artifacts/).

---

## Implementation Reference

For complete implementation details, see:

**Core Implementation**:
- [`packages/core/src/agent-loop.ts`](../packages/core/src/agent-loop.ts) - Main AgentLoop class
- [`packages/core/src/types.ts`](../packages/core/src/types.ts) - Type definitions
- [`packages/core/src/config.ts`](../packages/core/src/config.ts) - Configuration interface

**Operator Factories**:
- [`packages/core/src/operators/execute-operators.ts`](../packages/core/src/operators/execute-operators.ts) - Root execution span management
- [`packages/core/src/operators/iteration-operators.ts`](../packages/core/src/operators/iteration-operators.ts) - Iteration loop operators
- [`packages/core/src/operators/llm-operators.ts`](../packages/core/src/operators/llm-operators.ts) - LLM call and response processing

**Storage**:
- [`packages/core/src/stores/interfaces.ts`](../packages/core/src/stores/interfaces.ts) - TaskStateStore and ArtifactStore interfaces
- [`packages/core/src/stores/factory.ts`](../packages/core/src/stores/factory.ts) - Store creation factory
- [`packages/core/src/stores/redis/`](../packages/core/src/stores/redis/) - Redis implementations
- [`packages/core/src/stores/memory/`](../packages/core/src/stores/memory/) - In-memory implementations

**Tools**:
- [`packages/core/src/tools/interfaces.ts`](../packages/core/src/tools/interfaces.ts) - ToolProvider interface
- [`packages/core/src/tools/local-tools.ts`](../packages/core/src/tools/local-tools.ts) - Local tool registration
- [`packages/core/src/tools/client-tool-provider.ts`](../packages/core/src/tools/client-tool-provider.ts) - Client-provided tools

**Observability**:
- [`packages/core/src/observability/tracing.ts`](../packages/core/src/observability/tracing.ts) - OpenTelemetry setup
- [`packages/core/src/observability/spans/`](../packages/core/src/observability/spans/) - Span helper functions

---

## Testing

See [`packages/core/tests/agent-loop.test.ts`](../packages/core/tests/agent-loop.test.ts) for comprehensive test suite covering:

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
