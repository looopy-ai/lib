# GitHub Copilot Instructions for Looopy Project

## Project Overview

This is an RxJS-based AI agent framework implementing the A2A (Agent-to-Agent) protocol. We follow a **documentation-first approach** with strict separation between conceptual design and implementation code.

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
  // Design: design/agent-loop.md#checkpointing-during-execution
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
    * Design: design/agent-loop.md#state-store-implementations
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
2. Read: design/agent-loop.md#llm-provider
3. Code: Implement streaming in src/core/llm-provider.ts
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
- **Refactoring Plan**: See [REFACTOR_PLAN.md](../REFACTOR_PLAN.md)
- **A2A Alignment**: See [A2A_ALIGNMENT.md](../A2A_ALIGNMENT.md)

## Common Patterns

### Pattern: Factory Pattern

**Design doc** (`design/*.md`):
```typescript
// Interface definition only
interface StoreFactory {
  createStateStore(config: StateConfig): StateStore;
  createArtifactStore(config: ArtifactConfig): ArtifactStore;
}
```

**Implementation** (`src/stores/factory.ts`):
```typescript
// Design: design/agent-loop.md#store-factory-pattern
export class StoreFactory {
  static createStateStore(config: StateConfig): StateStore {
    // Complete implementation with validation, error handling, etc.
  }
}
```

### Pattern: RxJS Pipelines

**Design doc** (`design/*.md`):
```typescript
// Conceptual flow
const loop$ = pipe(
  prepareExecution,
  callLLM,
  executeTools,
  updateState
);
```

**Implementation** (`src/core/agent-loop.ts`):
```typescript
// Design: design/agent-loop.md#reactive-execution-pipeline
export const createAgentLoop = (context: Context): Observable<State> => {
  return of(context).pipe(
    // Complete implementation with error handling, tracing, etc.
  );
};
```

## Technology Stack

- **TypeScript** (strict mode)
- **RxJS** for reactive programming
- **OpenTelemetry** for observability
- **Server-Sent Events** (SSE) for A2A protocol
- **Redis** for state persistence (optional)

## Remember

**The key principle**: Design documents explain the "what" and "why", implementation code shows the "how", and examples demonstrate the "how to use".

Keep designs clean, conceptual, and stable. Put all the detailed implementation work in `src/`.
