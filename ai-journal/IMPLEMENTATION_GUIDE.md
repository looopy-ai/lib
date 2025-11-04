# Agent Loop Design - Implementation Guide

> **Note**: Most of the core agent loop has been implemented in `src/core/agent-loop.ts`. This document highlights the **remaining features** to implement and provides references to the full design document.

## What's Already Implemented ✅

See `src/core/agent-loop.ts` for:
- Core agent loop with RxJS expand() pattern
- State machine (IDLE → PREPARING → LLM_CALL → TOOL_EXECUTE → COMPLETED)
- LLM integration with retry logic
- Parallel tool execution with concurrency limits
- Checkpointing and state persistence
- Session resumption from persisted state
- Error handling and graceful degradation
- OpenTelemetry tracing with Langfuse observation types
- A2A event emission (task, status-update, artifact-update)
- shareReplay() for hot observables

See `src/stores/` for:
- `StateStore` interface and implementations (Redis, Memory)
- `StoreFactory` for creating store instances
- State cleanup service

## What Still Needs Implementation ❌

### 1. Artifact Store Implementations (HIGH PRIORITY)

**Why**: Required for A2A artifact-update events, multi-part responses, and file generation.

**Files to create**:
```
src/stores/redis/redis-artifact-store.ts
src/stores/memory/memory-artifact-store.ts
src/stores/decorators/artifact-events.ts
```

**Interface already defined**: `src/stores/interfaces.ts` - ArtifactStore

**Key features**:
- Multi-part artifact composition
- Inline storage for small parts (< 1MB)
- External storage (S3/local) for large parts
- Streaming support (append, replace operations)
- Version tracking
- A2A event emission on changes

**Reference**: `design/agent-loop.md` lines 806-1935

---

### 2. Artifact Management Tools (HIGH PRIORITY)

**Why**: Enables LLM to create and manage multi-part artifacts.

**File to create**: `src/tools/artifact-tools.ts`

**Tools to implement**:
- `create_artifact` - Create a new artifact
- `append_artifact` - Append text content
- `append_artifact_data` - Append structured data
- `replace_artifact_part` - Update specific part
- `complete_artifact` - Mark as finished
- `list_artifacts` - List task artifacts

**Class**: `ArtifactToolProvider implements ToolProvider`

**Reference**: `design/agent-loop.md` lines 1411-1676

---

### 3. Tool Execution Idempotency (MEDIUM PRIORITY)

**Why**: Prevents duplicate tool calls when resuming from checkpoints.

**File to create**: `src/core/tool-tracking.ts`

**Key features**:
- Track tool execution status (pending/running/completed/failed)
- Store execution records in state store
- Check records before re-executing on resume
- Audit trail for debugging

**Reference**: `design/agent-loop.md` lines 2246-2447

---

### 4. LLM Response Streaming (MEDIUM PRIORITY)

**Why**: Lower latency to first token, better UX for long responses.

**Enhancement**: `src/core/agent-loop.ts` - Add streaming support

**Key features**:
- `llmProvider.stream()` method
- Emit artifact-update events as chunks arrive
- Accumulate chunks for final response
- Support for progressive rendering

**Reference**: `design/agent-loop.md` lines 233-266

---

### 5. Sub-Agent Invocation (LOW PRIORITY - FUTURE)

**Why**: Enables agent composition and task delegation.

**Dependencies**: Requires A2A client and agent registry (separate design docs)

**File to create**: `src/tools/sub-agent-provider.ts`

**Key features**:
- Discover agents via registry
- A2A client for agent-to-agent communication
- Forward sub-agent events to parent
- Return sub-agent result as tool result

**Reference**: `design/agent-loop.md` lines 338-388

---

### 6. Tool Execution Optimization (LOW PRIORITY - FUTURE)

**Enhancement**: `src/core/agent-loop.ts` - executeTools() method

**Features to add**:
- **Batching**: Group tools by provider, use batch APIs
- **Caching**: Cache LLM responses based on message history
- **Advanced retry**: Circuit breaker for failing tools

**Reference**: `design/agent-loop.md` lines 575-623

---

### 7. Extension Hooks (LOW PRIORITY - FUTURE)

**Why**: Enables plugin architecture for custom behavior.

**Dependencies**: Requires extension registry system (see `design/extension-points.md`)

**Hook points**:
- beforeRequest, beforeLLMCall, afterLLMCall
- beforeToolExecution, afterToolExecution
- afterCompletion

**Reference**: Throughout `design/agent-loop.md`, `design/extension-points.md`

---

## Recommended Implementation Order

### Phase 1: Artifact Management (Immediate)
1. ✅ Define interfaces (already done in `src/stores/interfaces.ts`)
2. ⬜ Implement `InMemoryArtifactStore` (testing/dev)
3. ⬜ Implement `RedisArtifactStore` (production)
4. ⬜ Implement `ArtifactStoreWithEvents` decorator
5. ⬜ Implement `ArtifactToolProvider` with 6 tools
6. ⬜ Update `StoreFactory` to wire everything together

**Deliverable**: LLM can create multi-part artifacts, A2A clients receive artifact-update events

### Phase 2: Reliability (Soon)
7. ⬜ Implement tool execution tracking
8. ⬜ Enhance resumption logic to check execution records
9. ⬜ Add idempotency tests

**Deliverable**: Safer resumption, no duplicate tool calls

### Phase 3: Performance (Later)
10. ⬜ Add LLM streaming support
11. ⬜ Add tool execution caching
12. ⬜ Add tool execution batching

**Deliverable**: Better performance and UX

### Phase 4: Advanced Features (Future)
13. ⬜ Sub-agent invocation (needs A2A client)
14. ⬜ Extension hooks (needs extension system)

**Deliverable**: Advanced use cases, plugin architecture

---

## Key Interfaces

All interfaces are already defined in:
- `src/core/types.ts` - Core types (LoopState, Message, LLMResponse, etc.)
- `src/stores/interfaces.ts` - Store types (ArtifactStore, StoredArtifact, etc.)
- `src/tools/interfaces.ts` - Tool types (ToolProvider, ToolDefinition, etc.)

**No new interfaces needed** - just implementations!

---

## Testing Strategy

For each new feature:

1. **Unit tests**: Test implementations in isolation
2. **Integration tests**: Test with real stores/providers
3. **E2E tests**: Test complete agent scenarios
4. **A2A compliance**: Verify event format matches spec

Example test structure:
```typescript
describe('InMemoryArtifactStore', () => {
  it('should create artifact with unique ID', async () => { });
  it('should append parts in order', async () => { });
  it('should emit A2A artifact-update events', async () => { });
  // ... more tests
});
```

---

## Questions to Answer

Before implementing, decide:

1. **Artifact external storage**: Use S3, local filesystem, or Redis-only?
2. **Artifact TTL**: How long to keep artifacts after task completion?
3. **Tool execution records**: Store in state store or separate table?
4. **LLM streaming**: Support all providers or OpenAI-compatible only?
5. **Sub-agents**: Is this a real requirement or nice-to-have?

---

## Full Design Reference

For complete design details, see:
- `design/agent-loop.md` - Full agent loop design (2500+ lines)
- `PENDING_FEATURES.md` - Detailed feature breakdown with priorities

This implementation guide focuses on **what to build next**, not conceptual architecture.
