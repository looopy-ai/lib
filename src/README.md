# Implementation

This directory contains the actual implementation code for the Looopy framework.

## Structure

```
src/
├── core/                      # Core agent implementation
│   ├── agent.ts               # Multi-turn conversation manager (stateful)
│   ├── agent-loop.ts          # Single-turn execution engine (stateless)
│   ├── operators/             # RxJS operator factories
│   │   ├── execute-operators.ts    # Root span management
│   │   ├── iteration-operators.ts  # Iteration loop
│   │   └── llm-operators.ts        # LLM calls and responses
│   ├── types.ts               # Core type definitions
│   ├── config.ts              # Configuration interfaces
│   ├── logger.ts              # Pino logger setup
│   ├── cleanup.ts             # State cleanup service
│   ├── events.ts              # Event helper utilities
│   ├── sanitize.ts            # Input sanitization
│   └── index.ts               # Exports
│
├── stores/                    # State and artifact persistence
│   ├── interfaces.ts          # StateStore, ArtifactStore interfaces
│   ├── factory.ts             # Store creation factory
│   ├── redis/                 # Redis implementations
│   │   └── redis-state-store.ts
│   ├── memory/                # In-memory implementations
│   │   └── memory-state-store.ts
│   └── artifacts/             # Artifact store implementations
│       ├── memory-artifact-store.ts
│       ├── artifact-store-with-events.ts
│       └── index.ts
│
├── tools/                     # Tool integration
│   ├── interfaces.ts          # ToolProvider interface
│   ├── local-tools.ts         # Local function tools
│   ├── client-tool-provider.ts # Client-delegated tools
│   ├── artifact-tools.ts      # Artifact management tools
│   └── index.ts               # Exports
│
├── providers/                 # LLM providers
│   ├── litellm-provider.ts    # LiteLLM proxy integration
│   └── index.ts               # Exports
│
└── observability/             # Tracing and logging
    ├── tracing.ts             # OpenTelemetry setup
    ├── spans/                 # Span helper functions
    │   └── agent-turn.ts
    └── index.ts               # Exports
```

## Not Yet Implemented

The following directories from the design docs are planned but not yet implemented:

```
├── a2a/                       # A2A protocol (planned)
│   ├── server.ts              # SSE server
│   └── client.ts              # SSE client
│
├── auth/                      # Authentication (planned)
├── extensions/                # Extension points (planned)
└── discovery/                 # Dynamic discovery (planned)
```

## Design Reference

All code in this directory implements the designs in `/design`:

| Implementation               | Design Document                                                     |
| ---------------------------- | ------------------------------------------------------------------- |
| `core/agent.ts`              | [design/agent-lifecycle.md](../design/agent-lifecycle.md)          |
| `core/agent-loop.ts`         | [design/agent-loop.md](../design/agent-loop.md)                    |
| `core/operators/*`           | [design/agent-loop.md](../design/agent-loop.md)                    |
| `stores/*`                   | [design/agent-loop.md](../design/agent-loop.md)                    |
| `stores/artifacts/*`         | [design/artifact-management.md](../design/artifact-management.md)  |
| `tools/*`                    | [design/tool-integration.md](../design/tool-integration.md)        |
| `providers/litellm-provider` | [design/agent-loop.md](../design/agent-loop.md)                    |
| `observability/*`            | [design/observability.md](../design/observability.md)              |
| `a2a/*` (planned)            | [design/a2a-protocol.md](../design/a2a-protocol.md)                |
| `auth/*` (planned)           | [design/authentication.md](../design/authentication.md)            |
| `extensions/*` (planned)     | [design/extension-points.md](../design/extension-points.md)        |
| `discovery/*` (planned)      | [design/dynamic-discovery.md](../design/dynamic-discovery.md)      |

## Code Style

- Use TypeScript strict mode
- Include JSDoc comments for public APIs
- Reference design documents in comments where appropriate:
  ```typescript
  // Implementation of checkpoint strategy
  // See: design/agent-loop.md#checkpointing-during-execution
  ```

## Testing

Tests are located in `/tests` and mirror this structure. Each module should have:
- Unit tests for individual functions/classes
- Integration tests for cross-module interactions
- Interface compliance tests against design specs
