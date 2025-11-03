# Design Document Refactoring Plan

## Goal

Separate conceptual design from implementation code. Design docs should explain *what* and *why*, implementation shows *how*.

## Approach

For each design document, we will:
1. Keep interfaces, type definitions, and contracts
2. Keep simplified conceptual examples (pseudo-code)
3. Extract full implementations to `src/` directory
4. Replace extracted code with references to implementation files

## Documents to Refactor

### 1. agent-loop.md

**Keep in Design:**
- Overview and architecture diagrams
- RxJS pipeline concept with simplified operators
- Interface definitions:
  - `PersistedLoopState`
  - `StateStore`
  - `ArtifactStore`
  - `ToolExecutionRecord`
- Flow diagrams and sequence diagrams
- Design decisions and rationale
- Simplified pseudo-code examples

**Extract to Implementation:**
- [ ] `RedisStateStore` class → `src/stores/redis/redis-state-store.ts`
- [ ] `InMemoryStateStore` class → `src/stores/memory/memory-state-store.ts`
- [ ] `RedisArtifactStore` class → `src/stores/redis/redis-artifact-store.ts`
- [ ] `InMemoryArtifactStore` class → `src/stores/memory/memory-artifact-store.ts`
- [ ] `StoreFactory` class → `src/stores/factory.ts`
- [ ] `ArtifactStoreWithEvents` class → `src/stores/decorators.ts`
- [ ] `ArtifactToolProvider` class → `src/tools/artifact-tools.ts`
- [ ] `StateCleanupService` class → `src/stores/cleanup.ts`
- [ ] Full checkpoint implementation → `src/core/checkpoint.ts`
- [ ] Full resumption implementation → `src/core/resumption.ts`
- [ ] A2A server integration code → `src/a2a/server.ts`

**Replace With:**
```markdown
### State Store Implementations

The framework provides multiple state store implementations. See [src/stores/](../src/stores/) for:
- `RedisStateStore` - Production Redis-backed storage
- `InMemoryStateStore` - Testing and development

For implementation details, see:
- [State Store Interface](../src/stores/interfaces.ts)
- [Redis Implementation](../src/stores/redis/redis-state-store.ts)
- [Factory Pattern](../src/stores/factory.ts)
```

### 2. a2a-protocol.md

**Keep in Design:**
- Protocol overview and specification
- Message format examples (minimal)
- Interface definitions for A2A messages
- Flow diagrams
- Error code tables
- Compliance checklist

**Extract to Implementation:**
- [ ] Full Express server implementation → `src/a2a/server.ts`
- [ ] Full SSE client implementation → `src/a2a/client.ts`
- [ ] Message validation code → `src/a2a/validation.ts`
- [ ] Full method routing → `src/a2a/router.ts`

**Replace With:**
```markdown
### Implementation

See the implementation in:
- [A2A Server](../src/a2a/server.ts) - Express-based SSE server
- [A2A Client](../src/a2a/client.ts) - SSE client with reconnection
- [Message Types](../src/a2a/types.ts) - TypeScript type definitions
```

### 3. tool-integration.md

**Keep in Design:**
- Tool provider architecture
- Provider interface definitions
- Tool routing concepts
- Integration patterns

**Extract to Implementation:**
- [ ] `LocalToolProvider` → `src/tools/local/local-provider.ts`
- [ ] `MCPToolProvider` → `src/tools/mcp/mcp-provider.ts`
- [ ] `ClientToolProvider` → `src/tools/client/client-provider.ts`
- [ ] `ToolRouter` → `src/tools/router.ts`
- [ ] Tool execution logic → `src/tools/executor.ts`

### 4. observability.md

**Keep in Design:**
- Tracing architecture
- Span hierarchy concepts
- Trace context propagation patterns
- Metric definitions

**Extract to Implementation:**
- [ ] OpenTelemetry setup → `src/observability/setup.ts`
- [ ] Tracer creation → `src/observability/tracer.ts`
- [ ] Span creation helpers → `src/observability/spans.ts`
- [ ] Metrics collection → `src/observability/metrics.ts`

### 5. authentication.md

**Keep in Design:**
- Auth strategy patterns
- Interface definitions
- Credential flow diagrams
- Security considerations

**Extract to Implementation:**
- [ ] `RawPassthroughStrategy` → `src/auth/strategies/passthrough.ts`
- [ ] `TokenReissueStrategy` → `src/auth/strategies/reissue.ts`
- [ ] Auth context builder → `src/auth/context.ts`

### 6. extension-points.md

**Keep in Design:**
- Extension architecture
- Hook point locations
- Extension interface
- Plugin patterns

**Extract to Implementation:**
- [ ] Extension registry → `src/extensions/registry.ts`
- [ ] Hook execution → `src/extensions/hooks.ts`
- [ ] Built-in extensions → `src/extensions/builtin/`

### 7. dynamic-discovery.md

**Keep in Design:**
- Discovery architecture
- Registry concepts
- Service registration patterns

**Extract to Implementation:**
- [ ] Discovery service → `src/discovery/service.ts`
- [ ] Registry implementation → `src/discovery/registry.ts`
- [ ] Auto-discovery → `src/discovery/auto-discover.ts`

## Refactoring Process

For each document:

1. **Create implementation files** in `src/` with extracted code
2. **Update design doc** to:
   - Remove full implementation code
   - Keep interface definitions
   - Add simplified conceptual examples
   - Add references to implementation files
3. **Add design references** in implementation code:
   ```typescript
   // Implementation of state persistence strategy
   // Design: design/agent-loop.md#state-persistence-strategy
   ```

## Example Before/After

### Before (in design/agent-loop.md)
```markdown
### Redis State Store

```typescript
class RedisStateStore implements StateStore {
  constructor(private redis: RedisClient, private ttl: number = 24 * 60 * 60) {}

  async save(taskId: string, state: PersistedLoopState): Promise<void> {
    const key = `task:${taskId}:state`;
    await this.redis.setex(key, this.ttl, JSON.stringify(state));
  }

  async load(taskId: string): Promise<PersistedLoopState | null> {
    const data = await this.redis.get(`task:${taskId}:state`);
    return data ? JSON.parse(data) : null;
  }

  // ... 100 more lines
}
```
```

### After (in design/agent-loop.md)
```markdown
### State Store Implementations

The framework provides multiple implementations of `StateStore`:

- **RedisStateStore** - Production-ready storage using Redis with TTL support
- **InMemoryStateStore** - Lightweight storage for testing and development

Example usage:
```typescript
// Create via factory
const store = StoreFactory.createStateStore({
  type: 'redis',
  redis: redisClient,
  ttl: 86400
});

// Use in agent loop
await store.save(taskId, state);
const restored = await store.load(taskId);
```

**Implementation**: See [src/stores/](../src/stores/) for full implementations.
```

## Timeline

- **Phase 1** (Priority): agent-loop.md, a2a-protocol.md
- **Phase 2**: tool-integration.md, observability.md
- **Phase 3**: authentication.md, extension-points.md, dynamic-discovery.md

## Success Criteria

- [ ] Design docs are under 500 lines each (excluding diagrams)
- [ ] No design doc has complete class implementations
- [ ] All interfaces are defined in design docs
- [ ] All implementations reference design docs
- [ ] README links to both design and implementation
- [ ] New contributors can understand architecture from design docs alone
