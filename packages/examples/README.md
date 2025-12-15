# Looopy Examples

This directory contains practical examples demonstrating various features of the Looopy framework.

## Prerequisites

All examples require:

1. **LiteLLM Proxy**: Start a local LiteLLM proxy server
   ```nu
   litellm --model gpt-3.5-turbo
   ```
   Or for specific AWS Bedrock models:
   ```nu
   litellm --model bedrock/us.amazon.nova-micro-v1:0
   ```

2. **Environment Variables** (create `.env` file in project root):
   ```bash
   LITELLM_URL=http://localhost:4000
   LITELLM_API_KEY=your-api-key  # Optional, depends on your setup
   OTEL_ENABLED=false             # Set to true to enable OpenTelemetry tracing
   ```

## Running Examples

Use `tsx` to run TypeScript src directly:

```nu
pnpm tsx src/agentcore-client.ts
pnpm tsx src/agentcore-server.ts
pnpm tsx src/kitchen-sink.ts
pnpm tsx src/sse-client.ts
pnpm tsx src/sse-client2.ts
pnpm tsx src/sse-server.ts
```

## Available Examples

### 1. `kitchen-sink.ts` ⭐ COMPLETE INTERACTIVE EXAMPLE

**Status**: ✅ Complete

**Purpose**: Comprehensive interactive CLI agent demonstrating ALL framework components working together.

**Features**:
- **Interactive CLI**: Real-time conversation interface with commands
- **Filesystem Persistence**: All data stored on disk (state, messages, artifacts)
- **Agent Lifecycle**: Full multi-turn conversation management
- **Real LLM**: LiteLLM provider integration
- **Multiple Tools**: Math, weather, random numbers, and artifacts
- **Resume Support**: Continue previous conversations by context ID
- **Organized Storage**: Clean directory structure under `./_agent_store/`

**Directory Structure**:
```
./_agent_store/agent={agentId}/context={contextId}/
├── state/        # Persisted loop state (JSON files)
├── messages/     # Conversation history (timestamped)
└── artifacts/    # Created artifacts (organized by ID)
```

**Commands**:
- `/quit` or `/exit` - Shutdown agent and exit
- `/history` - View conversation history
- `/artifacts` - List created artifacts
- `/clear` - Clear conversation history

**To run**:
```nu
# New conversation (auto-generated context ID)
pnpm tsx src/kitchen-sink.ts

# Resume or use specific context
pnpm tsx src/kitchen-sink.ts --context-id my-session

# Custom agent and context IDs
pnpm tsx src/kitchen-sink.ts --agent-id my-agent --context-id my-session
```

**What it demonstrates**:
- Complete Agent setup with all stores
- Filesystem-based persistence (FileSystemStateStore, FileSystemMessageStore, FileSystemArtifactStore)
- Interactive CLI with readline
- Multi-turn conversations with context
- Tool execution (local tool plugins + artifact tools)
- Event handling and display
- Graceful shutdown

**Key Learning Points**:
- How all components fit together in a real application
- Filesystem store implementations for production use
- CLI interaction patterns
- Session management and resumption
- Complete agent lifecycle

**Design Reference**: This example brings together concepts from:
- [design/agent-lifecycle.md](../../design/agent-lifecycle.md) - Agent and multi-turn
- [design/agent-loop.md](../../design/agent-loop.md) - Single-turn execution
- [design/message-management.md](../../design/message-management.md) - Message persistence
- [design/artifact-management.md](../../design/artifact-management.md) - Artifact storage

### 2. `agentcore-server.ts` ⭐ LOCAL AGENTCORE RUNTIME

**Status**: ✅ Complete

**Purpose**: Run a Looopy Agent behind the AWS Bedrock AgentCore runtime HTTP contract so you can iterate on AgentCore “skills” completely locally.

**Features**:
- **AWS-compatible endpoints**: Implements `/ping` and `/invocation` with SSE streaming, mirroring AgentCore’s expectations (busy responses, health checks, and JSON validation).
- **Session-aware Agents**: Validates `X-Amzn-Bedrock-AgentCore-Runtime-Session-Id`, lazily creates an Agent per session, and prevents cross-session collisions.
- **Shared configuration**: Uses the filesystem stores, prompts, and tool plugins defined in `src/configs/basic.ts`, so artifacts/messages land under `_agent_store/`.
- **Instrumentation ready**: Automatically respects OTEL/logging env vars and writes structured logs per context to `logger.jsonl`.

**How to use**:
1. Start LiteLLM (Bedrock or OpenAI) as outlined in the prerequisites.
2. Launch the runtime:
   ```nu
   pnpm tsx src/agentcore-server.ts
   # Listens on http://localhost:8080 by default
   ```
3. Send prompts with the bundled client or curl:
   ```bash
   curl -N \
     -H 'Accept: text/event-stream' \
     -H 'X-Amzn-Bedrock-AgentCore-Runtime-Session-Id: ctx-1234' \
     -d '{"prompt": "Plan a Seattle day trip"}' \
     http://localhost:8080/invocation
   ```

**Design Reference**: [docs/providers.md](../../docs/providers.md) (AgentCore runtime overview)

### 3. `agentcore-client.ts` ⭐ STREAMING CLIENT

**Status**: ✅ Complete

**Purpose**: Minimal Node.js client that exercises the AgentCore-compatible server and surfaces the SSE event stream in your terminal.

**Features**:
- **Single-command prompts**: Pass a prompt via CLI argument (default message provided).
- **Required headers**: Automatically sets `X-Amzn-Bedrock-AgentCore-Runtime-Session-Id` and `Accept: text/event-stream`.
- **Rich event logging**: Uses `@geee-be/sse-stream-parser` to decode events and prints icons for tasks, tool activity, reasoning, and streaming deltas.
- **Reusable client**: Point `fetch` at a real AgentCore endpoint to debug managed runtimes with the same tool.

**To run**:
```nu
pnpm tsx src/agentcore-client.ts "Summarize the meeting in bullet points"
```

### 4. `sse-server.ts` ⭐ STREAMING BACKEND REFERENCE

**Status**: ✅ Complete

**Purpose**: Stand-alone SSE backend demonstrating how to wire `SSEServer` to an Agent and expose every event over HTTP.

**Features**:
- **Hono + SSEServer**: Lightweight Node server (port 3000) with a `POST /sse/:contextId` endpoint that emits every Agent event over the same request.
- **Filesystem persistence**: Stores state, messages, and artifacts just like `kitchen-sink.ts`, enabling deep inspection.
- **Tool + artifact support**: Shares the same calculator/weather/random tools and artifact plugins as other examples.
- **Multi-subscriber fan-out**: `SSEServer` allows multiple listeners to subscribe to the same context.

**To run**:
```nu
pnpm tsx src/sse-server.ts
# Then post a message (keep the connection open to watch live events)
curl -N \
  -H 'Accept: text/event-stream' \
  -d '{"message":"Solve a word problem"}' \
  http://localhost:3000/sse/ctx-user-123
```

### 5. `sse-client.ts` ⭐ EVENTSOURCE RECIPES

**Status**: ✅ Complete

**Purpose**: A collection of EventSource recipes that show how to consume the SSE stream from Node or the browser.

**Highlights**:
- Seven ready-to-run examples: basic streaming, task filtering, reconnection with `Last-Event-ID`, progress tracking, multi-event subscriptions, error handling with retries, and client-side filtering of “internal” events.
- Uses the standard `eventsource` polyfill so the code mirrors browser EventSource usage.
- Each example logs structured summaries of the events it receives, making it easy to extend for your UI.

**To run**:
1. Start `pnpm tsx src/sse-server.ts` in another terminal.
2. Open `src/sse-client.ts` and uncomment the example you want to run in `main()`.
3. Execute:
   ```nu
   pnpm tsx src/sse-client.ts
   ```

### 6. `sse-client2.ts` ⭐ STREAM-PARSER TERMINAL CLIENT

**Status**: ✅ Complete

**Purpose**: Ultra-light CLI client that talks to `sse-server.ts` (or any SSE endpoint) using `@geee-be/sse-stream-parser` for low-level control.

**Features**:
- Accepts the outgoing message as a CLI argument and posts to `http://localhost:3000/sse/ctx-user-123`.
- Streams every SSE event and prints emoji-coded summaries for tasks, tools, thought streams, and content deltas.
- Keeps the example dependency graph tiny—perfect for embedding into integration tests or smoke checks.

**To run**:
```nu
pnpm tsx src/sse-client2.ts "Draft an email inviting the team to lunch"
```

### Supporting Modules

- `src/configs/basic.ts` centralizes shared stores, prompts, and tool plugins so every example behaves consistently. Tweak it to point at different storage backends or tool sets.
- `src/tools/` contains the calculator, random number, and weather tools that power the examples. Copy these as starting points for your own tool plugins.

## Example Progression

We recommend reviewing examples in this order:

1. **`kitchen-sink.ts`** - Get familiar with the Agent, stores, and tools in an interactive CLI.
2. **`sse-server.ts`** - Learn how to expose every Agent event over HTTP + SSE.
3. **`sse-client.ts`** - Explore different EventSource patterns against the streaming server.
4. **`sse-client2.ts`** - See a minimal CLI client that uses a streaming parser.
5. **`agentcore-server.ts`** - Reuse the same Agent in an AWS AgentCore-compatible runtime.
6. **`agentcore-client.ts`** - Exercise the AgentCore runtime with a purpose-built SSE client.

## Agent vs AgentLoop

The framework provides two APIs for different use cases:

### Agent (Multi-turn, Stateful) - RECOMMENDED

Use **Agent** when you need:
- ✅ Multi-turn conversations
- ✅ Automatic message persistence
- ✅ Session management
- ✅ Lazy initialization
- ✅ Lifecycle management (shutdown)

All examples in this package (`kitchen-sink.ts`, `sse-server.ts`, and `agentcore-server.ts`) rely on `Agent` because they showcase persistence, tooling, and observability together.

### runLoop (Single-turn, Stateless)

Use **`runLoop`** when you only need a single LLM turn, no persistence, and low-latency orchestration (e.g., Lambda functions or smoke tests). There is no dedicated `runLoop` example in `packages/examples` right now, but the design guide below explains how to adapt the Agent code to use `runLoop` directly.

**Design References**:
- [design/agent-lifecycle.md](../../design/agent-lifecycle.md) - Agent (multi-turn)
- [design/agent-loop.md](../../design/agent-loop.md) - runLoop (single-turn)

## OpenTelemetry Tracing

All examples support optional OpenTelemetry tracing. Enable by setting:

```bash
OTEL_ENABLED=true
```

This provides distributed tracing across:
- Agent loop iterations
- LLM calls
- Tool executions
- State persistence operations

## Error Handling

Examples demonstrate comprehensive error handling:

1. **Tool Validation Errors**: Caught at initialization
   ```typescript
   try {
     const provider = new ClientToolProvider({ tools });
   } catch (error) {
     console.error('Invalid tool definitions:', error);
   }
   ```

2. **Execution Errors**: Handled gracefully
   ```typescript
   return {
     success: false,
     error: 'Tool execution failed: timeout'
   };
   ```

3. **LLM Errors**: Logged and propagated
   ```typescript
   events$.subscribe({
     error: (err) => console.error('Agent error:', err)
   });
   ```

## Best Practices

Based on the examples:

1. **Start with Agent**: Use the Agent API for most use cases (multi-turn conversations)
2. **Use Type Safety**: Leverage discriminated unions for artifact types
3. **Handle Errors**: Add proper error handling in tools and event subscriptions
4. **Enable Tracing**: Set `OTEL_ENABLED=true` for debugging and monitoring
5. **Persist State**: Use appropriate stores (FileSystem for production, InMemory for dev)
6. **Test Interactively**: Use `kitchen-sink.ts` as a template for CLI applications

## Next Steps

After reviewing the examples:

1. Review [design/agent-lifecycle.md](../../design/agent-lifecycle.md) for Agent architecture
2. Check [design/artifact-management.md](../../design/artifact-management.md) for artifact patterns
3. Explore [design/message-management.md](../../design/message-management.md) for persistence strategies
4. Read [design/observability.md](../../design/observability.md) for tracing and monitoring

## Troubleshooting

**LiteLLM Connection Errors**:
```
Error: connect ECONNREFUSED 127.0.0.1:4000
```
→ Make sure LiteLLM proxy is running on port 4000

**Missing AgentCore Session Header**:
```
Error: Missing X-Amzn-Bedrock-AgentCore-Runtime-Session-Id header
```
→ Include the header when calling `/invocation` (the CLI client does this automatically). Use a unique context ID per concurrent session.

**Agent Busy / Session Conflicts**:
```
Error: Agent is currently busy
Error: Another session is active
```
→ The AgentCore runtime only handles one session at a time. Wait for the current session to finish, or restart the server to clear state.

**SSE Connection Closes Immediately**:
```
curl: (18) transfer closed with outstanding read data remaining
```
→ Ensure `Accept: text/event-stream` is set and keep the connection open. Verify that `sse-server.ts` is running and that the JSON body contains a `message` string.

**No Events Received In Clients**:
- Confirm the SSE server log shows task creation events.
- Double-check the `contextId` in the request URL matches the one used by the server.
- For `sse-client.ts`, make sure the example you want is uncommented in `main()`.

## Contributing Examples

When adding new examples:

1. Create descriptive filename: `{feature}.ts` (no `-agent` suffix needed)
2. Add comprehensive comments explaining each step
3. Include error handling patterns
4. Demonstrate realistic use cases
5. Add console output for visibility
6. Update this README with the new example
7. Test with `tsx src/{your-example}.ts`
