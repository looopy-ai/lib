# Artifact Store Scheduling Fix Complete

**Date**: 2025-01-14
**Status**: ✅ Complete

## Problem Summary

The kitchen-sink example was encountering "File artifact not found" errors even though artifacts were being created successfully. Root cause: artifact tools were using a different artifact store instance than AgentLoop.

### Technical Details

**Flow**:
1. `examples/kitchen-sink.ts` created artifact tools with base `artifactStore`
2. Agent constructor wrapped `artifactStore` with `ArtifactScheduler`
3. AgentLoop received the scheduled store from config
4. Result: Tools pointed to base store Map, AgentLoop pointed to scheduled store Map
5. Artifacts created via tools existed in base store but were invisible to AgentLoop

**Error Message**:
```
Error: File artifact not found: bruno-kids-book
```

## Solution

### 1. Agent Exposes Scheduled Store

Modified `src/core/agent.ts`:
```typescript
constructor(config: AgentConfig) {
  // Wrap artifact store with scheduler BEFORE storing in config
  const scheduledArtifactStore = new ArtifactScheduler(config.artifactStore);

  this.config = {
    ...config,
    artifactStore: scheduledArtifactStore,  // Config gets scheduled version
  };

  // AgentLoop receives config.artifactStore (already scheduled)
  this.agentLoop = new AgentLoop({
    artifactStore: this.config.artifactStore,
    // ...
  });
}

// Expose scheduled store via getter
get artifactStore(): ArtifactStore {
  return this.config.artifactStore;
}
```

### 2. Kitchen-Sink Example Updated

Modified `examples/kitchen-sink.ts`:
```typescript
// Create agent FIRST
const agent = new Agent({
  contextId,
  agentId,
  llmProvider,
  toolProviders: [localToolProvider], // Artifact tools added later
  messageStore,
  artifactStore,  // Base store passed to constructor
  systemPrompt,
  autoSave: true,
  logger,
});

// Create artifact tools AFTER agent using agent.artifactStore
// This ensures tools use the scheduled store (same instance as AgentLoop)
const artifactToolProvider = createArtifactTools(agent.artifactStore, taskStateStore);

// Add to agent's tool providers
agent['config'].toolProviders.push(artifactToolProvider);
```

### 3. Test Coverage

Created `tests/agent-artifact-tools.test.ts` documenting the correct pattern:
- ✅ Verifies agent wraps store with scheduler
- ✅ Verifies config stores scheduled version
- ✅ Verifies getter exposes scheduled store
- ✅ Documents correct pattern for creating artifact tools

## Correct Pattern

**Always create artifact tools AFTER Agent construction:**

```typescript
// ✅ CORRECT
const agent = new Agent({ artifactStore: baseStore, ... });
const artifactTools = createArtifactTools(agent.artifactStore, stateStore);
agent['config'].toolProviders.push(artifactTools);

// ❌ WRONG - Tools will use different store than AgentLoop
const artifactTools = createArtifactTools(baseStore, stateStore);
const agent = new Agent({ artifactStore: baseStore, toolProviders: [artifactTools] });
```

## Why This Works

The ArtifactScheduler is a wrapper that maintains per-artifact operation queues. When you pass a base store to Agent:

1. Agent wraps it: `scheduledStore = new ArtifactScheduler(baseStore)`
2. Agent stores wrapped version in config
3. AgentLoop receives scheduled store from config
4. Tools created with `agent.artifactStore` receive same scheduled store

All components now reference the same Map instance:
- ✅ Artifact tools write to scheduled store → queued operations
- ✅ AgentLoop reads from scheduled store → sees all artifacts
- ✅ Parallel create + append properly sequenced per artifact

## Test Results

All tests passing:
```
✓ tests/agent-artifact-tools.test.ts (3 tests)
✓ tests/artifact-scheduler.test.ts (12 tests)
✓ Total: 245 tests passing
```

Build successful:
```bash
pnpm run build  # No errors
```

## Related Work

- **ArtifactScheduler Implementation**: Per-partition sequential execution
- **Empty Chunk Handling**: Graceful handling of empty content with isLastChunk=true
- **Agent Integration**: Automatic store wrapping on construction

## Documentation

- Pattern documented in test suite
- Example updated to demonstrate correct usage
- Comments added to kitchen-sink.ts explaining the pattern

## Next Steps

No further action required. Pattern is working and documented.

## Files Modified

- `src/core/agent.ts` - Added scheduled store wrapping and getter
- `examples/kitchen-sink.ts` - Updated to create artifact tools after Agent
- `tests/agent-artifact-tools.test.ts` - New test documenting pattern

## Lessons Learned

When using the decorator/wrapper pattern:
1. Wrap dependencies before storing in config
2. Expose wrapped version via getter for late binding
3. Document the correct usage pattern
4. Add tests verifying the pattern

Wrapping at construction time + getter pattern ensures all consumers (AgentLoop, tools, user code) receive the same wrapped instance.
