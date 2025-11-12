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

Use `tsx` to run TypeScript examples directly:

```nu
pnpm tsx examples/agent-lifecycle.ts
pnpm tsx examples/kitchen-sink.ts
pnpm tsx examples/message-stores.ts
pnpm tsx examples/artifact-scheduler.ts
pnpm tsx examples/artifact-store-type-safety.ts
pnpm tsx examples/sse-client.ts
```

## Available Examples

### 1. `agent-lifecycle.ts` ⭐ RECOMMENDED START HERE

**Status**: ✅ Complete

**Purpose**: Demonstrates the stateful Agent API for multi-turn conversations with automatic persistence.

**Features**:
- **Stateful Agent**: Manages conversation history across multiple turns
- **Real LLM Integration**: Uses LiteLLM with AWS Bedrock or OpenAI
- **Auto-save**: Automatically persists messages after each turn
- **Multiple Turns**: Demonstrates 3 conversational turns with context
- **Local Tools**: Math calculator, weather, and random numbers
- **In-Memory Storage**: Simple stores for development/testing
- **OpenTelemetry**: Optional distributed tracing support

**What it demonstrates**:
- Creating an agent with persistent state
- Executing multiple conversational turns
- Context continuity across turns
- Real LLM tool calling
- Per-turn authentication context

**To run**:
```nu
# Start LiteLLM proxy first
litellm --model gpt-3.5-turbo
# Or for AWS Bedrock
litellm --model bedrock/us.amazon.nova-micro-v1:0

# Run the example
pnpm tsx examples/agent-lifecycle.ts
```

**Key Concepts**:
- **Agent** vs **AgentLoop**: Agent manages lifecycle and state, AgentLoop executes single turns
- **contextId**: Unique identifier for a conversation session
- **MessageStore**: Persists conversation history
- **Turn-based execution**: Each `startTurn()` is one complete LLM interaction

**Design Reference**: See [design/agent-lifecycle.md](../design/agent-lifecycle.md)

### 2. `kitchen-sink.ts` ⭐ COMPLETE INTERACTIVE EXAMPLE

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
pnpm tsx examples/kitchen-sink.ts

# Resume or use specific context
pnpm tsx examples/kitchen-sink.ts --context-id my-session

# Custom agent and context IDs
pnpm tsx examples/kitchen-sink.ts --agent-id my-agent --context-id my-session
```

**What it demonstrates**:
- Complete Agent setup with all stores
- Filesystem-based persistence (FileSystemStateStore, FileSystemMessageStore, FileSystemArtifactStore)
- Interactive CLI with readline
- Multi-turn conversations with context
- Tool execution (local tools + artifact tools)
- Event handling and display
- Graceful shutdown

**Key Learning Points**:
- How all components fit together in a real application
- Filesystem store implementations for production use
- CLI interaction patterns
- Session management and resumption
- Complete agent lifecycle

**Design Reference**: This example brings together concepts from:
- [design/agent-lifecycle.md](../design/agent-lifecycle.md) - Agent and multi-turn
- [design/agent-loop.md](../design/agent-loop.md) - Single-turn execution
- [design/message-management.md](../design/message-management.md) - Message persistence
- [design/artifact-management.md](../design/artifact-management.md) - Artifact storage

### 3. `message-stores.ts`

**Status**: ✅ Complete

**Purpose**: Demonstrates different message store implementations for conversation persistence.

**Features**:
- **In-Memory Store**: Simple development/testing storage
- **AWS Bedrock Memory Store**: Managed memory with auto-summarization
- **Mem0 Store**: Multi-level intelligent memory (short/long-term, entity, user)
- **Hybrid Store**: Combines raw messages with intelligent memory
- **Real Examples**: Working code for each store type
- **Configuration**: Shows setup for each provider

**What it demonstrates**:
- Creating and using different MessageStore implementations
- Appending and retrieving messages
- Memory summarization strategies
- Multi-level memory organization
- Hybrid approaches for best of both worlds

**To run**:
```nu
pnpm tsx examples/message-stores.ts
```

**Key Learning Points**:
- When to use each message store type
- Configuring AWS Bedrock Agents Memory
- Setting up Mem0 with different memory levels
- Hybrid strategy for combining raw + intelligent memory
- How message stores integrate with Agent class

**Design Reference**: See [design/message-management.md](../design/message-management.md)

### 4. `artifact-scheduler.ts`

**Status**: ✅ Complete

**Purpose**: Demonstrates how the ArtifactScheduler solves race conditions in parallel tool execution.

**The Problem**:
When an LLM emits multiple artifact operations in a single response:
```
1. artifact_create_file(id="report")
2. artifact_append_file(id="report", chunk="...")
3. artifact_append_file(id="report", chunk="...")
```

These execute in parallel, causing operations (2) and (3) to fail because (1) hasn't finished creating the artifact yet.

**The Solution**:
`ArtifactScheduler` partitions operations by `artifactId` and executes them sequentially per partition, while allowing parallel execution across different artifacts.

**To run**:
```nu
pnpm tsx examples/artifact-scheduler.ts
```

**Key Learning Points**:
- Why artifact operations need coordination
- How the scheduler maintains correct ordering
- No manual intervention needed (Agent handles it automatically)
- Partition-based concurrency control

### 5. `artifact-store-type-safety.ts`

**Status**: ✅ Complete

**Purpose**: Demonstrates the benefits of discriminated union types for type-safe artifact operations.

**Features**:
- **Type-Safe Operations**: TypeScript enforces correct artifact types at compile time
- **Three Artifact Types**:
  - `FileArtifact` - Text/binary files with chunks and encoding
  - `DataArtifact` - Structured JSON data
  - `DatasetArtifact` - Columnar data with rows and schema
- **Type Narrowing**: Use discriminated unions to access type-specific properties

**To run**:
```nu
pnpm tsx examples/artifact-store-type-safety.ts
```

**Key Concept**:
```typescript
// Type narrowing with discriminated unions
const artifact = await store.getArtifact(contextId, artifactId);

if (artifact && artifact.type === 'file') {
  // TypeScript knows artifact has: chunks, mimeType, encoding
  const content = await store.getFileContent(contextId, artifactId);
}
```

### 6. `sse-client.ts`

**Status**: ✅ Complete

**Purpose**: Demonstrates how to consume SSE (Server-Sent Events) from a Looopy agent.

**Features**:
- **EventSource API**: Standard browser-compatible SSE client
- **Event Filtering**: Subscribe to specific event types
- **Reconnection Handling**: Automatic reconnection on disconnect
- **Progress Tracking**: Monitor task progress in real-time

**Event Types Demonstrated**:
- `task-created`, `task-status` - Task lifecycle events
- `file-write`, `content-delta` - Content streaming
- `tool-call` - Tool execution events
- `thought` - Internal reasoning (if enabled)

**To run**:
```nu
# Start the SSE server first (separate terminal)
pnpm tsx src/server/sse-server.ts

# Run the client examples
pnpm tsx examples/sse-client.ts
```

**Design References**:
- [design/agent-lifecycle.md](../design/agent-lifecycle.md) - Agent (multi-turn)
- [design/agent-loop.md](../design/agent-loop.md) - AgentLoop (single-turn)

## Example Progression

We recommend reviewing examples in this order:

1. **`agent-lifecycle.ts`** - Start here: Real LLM with multi-turn conversations ⭐
2. **`kitchen-sink.ts`** - Complete interactive CLI demonstrating all features
3. **`message-stores.ts`** - Advanced message persistence strategies
4. **`artifact-scheduler.ts`** - Understanding artifact operation coordination
5. **`artifact-store-type-safety.ts`** - Type-safe artifact operations
6. **`sse-client.ts`** - Real-time event streaming patterns

## Agent vs AgentLoop

The framework provides two APIs for different use cases:

### Agent (Multi-turn, Stateful) - RECOMMENDED

Use **Agent** when you need:
- ✅ Multi-turn conversations
- ✅ Automatic message persistence
- ✅ Session management
- ✅ Lazy initialization
- ✅ Lifecycle management (shutdown)

**Examples**: `agent-lifecycle.ts`, `kitchen-sink.ts`, `message-stores.ts`

**Design References**:
- [design/agent-lifecycle.md](../design/agent-lifecycle.md) - Agent (multi-turn)
- [design/agent-loop.md](../design/agent-loop.md) - AgentLoop (single-turn)

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

1. Review [design/agent-lifecycle.md](../design/agent-lifecycle.md) for Agent architecture
2. Check [design/artifact-management.md](../design/artifact-management.md) for artifact patterns
3. Explore [design/message-management.md](../design/message-management.md) for persistence strategies
4. Read [design/observability.md](../design/observability.md) for tracing and monitoring

## Troubleshooting

**LiteLLM Connection Errors**:
```
Error: connect ECONNREFUSED 127.0.0.1:4000
```
→ Make sure LiteLLM proxy is running on port 4000

**Artifact Race Conditions**:
```
Error: Cannot append to non-existent artifact
```
→ This is automatically handled by ArtifactScheduler (no action needed)

**Type Narrowing Issues**:
```typescript
// ❌ Wrong - TypeScript doesn't know artifact type
artifact.chunks  // Error

// ✅ Correct - Use type narrowing
if (artifact.type === 'file') {
  artifact.chunks  // OK
}
```

## Contributing Examples

When adding new examples:

1. Create descriptive filename: `{feature}.ts` (no `-agent` suffix needed)
2. Add comprehensive comments explaining each step
3. Include error handling patterns
4. Demonstrate realistic use cases
5. Add console output for visibility
6. Update this README with the new example
7. Test with `tsx examples/{your-example}.ts`
