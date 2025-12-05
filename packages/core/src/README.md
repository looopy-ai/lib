# Implementation

This directory contains the actual implementation code for the Looopy framework.

## Structure

```
src/
├── core/                      # Agent orchestration (Agent, loop, logger)
├── events/                    # Event factories and utilities
├── observability/             # OpenTelemetry spans and logging helpers
├── providers/                 # LLM providers (LiteLLM) and chat-completion helpers
├── server/                    # HTTP runtime helpers (serve entrypoints)
├── stores/                    # Message, agent-state, artifact stores (in-memory, filesystem, etc.)
├── tools/                     # Tool plugins (local, client, MCP) and helpers
├── types/                     # Shared types for events, messages, tools, context
└── utils/                     # Shared utilities (error serialization, system prompt helpers)
```

## Not Yet Implemented

The following directories from the design docs are planned but not yet implemented:

```
- a2a protocol support (planned)
- authentication hooks (planned)
- dynamic discovery and extension points (planned)
```

## Design Reference

All code in this directory implements the designs in `/design`:

| Implementation               | Design Document                                                     |
| ---------------------------- | ------------------------------------------------------------------- |
| `core/agent.ts`              | [design/agent-lifecycle.md](../design/agent-lifecycle.md)          |
| `core/agent-loop.ts`         | [design/agent-loop.md](../design/agent-loop.md)                    |
| `core/*`                     | [design/agent-lifecycle.md](../design/agent-lifecycle.md)          |
| `core/loop.ts`, `core/iteration.ts` | [design/agent-loop.md](../design/agent-loop.md)             |
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
