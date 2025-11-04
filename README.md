# Looopy - Reactive AI Agent Framework

A TypeScript-based AI agent framework leveraging RxJS for asynchronous execution, built on the Agent-to-Agent (A2A) protocol for real-time streaming communication.

> **📖 Project Guidelines**: See [PROJECT.md](./PROJECT.md) for our way of working, including design/implementation separation and contribution guidelines.

## Overview

Looopy provides a reactive, extensible architecture for building AI agent systems with:

- **Multi-turn conversation management** via the Agent class
- **Single-turn execution engine** via the AgentLoop class
- **Tool execution** across multiple backends (local functions, client tools)
- **State persistence** with Redis or in-memory stores
- **Distributed tracing** with OpenTelemetry
- **A2A protocol compliance** for event streaming

## Key Features

### 🔄 Reactive Architecture
- Built on RxJS observables for powerful async control flow
- Operator-based pipeline for clean, testable execution flow
- Hot observables with shareReplay() prevent duplicate executions
- Stream-based communication enables real-time updates

### 🤖 Agent/AgentLoop Separation
- **Agent**: Multi-turn conversation manager (stateful)
  - Manages conversation history via MessageStore
  - Persists artifacts via ArtifactStore
  - Coordinates turns by calling AgentLoop
  - Lazy initialization on first turn

- **AgentLoop**: Single-turn execution engine (stateless)
  - Executes one complete reasoning cycle
  - Orchestrates LLM calls and tool execution
  - Emits A2A-compliant events
  - Supports checkpointing and resumption

### 🌐 A2A Protocol Compliance
- Events follow A2A specification (TaskEvent, StatusUpdateEvent, ArtifactUpdateEvent)
- Internal events for observability (not sent to clients)
- See [A2A_ALIGNMENT.md](./A2A_ALIGNMENT.md) for protocol details

### 🔧 Tool Support
- **Local Functions**: Direct TypeScript function execution
- **Client Tools**: Delegated execution via A2A input-required mechanism
- **MCP Support**: Planned for future integration
- Parallel execution with configurable concurrency (default: 5)

### 🔍 Observability
- OpenTelemetry integration for distributed tracing
- Nested span hierarchy (agent.turn → agent.execute → iteration → llm/tools)
- Trace context propagation through Context object
- Selective trace-level logging for span operations
- See [docs/OBSERVABILITY.md](./docs/OBSERVABILITY.md) for details

### � State Persistence
- **StateStore**: Save/restore execution state for resumption
- **ArtifactStore**: Manage conversation artifacts
- Redis and in-memory implementations
- Factory pattern for easy store creation

## Architecture

High-level architecture overview:

```
┌─────────────────────────────────────────────────────────────┐
│                        Client                               │
│                  (Future: A2A/SSE Consumer)                 │
└────────────────────┬────────────────────────────────────────┘
                     │ (A2A Server not yet implemented)
                     ▼
┌─────────────────────────────────────────────────────────────┐
│                        Agent                                │
│                   (Multi-turn Manager)                      │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  • Load message history (MessageStore)               │   │
│  │  • Call AgentLoop.startTurn(messages)                │   │
│  │  • Collect events from Observable                    │   │
│  │  • Save new messages to MessageStore                 │   │
│  │  • Lifecycle: created → ready → busy → ready         │   │
│  └──────────────────────────────────────────────────────┘   │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│                     AgentLoop                               │
│                 (Single-turn Execution)                     │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Operator Pipeline:                                  │   │
│  │    defer → tap(beforeExecute) → switchMap(runLoop)   │   │
│  │    → tap(afterExecute) → catchError → shareReplay    │   │
│  │                                                      │   │
│  │  Per Iteration:                                      │   │
│  │    • Call LLM with messages + tools                  │   │
│  │    • Execute requested tools (parallel, max 5)       │   │
│  │    • Aggregate results                               │   │
│  │    • Loop until LLM finishes or max iterations       │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐                         │
│  │ Local Tools  │  │ Client Tools │                         │
│  └──────────────┘  └──────────────┘                         │
└─────────────────────────────────────────────────────────────┘
                     │
                     │ OpenTelemetry Traces
                     ▼
┌─────────────────────────────────────────────────────────────┐
│              Observability Backend                          │
│          (Jaeger, Zipkin, OTLP Collector)                   │
└─────────────────────────────────────────────────────────────┘
```

**Span Hierarchy**:
```
agent.turn (Agent creates this)
  └─ agent.initialize (first turn only)
  └─ agent.execute (AgentLoop root span)
      ├─ iteration[0]
      │   ├─ llm.call
      │   └─ tools.execute
      │       ├─ tool[name1]
      │       └─ tool[name2]
      └─ iteration[1]...
```

**📚 Detailed Architecture**: See the `design/` directory for comprehensive architectural documentation:
- [Architecture Overview](./design/architecture.md) - System design and patterns
- [Agent Lifecycle](./design/agent-lifecycle.md) - Multi-turn conversation management
- [Agent Loop](./design/agent-loop.md) - Single-turn execution engine
- [A2A Protocol](./design/a2a-protocol.md) - Event specification (future SSE server)
- [Tool Integration](./design/tool-integration.md) - Tool provider patterns
- [Observability](./design/observability.md) - Distributed tracing details

## Quick Start

### Installation

```bash
pnpm install
```

### Basic Usage with Agent

```typescript
import { Agent, AgentConfig } from 'looopy';

// Configure agent
const config: AgentConfig = {
  agentId: 'my-agent',
  llmProvider: liteLLMProvider,
  toolProviders: [localTools],
  systemPrompt: 'You are a helpful assistant.',
  maxIterations: 10
};

// Create agent
const agent = new Agent(config);

// Start conversation turn
const events$ = await agent.startTurn('What is 2 + 2?');

// Subscribe to events
events$.subscribe({
  next: (event) => {
    if (event.kind === 'status-update' && event.final) {
      console.log('Result:', event.status.message?.content);
    }
  },
  error: (err) => console.error('Error:', err),
  complete: () => console.log('Turn complete')
});
```

### Direct AgentLoop Usage

For single-turn execution without conversation management:

```typescript
import { AgentLoop, AgentLoopConfig } from 'looopy';

// Configure loop
const config: AgentLoopConfig = {
  agentId: 'my-agent',
  llmProvider: liteLLMProvider,
  toolProviders: [localTools],
  maxIterations: 10
};

// Create loop
const loop = new AgentLoop(config);

// Execute single turn
const messages = [{ role: 'user', content: 'What is 2 + 2?' }];
const events$ = loop.startTurn(messages, {
  taskId: 'task-123',
  contextId: 'session-456'
});

// Multiple subscribers share the same execution
events$.subscribe(event => console.log(event));
events$.subscribe(event => logToFile(event));
// ↑ Both subscribers get events from a single execution (no duplicate LLM calls)
```

**Important**: The observable uses `shareReplay()`, which means:
- ✅ **Multiple subscribers share one execution** - No duplicate LLM calls or tool executions
- ✅ **Late subscribers get all events** - Subscribe after execution starts and still get all events
- ✅ **Thread-safe** - Safe to subscribe from multiple places

### State Persistence

```typescript
import { StoreFactory } from 'looopy';

// Create stores
const stateStore = StoreFactory.createStateStore({
  type: 'redis',
  redis: redisClient,
  ttl: 86400 // 24 hours
});

const artifactStore = StoreFactory.createArtifactStore({
  type: 'memory'
});

// Use in Agent
const agent = new Agent({
  agentId: 'my-agent',
  llmProvider,
  toolProviders,
  messageStore: stateStore, // For conversation history
  artifactStore
});

// Resume from checkpoint
const events$ = await AgentLoop.resume('task-123', config);
```

See [examples/](./examples/) for complete working examples.

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
│   ├── core/              # Agent, AgentLoop, and core types
│   │   ├── agent.ts       # Multi-turn conversation manager
│   │   ├── agent-loop.ts  # Single-turn execution engine
│   │   ├── operators/     # RxJS operator factories
│   │   ├── types.ts       # Core type definitions
│   │   └── config.ts      # Configuration interfaces
│   ├── stores/            # State and artifact persistence
│   │   ├── interfaces.ts  # Store interfaces
│   │   ├── factory.ts     # Store creation factory
│   │   ├── redis/         # Redis implementations
│   │   └── memory/        # In-memory implementations
│   ├── tools/             # Tool providers
│   │   ├── local-tools.ts       # Local function execution
│   │   └── client-tool-provider.ts # Client-delegated tools
│   ├── providers/         # LLM providers
│   │   └── litellm-provider.ts # LiteLLM proxy integration
│   ├── observability/     # Tracing and logging
│   │   ├── tracing.ts     # OpenTelemetry setup
│   │   └── spans/         # Span helper functions
│   └── README.md          # Implementation guide
├── design/                # Design documentation (conceptual)
│   ├── architecture.md    # System architecture
│   ├── agent-lifecycle.md # Agent class design
│   ├── agent-loop.md      # AgentLoop design
│   ├── a2a-protocol.md    # A2A event specification
│   └── ...
├── examples/              # Working code examples
│   ├── litellm-agent.ts   # Local tools example
│   ├── client-tools-agent.ts # Client tools example
│   └── README.md          # Examples guide
├── tests/                 # Test suite (103 tests)
└── docs/                  # Additional documentation
```

## Technology Stack

- **TypeScript** - Type-safe development with strict mode
- **RxJS** - Reactive programming and stream processing
- **OpenTelemetry** - Distributed tracing and observability
- **Pino** - Structured logging with selective trace-level logging
- **Vitest** - Fast unit testing framework (103 tests passing)
- **LiteLLM** - Multi-provider LLM integration
- **Redis** - State persistence (optional)
- **Server-Sent Events** - Real-time streaming (planned for A2A server)

## Development

```bash
# Install dependencies
pnpm install

# Build
pnpm build

# Run tests (103 tests)
pnpm test

# Run specific example
tsx examples/litellm-agent.ts
tsx examples/client-tools-agent.ts

# Type checking
pnpm type-check

# Linting (Biome)
pnpm lint
```

## Documentation

### Project Guidelines
- **[PROJECT.md](./PROJECT.md)** - Way of working and contribution guidelines
- **[QUICK_REFERENCE.md](./QUICK_REFERENCE.md)** - Quick guide: design vs implementation
- **[A2A_ALIGNMENT.md](./A2A_ALIGNMENT.md)** - Event type mapping and A2A protocol compliance

### Design Documentation (Conceptual)
- **[design/architecture.md](./design/architecture.md)** - Overall system architecture and patterns
- **[design/agent-lifecycle.md](./design/agent-lifecycle.md)** - Agent class design (multi-turn manager)
- **[design/agent-loop.md](./design/agent-loop.md)** - AgentLoop class design (single-turn engine)
- **[design/a2a-protocol.md](./design/a2a-protocol.md)** - A2A event specification
- **[design/tool-integration.md](./design/tool-integration.md)** - Tool provider patterns
- **[design/observability.md](./design/observability.md)** - Distributed tracing and logging
- **[design/artifact-management.md](./design/artifact-management.md)** - Artifact storage (planned)

### Implementation Documentation
- **[src/README.md](./src/README.md)** - Implementation structure and guidelines
- **[src/core/](./src/core/)** - Agent, AgentLoop, and operators
- **[src/stores/](./src/stores/)** - State and artifact storage
- **[src/tools/](./src/tools/)** - Tool provider implementations
- **[src/observability/](./src/observability/)** - Tracing and span helpers
- **[examples/](./examples/)** - Working code examples

### Additional Documentation
- **[docs/OBSERVABILITY.md](./docs/OBSERVABILITY.md)** - Detailed observability guide
- **[docs/CLIENT_TOOL_PROVIDER.md](./docs/CLIENT_TOOL_PROVIDER.md)** - Client tools guide
- **[docs/LITELLM_PROVIDER.md](./docs/LITELLM_PROVIDER.md)** - LiteLLM integration guide

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

### ✅ Completed
- [x] Core Agent class (multi-turn conversation manager)
- [x] Core AgentLoop class (single-turn execution engine)
- [x] Operator-based RxJS pipeline architecture
- [x] Local tool provider
- [x] Client tool provider with A2A input-required
- [x] LiteLLM provider integration
- [x] OpenTelemetry distributed tracing
- [x] State persistence (Redis and in-memory)
- [x] Checkpointing and resumption
- [x] A2A event types (TaskEvent, StatusUpdateEvent, ArtifactUpdateEvent)
- [x] Comprehensive test suite (103 tests)
- [x] Working examples (local tools, client tools)

### 🚧 In Progress
- [ ] Artifact management improvements
- [ ] Streaming LLM response support
- [ ] Enhanced tool result aggregation

### 📋 Planned
- [ ] A2A SSE server implementation
- [ ] MCP (Model Context Protocol) tool provider
- [ ] Sub-agent invocation as tools
- [ ] Extension hook system (beforeLLMCall, afterToolExecution, etc.)
- [ ] Advanced artifact stores (S3, filesystem backends)
- [ ] Tool execution caching
- [ ] LLM response caching
- [ ] Dynamic tool/agent discovery service
- [ ] Authentication framework enhancements
- [ ] Performance benchmarks

## Support

For questions and support, please open an issue on GitHub.
