# Quick Reference: Design vs Implementation

## Where Does This Go?

Use this flowchart to decide where to put your work:

```
Are you explaining HOW the system works conceptually?
│
├─ YES → design/*.md
│   │
│   ├─ Is it an interface/contract? → Keep in design
│   ├─ Is it a simplified example? → Keep in design
│   ├─ Is it explaining rationale? → Keep in design
│   └─ Is it complete working code? → Move to src/
│
└─ NO → Are you writing production code?
    │
    ├─ YES → src/**/*.ts
    │   │
    │   ├─ Implement interfaces from design docs
    │   ├─ Add comment: "// Design: design/xyz.md#section"
    │   ├─ Include full error handling
    │   └─ Write tests in tests/
    │
    └─ NO → Are you showing usage?
        │
        ├─ YES → examples/
        │   │
        │   ├─ Complete working examples
        │   ├─ Real-world scenarios
        │   └─ Best practices
        │
        └─ NO → README.md or docs/
```

## Examples

### ✅ Design Document (design/agent-loop.md)

```markdown
## State Persistence

The agent loop persists state at checkpoint intervals to enable resumption.

### Interface

```typescript
interface StateStore {
  save(taskId: string, state: State): Promise<void>;
  load(taskId: string): Promise<State | null>;
}
```

### Conceptual Flow

```typescript
// Checkpoint after significant operations
const checkpoint$ = pipe(
  filter(state => shouldCheckpoint(state)),
  tap(state => stateStore.save(state))
);
```

### Implementations

- **RedisStateStore**: Production Redis storage
- **InMemoryStateStore**: Testing and development

See [src/stores/](../src/stores/) for implementations.
```

### ✅ Implementation Code (src/stores/redis/redis-state-store.ts)

```typescript
/**
 * Redis State Store Implementation
 *
 * Design: design/agent-loop.md#state-persistence
 */

import { StateStore, State } from '../interfaces';

export class RedisStateStore implements StateStore {
  constructor(
    private redis: RedisClient,
    private ttl: number = 24 * 60 * 60
  ) {}

  async save(taskId: string, state: State): Promise<void> {
    const key = `task:${taskId}:state`;

    try {
      await this.redis.setex(
        key,
        this.ttl,
        JSON.stringify(state)
      );

      logger.debug('Saved state', { taskId });
    } catch (error) {
      logger.error('Failed to save state', { taskId, error });
      throw new StateStorageError(`Save failed: ${error.message}`);
    }
  }

  async load(taskId: string): Promise<State | null> {
    // Full implementation with error handling...
  }
}
```

### ✅ Usage Example (examples/basic-agent.ts)

```typescript
/**
 * Basic Agent Example
 *
 * Shows how to create and run a simple agent with state persistence.
 */

import { AgentLoop, StoreFactory } from 'looopy';

// Create stores
const stateStore = StoreFactory.createStateStore({
  type: 'redis',
  redis: createRedisClient(),
  ttl: 86400
});

// Create agent
const agent = new AgentLoop({
  stateStore,
  // ... other config
});

// Run
const result$ = agent.execute('Analyze this data', context);
result$.subscribe({
  next: event => console.log('Event:', event),
  error: err => console.error('Error:', err),
  complete: () => console.log('Done')
});
```

## Common Mistakes

### ❌ Too Much Code in Design

```markdown
<!-- design/agent-loop.md -->

## State Store

```typescript
class RedisStateStore {
  async save(taskId: string, state: State): Promise<void> {
    const key = `task:${taskId}:state`;

    try {
      const serialized = JSON.stringify(state);
      await this.redis.setex(key, this.ttl, serialized);

      // Also update index
      await this.redis.sadd('all-tasks', taskId);

      // Log for debugging
      logger.debug('Saved state', { taskId, size: serialized.length });

    } catch (error) {
      if (error instanceof RedisError) {
        // Handle Redis-specific errors
        logger.error('Redis error', { error });
        throw new StateStorageError('Redis save failed');
      }
      throw error;
    }
  }

  // ... 200 more lines
}
```
```

**Problem**: This is complete implementation code. Should be in `src/`.

### ❌ No Design Reference in Implementation

```typescript
// src/stores/redis/redis-state-store.ts

export class RedisStateStore implements StateStore {
  async save(taskId: string, state: State): Promise<void> {
    // Implementation here
  }
}
```

**Problem**: Missing design reference. Should have:
```typescript
/**
 * Redis State Store Implementation
 *
 * Provides production-ready state persistence using Redis with TTL support.
 *
 * Design: design/agent-loop.md#state-persistence-strategy
 */
export class RedisStateStore implements StateStore {
```

### ❌ Interface in Wrong Place

```typescript
// Only in src/stores/redis/redis-state-store.ts

interface StateStore {
  save(taskId: string, state: State): Promise<void>;
  load(taskId: string): Promise<State | null>;
}

export class RedisStateStore implements StateStore {
  // ...
}
```

**Problem**: Interface should be in design doc AND in `src/stores/interfaces.ts`.

## Checklist

### When Writing Design Docs

- [ ] Explains *what* and *why*, not detailed *how*
- [ ] Includes interface definitions
- [ ] Has conceptual diagrams
- [ ] Shows simplified examples (pseudo-code OK)
- [ ] Documents design decisions and trade-offs
- [ ] References related designs
- [ ] Links to implementation: `See [src/xyz/](../src/xyz/)`

### When Writing Implementation

- [ ] References design doc: `// Design: design/xyz.md#section`
- [ ] Implements interface from design
- [ ] Includes full error handling
- [ ] Has comprehensive logging
- [ ] Includes JSDoc comments
- [ ] Has corresponding tests
- [ ] Follows TypeScript best practices

### When Writing Examples

- [ ] Complete working code (can run as-is)
- [ ] Shows common use case
- [ ] Includes comments explaining steps
- [ ] References relevant design docs
- [ ] Has clear output/expectations

## Quick Decision Matrix

| Content Type            | Location                              | Example                        |
| ----------------------- | ------------------------------------- | ------------------------------ |
| Interface definition    | `design/*.md` + `src/*/interfaces.ts` | `interface StateStore`        |
| Conceptual flow         | `design/*.md`                         | Simplified RxJS pipeline       |
| Complete implementation | `src/**/*.ts`                         | Full class with error handling |
| Design decision         | `design/*.md`                         | "We chose Redis because..."    |
| Usage example           | `examples/*.ts`                       | Working demo code              |
| API docs                | Generated from `src/`                 | TSDoc → HTML                   |

## Need Help?

- Read [PROJECT.md](./PROJECT.md) for full guidelines
- Check [REFACTOR_PLAN.md](./REFACTOR_PLAN.md) for refactoring strategy
- See [DESIGN_IMPLEMENTATION_SEPARATION.md](./DESIGN_IMPLEMENTATION_SEPARATION.md) for detailed examples
- Look at existing code in `src/` for patterns
