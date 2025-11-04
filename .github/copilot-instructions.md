# GitHub Copilot Instructions for Looopy Project

## Project Overview

This is an RxJS-based AI agent framework implementing the A2A (Agent-to-Agent) protocol. We follow a **documentation-first approach** with strict separation between conceptual design and implementation code.

**Key Architecture**: The framework has two core classes:
- **Agent** - Multi-turn conversation manager (stateful)
- **AgentLoop** - Single-turn execution engine (stateless)

**CRITICAL**: Design documents in the `design/` folder are the **source of truth** for architecture and must be kept up-to-date. When making changes to implementations, always update the corresponding design document if the change affects architecture, interfaces, or design decisions.

## Documentation Structure

### Design Documents (`design/`)

Design documents are **CONCEPTUAL ONLY** and should:

- ✅ Explain architecture, patterns, and data flows
- ✅ Include diagrams (Mermaid, ASCII art)
- ✅ Define TypeScript interfaces and type definitions
- ✅ Explain rationale and design decisions
- ✅ Show simplified pseudo-code or conceptual examples
- ✅ Remain high-level and stable
- ✅ **Be kept up-to-date** when architecture or interfaces change

Design documents should **NEVER** include:

- ❌ Complete class implementations
- ❌ Detailed error handling code
- ❌ Framework-specific boilerplate
- ❌ Production configuration details
- ❌ Full method implementations with try/catch blocks
- ❌ Complete constructor implementations
- ❌ Logging statements and detailed instrumentation

**When to Update Design Docs**:
- ✅ Interface definitions change
- ✅ New architectural patterns introduced
- ✅ Data flow changes
- ✅ Design decisions are made or revised
- ✅ New major features added
- ❌ Bug fixes in implementation
- ❌ Performance optimizations
- ❌ Implementation details (logging, error handling)

### Implementation Code (`src/`)

Implementation code should:

- ✅ Contain complete, production-ready implementations
- ✅ Include comprehensive error handling
- ✅ Reference design documents in comments:
  ```typescript
  // Implementation of agent loop checkpoint strategy
  // Design: design/agent-loop.md (State Persistence section)
  ```
- ✅ Use proper TypeScript types and follow strict mode
- ✅ Include JSDoc comments for public APIs

### Examples (`examples/`)

Example code should:

- ✅ Show complete working usage patterns
- ✅ Be runnable as-is
- ✅ Demonstrate best practices
- ✅ Include clear comments

## When Generating Code

### For Design Documents

When working in `design/*.md` files:

1. **Define interfaces only**, don't implement them:
   ```typescript
   // ✅ Good - Interface definition
   interface StateStore {
     save(taskId: string, state: State): Promise<void>;
     load(taskId: string): Promise<State | null>;
   }
   ```

2. **Use simplified conceptual examples**:
   ```typescript
   // ✅ Good - Conceptual flow
   const checkpoint$ = pipe(
     filter(shouldCheckpoint),
     tap(state => store.save(state))
   );
   ```

3. **Avoid complete implementations**:
   ```typescript
   // ❌ Bad - Don't do this in design docs
   class RedisStateStore implements StateStore {
     constructor(private redis: RedisClient) {}

     async save(taskId: string, state: State): Promise<void> {
       try {
         const key = `task:${taskId}:state`;
         await this.redis.setex(key, 86400, JSON.stringify(state));
         logger.debug('Saved state', { taskId });
       } catch (error) {
         logger.error('Failed to save', { error });
         throw new StateStorageError(error.message);
       }
     }
   }
   ```

4. **Reference implementations instead**:
   ```markdown
   ### State Store Implementations

   The framework provides multiple `StateStore` implementations:
   - **RedisStateStore** - Production Redis storage with TTL
   - **InMemoryStateStore** - Testing and development

   See [src/stores/](../src/stores/) for complete implementations.
   ```

### For Implementation Files

When working in `src/**/*.ts` files:

1. **Always include design reference**:
   ```typescript
   /**
    * Redis State Store Implementation
    *
    * Production-ready state persistence using Redis with TTL support.
    *
    * Design: design/agent-loop.md (State Persistence section)
    */
   export class RedisStateStore implements StateStore {
   ```

2. **Implement complete functionality**:
   - Full error handling with try/catch
   - Logging for debugging and monitoring
   - Input validation
   - Edge case handling

3. **Use TypeScript strictly**:
   - Explicit types for all parameters and returns
   - No `any` types unless absolutely necessary
   - Proper interface implementations

### For Example Files

When working in `examples/**/*.ts` files:

1. **Make it runnable**: Include all necessary imports and setup
2. **Add explanatory comments**: Help users understand each step
3. **Show best practices**: Demonstrate recommended patterns

## Code Review Principles

When reviewing or generating code changes:

- If modifying a **design document**: Keep it conceptual, remove detailed implementations
- If modifying **implementation**: Ensure it references the design doc
- If adding **new features**: Start with design doc update, then implement in `src/`
- **After making architectural changes**: Always update the corresponding design document to reflect the new architecture, interfaces, or patterns

## Keeping Design Docs Up-to-Date

**CRITICAL WORKFLOW**: When making changes that affect architecture:

1. **Before coding**: Review the relevant design document
2. **While coding**: Note any deviations from the design
3. **After coding**: Update the design document if you:
   - Changed interface signatures
   - Added new architectural patterns
   - Modified data flows
   - Made design decisions
   - Added major features

**Example Workflow**:
```
1. Task: Add streaming support to LLMProvider
2. Read: design/agent-loop.md (LLM Provider section)
3. Code: Implement streaming in src/providers/litellm-provider.ts
4. Update: design/agent-loop.md to show new streaming interface
5. Commit: Both implementation and design doc changes together
```

**What to Update in Design Docs**:
- ✅ Interface definitions (add new methods/properties)
- ✅ Architecture diagrams (if structure changed)
- ✅ Data flow descriptions (if flow changed)
- ✅ Design rationale (document why decisions were made)

**What NOT to Update**:
- ❌ Implementation details (keep in src/)
- ❌ Bug fix details (keep in git commit messages)
- ❌ Performance tuning specifics

## Project References

- **Way of Working**: See [PROJECT.md](../PROJECT.md)
- **Quick Reference**: See [QUICK_REFERENCE.md](../QUICK_REFERENCE.md)
- **A2A Alignment**: See [A2A_ALIGNMENT.md](../A2A_ALIGNMENT.md)

## Key Design Documents

- **[design/architecture.md](../design/architecture.md)** - Overall system architecture
- **[design/agent-lifecycle.md](../design/agent-lifecycle.md)** - Agent class design (multi-turn)
- **[design/agent-loop.md](../design/agent-loop.md)** - AgentLoop class design (single-turn)
- **[design/a2a-protocol.md](../design/a2a-protocol.md)** - A2A event specification
- **[design/tool-integration.md](../design/tool-integration.md)** - Tool provider patterns
- **[design/observability.md](../design/observability.md)** - Distributed tracing

## Common Patterns

### Pattern: Operator Factory Pattern

**Design doc** (`design/agent-loop.md`):
```typescript
// Factory function creates operator with closures
export function tapBeforeExecute(
  spanRef: { current: Span | undefined },
  logger: Logger,
  context: Context
): OperatorFunction<Context, Context>
```

**Implementation** (`src/core/operators/execute-operators.ts`):
```typescript
// Design: design/agent-loop.md (Operator-Based Architecture section)
export function tapBeforeExecute(
  spanRef: { current: Span | undefined },
  logger: Logger,
  context: Context
): OperatorFunction<Context, Context> {
  return tap((ctx) => {
    spanRef.current = startExecutionSpan(ctx);
    logger.trace({ taskId: ctx.taskId }, 'Started execution span');
  });
}
```

### Pattern: Store Factory Pattern

**Design doc** (`design/agent-loop.md`):
```typescript
// Interface definition only
interface StoreFactory {
  createStateStore(config: StateConfig): StateStore;
  createArtifactStore(config: ArtifactConfig): ArtifactStore;
}
```

**Implementation** (`src/stores/factory.ts`):
```typescript
// Design: design/agent-loop.md (State Persistence section)
export class StoreFactory {
  static createStateStore(config: StateConfig): StateStore {
    // Complete implementation with validation, error handling, etc.
  }
}
```

### Pattern: Agent/AgentLoop Separation

**Design doc** (`design/agent-lifecycle.md`, `design/agent-loop.md`):
```typescript
// Agent manages multi-turn conversations
class Agent {
  async startTurn(message: string): Promise<Observable<AgentEvent>>
}

// AgentLoop executes single turns
class AgentLoop {
  startTurn(messages: Message[], context: Context): Observable<AgentEvent>
}
```

**Implementation**:
- `src/core/agent.ts` - Multi-turn manager with MessageStore
- `src/core/agent-loop.ts` - Single-turn execution with operator pipeline

## Technology Stack

- **TypeScript** (strict mode)
- **RxJS** for reactive programming
- **OpenTelemetry** for observability
- **Pino** for structured logging
- **Vitest** for testing (103 tests passing)
- **LiteLLM** for multi-provider LLM integration
- **Server-Sent Events** (SSE) for A2A protocol (planned)
- **Redis** for state persistence (optional)

## Current Project Structure

```
src/
├── core/              # Agent and AgentLoop
│   ├── agent.ts       # Multi-turn conversation manager
│   ├── agent-loop.ts  # Single-turn execution engine (includes checkpointing)
│   ├── operators/     # RxJS operator factories
│   │   ├── execute-operators.ts
│   │   ├── iteration-operators.ts
│   │   └── llm-operators.ts
│   ├── types.ts       # Core type definitions
│   ├── config.ts      # Configuration interfaces
│   ├── logger.ts      # Pino logger setup
│   └── cleanup.ts     # State cleanup service
├── stores/            # State and artifact storage
│   ├── interfaces.ts  # Store interfaces
│   ├── factory.ts     # Store creation factory
│   ├── redis/         # Redis implementations
│   │   └── redis-state-store.ts
│   ├── memory/        # In-memory implementations
│   │   └── memory-state-store.ts
│   └── artifacts/     # Artifact store implementations
│       ├── memory-artifact-store.ts
│       └── artifact-store-with-events.ts
├── tools/             # Tool integration
│   ├── interfaces.ts  # ToolProvider interface
│   ├── local-tools.ts # Local function tools
│   ├── client-tool-provider.ts # Client-delegated tools
│   └── artifact-tools.ts # Artifact management tools (planned)
├── providers/         # LLM providers
│   └── litellm-provider.ts # LiteLLM proxy integration
├── observability/     # Tracing and logging
│   ├── tracing.ts     # OpenTelemetry setup
│   └── spans/         # Span helper functions
│       └── agent-turn.ts
└── README.md          # Implementation guide

Future directories (planned):
├── a2a/               # A2A protocol (not yet implemented)
│   ├── server.ts      # SSE server
│   └── client.ts      # SSE client
```

## Remember

**The key principle**: Design documents explain the "what" and "why", implementation code shows the "how", and examples demonstrate the "how to use".

Keep designs clean, conceptual, and stable. Put all the detailed implementation work in `src/`.
