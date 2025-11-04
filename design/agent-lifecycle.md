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
┌─────────────────────────────────────────────────────────────┐
│                           Agent                              │
│  (Stateful, Multi-turn, Lifecycle Management)               │
│                                                              │
│  - contextId / sessionId                                    │
│  - MessageStore (conversation history)                      │
│  - ArtifactStore (generated artifacts)                      │
│  - StateStore (agent metadata)                              │
│  - Lifecycle: start, pause, resume, shutdown                │
│                                                              │
│  ┌────────────────────────────────────────────────────┐    │
│  │            executeTurn(userMessage)                │    │
│  │                                                     │    │
│  │  1. Load conversation history                      │    │
│  │  2. Append user message                            │    │
│  │  3. Call AgentLoop.execute(messages, context)      │    │
│  │  4. Save assistant messages                        │    │
│  │  5. Save artifacts                                 │    │
│  │  6. Return events                                  │    │
│  └────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                       AgentLoop                              │
│  (Stateless, Single-turn, Execution)                        │
│                                                              │
│  execute(messages, context) → Observable<AgentEvent>        │
│                                                              │
│  Single Turn:                                               │
│  1. LLM call with message history                           │
│  2. Execute tools if requested                              │
│  3. Repeat until:                                           │
│     - LLM finish_reason = 'stop'                            │
│     - Max iterations reached                                │
│     - Error occurs                                          │
│  4. Return final state                                      │
└─────────────────────────────────────────────────────────────┘
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

  /** Tool provider for tool execution */
  toolProvider: ToolProvider;

  /** Message store for conversation history */
  messageStore: MessageStore;

  /** Artifact store for generated content */
  artifactStore: ArtifactStore;

  /** State store for agent metadata (optional) */
  stateStore?: StateStore;

  /** Agent loop configuration */
  loopConfig?: Partial<AgentLoopConfig>;

  /** Auto-save messages after each turn (default: true) */
  autoSave?: boolean;

  /** Auto-compact messages when exceeding limit (default: false) */
  autoCompact?: boolean;

  /** Maximum messages to keep before compaction */
  maxMessages?: number;
}

interface Agent {
  /** Unique identifier for this agent instance */
  readonly contextId: string;

  /** Current agent state */
  readonly state: AgentState;

  /**
   * Start or resume the agent
   * Loads state from stores if resuming
   */
  start(): Promise<void>;

  /**
   * Execute a single conversational turn
   * @param userMessage - User's message or null for continuation
   * @param authContext - Fresh authentication context (token may be refreshed)
   * @returns Observable stream of agent events
   */
  executeTurn(
    userMessage: string | null,
    authContext?: AuthContext
  ): Observable<AgentEvent>;

  /**
   * Pause the agent (save state, keep in memory)
   * Can be resumed without reloading
   */
  pause(): Promise<void>;

  /**
   * Shutdown the agent (save state, cleanup resources)
   * Must call start() to resume
   */
  shutdown(): Promise<void>;

  /**
   * Get conversation history
   */
  getMessages(options?: GetMessagesOptions): Promise<Message[]>;

  /**
   * Get generated artifacts
   */
  getArtifacts(): Promise<Artifact[]>;

  /**
   * Manually save current state
   */
  saveState(): Promise<void>;

  /**
   * Clear conversation history and artifacts
   */
  clear(): Promise<void>;
}

interface AgentState {
  /** Agent lifecycle state */
  status: 'created' | 'starting' | 'ready' | 'busy' | 'paused' | 'shutdown';

  /** Total turns executed */
  turnCount: number;

  /** Last activity timestamp */
  lastActivity: Date;

  /** Error if in error state */
  error?: Error;

  /** Metadata */
  metadata?: Record<string, unknown>;
}
```

### AgentLoop Interface (Refactored)

```typescript
interface AgentLoopConfig {
  /** LLM provider */
  llmProvider: LLMProvider;

  /** Tool provider */
  toolProvider: ToolProvider;

  /** Maximum iterations per turn */
  maxIterations?: number;

  /** System prompt */
  systemPrompt?: string;

  /** Tracing configuration */
  tracing?: TracingConfig;
}

interface TurnContext {
  /** Context ID for this session */
  contextId: string;

  /** Turn number (1-indexed) */
  turnNumber: number;

  /** Available artifacts (read-only) */
  artifacts?: Artifact[];

  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

interface AgentLoop {
  /**
   * Execute a single turn
   * @param messages - Full conversation history
   * @param context - Turn context
   * @returns Observable stream of events
   */
  executeTurn(
    messages: Message[],
    context: TurnContext
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
│ Agent.executeTurn(userMessage)          │
│                                          │
│ 1. Load messages from MessageStore      │
│    messages = [                          │
│      { role: 'user', content: '...' }   │
│    ]                                     │
│                                          │
│ 2. Append user message                  │
│    messages.push(userMessage)           │
│                                          │
│ 3. Execute turn via AgentLoop           │
│    ┌──────────────────────────────┐    │
│    │ AgentLoop.executeTurn()      │    │
│    │                               │    │
│    │ - LLM call with messages     │    │
│    │ - Tool execution (weather)   │    │
│    │ - LLM call with tool result  │    │
│    │ - finish_reason = 'stop'     │    │
│    │                               │    │
│    │ Returns: assistant message   │    │
│    └──────────────────────────────┘    │
│                                          │
│ 4. Save assistant message                │
│    messageStore.append([assistantMsg])  │
│                                          │
│ 5. Save artifacts (if any)              │
│    artifactStore.save(...)              │
│                                          │
│ 6. Update agent state                   │
│    state.turnCount++                    │
│    state.lastActivity = now()           │
│                                          │
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
│ Agent.executeTurn(userMessage)          │
│                                          │
│ 1. Load messages (includes previous)    │
│    messages = [                          │
│      { role: 'user', content: 'weather' },
│      { role: 'assistant', ... },        │
│      { role: 'tool', ... }              │
│    ]                                     │
│                                          │
│ 2. Append new user message              │
│    ... (same flow)                       │
└─────────────────────────────────────────┘
```

### Pause and Resume

```
Agent Session 1:
┌──────────────────────────────────────┐
│ agent = new Agent({ contextId })     │
│ await agent.start()                  │
│                                       │
│ // Turn 1                             │
│ agent.executeTurn("Hello").subscribe()│
│ messageStore: [user, assistant]      │
│                                       │
│ // Turn 2                             │
│ agent.executeTurn("Help me").subscribe()│
│ messageStore: [user, asst, user, asst]│
│                                       │
│ // Pause                              │
│ await agent.pause()                  │
│ → Saves to messageStore              │
│ → Saves to stateStore                │
│   { turnCount: 2, ... }              │
└──────────────────────────────────────┘

... (user closes app, time passes) ...

Agent Session 2 (same contextId):
┌──────────────────────────────────────┐
│ agent = new Agent({                  │
│   contextId: 'same-id'               │
│ })                                    │
│                                       │
│ await agent.start()                  │
│ → Loads from messageStore            │
│   [user, asst, user, asst]           │
│ → Loads from stateStore              │
│   { turnCount: 2, ... }              │
│                                       │
│ state.status = 'ready'               │
│                                       │
│ // Continue conversation             │
│ agent.executeTurn("Continue").subscribe()│
│ → Turn 3 with full history           │
└──────────────────────────────────────┘
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
2. Change `execute()` to `executeTurn(messages, context)`
3. Return when turn completes (not when task completes)
4. Remove state persistence from loop

### Phase 2: Implement Agent

1. Create `Agent` class with lifecycle management
2. Implement state loading/saving
3. Implement `executeTurn()` coordination
4. Add pause/resume/shutdown

### Phase 3: Update A2A Server

1. Create Agent instance per task
2. Map A2A lifecycle to Agent lifecycle
3. Handle multi-turn via repeated `executeTurn()` calls

## API Examples

### Basic Usage

```typescript
import { Agent } from 'looopy';
import { LiteLLMProvider } from 'looopy/providers';
import { InMemoryMessageStore } from 'looopy/stores';

// Create agent
const agent = new Agent({
  contextId: 'user-123-session-456',
  llmProvider: new LiteLLMProvider({ model: 'gpt-4' }),
  toolProvider: localTools,
  messageStore: new InMemoryMessageStore(),
  artifactStore: new InMemoryArtifactStore(),
});

// Start agent
await agent.start();

// Get fresh auth context (e.g., from request headers, JWT)
const getAuthContext = () => ({
  actorId: getUserIdFromJWT(),
  credentials: { token: extractToken() }
});

// Turn 1 - Pass fresh auth context
const turn1$ = agent.executeTurn('Hello, what can you help with?', getAuthContext());
await lastValueFrom(turn1$);

// Turn 2 - Pass potentially refreshed auth context
const turn2$ = agent.executeTurn('Tell me about TypeScript', getAuthContext());
await lastValueFrom(turn2$);

// Shutdown
await agent.shutdown();
```

### Authentication Context Per Turn

**Why per-turn instead of construction?**

Long-running agents may span hours or days. Authentication tokens expire. By passing `authContext` to each `executeTurn()` call:

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
  const events$ = agent.executeTurn(req.body.message, authContext);

  events$.subscribe({
    next: (event) => res.write(JSON.stringify(event) + '\n'),
    complete: () => res.end()
  });
});
```

### Pause and Resume

```typescript
// Session 1
const agent = new Agent({ contextId: 'persistent-session' });
await agent.start();

agent.executeTurn('Start a complex task').subscribe({
  complete: async () => {
    await agent.pause(); // Save state
    console.log('Paused, can resume later');
  }
});

// ... later (different process, after restart, etc.) ...

// Session 2
const agent2 = new Agent({ contextId: 'persistent-session' });
await agent2.start(); // Loads previous state

console.log('Resumed with', agent2.state.turnCount, 'previous turns');

agent2.executeTurn('Continue the task').subscribe();
```

### Error Handling

```typescript
const agent = new Agent({ contextId: 'session' });
await agent.start();

agent.executeTurn('Do something').subscribe({
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
    if (agent.state.status === 'busy') {
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
    await agent.start(); // Loads if resuming

    // Execute turn
    const userMessage = params.message.parts[0].text;
    const events$ = agent.executeTurn(userMessage);

    res.setHeader('Content-Type', 'text/event-stream');

    events$.subscribe({
      next: (event) => {
        if (!event.kind.startsWith('internal:')) {
          res.write(`data: ${JSON.stringify(event)}\n\n`);
        }
      },
      complete: async () => {
        await agent.pause(); // Save state between turns
        res.end();
      },
      error: async (err) => {
        await agent.shutdown();
        res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
        res.end();
      }
    });
  }
});
```

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

**Decision**: B (Agent). AgentLoop should be stateless and focused on execution. Agent coordinates persistence.

### 3. Auto-save vs Manual Save?

**Decision**: Auto-save by default (`autoSave: true`), with option to disable. Most users want automatic persistence, advanced users can control it manually.

### 4. What Happens on Error Mid-turn?

**Decision**:
- Save partial state (messages up to error point)
- Emit error event
- Set agent status to 'failed'
- User can retry turn or shutdown

### 5. Message Compaction Strategy?

**Decision**:
- Agent can auto-compact when `maxMessages` exceeded
- User can manually compact via `messageStore.compact()`
- Agent doesn't force compaction, just warns

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
  toolProvider,
  messageStore,
  artifactStore,
  stateStore
});

await agent.start();
const events$ = agent.executeTurn('Do something');
```

**Breaking Changes**:
- `AgentLoop.execute()` → `Agent.executeTurn()`
- Must call `agent.start()` before first turn
- Context is now part of agent config, not per-execution
- Must manage agent lifecycle (shutdown)

**Migration Support**:
- Keep `AgentLoop.execute()` as deprecated wrapper
- Add migration guide
- Provide codemods if needed

## References

- [A2A Protocol Lifecycle](./a2a-protocol.md) - Task states and events
- [Agent Loop Design](./agent-loop.md) - Current implementation
- [Message Management](./message-management.md) - Message store design
- [Artifact Management](./artifact-management.md) - Artifact store design

## Next Steps

1. ✅ Design document (this file)
2. Refactor `AgentLoop` to single-turn execution
3. Implement `Agent` class with lifecycle management
4. Update A2A server to use Agent
5. Write tests for multi-turn scenarios
6. Update examples and documentation
7. Add migration guide
