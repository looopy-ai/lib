# Implementation

This directory contains the actual implementation code for the Looopy framework.

## Structure

```
src/
├── core/              # Core agent loop implementation
│   ├── interfaces.ts  # Core interfaces and types
│   ├── agent-loop.ts  # Main agent execution loop
│   └── checkpoint.ts  # State checkpointing logic
│
├── stores/            # State and artifact persistence
│   ├── interfaces.ts  # StateStore, ArtifactStore interfaces
│   ├── redis/         # Redis implementations
│   ├── memory/        # In-memory implementations
│   └── factory.ts     # Store factory
│
├── tools/             # Tool integration
│   ├── interfaces.ts  # ToolProvider interface
│   ├── local/         # Local function tools
│   ├── mcp/           # MCP client integration
│   └── client/        # Client tool delegation
│
├── a2a/               # A2A protocol implementation
│   ├── server.ts      # SSE server
│   ├── client.ts      # SSE client
│   └── types.ts       # A2A message types
│
├── observability/     # OpenTelemetry integration
│   ├── tracer.ts      # Trace setup
│   └── metrics.ts     # Metrics setup
│
├── auth/              # Authentication
│   ├── interfaces.ts  # Auth strategy interfaces
│   └── strategies/    # Auth implementations
│
├── extensions/        # Extension points
│   └── hooks.ts       # Extension hook system
│
└── discovery/         # Dynamic discovery
    └── registry.ts    # Tool/agent registry
```

## Design Reference

All code in this directory implements the designs in `/design`:

| Implementation       | Design Document                                               |
| -------------------- | ------------------------------------------------------------- |
| `core/agent-loop.ts` | [design/agent-loop.md](../design/agent-loop.md)               |
| `stores/*`           | [design/agent-loop.md#persistence](../design/agent-loop.md)   |
| `a2a/*`              | [design/a2a-protocol.md](../design/a2a-protocol.md)           |
| `tools/*`            | [design/tool-integration.md](../design/tool-integration.md)   |
| `auth/*`             | [design/authentication.md](../design/authentication.md)       |
| `observability/*`    | [design/observability.md](../design/observability.md)         |
| `extensions/*`       | [design/extension-points.md](../design/extension-points.md)   |
| `discovery/*`        | [design/dynamic-discovery.md](../design/dynamic-discovery.md) |

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
