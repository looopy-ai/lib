# Loopy - Reactive AI Agent Framework

A TypeScript-based AI agent framework leveraging RxJS for asynchronous tool execution, agent orchestration, and real-time communication using Agent-to-Agent (A2A) Server-Sent Events (SSE) protocol.

> **📖 Project Guidelines**: See [PROJECT.md](./PROJECT.md) for our way of working, including design/implementation separation and contribution guidelines.

## Overview

Looopy provides a reactive, extensible architecture for building AI agent systems that can:

- Execute tool calls across multiple backends (local functions, MCP, client tools)
- Orchestrate hierarchical agent workflows with streaming updates
- Support dynamic tool and agent discovery
- Provide distributed tracing and observability
- Enable flexible authentication passthrough

## Key Features

### 🔄 Reactive Architecture
- Built on RxJS observables for powerful async control flow
- Stream-based communication enables real-time updates
- Composable agent pipelines with backpressure handling

### 🌐 Agent-to-Agent (A2A) Protocol
- SSE-based streaming communication
- Hierarchical task tracking with namespaced IDs
- Sub-agent invocation with transparent update propagation
- Client tool invocation via `input-required` mechanism

### 🔧 Multi-Backend Tool Support
- **Local Functions**: Direct TypeScript function calls
- **MCP (Model Context Protocol)**: Integration with MCP servers
- **Client Tools**: Delegated execution via A2A input-required

### 🔍 Observability
- OpenTelemetry integration for distributed tracing
- Trace context propagation across agent boundaries
- Comprehensive span creation for tools and agents
- OTLP export to Jaeger, Zipkin, or custom collectors
- See [docs/OBSERVABILITY.md](./docs/OBSERVABILITY.md) for details

### 🔌 Extensibility
- Extension point hooks throughout the execution pipeline
- Dynamic tool and agent registration
- Pluggable authentication strategies

### 🔐 Authentication Passthrough
- Raw credential forwarding
- Token re-issuance for external services
- Configurable auth strategies per tool/agent

## Architecture

High-level architecture overview:

```
┌─────────────────────────────────────────────────────────────┐
│                        Client                               │
│                     (A2A/SSE Consumer)                      │
└────────────────────┬────────────────────────────────────────┘
                     │ SSE Stream
                     │ (task updates, sub-agent events)
                     ▼
┌─────────────────────────────────────────────────────────────┐
│                     Looopy Loop                            │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  LLM Request → Tool Calls → Execute → Response       │   │
│  │       ▲                         │                    │   │
│  │       └─────────────────────────┘                    │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │ Local Tools  │  │  MCP Tools   │  │ Client Tools │       │
│  └──────────────┘  └──────────────┘  └──────────────┘       │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │        Sub-Agent Invocation (nested A2A)             │   │
│  │     Updates: sub-agent/task-id namespace             │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                     │
                     │ OpenTelemetry Traces
                     ▼
┌─────────────────────────────────────────────────────────────┐
│              Observability Backend                          │
│          (Jaeger, Zipkin, OTLP Collector)                   │
└─────────────────────────────────────────────────────────────┘
```

**📚 Detailed Architecture**: See the `design/` directory for comprehensive architectural documentation:
- [Core Agent Loop](./design/agent-loop.md) - Reactive execution model
- [A2A Protocol](./design/a2a-protocol.md) - SSE streaming communication
- [Tool Integration](./design/tool-integration.md) - Multi-backend tool support
- [Observability](./design/observability.md) - Distributed tracing
- [Authentication](./design/authentication.md) - Auth passthrough strategies

## Quick Start

### Installation

```bash
pnpm install
```

### Basic Usage

For complete working examples, see the [examples/](./examples/) directory.

```typescript
import { AgentLoop, StoreFactory } from 'looopy';

// Create stores
const stateStore = StoreFactory.createStateStore({ type: 'redis', redis });
const artifactStore = StoreFactory.createArtifactStore({ type: 'redis', redis });

// Initialize agent loop
const agent = new AgentLoop({
  stateStore,
  artifactStore,
  // ... configuration
});

// Execute
const result$ = agent.execute(prompt, context);
result$.subscribe(event => console.log(event));

// Multiple subscribers share the same execution (no duplicate runs)
result$.subscribe(event => logToFile(event));
result$.subscribe(event => sendToUI(event));
// ↑ All three subscribers get the same events from a single execution
```

**Important**: The observable returned by `execute()` uses `shareReplay()`, which means:
- ✅ **Multiple subscribers share one execution** - No duplicate LLM calls or tool executions
- ✅ **Late subscribers get all events** - Subscribe after execution starts and still get all events
- ✅ **Thread-safe** - Safe to subscribe from multiple places in your code

See [Quick Start Guide](./examples/quick-start.md) for detailed setup.

## Examples

The [examples/](./examples/) directory contains practical demonstrations of framework features:

### 🧮 **[litellm-agent.ts](./examples/litellm-agent.ts)** - Local Tools
Demonstrates server-side tool execution with:
- LiteLLM provider (AWS Bedrock Nova Micro)
- Local calculator and random number tools
- OpenTelemetry tracing integration
- In-memory state storage

**Run**: `tsx examples/litellm-agent.ts`

### 🌐 **[client-tools-agent.ts](./examples/client-tools-agent.ts)** - Hybrid Tools
Demonstrates combining local and client tools:
- **Local tools** (server-side): Math operations, weather lookup
- **Client tools** (client-side): User search, order history, profiles
- Zod validation for client tool definitions
- A2A input-required flow simulation
- Multiple test scenarios

**Run**: `tsx examples/client-tools-agent.ts`

**Key Features**:
- ✅ `ClientToolProvider` with runtime validation
- ✅ Hybrid architecture (local + client tools)
- ✅ A2A protocol integration
- ✅ Comprehensive error handling

**Learn More**: See [examples/README.md](./examples/README.md) and [docs/CLIENT_TOOL_PROVIDER.md](./docs/CLIENT_TOOL_PROVIDER.md)

### Usage Patterns

**Local Tools** execute on the server:
```typescript
class LocalToolProvider implements ToolProvider {
  async execute(toolCall: ToolCall): Promise<ToolResult> {
    const result = performCalculation(args);
    return { success: true, result };
  }
}
```

**Client Tools** delegate to client via A2A:
```typescript
const clientTools = new ClientToolProvider({
  tools: clientToolDefinitions,  // Validated with Zod
  onInputRequired: async (toolCall) => {
    // Trigger input-required state, wait for client response
    return clientResult;
  },
});
```

**Combine Both** in a single agent:
```typescript
const agent = new AgentLoop({
  toolProviders: [localTools, clientTools],
  // ...
});
```

See [examples/client-tools-agent.ts](./examples/client-tools-agent.ts) for a complete working example.

## Documentation

- [Architecture Overview](./design/architecture.md)
- [Agent Loop Design](./design/agent-loop.md)
- [A2A Protocol Specification](./design/a2a-protocol.md)
- [Tool Integration](./design/tool-integration.md)
- [Authentication & Security](./design/authentication.md)
- [Observability & Tracing](./design/observability.md)
- [Extension Points](./design/extension-points.md)
- [Dynamic Discovery](./design/dynamic-discovery.md)

## Project Structure

```
looopy/
├── src/
│   ├── core/              # Core agent loop and orchestration
│   ├── a2a/               # A2A protocol implementation
│   ├── tools/             # Tool providers (local, MCP, client)
│   ├── agents/            # Agent registry and invocation
│   ├── telemetry/         # OpenTelemetry integration
│   ├── auth/              # Authentication strategies
│   ├── extensions/        # Extension point framework
│   └── discovery/         # Dynamic tool/agent discovery
├── design/                # Design documentation
├── examples/              # Usage examples
└── tests/                 # Test suite
```

## Technology Stack

- **TypeScript** - Type-safe development
- **RxJS** - Reactive programming and stream processing
- **OpenTelemetry** - Distributed tracing and metrics
- **Server-Sent Events** - Real-time streaming communication
- **MCP Protocol** - Model Context Protocol integration
- **Express/Fastify** - HTTP server framework

## Development

```bash
# Install dependencies
pnpm install

# Build
pnpm build

# Run tests
pnpm test

# Run examples
pnpm example:basic
```

## Documentation

### Project Guidelines
- **[PROJECT.md](./PROJECT.md)** - Way of working and contribution guidelines
- **[QUICK_REFERENCE.md](./QUICK_REFERENCE.md)** - Quick guide: design vs implementation

### Design Documentation (Conceptual)
- **[design/architecture.md](./design/architecture.md)** - Overall system architecture
- **[design/agent-loop.md](./design/agent-loop.md)** - Core agent execution loop
- **[design/a2a-protocol.md](./design/a2a-protocol.md)** - A2A SSE protocol specification
- **[design/tool-integration.md](./design/tool-integration.md)** - Tool provider patterns
- **[design/authentication.md](./design/authentication.md)** - Auth strategies
- **[design/observability.md](./design/observability.md)** - Distributed tracing
- **[design/extension-points.md](./design/extension-points.md)** - Extension system
- **[design/dynamic-discovery.md](./design/dynamic-discovery.md)** - Service discovery

### Implementation Documentation
- **[src/README.md](./src/README.md)** - Implementation structure and guidelines
- **[src/stores/](./src/stores/)** - State and artifact storage
- **[src/tools/](./src/tools/)** - Tool provider implementations
- **[src/a2a/](./src/a2a/)** - A2A protocol implementation
- **[examples/](./examples/)** - Working code examples

### Refactoring Resources
- **[DESIGN_IMPLEMENTATION_SEPARATION.md](./DESIGN_IMPLEMENTATION_SEPARATION.md)** - Separation strategy summary
- **[REFACTOR_PLAN.md](./REFACTOR_PLAN.md)** - Detailed extraction plan

## Contributing

Please read [PROJECT.md](./PROJECT.md) for our way of working before contributing.

Key principles:
- Documentation-first approach
- Design docs are conceptual (interfaces, patterns, rationale)
- Implementation is in `src/` with full code
- Link implementations back to design docs in comments

## License

ISC

## Roadmap

- [ ] Core agent loop implementation
- [ ] A2A SSE server implementation
- [ ] Local tool provider
- [ ] MCP tool provider
- [ ] Client tool provider
- [ ] OpenTelemetry integration
- [ ] Dynamic discovery service
- [ ] Authentication framework
- [ ] Extension point system
- [ ] Example implementations
- [ ] Comprehensive test suite
- [ ] Performance benchmarks

## Support

For questions and support, please open an issue on GitHub.
