# TaskId Implementation Complete

## Summary

Successfully implemented per-turn unique task identifiers for the Agent API. Each `executeTurn()` call now generates or accepts a unique `taskId` that flows through the entire execution pipeline.

## Changes Made

### 1. Agent API Update

**File**: `src/core/agent.ts`

**Updated `executeTurn()` signature**:
```typescript
async executeTurn(
  userMessage: string | null,
  options?: {
    authContext?: AuthContext;
    taskId?: string;
  }
): Promise<Observable<AgentEvent>>
```

**Key Features**:
- **Auto-generation**: If `taskId` not provided, generates: `${contextId}-turn-${turnNumber}-${timestamp}`
- **Custom override**: Can provide custom taskId via options
- **Unique per turn**: Each turn gets a distinct identifier for tracking

**Example auto-generated taskId**:
```
user-session-123-turn-1-1704067200000
user-session-123-turn-2-1704067205000
user-session-123-turn-3-1704067210000
```

### 2. Internal Method Update

**Updated `executeInternal()` signature**:
```typescript
private executeInternal(
  userMessage: string | null,
  taskId: string,
  authContext?: AuthContext
): Observable<AgentEvent>
```

**Flow**:
1. `executeTurn()` generates or receives taskId
2. Passes to `executeInternal()`
3. Flows through to `AgentLoop.executeTurn()` context
4. Used in all emitted `AgentEvent` objects

### 3. Examples Updated

**File**: `examples/agent-lifecycle.ts`

**Updated all `executeTurn()` calls**:
```typescript
// Before
await agent.executeTurn('message', authContext);

// After - using options object
await agent.executeTurn('message', {
  authContext: getAuthContext(),
});

// With custom taskId
await agent.executeTurn('message', {
  authContext: getAuthContext(),
  taskId: 'custom-task-abc-123',
});
```

**Added documentation**:
- Shows taskId format
- Demonstrates custom taskId usage
- Explains auto-generation behavior

## TaskId Format

### Auto-Generated

**Format**: `{contextId}-turn-{turnNumber}-{timestamp}`

**Components**:
- `contextId`: Agent's session/context identifier
- `turnNumber`: Sequential turn number (1, 2, 3, ...)
- `timestamp`: Unix timestamp in milliseconds

**Example**:
```typescript
const agent = new Agent({ contextId: 'session-abc' });

// Turn 1: session-abc-turn-1-1704067200000
await agent.executeTurn('First message');

// Turn 2: session-abc-turn-2-1704067205000
await agent.executeTurn('Second message');
```

### Custom TaskId

**Usage**:
```typescript
await agent.executeTurn('Process this order', {
  authContext: auth,
  taskId: 'order-processing-xyz-789',
});
```

**Use Cases**:
- External correlation (e.g., order IDs, request IDs)
- A2A protocol integration (map A2A taskId to Agent taskId)
- Distributed tracing (use trace/span IDs)
- Idempotency (reuse taskId to detect duplicate requests)

## Benefits

### 1. **Event Correlation**
All events from a single turn share the same taskId:
```typescript
{
  "kind": "status-update",
  "taskId": "session-abc-turn-1-1704067200000",
  "status": { "state": "working" }
}

{
  "kind": "artifact-update",
  "taskId": "session-abc-turn-1-1704067200000",
  "artifact": { ... }
}
```

### 2. **Multi-Turn Tracking**
Distinguish between turns in the same conversation:
```
Context: user-session-123
  ├─ Turn 1: user-session-123-turn-1-1704067200000
  ├─ Turn 2: user-session-123-turn-2-1704067205000
  └─ Turn 3: user-session-123-turn-3-1704067210000
```

### 3. **A2A Protocol Alignment**
Map A2A taskId to Agent execution:
```typescript
// A2A server
app.post('/api/a2a', async (req, res) => {
  const a2aTaskId = req.body.params.taskId;

  const events$ = await agent.executeTurn(message, {
    authContext: auth,
    taskId: a2aTaskId, // Use A2A taskId directly
  });
});
```

### 4. **Observability**
- OpenTelemetry traces can use taskId as span ID
- Log aggregation by taskId
- Metrics per turn (success rate, duration, etc.)

### 5. **Idempotency**
Detect and handle duplicate requests:
```typescript
const processedTasks = new Set<string>();

const customTaskId = 'order-123-payment';
if (processedTasks.has(customTaskId)) {
  console.log('Already processed this task');
  return cachedResult;
}

await agent.executeTurn(message, { taskId: customTaskId });
processedTasks.add(customTaskId);
```

## API Reference

### Agent.executeTurn()

```typescript
async executeTurn(
  userMessage: string | null,
  options?: {
    authContext?: AuthContext;
    taskId?: string;
  }
): Promise<Observable<AgentEvent>>
```

**Parameters**:
- `userMessage`: User's message for this turn, or `null` for tool-only turns
- `options.authContext`: Authentication context for this turn (prevents token expiration)
- `options.taskId`: Custom task identifier (auto-generated if not provided)

**Returns**: Observable stream of `AgentEvent` objects with matching `taskId`

**Throws**:
- `Error` if agent is shutdown or in error state
- `Error` if agent is already busy (prevents concurrent turns)

**Examples**:
```typescript
// Auto-generated taskId
const events$ = await agent.executeTurn('Hello');

// With auth context
const events$ = await agent.executeTurn('Process data', {
  authContext: { actorId: 'user-123', credentials: { token: 'abc' } },
});

// With custom taskId
const events$ = await agent.executeTurn('Analyze', {
  authContext: auth,
  taskId: 'analysis-job-456',
});
```

## Testing Recommendations

### 1. Verify Auto-Generation
```typescript
const agent = new Agent({ contextId: 'test-ctx' });

const events1$ = await agent.executeTurn('Message 1');
const events2$ = await agent.executeTurn('Message 2');

// Verify different taskIds
events1$.subscribe(e => {
  expect(e.taskId).toMatch(/test-ctx-turn-1-\d+/);
});

events2$.subscribe(e => {
  expect(e.taskId).toMatch(/test-ctx-turn-2-\d+/);
});
```

### 2. Verify Custom TaskId
```typescript
const customTaskId = 'my-custom-task-123';
const events$ = await agent.executeTurn('Message', {
  taskId: customTaskId,
});

events$.subscribe(e => {
  expect(e.taskId).toBe(customTaskId);
});
```

### 3. Verify Event Correlation
```typescript
const events$ = await agent.executeTurn('Message');
const taskIds = new Set<string>();

events$.subscribe(e => {
  taskIds.add(e.taskId);
});

// All events from same turn should have same taskId
expect(taskIds.size).toBe(1);
```

## Migration Guide

### From Old API

**Before**:
```typescript
await agent.executeTurn('message', authContext);
```

**After**:
```typescript
await agent.executeTurn('message', {
  authContext,
});
```

### Benefits of Migration

1. **Cleaner API**: Options object is extensible
2. **TaskId Control**: Can now specify custom taskIds
3. **Future-proof**: Easy to add more options without breaking changes

## Related Documentation

- **Design**: `design/agent-lifecycle.md` - Agent architecture
- **A2A Protocol**: `A2A_ALIGNMENT.md` - Event types and alignment
- **Examples**: `examples/agent-lifecycle.ts` - Working demonstrations

## Implementation Files

- `src/core/agent.ts` - Agent class with taskId generation
- `src/core/agent-loop.ts` - AgentLoop with taskId context
- `src/core/types.ts` - Event types with taskId field
- `examples/agent-lifecycle.ts` - Usage examples

## Status

✅ **COMPLETE**
- Agent.executeTurn() signature updated
- TaskId auto-generation implemented
- Examples updated with new API
- All compilation errors resolved
- Documentation complete

**Next Steps**:
- [ ] Add unit tests for taskId generation
- [ ] Add integration tests for event correlation
- [ ] Update A2A server to use Agent with taskId mapping
- [ ] Add OpenTelemetry span correlation with taskId
- [ ] Document taskId in design/agent-lifecycle.md

---

*Implementation completed: 2025-10-30*
