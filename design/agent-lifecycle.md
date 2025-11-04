# Agent Lifecycle and State Management

## Overview

This design separates the stateful **Agent** (lifecycle and persistence management) from the stateless **AgentLoop** (single turn execution). This enables multi-turn conversations, pause/resume, and proper state management.

## Motivation

### Current Architecture Issues

1. **AgentLoop is monolithic**: Handles both single-turn execution AND lifecycle
2. **No multi-turn support**: Each execution is independent
3. **State persistence is implicit**: Checkpoint/resume tied to execution
4. **No conversation continuity**: Message history not managed
5. **A2A alignment**: A2A protocol has task lifecycle separate from execution

### Desired Architecture

```
┌────────────────────────────────────────────────────────────┐
│                           Agent                            │
│  (Stateful, Multi-turn, Lifecycle Management)              │
│                                                            │
│  - contextId / sessionId                                   │
│  - MessageStore (conversation history)                     │
│  - ArtifactStore (generated artifacts)                     │
│  - StateStore (agent metadata)                             │
│  - Lifecycle: start, pause, resume, shutdown               │
│                                                            │
│  ┌────────────────────────────────────────────────────┐    │
│  │            startTurn(userMessage)                  │    │
│  │                                                    │    │
│  │  1. Load conversation history                      │    │
│  │  2. Append user message                            │    │
│  │  3. Call AgentLoop.execute(messages, context)      │    │
│  │  4. Save assistant messages                        │    │
│  │  5. Save artifacts                                 │    │
│  │  6. Return events                                  │    │
│  └────────────────────────────────────────────────────┘    │
└────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────────┐
│                       AgentLoop                            │
│  (Stateless, Single-turn, Execution)                       │
│                                                            │
│  execute(messages, context) → Observable<AgentEvent>       │
│                                                            │
│  Single Turn:                                              │
│  1. LLM call with message history                          │
│  2. Execute tools if requested                             │
│  3. Repeat until:                                          │
│     - LLM finish_reason = 'stop'                           │
│     - Max iterations reached                               │
│     - Error occurs                                         │
│  4. Return final state                                     │
└────────────────────────────────────────────────────────────┘
```

## Key Concepts

### Agent (Stateful)

The **Agent** manages the lifecycle and persistence of a conversation:

- **Identity**: `contextId` uniquely identifies the agent instance/session
- **State**: Maintains conversation history, artifacts, and metadata
- **Persistence**: Saves/loads state from stores
- **Multi-turn**: Coordinates multiple turns in a conversation
- **Lifecycle**: Start → [Execute Turns] → Pause/Resume → Shutdown

### AgentLoop (Stateless per Turn)

The **AgentLoop** executes a single conversational turn:

- **Input**: Message history + execution context
- **Process**: LLM calls + tool execution until completion
- **Output**: Stream of events + final state
- **Stateless**: Doesn't manage persistence (Agent does)

### Turn

A **Turn** is one complete LLM interaction cycle:

1. User provides input (message/tool results)
2. Agent loads conversation history
3. AgentLoop processes with LLM + tools
4. Agent saves new messages and artifacts
5. Turn completes when LLM finishes or needs input

## Architecture

### Agent Interface

```typescript
interface AgentConfig {
  /** Unique identifier for this agent/session */
  contextId: string;

  /** LLM provider for generating responses */
  llmProvider: LLMProvider;

  /** Tool providers for tool execution */
  toolProviders: ToolProvider[];

  /** Message store for conversation history */
  messageStore: MessageStore;

  /** Artifact store for generated content */
  artifactStore: ArtifactStore;

  /** Agent loop configuration (optional overrides) */
  loopConfig?: Partial<AgentLoopConfig>;

  /** Auto-save messages after each turn (default: true) */
  autoSave?: boolean;

  /** Auto-compact messages when exceeding limit (default: false) */
  autoCompact?: boolean;

  /** Maximum messages to keep before compaction warning */
  maxMessages?: number;

  /** System prompt */
  systemPrompt?: string;

  /** Agent ID for tracing */
  agentId?: string;

  /** Logger */
  logger?: import('pino').Logger;
}

interface Agent {
  /** Unique identifier for this agent instance */
  readonly contextId: string;

  /** Current agent state */
  readonly state: AgentState;

  /**
   * Execute a single conversational turn
   *
   * Automatically initializes the agent on first call (lazy initialization).
   *
   * @param userMessage - User's message or null for continuation
   * @param options - Turn options including authContext and optional taskId
   * @returns Observable stream of agent events
   */
  startTurn(
    userMessage: string | null,
    options?: {
      authContext?: AuthContext;
      taskId?: string;
    }
  ): Promise<Observable<AgentEvent>>;

  /**
   * Shutdown the agent (save state, cleanup resources)
   */
  shutdown(): Promise<void>;

  /**
   * Get conversation messages
   */
  getMessages(options?: GetMessagesOptions): Promise<Message[]>;

  /**
   * Get generated artifacts
   */
  getArtifacts(): Promise<Array<{ id: string; content: unknown }>>;

  /**
   * Manually save current conversation state
   */
  save(): Promise<void>;

  /**
   * Clear conversation history and artifacts
   */
  clear(): Promise<void>;
}

interface AgentState {
  /** Agent lifecycle status */
  status: 'created' | 'ready' | 'busy' | 'shutdown' | 'error';

  /** Total turns executed */
  turnCount: number;

  /** Last activity timestamp */
  lastActivity: Date;

  /** Creation timestamp */
  createdAt: Date;

  /** Error if in error state */
  error?: Error;

  /** Metadata */
  metadata?: Record<string, unknown>;
}
```

### AgentLoop Interface (Refactored)

```typescript
interface AgentLoopConfig {
  /** Agent ID for tracing */
  agentId?: string;

  /** LLM provider */
  llmProvider: LLMProvider;

  /** Tool providers for tool execution */
  toolProviders: ToolProvider[];

  /** State store (not used by Agent, uses NoopStateStore) */
  stateStore: StateStore;

  /** Artifact store for generated content */
  artifactStore: ArtifactStore;

  /** Maximum iterations per turn */
  maxIterations?: number;

  /** System prompt */
  systemPrompt?: string;

  /** Logger */
  logger?: import('pino').Logger;
}

interface StartTurnOptions {
  /** Context ID for this session */
  contextId: string;

  /** Task ID for this turn */
  taskId: string;

  /** Turn number (1-indexed) */
  turnNumber: number;

  /** Available artifacts (read-only) */
  artifacts?: Array<{ id: string; content: unknown }>;

  /** Authentication context */
  authContext?: AuthContext;

  /** Trace context for distributed tracing */
  traceContext?: TraceContext;
}

interface AgentLoop {
  /**
   * Execute a single turn
   * @param messages - Full conversation history
   * @param options - Turn execution options
   * @returns Observable stream of events
   */
  startTurn(
    messages: Message[],
    options: StartTurnOptions
  ): Observable<AgentEvent>;
}
```

## Data Flow

### Multi-turn Conversation

```
┌─────────┐
│  User   │
└────┬────┘
     │ "What's the weather?"
     ▼
┌─────────────────────────────────────────┐
│ Agent.startTurn(userMessage)            │
│                                         │
│ 1. Load messages from MessageStore      │
│    messages = [                         │
│      { role: 'user', content: '...' }   │
│    ]                                    │
│                                         │
│ 2. Append user message                  │
│    messages.push(userMessage)           │
│                                         │
│ 3. Execute turn via AgentLoop           │
│    ┌──────────────────────────────┐     │
│    │ AgentLoop.startTurn()        │     │
│    │                              │     │
│    │ - LLM call with messages     │     │
│    │ - Tool execution (weather)   │     │
│    │ - LLM call with tool result  │     │
│    │ - finish_reason = 'stop'     │     │
│    │                              │     │
│    │ Returns: assistant message   │     │
│    └──────────────────────────────┘     │
│                                         │
│ 4. Save assistant message               │
│    messageStore.append([assistantMsg])  │
│                                         │
│ 5. Save artifacts (if any)              │
│    artifactStore.save(...)              │
│                                         │
│ 6. Update agent state                   │
│    state.turnCount++                    │
│    state.lastActivity = now()           │
│                                         │
│ 7. Emit events to user                  │
└─────────────────────────────────────────┘
     │
     │ Events: status-update, artifact-update, etc.
     ▼
┌─────────┐
│  User   │
└────┬────┘
     │ "Thanks, now check my calendar"
     ▼
┌─────────────────────────────────────────┐
│ Agent.startTurn(userMessage)            │
│                                         │
│ 1. Load messages (includes previous)    │
│    messages = [                         │
│      { role: 'user', content: 'weather' },
│      { role: 'assistant', ... },        │
│      { role: 'tool', ... }              │
│    ]                                    │
│                                         │
│ 2. Append new user message              │
│    ... (same flow)                      │
└─────────────────────────────────────────┘
```

### Pause and Resume

```
Agent Session 1:
┌──────────────────────────────────────────┐
│ agent = new Agent({ contextId })         │
│ await agent.start()                      │
│                                          │
│ // Turn 1                                │
│ agent.startTurn("Hello").subscribe()     │
│ messageStore: [user, assistant]          │
│                                          │
│ // Turn 2                                │
│ agent.startTurn("Help me").subscribe()   │
│ messageStore: [user, asst, user, asst]   │
│                                          │
│ // Pause                                 │
│ await agent.pause()                      │
│ → Saves to messageStore                  │
│ → Saves to stateStore                    │
│   { turnCount: 2, ... }                  │
└──────────────────────────────────────────┘

... (user closes app, time passes) ...

Agent Session 2 (same contextId):
┌──────────────────────────────────────────┐
│ agent = new Agent({                      │
│   contextId: 'same-id'                   │
│ })                                       │
│                                          │
│ await agent.start()                      │
│ → Loads from messageStore                │
│   [user, asst, user, asst]               │
│ → Loads from stateStore                  │
│   { turnCount: 2, ... }                  │
│                                          │
│ state.status = 'ready'                   │
│                                          │
│ // Continue conversation                 │
│ agent.startTurn("Continue").subscribe()  │
│ → Turn 3 with full history               │
└──────────────────────────────────────────┘
```

## Turn Completion Conditions

A turn completes when ANY of these occur:

### 1. LLM Finish
```typescript
// LLM returns finish_reason = 'stop'
// No more tool calls requested
// Assistant has final response
{
  message: { role: 'assistant', content: 'Here is your answer...' },
  finished: true,
  finishReason: 'stop'
}
```

### 2. Max Iterations
```typescript
// Reached maxIterations in config
// Prevents infinite loops
// Should emit warning event
{
  status: {
    state: 'completed',
    message: { role: 'assistant', content: 'Partial result...' }
  },
  metadata: {
    reason: 'max_iterations',
    iterations: 10
  }
}
```

### 3. User Input Required
```typescript
// LLM requests client tool (user action)
// Need to wait for user response
// Return control to Agent
{
  status: {
    state: 'input-required',
    message: { role: 'assistant', content: 'Please provide...' }
  }
}
```

### 4. Error
```typescript
// Any error during execution
// Save partial state
// Emit error event
{
  status: {
    state: 'failed'
  },
  metadata: { error: '...' }
}
```

## State Persistence

### Agent Metadata (StateStore)

```typescript
interface AgentMetadata {
  contextId: string;
  createdAt: string;
  lastActivity: string;
  turnCount: number;
  status: AgentState['status'];
  metadata?: Record<string, unknown>;
}

// Save on: pause, shutdown, after each turn (if autoSave)
// Load on: start (if resuming)
```

### Message History (MessageStore)

```typescript
// Conversation history
// Save on: after each turn
// Load on: before each turn
// Compact on: when exceeding maxMessages (if autoCompact)

await messageStore.append(contextId, newMessages);
const history = await messageStore.getRecent(contextId, { maxMessages: 50 });
```

### Artifacts (ArtifactStore)

```typescript
// Generated artifacts
// Save on: when tools create artifacts
// Load on: when needed by tools

await artifactStore.save(contextId, artifactId, content);
const artifacts = await artifactStore.list(contextId);
```

## Implementation Strategy

### Phase 1: Refactor AgentLoop to Single Turn

1. Remove checkpoint/resumption from AgentLoop
2. Change `execute()` to `startTurn(messages, context)`
3. Return when turn completes (not when task completes)
4. Remove state persistence from loop

### Phase 2: Implement Agent

1. Create `Agent` class with lifecycle management
2. Implement state loading/saving
3. Implement `startTurn()` coordination
4. Add pause/resume/shutdown

### Phase 3: Update A2A Server

1. Create Agent instance per task
2. Map A2A lifecycle to Agent lifecycle
3. Handle multi-turn via repeated `startTurn()` calls

## API Examples

### Basic Usage

```typescript
import { Agent } from 'looopy';
import { LiteLLMProvider } from 'looopy/providers';
import { InMemoryMessageStore, InMemoryArtifactStore } from 'looopy/stores';

// Create agent
const agent = new Agent({
  contextId: 'user-123-session-456',
  llmProvider: new LiteLLMProvider({ model: 'gpt-4' }),
  toolProviders: [localTools],
  messageStore: new InMemoryMessageStore(),
  artifactStore: new InMemoryArtifactStore(),
});

// Note: No start() call needed - lazy initialization on first startTurn()

// Get fresh auth context (e.g., from request headers, JWT)
const getAuthContext = () => ({
  actorId: getUserIdFromJWT(),
  credentials: { token: extractToken() }
});

// Turn 1 - Pass fresh auth context
// Agent auto-initializes on first call
const turn1$ = await agent.startTurn('Hello, what can you help with?', {
  authContext: getAuthContext()
});
await lastValueFrom(turn1$);

// Turn 2 - Pass potentially refreshed auth context
const turn2$ = await agent.startTurn('Tell me about TypeScript', {
  authContext: getAuthContext()
});
await lastValueFrom(turn2$);

// Shutdown
await agent.shutdown();
```

### Authentication Context Per Turn

**Why per-turn instead of construction?**

Long-running agents may span hours or days. Authentication tokens expire. By passing `authContext` to each `startTurn()` call:

- ✅ Tokens can be refreshed between turns
- ✅ User identity remains current
- ✅ No stale credentials for tools or stores
- ✅ Works with short-lived JWTs (15 min expiry)

```typescript
// Web server example - fresh auth per request
app.post('/chat', async (req, res) => {
  const agent = await getOrCreateAgent(req.session.id);

  // Extract FRESH auth from this request
  const authContext = {
    actorId: req.user.id,
    credentials: {
      token: req.headers.authorization,
      refreshToken: req.session.refreshToken
    }
  };

  // Pass fresh auth to this turn
  const events$ = await agent.startTurn(req.body.message, { authContext });

  events$.subscribe({
    next: (event) => res.write(JSON.stringify(event) + '\n'),
    complete: () => res.end()
  });
});
```

### Resume Previous Conversation

```typescript
// Session 1
const agent = new Agent({
  contextId: 'persistent-session',
  llmProvider,
  toolProviders,
  messageStore, // Persistent message store (e.g., Redis, DB)
  artifactStore
});

const turn1$ = await agent.startTurn('Start a complex task');
await lastValueFrom(turn1$);

// Messages automatically saved if autoSave: true (default)
await agent.shutdown();

// ... later (different process, after restart, etc.) ...

// Session 2 - same contextId
const agent2 = new Agent({
  contextId: 'persistent-session', // Same context ID
  llmProvider,
  toolProviders,
  messageStore, // Same store - loads previous messages
  artifactStore
});

// Agent auto-initializes and loads message history on first startTurn
const turn2$ = await agent2.startTurn('Continue the task');
console.log('Resumed with', agent2.state.turnCount, 'previous turns');

await lastValueFrom(turn2$);
```

### Error Handling

```typescript
const agent = new Agent({
  contextId: 'session',
  llmProvider,
  toolProviders,
  messageStore,
  artifactStore
});

const events$ = await agent.startTurn('Do something');

events$.subscribe({
  next: (event) => {
    if (event.kind === 'status-update' && event.status.state === 'failed') {
      console.error('Turn failed:', event.metadata?.error);
    }
  },
  error: async (err) => {
    console.error('Fatal error:', err);
    await agent.shutdown(); // Cleanup
  },
  complete: async () => {
    if (agent.state.status === 'ready') {
      // Normal completion
      console.log('Turn completed successfully');
    }
  }
});
```

### With A2A Protocol

```typescript
// A2A task handler
app.post('/api/a2a', async (req, res) => {
  const { method, params } = req.body;

  if (method === 'message/stream') {
    const contextId = params.message.contextId || generateId();

    // Create or resume agent
    const agent = getOrCreateAgent(contextId);
    // Note: No start() call - lazy initialization on first startTurn

    // Execute turn
    const userMessage = params.message.parts[0].text;
    const events$ = await agent.startTurn(userMessage);

    res.setHeader('Content-Type', 'text/event-stream');

    events$.subscribe({
      next: (event) => {
        if (!event.kind.startsWith('internal:')) {
          const response = {
            jsonrpc: '2.0',
            id: req.body.id,
            result: event
          };
          res.write(`data: ${JSON.stringify(response)}\n\n`);
        }
      },
      complete: () => {
        // Messages auto-saved if autoSave: true
        res.end();
      },
      error: async (err) => {
        await agent.shutdown();
        const errorResponse = {
          jsonrpc: '2.0',
          id: req.body.id,
          error: { code: -32000, message: err.message }
        };
        res.write(`data: ${JSON.stringify(errorResponse)}\n\n`);
        res.end();
      }
    });
  }
});
```

## Design Decisions

### Implementation Notes

#### Lazy Initialization

The Agent automatically initializes on the first `startTurn()` call. There is no separate `start()` method:

```typescript
const agent = new Agent({ ... });

// First call - triggers initialization (loads existing messages if any)
const events$ = await agent.startTurn('Hello');

// Status transitions: 'created' → 'ready' → 'busy' → 'ready'
```

#### No Pause Method

The design document mentioned `pause()`, but the actual implementation doesn't have it. Instead:

- Messages are auto-saved after each turn (if `autoSave: true`, which is the default)
- State is persisted in the MessageStore
- Simply create a new Agent with the same `contextId` to resume

#### State Store Not Used

The Agent passes a `NoopStateStore` to AgentLoop. State persistence happens via:
- **MessageStore**: Conversation history
- **ArtifactStore**: Generated artifacts
- **Agent state**: In-memory only (not persisted)

If you need to persist agent metadata (turnCount, etc.), implement it in your application layer.

## Design Decisions

### 1. Why Separate Agent from AgentLoop?

**Pros**:
- Clear separation of concerns
- AgentLoop becomes simpler (single turn only)
- Agent handles all persistence
- Easier to test each component
- Aligns with A2A task lifecycle
- Supports multi-turn conversations naturally

**Cons**:
- More complexity for simple use cases
- Need to manage two abstractions

**Decision**: Separate. The benefits for real-world usage (chat, persistence, multi-turn) outweigh the added complexity.

### 2. Who Manages Message History?

**Options**:
- A: AgentLoop loads/saves messages
- B: Agent loads/saves messages, passes to AgentLoop

**Decision**: B (Agent). AgentLoop is stateless and focused on single-turn execution. Agent coordinates persistence.

### 3. Auto-save vs Manual Save?

**Decision**: Auto-save by default (`autoSave: true`), with option to disable. Most users want automatic persistence, advanced users can control it manually via `save()`.

### 4. What Happens on Error Mid-turn?

**Decision**:
- Set agent status to 'error'
- Emit error event with details
- Partial state saved (messages up to error point) if autoSave is enabled
- User can retry turn or shutdown

### 5. Lazy Initialization vs Explicit Start

**Decision**: Lazy initialization. No separate `start()` method - the agent initializes automatically on the first `startTurn()` call. This simplifies the API and matches common usage patterns.

### 6. ToolProvider vs ToolProviders

**Decision**: Array of `toolProviders` instead of single `toolProvider`. Allows composing multiple tool sources (local tools, MCP servers, client tools, etc.).

## Migration Path

For existing code using `AgentLoop.execute()`:

### Before (Old API)
```typescript
const loop = new AgentLoop({
  llmProvider,
  toolProvider,
  stateStore,
  artifactStore
});

const events$ = loop.execute('Do something', context);
```

### After (New API)
```typescript
const agent = new Agent({
  contextId: context.contextId,
  llmProvider,
  toolProviders: [toolProvider],
  messageStore,
  artifactStore
});

// No need to call start() - lazy initialization
const events$ = await agent.startTurn('Do something');
```

**Breaking Changes**:
- `AgentLoop.execute()` → `Agent.startTurn()`
- `toolProvider` → `toolProviders` (now an array)
- No separate `stateStore` - Agent uses NoopStateStore internally
- Context is now part of agent config, not per-execution
- `startTurn()` returns `Promise<Observable>` instead of `Observable`
- Must manage agent lifecycle (call `shutdown()` when done)

## References

- [A2A Protocol Lifecycle](./a2a-protocol.md) - Task states and events
- [Agent Loop Design](./agent-loop.md) - Current implementation
- [Message Management](./message-management.md) - Message store design
- [Artifact Management](./artifact-management.md) - Artifact store design

## Next Steps

1. ✅ Design document (this file)
2. ✅ Refactor `AgentLoop` to single-turn execution
3. ✅ Implement `Agent` class with lifecycle management
4. ✅ Update examples and documentation
5. 🔄 Update A2A server to use Agent (in progress)
6. 🔄 Add comprehensive tests for multi-turn scenarios
7. 📝 Add migration guide for users upgrading from old API
