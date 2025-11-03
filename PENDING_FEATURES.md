# Pending Features from agent-loop.md

This document lists features described in `design/agent-loop.md` that are **not yet implemented** and should be evaluated for inclusion.

## Priority 1: Artifact Management (Required for A2A Protocol)

### 1. Artifact Store Implementations

**Location in design**: Lines 806-1405

#### RedisArtifactStore
- Hybrid Redis/S3 storage for large artifacts
- Inline storage for small parts (< 1MB)
- External storage (S3/local) for large parts
- Multi-part composition with versioning
- Streaming support (append, replace operations)
- TTL-based expiration

**Files to create**:
- `src/stores/redis/redis-artifact-store.ts`
- `src/stores/memory/memory-artifact-store.ts`

**Interfaces already defined**: `src/stores/interfaces.ts` (ArtifactStore, StoredArtifact, ArtifactPart)

**Dependencies**:
- Redis client (already used in RedisStateStore)
- S3 client (optional, for external storage)
- Factory already references these classes but they don't exist

#### InMemoryArtifactStore
- In-memory storage for testing/development
- Same interface as RedisArtifactStore
- No external storage, all in-process

### 2. Artifact Management Tools

**Location in design**: Lines 1411-1676

Built-in tools that the LLM can use to create and manage artifacts:

- `create_artifact` - Create a new artifact
- `append_artifact` - Append text content incrementally
- `append_artifact_data` - Append structured JSON data
- `replace_artifact_part` - Update a specific part
- `complete_artifact` - Mark artifact as finished
- `list_artifacts` - List all task artifacts

**File to create**: `src/tools/artifact-tools.ts`

**Implementation**: ArtifactToolProvider class that implements ToolProvider interface

### 3. A2A Artifact Streaming Events

**Location in design**: Lines 1800-1935

Decorator pattern to emit A2A artifact-update events when artifacts change:

- `ArtifactStoreWithEvents` - Wraps any ArtifactStore
- Emits artifact-update events via A2A SSE on create/append/replace
- Converts internal artifact format to A2A Part[] format

**File to create**: `src/stores/decorators/artifact-events.ts`

**Usage**: Wrap artifact store returned by factory with event decorator

---

## Priority 2: Advanced Tool Execution

### 4. Tool Execution Optimization

**Location in design**: Lines 598-623

#### Batching by Provider
- Group tool calls by provider
- Use batch APIs when available
- Fall back to parallel execution for non-batch providers

**Benefits**:
- Reduced network overhead
- Better performance for multiple tools from same provider
- Provider-specific optimizations

**Implementation**: Enhance `src/core/agent-loop.ts` executeTools() method

### 5. Tool Execution Caching

**Location in design**: Lines 575-591

- Cache LLM responses based on message history + tools
- Configurable TTL
- Cache key computation from messages/tools
- Redis or in-memory cache backend

**Benefits**:
- Faster responses for repeated queries
- Reduced LLM API costs
- Better testing performance

**File to create**: `src/core/cache.ts`

### 6. Tool Execution Idempotency

**Location in design**: Lines 2413-2447

Track tool execution status across resumptions:

- `ToolExecutionRecord` - Track each tool call (pending/running/completed/failed)
- Store execution records in state store
- Resume checks records before re-executing
- Prevents duplicate tool calls on resume

**Benefits**:
- Safe resumption without duplicate side effects
- Better error recovery
- Audit trail of tool executions

**File to create**: `src/core/tool-tracking.ts`

---

## Priority 3: Sub-Agent Integration

### 7. Sub-Agent Invocation

**Location in design**: Lines 338-388

Treat sub-agents as special tools:

- Agent discovery via registry
- A2A client for agent communication
- Forward sub-agent events to parent
- Wait for sub-agent completion
- Return result as tool result

**Benefits**:
- Agent composition
- Task delegation
- Distributed agent systems

**Dependencies**:
- A2A server/client implementation (separate design doc)
- Agent registry (dynamic-discovery.md)

**File to create**: `src/tools/sub-agent-provider.ts`

---

## Priority 4: Enhanced Resumption

### 8. Message History Reconstruction

**Location in design**: Lines 2312-2334

On resume, reconstruct complete message history:

- Load persisted messages
- Add tool results that completed after last checkpoint
- Ensure chronological order
- Prevent duplicate messages

**Enhancement to**: `src/core/agent-loop.ts` restoreState()

### 9. Partial Tool Execution Recovery

**Location in design**: Lines 2246-2310

Resume from mid-tool-execution:

- Identify which tool calls were completed
- Re-execute only pending tools
- Check for already-completed results
- Handle tools that were "running" during crash

**Enhancement to**: `src/core/agent-loop.ts` resume() method

---

## Priority 5: Streaming LLM Response

### 10. LLM Chunk Streaming

**Location in design**: Lines 233-266

Stream LLM response chunks instead of waiting for complete response:

- `llmProvider.stream()` method
- Emit `llm-chunk` events as they arrive
- Accumulate chunks for final response
- Support for A2A artifact-update streaming

**Benefits**:
- Lower latency to first token
- Better UX for long responses
- Progressive rendering in UI

**Enhancement to**: `src/core/agent-loop.ts` callLLM() method

---

## Priority 6: Extension Hooks (Future)

### 11. Extension Points

**Location in design**: Throughout pipeline, not fully designed

Mentioned extension hooks:
- `beforeRequest` - Before execution starts
- `beforeLLMCall` - Before each LLM call
- `afterLLMCall` - After LLM response
- `beforeToolExecution` - Before tool call
- `afterToolExecution` - After tool completes
- `afterCompletion` - After task finishes

**Status**: Conceptual only, no detailed design yet

**Related design**: `design/extension-points.md`

---

## Priority 7: Performance Features (Future)

### 12. Loop Control Enhancements

Already implemented: max iterations, cancellation

Potential additions from design:
- Timeout per iteration
- Adaptive max iterations based on complexity
- Cost-based limits

### 13. Advanced Error Handling

Already implemented: retry with exponential backoff, graceful degradation

Potential additions:
- Circuit breaker pattern for failing tools
- Fallback agents
- Partial completion on error

---

## Evaluation Criteria

For each pending feature, consider:

1. **A2A Protocol Compliance**: Required for protocol features?
   - ✅ Artifact stores (artifact-update events)
   - ⚠️ Sub-agent invocation (nice to have)
   - ❌ Caching (internal optimization)

2. **User Value**: Enables important use cases?
   - ✅ Artifact tools (multi-part responses, files)
   - ✅ Streaming (better UX)
   - ⚠️ Idempotency (reliability)

3. **Complexity**: Implementation effort vs benefit?
   - 🟢 Low: InMemoryArtifactStore, artifact tools
   - 🟡 Medium: RedisArtifactStore, streaming
   - 🔴 High: Sub-agents, extension hooks

4. **Dependencies**: Requires other features first?
   - Artifact tools → Artifact stores ✅
   - Sub-agents → A2A client, registry ❌
   - Extension hooks → Extension registry ❌

---

## Recommended Implementation Order

### Phase 1 (High Priority - A2A Protocol)
1. `InMemoryArtifactStore` - Testing/dev implementation
2. `RedisArtifactStore` - Production implementation
3. `ArtifactToolProvider` - Built-in artifact tools
4. `ArtifactStoreWithEvents` - A2A event emission

**Benefit**: Enables artifact-update events, multi-part responses, file generation

### Phase 2 (Medium Priority - Reliability)
5. Tool execution idempotency tracking
6. Enhanced message history reconstruction
7. Partial tool execution recovery

**Benefit**: Better resumption reliability, safer retries

### Phase 3 (Nice to Have - Performance)
8. LLM response caching
9. Tool execution batching
10. Streaming LLM responses

**Benefit**: Better performance, lower costs, improved UX

### Phase 4 (Future - Advanced Features)
11. Sub-agent invocation (requires A2A client)
12. Extension hooks (requires extension system)
13. Advanced control/error handling

**Benefit**: Advanced use cases, extensibility

---

## Current Implementation Status

✅ **Complete**:
- Core agent loop with RxJS
- State persistence (Redis + Memory)
- Checkpointing and resumption
- Tool execution (parallel)
- Error handling with retries
- OpenTelemetry tracing
- A2A event emission (task, status-update)
- State cleanup service
- shareReplay() for hot observables

🚧 **Partial**:
- Artifact management (interface only, no implementations)
- Tool result aggregation (basic)
- A2A artifact events (structure exists, needs stores)

❌ **Missing**:
- Everything listed in this document

---

## Next Steps

1. Review this document with the team
2. Decide which features to implement
3. Update TODO list with selected features
4. Create implementation tasks
5. Update `design/agent-loop.md` to remove detailed implementations for completed features
