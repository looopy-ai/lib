# Agent Lifecycle API Simplification

## Summary

Simplified the Agent lifecycle API based on user feedback to remove unnecessary ceremony and add explicit control where needed.

**Date**: 2025-01-30
**Status**: ✅ Complete

---

## Changes Made

### 1. Removed Explicit `start()` Method

**Before**:
```typescript
const agent = new Agent({ ... });
await agent.start(); // Explicit initialization required
const result$ = agent.executeTurn('message', authContext);
```

**After**:
```typescript
const agent = new Agent({ ... });
const result$ = await agent.executeTurn('message', authContext); // Auto-initializes
```

**Rationale**:
- Reduces boilerplate - one less method to call
- Auto-initialization on first `executeTurn()` is more intuitive
- Matches common patterns in other frameworks (lazy initialization)

**Implementation**:
- Added private `initialize()` method
- `executeTurn()` now checks if `status === 'created'` and calls `initialize()` automatically
- State transitions: `created` → `ready` → `busy` → `ready` (cycle)

### 2. Removed `pause()` Method

**Before**:
```typescript
await agent.pause(); // Pauses agent, saves state
// Later...
await agent.start(); // Resume
```

**After**:
```typescript
// Just shutdown if done, or keep using executeTurn()
await agent.shutdown(); // Clean shutdown when truly done
```

**Rationale**:
- Unclear value proposition - what does "paused" mean?
- State is already auto-saved after each turn (if `autoSave: true`)
- Resume is just creating a new Agent with same `contextId`
- Simplified state machine: no `paused` or `starting` states

**State Machine Now**:
```
created → ready → busy ⟲ (repeats for each turn)
                     ↓
                  shutdown (terminal)
                     ↓
                  error (terminal)
```

### 3. Added Public `save()` Method

**Before**:
```typescript
// No way to manually trigger save (only via autoSave config)
// Internal saveState() was private
```

**After**:
```typescript
const agent = new Agent({
  autoSave: false, // Disable auto-save
  // ...
});

await agent.executeTurn('message', authContext);
await agent.save(); // Explicit save point
```

**Rationale**:
- Gives explicit control when `autoSave: false`
- Useful for checkpoints at specific points
- Complements auto-save behavior

**Implementation**:
- Renamed `saveState()` → `save()` and made public
- Currently a lightweight operation (messages already persisted via `MessageStore.append()`)
- Provides hook for future extensibility (metadata, backups, etc.)

---

## Updated API

### Agent Constructor

```typescript
const agent = new Agent({
  contextId: string;              // Session identifier
  llmProvider: LLMProvider;
  toolProviders: ToolProvider[];
  messageStore: MessageStore;     // Conversation persistence
  artifactStore: ArtifactStore;   // Generated content storage

  // Optional configuration
  systemPrompt?: string;
  autoSave?: boolean;             // Default: true
  autoCompact?: boolean;          // Default: true
  maxMessages?: number;           // Default: 100
  loopConfig?: Partial<AgentLoopConfig>;
});
```

**Note**: No `authContext` in config (moved to per-operation parameter)

### Lifecycle Methods

#### `executeTurn(message, authContext)` → `Promise<Observable<AgentEvent>>`

Execute a single turn in the conversation. Auto-initializes on first call.

```typescript
const result$ = await agent.executeTurn(
  'What is 2+2?',
  {
    actorId: 'user-123',
    credentials: { token: 'fresh-jwt-token' }
  }
);

result$.subscribe({
  next: (event) => {
    if (event.kind === 'status-update' && event.status.state === 'completed') {
      console.log('Result:', event.status.message?.content);
    }
  }
});
```

**Key Points**:
- **Auto-initialization**: First call initializes agent (no `start()` needed)
- **Per-turn auth**: Fresh `authContext` for each turn prevents stale tokens
- **State validation**: Checks for `shutdown`, `error`, `busy` states before executing
- **Returns**: `Promise<Observable>` (async for init, Observable for streaming events)

#### `save()` → `Promise<void>`

Manually save current state. Useful when `autoSave: false`.

```typescript
await agent.save();
```

#### `shutdown()` → `Promise<void>`

Clean shutdown. Saves state if `autoSave: false`, sets status to `shutdown`.

```typescript
await agent.shutdown();
```

### Query Methods

#### `getMessages(options?)` → `Promise<Message[]>`

Retrieve conversation history.

```typescript
// All messages
const messages = await agent.getMessages();

// Recent messages only
const recent = await agent.getMessages({ maxMessages: 10 });

// Token-constrained
const limited = await agent.getMessages({ maxTokens: 4000 });
```

#### `getArtifacts()` → `Promise<Array<{ id, content }>>`

Get generated artifacts (files, data, etc.).

```typescript
const artifacts = await agent.getArtifacts();
```

#### `clear()` → `Promise<void>`

Clear conversation history and artifacts.

```typescript
await agent.clear();
```

---

## State Machine

### States

```typescript
type AgentStatus =
  | 'created'   // Initial state
  | 'ready'     // Ready for next turn
  | 'busy'      // Executing turn
  | 'shutdown'  // Clean shutdown (terminal)
  | 'error';    // Error state (terminal)
```

### Transitions

```
Agent constructor
    ↓
created (auto-initializes on first executeTurn)
    ↓
executeTurn() → initialize()
    ↓
ready
    ↓
executeTurn() → busy
    ↓
[Turn execution]
    ↓
ready (back to ready for next turn)
    ⟲

shutdown() → shutdown (terminal)
error → error (terminal)
```

### State Access

```typescript
const state = agent.state;

console.log(state.status);        // Current status
console.log(state.turnCount);     // Number of turns executed
console.log(state.createdAt);     // Agent creation timestamp
console.log(state.lastActivity);  // Last turn timestamp
```

---

## Migration Guide

### Removing `start()` Calls

**Before**:
```typescript
const agent = new Agent({ ... });
await agent.start();
const result$ = agent.executeTurn('message', authContext);
```

**After**:
```typescript
const agent = new Agent({ ... });
const result$ = await agent.executeTurn('message', authContext); // Auto-starts
```

### Replacing `pause()` with `shutdown()`

**Before**:
```typescript
await agent.pause(); // Pause for later
// Later...
await agent.start(); // Resume
```

**After**:
```typescript
// Option 1: Just shutdown when done
await agent.shutdown();

// Option 2: Resume in new instance (same contextId)
const agent2 = new Agent({
  contextId: 'same-context-id', // Loads previous messages
  // ... same config
});
const result$ = await agent2.executeTurn('continue...', authContext);
```

### Using `save()` for Manual Snapshots

**New capability**:
```typescript
const agent = new Agent({
  autoSave: false, // Disable auto-save
  // ...
});

await agent.executeTurn('message', authContext);
// ... do more work
await agent.save(); // Explicit checkpoint
```

---

## Example: Multi-Turn Conversation

```typescript
import { Agent } from 'looopy';
import { LiteLLMProvider } from 'looopy/providers';
import { InMemoryMessageStore, InMemoryArtifactStore } from 'looopy/stores';
import { localTools } from 'looopy/tools';

// Create stores (use Redis in production)
const messageStore = new InMemoryMessageStore();
const artifactStore = new InMemoryArtifactStore();

// Create agent (no start() needed!)
const agent = new Agent({
  contextId: 'user-session-123',
  llmProvider: new LiteLLMProvider({
    baseUrl: 'http://localhost:4000',
    model: 'gpt-4',
  }),
  toolProviders: [localTools([...])],
  messageStore,
  artifactStore,
  autoSave: true, // Auto-save after each turn
});

// Helper for fresh auth
const getAuthContext = () => ({
  actorId: 'user-alice',
  credentials: { token: getJWT() } // Fresh token each time
});

// Turn 1 - auto-initializes
const turn1$ = await agent.executeTurn(
  'Calculate 25 * 17',
  getAuthContext()
);

turn1$.subscribe({
  next: (event) => {
    if (event.kind === 'status-update' && event.status.state === 'completed') {
      console.log('Result:', event.status.message?.content);
    }
  },
  complete: async () => {
    // Turn 2 - has context from turn 1
    const turn2$ = await agent.executeTurn(
      'Now divide that by 5',
      getAuthContext() // Fresh auth for this turn
    );

    turn2$.subscribe({
      next: (event) => { /* ... */ },
      complete: async () => {
        // View history
        const messages = await agent.getMessages();
        console.log('Conversation:', messages);

        // Clean shutdown
        await agent.shutdown();
      }
    });
  }
});
```

---

## Files Changed

### Implementation

1. **`src/core/agent.ts`**
   - ✅ Removed `start()` method
   - ✅ Added private `initialize()` method
   - ✅ Updated `executeTurn()` to auto-initialize
   - ✅ Removed `pause()` method
   - ✅ Added public `save()` method
   - ✅ Updated `shutdown()` to use `save()` instead of `saveState()`
   - ✅ Removed `'starting'` and `'paused'` from `AgentStatus` type

2. **`examples/agent-lifecycle.ts`**
   - ✅ Removed all `agent.start()` calls
   - ✅ Removed `agent.pause()` / resume pattern
   - ✅ Added `agent.save()` demonstration
   - ✅ Updated comments to explain auto-initialization
   - ✅ Made `executeTurn()` calls `await` (returns Promise now)

### Documentation

3. **`AGENT_LIFECYCLE_SIMPLIFIED.md`** (this file)
   - ✅ API changes summary
   - ✅ Migration guide
   - ✅ Updated state machine diagram
   - ✅ Complete examples

### Still TODO

- [ ] Update `design/agent-lifecycle.md` to remove `pause()` references
- [ ] Update `design/agent-lifecycle.md` to document auto-initialization
- [ ] Update `AGENT_LIFECYCLE_COMPLETE.md` with new API
- [ ] Add tests for auto-initialization
- [ ] Add tests for `save()` method
- [ ] Update `examples/README.md`

---

## Testing

### Manual Testing Checklist

- [ ] Agent auto-initializes on first `executeTurn()`
- [ ] State transitions correctly: `created → ready → busy → ready`
- [ ] `save()` method works (logs appropriately)
- [ ] `shutdown()` saves state when `autoSave: false`
- [ ] Multiple turns work without `start()`
- [ ] Resume works (new Agent with same contextId)
- [ ] Fresh auth context works per-turn
- [ ] Error states handled correctly

### Unit Tests Needed

```typescript
describe('Agent Lifecycle Simplification', () => {
  it('should auto-initialize on first executeTurn', async () => {
    const agent = new Agent({ ... });
    expect(agent.state.status).toBe('created');

    await agent.executeTurn('test', authContext);
    expect(agent.state.status).toBe('ready'); // After turn completes
  });

  it('should not have pause() method', () => {
    const agent = new Agent({ ... });
    expect(agent.pause).toBeUndefined();
  });

  it('should have public save() method', () => {
    const agent = new Agent({ ... });
    expect(typeof agent.save).toBe('function');
  });

  it('should save state on shutdown when autoSave=false', async () => {
    const agent = new Agent({ autoSave: false, ... });
    const saveSpy = vi.spyOn(agent, 'save');

    await agent.shutdown();
    expect(saveSpy).toHaveBeenCalled();
  });
});
```

---

## Benefits

### Developer Experience

1. **Less Boilerplate**
   - No `start()` call needed
   - Just create agent and call `executeTurn()`

2. **Clearer Intent**
   - `save()` is explicit when needed
   - No confusing `pause()` semantics

3. **Simpler Mental Model**
   - State machine has fewer states
   - Auto-initialization is intuitive

### Code Quality

1. **Fewer States to Handle**
   - Removed `'starting'` and `'paused'`
   - Simpler state transitions

2. **Better Error Handling**
   - State validation in `executeTurn()`
   - Clear error messages

3. **Future-Proof**
   - `save()` provides hook for extensibility
   - Can add metadata persistence later

---

## Related Documents

- **Design**: `design/agent-lifecycle.md` (needs update)
- **Implementation**: `src/core/agent.ts`
- **Example**: `examples/agent-lifecycle.ts`
- **Previous**: `AGENT_LIFECYCLE_COMPLETE.md`

---

*Last Updated: 2025-01-30*
