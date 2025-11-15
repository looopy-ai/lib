# Pending Features

This document lists features that are **not yet implemented** and should be evaluated for future development.

**Last Updated**: November 5, 2025

## Current Implementation Status

### ✅ Fully Implemented

**Core Framework**:
- Agent class (multi-turn conversation manager with lazy initialization)
- AgentLoop class (single-turn execution engine)
- Operator-based RxJS pipeline architecture
- State persistence (Redis and in-memory TaskStateStore)
- Checkpointing and resumption
- Comprehensive error handling with retry logic
- OpenTelemetry distributed tracing with span hierarchy
- Hot observables with shareReplay()
- State cleanup service

**Tool System**:
- LocalToolProvider (server-side function execution)
- ClientToolProvider (client-side delegation via A2A input-required)
- MCPToolProvider (integration with MCP servers)
- Parallel tool execution with configurable concurrency (default: 5)
- Tool definition interfaces

**Artifact System**:
- InMemoryArtifactStore (full implementation)
- ArtifactStoreWithEvents (A2A event emission decorator)
- Artifact tool provider with 6 built-in tools:
  - `create_artifact` - Create new artifacts
  - `append_artifact` - Append text content
  - `append_artifact_data` - Append JSON data
  - `replace_artifact_part` - Update specific parts
  - `complete_artifact` - Mark as finished
  - `list_artifacts` - List all artifacts

**LLM Integration**:
- LiteLLMProvider (multi-provider proxy support)
- System prompt injection at LLM call time
- Message history management

**A2A Protocol**:
- TaskEvent, StatusUpdateEvent, ArtifactUpdateEvent emission
- Event type definitions aligned with A2A spec v0.3.0
- Internal events for observability (filtered from A2A streams)

**Logging & Observability**:
- Pino structured logging
- Selective trace-level logging for span operations
- Comprehensive span hierarchy (agent.turn → agent.execute → iteration → llm/tools)

**Testing**:
- 103 tests passing
- Unit tests for core components
- Integration tests for tool providers
- Artifact store tests

### 🚧 Partially Implemented

**Artifact Management**:
- ✅ Interface defined (`ArtifactStore`)
- ✅ InMemoryArtifactStore complete
- ✅ ArtifactStoreWithEvents complete
- ✅ Built-in artifact tools complete
- ❌ RedisArtifactStore not implemented
- ❌ S3/filesystem backends not implemented

**Streaming**:
- ✅ Event structure supports streaming (ArtifactUpdateEvent with `append` and `lastChunk`)
- ❌ LLM provider streaming not implemented
- ❌ Streaming LLM responses end-to-end not working

**Tool Result Aggregation**:
- ✅ Basic aggregation working
- ❌ Advanced formatting/summarization not implemented

---

## Priority 1: A2A Server Implementation

### 1. A2A SSE Server

**Status**: ❌ Not implemented

**Description**: HTTP server that exposes agents via A2A protocol with Server-Sent Events.

**Requirements**:
- POST `/api/a2a` endpoint for JSON-RPC 2.0 requests
- SSE streaming for real-time event delivery
- Authentication (bearer token, API keys)
- Task management (create, get, cancel)
- Event filtering (exclude internal events)
- Error handling with proper JSON-RPC error codes

**Benefits**:
- Standard protocol for agent-to-agent communication
- Web client compatibility
- Real-time progress updates
- Multi-client support

**Related Design**: `design/a2a-protocol.md`

**Files to create**:
- `packages/a2a/src/server.ts` - Express/Fastify SSE server
- `packages/a2a/src/client.ts` - A2A client for agent-to-agent calls
- `packages/a2a/src/types.ts` - A2A-specific type definitions

**Dependencies**: None (events already A2A-compliant)

---

## Priority 2: Enhanced Storage Backends

### 2. RedisArtifactStore

**Status**: ❌ Not implemented

**Description**: Production-ready artifact storage with Redis + optional S3/filesystem for large files.

**Features**:
- Inline storage for small artifacts (< 1MB in Redis)
- External storage for large files (S3 or local filesystem)
- Multi-part composition with versioning
- Streaming support (append, replace operations)
- TTL-based expiration
- Artifact indexing by task/context

**Benefits**:
- Production-ready persistence
- Scalable storage for large artifacts
- Automatic cleanup with TTL
- Consistent with RedisStateStore pattern

**Related Design**: `design/artifact-management.md`

**File to create**: `packages/core/src/stores/redis/redis-artifact-store.ts`

**Dependencies**:
- Redis client (already used)
- Optional: AWS S3 SDK or filesystem APIs

### 3. Advanced Artifact Backends

**Status**: ❌ Not implemented

**Options**:
- **S3ArtifactStore**: Direct S3 storage (no Redis)
- **FilesystemArtifactStore**: Local filesystem storage
- **PostgreSQLArtifactStore**: Database-backed storage with SQL queries

**Benefits**:
- Flexibility for different deployment scenarios
- Cost optimization (S3 cheaper than Redis for large files)
- Better querying capabilities (PostgreSQL)

**Files to create**:
- `packages/core/src/stores/s3/s3-artifact-store.ts`
- `packages/core/src/stores/filesystem/filesystem-artifact-store.ts`
- `packages/core/src/stores/postgres/postgres-artifact-store.ts`

---

## Priority 3: Tool System Enhancements

### 5. Tool Execution Caching

**Status**: ❌ Not implemented

**Description**: Cache tool execution results to avoid duplicate API calls.

**Features**:
- Cache key generation from tool name + arguments
- Configurable TTL per tool
- Redis or in-memory cache backend
- Cache invalidation strategies
- Metadata tagging for cached results

**Benefits**:
- Faster responses for repeated queries
- Reduced API costs
- Better testing performance

**File to create**: `packages/core/src/tool-cache.ts`

**Implementation**: Decorator pattern around ToolProvider

### 6. Tool Execution Batching

**Status**: ❌ Not implemented

**Description**: Group tool calls by provider and use batch APIs when available.

**Features**:
- Group tool calls by provider
- Use provider batch APIs when available
- Fall back to parallel execution
- Configurable batch size limits

**Benefits**:
- Reduced network overhead
- Better performance for multiple tools
- Provider-specific optimizations

**Enhancement to**: `packages/core/src/agent-loop.ts` executeTools() method

### 7. Tool Execution Idempotency Tracking

**Status**: ❌ Not implemented

**Description**: Track tool execution status to prevent duplicate executions on resume.

**Features**:
- `ToolExecutionRecord` tracking (pending/running/completed/failed)
- Store records in TaskStateStore
- Check records before re-executing on resume
- Audit trail of tool executions

**Benefits**:
- Safe resumption without duplicate side effects
- Better error recovery
- Debugging and observability

**File to create**: `packages/core/src/tool-tracking.ts`

---

## Priority 4: Sub-Agent System

### 8. Sub-Agent Invocation

**Status**: ❌ Not implemented

**Description**: Invoke other agents as tools for task delegation and composition.

**Features**:
- Discover agents via registry
- Invoke via A2A protocol
- Forward sub-agent events to parent
- Wait for sub-agent completion
- Return result as tool result
- Handle sub-agent errors gracefully

**Benefits**:
- Agent composition
- Task delegation
- Distributed agent systems
- Hierarchical agent architectures

**Related Design**: `design/tool-integration.md`

**File to create**: `packages/core/src/tools/sub-agent-provider.ts`

**Dependencies**:
- A2A client implementation
- Agent registry/discovery service

### 9. Agent Registry and Discovery

**Status**: ❌ Not implemented

**Description**: Service for discovering and managing available agents.

**Features**:
- Register agents with capabilities/skills
- Query agents by capability
- Health checking
- Load balancing
- Version management

**Benefits**:
- Dynamic agent discovery
- Service mesh patterns
- Better scalability

**Related Design**: `design/dynamic-discovery.md`

**Files to create**:
- `packages/core/src/registry/agent-registry.ts`
- `packages/core/src/registry/service-discovery.ts`

---

## Priority 5: Streaming and Performance

### 10. Streaming LLM Responses

**Status**: ❌ Not implemented

**Description**: Stream LLM response chunks for lower latency and better UX.

**Features**:
- `llmProvider.stream()` method
- Emit ArtifactUpdateEvent as chunks arrive
- Accumulate chunks for final response
- Support for streaming tool calls
- Error handling for stream interruptions

**Benefits**:
- Lower latency to first token
- Better UX for long responses
- Progressive rendering in UI
- Real-time feedback

**Enhancement to**:
- `packages/core/src/providers/litellm-provider.ts` - Add stream() method
- `packages/core/src/agent-loop.ts` - Support streaming in LLM call pipeline

### 11. LLM Response Caching

**Status**: ❌ Not implemented

**Description**: Cache LLM responses to reduce API costs and latency.

**Features**:
- Cache key from message history + tools + system prompt
- Configurable TTL
- Redis or in-memory backend
- Cache warming strategies
- Cache hit/miss metrics

**Benefits**:
- Reduced LLM API costs
- Faster responses for repeated queries
- Better testing performance

**File to create**: `packages/core/src/llm-cache.ts`

---

## Priority 6: Extension System

### 12. Extension Hooks

**Status**: ❌ Not designed or implemented

**Description**: Pluggable hooks for extending agent behavior at key points.

**Proposed Hooks**:
- `beforeRequest` - Before execution starts
- `beforeLLMCall` - Before each LLM call
- `afterLLMCall` - After LLM response
- `beforeToolExecution` - Before tool call
- `afterToolExecution` - After tool completes
- `afterCompletion` - After task finishes
- `onError` - On any error

**Benefits**:
- Extensibility without forking
- Custom logging/metrics
- Policy enforcement
- A/B testing
- Custom caching strategies

**Related Design**: `design/extension-points.md` (needs to be created)

**Files to create**:
- `packages/core/src/extension-registry.ts`
- `packages/core/src/extension-types.ts`

---

## Priority 7: Advanced Features

### 13. Enhanced Error Handling

**Current**: Retry with exponential backoff, graceful degradation

**Potential Additions**:
- Circuit breaker pattern for failing tools/LLMs
- Fallback agents on failure
- Partial completion strategies
- Error recovery workflows
- Detailed error categorization

### 14. Performance Optimizations

**Current**: Parallel tool execution (max 5 concurrent)

**Potential Additions**:
- Adaptive concurrency based on resource usage
- Request prioritization
- Resource pooling
- Connection reuse
- Batch processing optimizations

### 15. Enhanced Resumption

**Current**: Basic checkpoint/resume working

**Potential Additions**:
- Message history reconstruction on resume
- Partial tool execution recovery
- Resume from mid-iteration
- Resume from specific checkpoint
- Checkpoint compression

### 16. Cost Management

**Status**: ❌ Not implemented

**Features**:
- Track LLM token usage per task/context
- Cost estimation before execution
- Budget limits and warnings
- Cost attribution by user/tenant
- Cost optimization recommendations

**Benefits**:
- Cost visibility
- Budget control
- Multi-tenant cost tracking

### 17. Authentication Framework

**Status**: Basic authContext structure exists

**Enhancements Needed**:
- OAuth 2.0 integration
- API key management
- Role-based access control (RBAC)
- Multi-tenant isolation
- Credential refresh handling

---

## Evaluation Criteria

For each pending feature, consider:

1. **A2A Protocol Compliance**: Required for protocol features?
   - ✅ A2A SSE server (required for protocol)
   - ⚠️ Sub-agent invocation (nice to have)
   - ❌ Caching (internal optimization)

2. **User Value**: Enables important use cases?
   - ✅ A2A server (enables web clients, standard protocol)
   - ✅ MCP tools (access to ecosystem)
   - ✅ Streaming (better UX)
   - ⚠️ Caching (performance)

3. **Complexity**: Implementation effort vs benefit?
   - 🟢 Low: RedisArtifactStore, tool caching
   - 🟡 Medium: A2A server, MCP provider, streaming
   - 🔴 High: Sub-agents, extension hooks, discovery service

4. **Dependencies**: Requires other features first?
   - A2A server → None ✅
   - Sub-agents → A2A client, registry ❌
   - Extension hooks → Extension registry ❌
   - MCP provider → None ✅

---

## Recommended Implementation Order

### Phase 1: Protocol Compliance (High Priority)
1. ✅ **A2A SSE Server** - Enables standard protocol access
   - Benefits: Web clients, standard protocol, real-time updates
   - Effort: Medium
   - Dependencies: None

2. **A2A Client** - For agent-to-agent communication
   - Benefits: Enables sub-agent calls, testing
   - Effort: Low-Medium
   - Dependencies: None

### Phase 2: Storage & Tools (Medium Priority)
3. **RedisArtifactStore** - Production artifact storage
   - Benefits: Scalable persistence, TTL cleanup
   - Effort: Low
   - Dependencies: None

4. **MCP Tool Provider** - Access MCP ecosystem
   - Benefits: File system, databases, dynamic tools
   - Effort: Medium
   - Dependencies: MCP client library

5. **Tool Execution Caching** - Performance optimization
   - Benefits: Lower costs, faster responses
   - Effort: Low
   - Dependencies: None

### Phase 3: Streaming & Performance (Medium Priority)
6. **Streaming LLM Responses** - Better UX
   - Benefits: Lower latency, progressive rendering
   - Effort: Medium
   - Dependencies: LLM provider streaming support

7. **LLM Response Caching** - Cost optimization
   - Benefits: Reduced API costs, faster testing
   - Effort: Low
   - Dependencies: None

### Phase 4: Advanced Features (Lower Priority)
8. **Sub-Agent Invocation** - Agent composition
   - Benefits: Task delegation, hierarchical agents
   - Effort: Medium-High
   - Dependencies: A2A client (Phase 1)

9. **Agent Registry** - Dynamic discovery
   - Benefits: Service mesh, scalability
   - Effort: High
   - Dependencies: None

10. **Extension Hooks** - Extensibility
    - Benefits: Custom behavior, plugins
    - Effort: Medium-High
    - Dependencies: Extension system design

---

## Notes

- **A2A Server** should be top priority to enable standard protocol access
- **Artifact storage** is mostly complete (InMemory done, Redis straightforward)
- **MCP integration** would unlock significant ecosystem value
- **Streaming** requires LLM provider support (LiteLLM has streaming)
- **Sub-agents** and **Extension hooks** are complex and should wait until core is stable

For detailed design specifications, see the `design/` directory.

For detailed design specifications, see the `design/` directory.
