# Artifact Store Scheduling - Cleaner Pattern

**Date**: 2025-01-14
**Status**: ✅ Complete (Refactored to simpler pattern)

## Problem Summary

The kitchen-sink example was encountering "File artifact not found" errors because artifact tools were using a different artifact store instance than AgentLoop.

### Original Issue

**Flow**:
1. `examples/kitchen-sink.ts` created artifact tools with base `artifactStore`
2. Agent constructor wrapped `artifactStore` with `ArtifactScheduler` internally
3. AgentLoop received the scheduled store from config
4. Result: Tools pointed to base store Map, AgentLoop pointed to scheduled store Map
5. Artifacts created via tools existed in base store but were invisible to AgentLoop

**Error Message**:
```
Error: File artifact not found: bruno-kids-book
```

### Initial Solution Was Messy

First attempt had Agent wrap the store internally and expose it via getter:
```typescript
// ❌ MESSY - Hidden wrapping, confusing instances
const agent = new Agent({ artifactStore: baseStore, ... });
const artifactTools = createArtifactTools(agent.artifactStore, stateStore); // Different instance!
```

This was unintuitive because:
- Two different instances existed (base vs scheduled)
- Hidden wrapping made it hard to understand
- Easy to accidentally use wrong instance
- Required accessing agent property after construction

## Final Solution: User Controls Wrapping

### 1. Agent No Longer Wraps

Modified `src/core/agent.ts`:
```typescript
constructor(config: AgentConfig) {
  // DON'T wrap - just use whatever store user provides
  this.config = {
    autoSave: true,
    autoCompact: false,
    maxMessages: 100,
    agentId: 'default-agent',
    systemPrompt: 'You are a helpful AI assistant.',
    ...config,
    // No wrapping - user's store used as-is
  };

  // AgentLoop gets whatever store user provided
  this.agentLoop = new AgentLoop({
    artifactStore: this.config.artifactStore,
    // ...
  });
}
```

### 2. Kitchen-Sink Example - Explicit Scheduling

Modified `examples/kitchen-sink.ts`:
```typescript
// Create base artifact store
const baseArtifactStore = new FileSystemArtifactStore({ basePath });

// Wrap it with scheduler EXPLICITLY (user's choice)
const scheduledArtifactStore = new ArtifactScheduler(baseArtifactStore);

// Create artifact tools with SAME scheduled store
const artifactToolProvider = createArtifactTools(scheduledArtifactStore, taskStateStore);

// Create agent with SAME scheduled store
const agent = new Agent({
  contextId,
  agentId,
  llmProvider,
  toolProviders: [localToolProvider, artifactToolProvider],
  messageStore,
  artifactStore: scheduledArtifactStore, // Same instance everywhere
  systemPrompt,
  autoSave: true,
  logger,
});
```

### 3. Test Coverage

Updated `tests/agent-artifact-tools.test.ts`:
- ✅ Verifies agent accepts pre-scheduled store
- ✅ Verifies agent doesn't wrap (uses store as-is)
- ✅ Verifies user can choose NOT to schedule
- ✅ Documents correct pattern

## Correct Pattern

**Create scheduled store once, pass same instance everywhere:**

```typescript
// ✅ CORRECT - ONE instance, explicit control
const artifactStore = new ArtifactScheduler(new InMemoryArtifactStore());

// Pass same instance to tools
const artifactTools = createArtifactTools(artifactStore, stateStore);

// Pass same instance to agent
const agent = new Agent({
  artifactStore,
  toolProviders: [artifactTools],
  // ...
});

// User can also choose NOT to schedule:
const baseStore = new InMemoryArtifactStore();
const agent = new Agent({ artifactStore: baseStore, ... }); // No scheduling
```## Why This Is Better

**Benefits**:
1. ✅ **One instance** - No hidden wrapping, explicit control
2. ✅ **Clear intent** - User explicitly chooses to schedule
3. ✅ **Simple** - Pass the same thing everywhere
4. ✅ **Flexible** - User can choose NOT to schedule
5. ✅ **Intuitive** - No surprising behavior

**How It Works**:
- ArtifactScheduler wraps base store with per-artifact queues
- User creates scheduled store once
- Same scheduled instance passed to Agent and tools
- All components reference same Map instance
- Parallel create + append properly sequenced per artifact

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
