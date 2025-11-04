# Quick Reference: Design vs Implementation

## Project Architecture Overview

**Looopy** is an RxJS-based AI agent framework with two core classes:

- **Agent** - Multi-turn conversation manager (stateful)
  - Manages message history via MessageStore
  - Persists artifacts via ArtifactStore
  - Lifecycle: created → ready → busy → ready
  - Lazy initialization on first turn

- **AgentLoop** - Single-turn execution engine (stateless)
  - Operator-based RxJS pipeline
  - Executes one complete LLM reasoning cycle
  - Operated by Agent class
  - No conversation memory between calls

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

**Purpose**: Explain single-turn execution conceptually

```markdown
## Operator-Based Architecture

AgentLoop uses RxJS operator factories for modular execution.

### Interface

```typescript
// Factory creates operator with closures
export function tapBeforeExecute(
  spanRef: { current: Span | undefined },
  logger: Logger,
  context: Context
): OperatorFunction<Context, Context>
```

### Conceptual Pipeline

```typescript
// Simplified execution flow
defer(() => of(context))
  → tap(beforeExecute)      // Start span, emit TaskEvent
  → switchMap(runLoop)       // Iteration loop
  → tap(afterExecute)        // Final StatusUpdate
  → catchError(handleError)  // Error handling
  → shareReplay(1)           // Hot observable
```

### Implementations

See [src/core/operators/](../src/core/operators/) for:
- **execute-operators.ts** - Root span management
- **iteration-operators.ts** - Iteration loop
- **llm-operators.ts** - LLM calls and responses
```

### ✅ Implementation Code (src/core/operators/execute-operators.ts)

**Purpose**: Implement operator factory pattern

```typescript
/**
 * Execute Operators
 *
 * Root span management and initial/final events for AgentLoop execution.
 *
 * Design: design/agent-loop.md (Operator-Based Architecture section)
 */

import { tap, catchError, type OperatorFunction } from 'rxjs';
import type { Context, AgentEvent } from '../types';
import type { Logger } from 'pino';

/**
 * Factory function creates operator with closures
 */
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

// Additional operators: tapAfterExecuteEvents, catchExecuteError
```

### ✅ Usage Example (examples/basic-agent.ts)

**Purpose**: Show how to use Agent for multi-turn conversations

```typescript
/**
 * Basic Agent Example
 *
 * Shows how to create and run a multi-turn agent with message persistence.
 */

import { Agent } from 'looopy';
import { LiteLLMProvider } from 'looopy/providers';
import { InMemoryMessageStore, InMemoryArtifactStore } from 'looopy/stores';

// Create agent (lazy initialization on first turn)
const agent = new Agent({
  contextId: 'user-123-session-456',
  llmProvider: new LiteLLMProvider({ model: 'gpt-4' }),
  toolProviders: [localTools],
  messageStore: new InMemoryMessageStore(),
  artifactStore: new InMemoryArtifactStore(),
});

// Turn 1 - Auto-initializes
const turn1$ = await agent.startTurn('Hello, what can you help with?');
await lastValueFrom(turn1$);

// Turn 2 - Continues with message history
const turn2$ = await agent.startTurn('Tell me about TypeScript');
await lastValueFrom(turn2$);

// Shutdown
await agent.shutdown();
```

## Common Mistakes

### ❌ Too Much Code in Design

```markdown
<!-- design/agent-loop.md -->

## Operator-Based Architecture

```typescript
export function tapBeforeExecute(
  spanRef: { current: Span | undefined },
  logger: Logger,
  context: Context
): OperatorFunction<Context, Context> {
  return tap((ctx) => {
    // Start execution span
    const span = trace.getTracer('looopy').startSpan('agent.execute', {
      attributes: {
        'agent.id': ctx.agentId,
        'task.id': ctx.taskId,
        'context.id': ctx.contextId
      }
    });

    // Set span in ref
    spanRef.current = span;

    // Emit initial event
    this.events$.next({
      kind: 'task',
      id: ctx.taskId,
      contextId: ctx.contextId,
      status: { state: 'submitted', timestamp: new Date().toISOString() }
    });

    // Log trace-level
    logger.trace({ taskId: ctx.taskId, traceId: span.spanContext().traceId }, 'Started execution span');
  });
}

// ... 200 more lines of complete implementation
```
```

**Problem**: This is complete implementation code with full error handling and logging. Should be in `src/core/operators/`.

**Fix**: Keep only interface and conceptual flow in design doc, link to implementation.

### ❌ No Design Reference in Implementation

```typescript
// src/core/operators/execute-operators.ts

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

**Problem**: Missing design reference. Should have:

```typescript
/**
 * Execute Operators
 *
 * Root span management and initial/final events for AgentLoop execution.
 *
 * Design: design/agent-loop.md (Operator-Based Architecture section)
 */

export function tapBeforeExecute(
  spanRef: { current: Span | undefined },
  logger: Logger,
  context: Context
): OperatorFunction<Context, Context> {
  // Implementation...
}
```

### ❌ Interface in Wrong Place

```typescript
// Only in src/core/operators/execute-operators.ts

type OperatorFunction<T, R> = (source: Observable<T>) => Observable<R>;

export function tapBeforeExecute(
  spanRef: { current: Span | undefined },
  logger: Logger,
  context: Context
): OperatorFunction<Context, Context> {
  // ...
}
```

**Problem**: Core type definitions should be in design doc AND in `src/core/types.ts`, not buried in operator files.

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
- Check [A2A_ALIGNMENT.md](./A2A_ALIGNMENT.md) for event type mapping
- See design docs in [design/](./design/) for architecture details
- Look at existing code in `src/` for patterns
