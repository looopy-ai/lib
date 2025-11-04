# Project Guidelines

## Overview

This project is an RxJS-based AI agent framework implementing the A2A (Agent-to-Agent) protocol. We follow a documentation-first approach with clear separation between conceptual design and implementation.

## Way of Working

### 1. Documentation-First Development

We maintain comprehensive documentation before implementation:

1. **Design documents** describe *what* and *why*
2. **Implementation code** shows *how*
3. Design decisions are captured before coding begins
4. All changes start with documentation updates

### 2. Design vs Implementation Separation

#### Design Documents (`design/`)

Design documents are **conceptual** and should:

- ✅ Describe architecture, patterns, and data flows
- ✅ Include diagrams (text-based: mermaid, ASCII art)
- ✅ Define interfaces and contracts
- ✅ Explain rationale and trade-offs
- ✅ Show simplified pseudo-code or interface definitions
- ✅ Remain stable and high-level

Design documents should **NOT**:

- ❌ Include complete implementation code
- ❌ Show detailed error handling boilerplate
- ❌ Contain framework-specific details (unless critical to design)
- ❌ Include code that will become outdated quickly

#### Implementation Code (`src/`)

Implementation code should:

- ✅ Follow designs faithfully
- ✅ Include full error handling and edge cases
- ✅ Be production-ready with tests
- ✅ Include inline comments referencing design documents
- ✅ Use proper TypeScript types and interfaces

Example reference comment:
```typescript
// Implementation of agent loop checkpoint strategy
// See: design/agent-loop.md#checkpointing-during-execution
```

### 3. When to Update Documentation

Update design documents when:

- 🔄 Architecture or core patterns change
- 🔄 New major features are added
- 🔄 Interfaces or contracts evolve
- 🔄 Design decisions need to be captured

Do NOT update design documents for:

- ⛔ Bug fixes in implementation
- ⛔ Performance optimizations
- ⛔ Code refactoring that preserves design
- ⛔ Implementation detail changes

### 4. Design Document Structure

Each design document should follow this structure:

```markdown
# Feature Name

## Overview
Brief description of what this component does and why it exists.

## Architecture
High-level architecture with diagrams.

## Key Concepts
Core ideas and patterns used.

## Interfaces & Contracts
TypeScript interfaces showing the contract (no implementation).

## Data Flow
How data moves through the system.

## Design Decisions
Rationale for key choices, trade-offs considered.

## Integration Points
How this component connects to others.

## References
Links to related designs, specs, or external documentation.
```

### 5. Implementation Document Structure

Implementation should be organized as:

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

### 6. Code Examples in Design

When code examples are necessary in design docs:

**✅ Good - Interface definitions:**
```typescript
interface StateStore {
  save(taskId: string, state: State): Promise<void>;
  load(taskId: string): Promise<State | null>;
}
```

**✅ Good - Simplified concept illustration:**
```typescript
// Conceptual checkpoint flow
const checkpoint$ = pipe(
  filter(shouldCheckpoint),
  tap(state => store.save(state))
);
```

**❌ Avoid - Full implementation with error handling:**
```typescript
// Too detailed for design doc
async save(taskId: string, state: State): Promise<void> {
  try {
    const key = `task:${taskId}`;
    await this.redis.setex(key, this.ttl, JSON.stringify(state));
    await this.redis.sadd('tasks', taskId);
  } catch (error) {
    logger.error('Failed to save state', { taskId, error });
    throw new StateStorageError(`Save failed: ${error.message}`);
  }
}
```

### 7. Testing Philosophy

- Unit tests for individual components
- Integration tests for A2A protocol compliance
- E2E tests for complete agent scenarios
- Test against design document specifications
- Use in-memory implementations for fast tests

### 8. Version Control Practices

**Commit messages:**
```
design: Add artifact store concept to agent-loop
impl: Implement Redis artifact store
fix: Handle null artifacts in cleanup service
docs: Update README with new installation steps
```

**Branch naming:**
```
design/feature-name    # Design work
impl/feature-name      # Implementation work
fix/bug-description    # Bug fixes
```

### 9. Code Review Checklist

**For Design Changes:**
- [ ] Does it explain *why* not just *how*?
- [ ] Are interfaces clearly defined?
- [ ] Are trade-offs documented?
- [ ] Is it understandable without reading code?
- [ ] Does it avoid implementation specifics?

**For Implementation:**
- [ ] Does it follow the design document?
- [ ] Are there comments linking to design docs?
- [ ] Is error handling complete?
- [ ] Are there tests?
- [ ] Is it production-ready?

### 10. Documentation Maintenance

**Quarterly Review:**
- Review all design docs for accuracy
- Archive obsolete designs
- Update diagrams if architecture changed
- Ensure consistency across documents

**On Major Releases:**
- Verify all designs reflect current architecture
- Update version references
- Review and consolidate lessons learned

## Quick Reference

| Task                   | Location                               | Format                |
| ---------------------- | -------------------------------------- | --------------------- |
| Architecture decisions | `design/*.md`                          | Conceptual            |
| Interface definitions  | `design/*.md` or `src/*/interfaces.ts` | TypeScript interfaces |
| Implementation         | `src/**/*.ts`                          | Full TypeScript       |
| Usage examples         | `README.md` or `examples/`             | Working code          |
| API documentation      | Generated from code                    | TSDoc comments        |

## Tools

- **Mermaid**: For diagrams in design docs
- **TSDoc**: For API documentation in code
- **Markdown**: For all documentation
- **TypeScript**: For all implementation

## Contributing

1. **Start with design**: Create or update design doc
2. **Get review**: Have design reviewed before coding
3. **Implement**: Write code following the design
4. **Link back**: Reference design docs in code comments
5. **Test**: Ensure implementation matches design contracts
6. **Document**: Update README if needed (not design docs)

## Examples

See `examples/` directory for:
- Complete working examples
- Integration patterns
- Common use cases
- Best practices in action

---

*This document itself should be updated as our way of working evolves. Last updated: October 30, 2025*
