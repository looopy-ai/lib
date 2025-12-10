# Implementation

This directory contains the actual implementation code for the Looopy framework.

## Structure

```
src/
├── core/                      # Agent orchestration (Agent, loop, logger, iteration)
├── events/                    # Event factories and utilities
├── observability/             # OpenTelemetry spans and logging helpers
├── plugins/                   # Plugin system (system prompts)
├── providers/                 # LLM providers (LiteLLM) and chat-completion helpers
├── server/                    # HTTP runtime helpers (SSE, event routing, shutdown)
├── skills/                    # Agent skills registry and management
├── stores/                    # Message, agent-state, artifact stores (in-memory, filesystem, etc.)
├── tools/                     # Tool plugins (local, client, MCP, agent) and helpers
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
| `core/agent.ts`              | [design/agent-lifecycle.md](../../../design/agent-lifecycle.md)          |
| `core/loop.ts`               | [design/agent-loop.md](../../../design/agent-loop.md)                    |
| `core/iteration.ts`          | [design/agent-loop.md](../../../design/agent-loop.md)                    |
| `core/logger.ts`             | [design/observability.md](../../../design/observability.md)              |
| `stores/*`                   | [design/agent-loop.md](../../../design/agent-loop.md)                    |
| `stores/artifacts/*`         | [design/artifact-management.md](../../../design/artifact-management.md)  |
| `stores/messages/*`          | [design/message-management.md](../../../design/message-management.md)   |
| `tools/*`                    | [design/tool-integration.md](../../../design/tool-integration.md)        |
| `providers/litellm-provider` | [design/agent-loop.md](../../../design/agent-loop.md)                    |
| `providers/chat-completions` | [design/streaming-architecture.md](../../../design/streaming-architecture.md) |
| `server/*`                   | [design/internal-event-protocol.md](../../../design/internal-event-protocol.md) |
| `observability/*`            | [design/observability.md](../../../design/observability.md)              |
| `skills/*`                   | [design/extension-points.md](../../../design/extension-points.md)        |
| `a2a/*` (planned)            | [design/a2a-protocol.md](../../../design/a2a-protocol.md)                |
| `auth/*` (planned)           | [design/authentication.md](../../../design/authentication.md)            |
| `extensions/*` (planned)     | [design/extension-points.md](../../../design/extension-points.md)        |
| `discovery/*` (planned)      | [design/dynamic-discovery.md](../../../design/dynamic-discovery.md)      |

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

## Key Exports

The main exports from this package include:

- **Agent**: The main `Agent` class for multi-turn conversations
- **runLoop**: The core loop execution function (used internally by Agent)
- **Stores**: `FileSystemAgentStore`, `FileSystemMessageStore`, `FileSystemArtifactStore`, `FileSystemContextStore`, `FileSystemStateStore`, and in-memory alternatives
- **Providers**: `LiteLLMProvider` for LLM integration
- **Tools**: `localTools`, `mcp`, `AgentToolProvider`, `createArtifactTools` for tool plugins
- **Plugins**: `literalPrompt`, `asyncPrompt` for system prompt injection
- **Server**: `SSEServer`, `EventRouter`, `EventBuffer` for HTTP/SSE streaming
- **Observability**: OpenTelemetry tracing and structured logging via pino
