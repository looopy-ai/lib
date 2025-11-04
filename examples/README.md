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
pnpm tsx examples/basic-agent.ts
pnpm tsx examples/agent-lifecycle.ts
pnpm tsx examples/litellm-agent.ts
pnpm tsx examples/client-tools-agent.ts
pnpm tsx examples/artifacts-agent.ts
pnpm tsx examples/litellm-artifacts-agent.ts
pnpm tsx examples/message-stores.ts
```

## Available Examples

### 1. `basic-agent.ts`

**Status**: ✅ Complete

**Purpose**: Minimal AgentLoop example with simulated LLM demonstrating core single-turn execution.

**Features**:
- **Simple LLM Provider**: Mock provider that simulates tool calls
- **Local Tools**: Weather tool integration
- **AgentLoop API**: Single-turn execution pattern
- **In-Memory Storage**: State and artifact stores
- **Basic Event Handling**: Subscribe to agent events

**What it demonstrates**:
- Creating an AgentLoop with minimal configuration
- Simulated LLM responses and tool calls
- Tool execution flow
- Event subscription pattern
- Single-turn completion

**To run**:
```nu
pnpm tsx examples/basic-agent.ts
```

**Key Concepts**:
- **AgentLoop**: Single-turn execution engine (stateless)
- **LLMProvider**: Interface for LLM integration
- **ToolProvider**: Interface for tool execution
- **Observable Events**: RxJS-based event streaming

**Design Reference**: See [design/agent-loop.md](../design/agent-loop.md)

### 2. `agent-lifecycle.ts` ⭐ RECOMMENDED

**Status**: ✅ Complete

**Purpose**: Demonstrates the stateful Agent API for multi-turn conversations with automatic persistence.

**Features**:
- **Stateful Agent**: Manages conversation history across multiple turns
- **Auto-save**: Automatically persists messages after each turn
- **Pause/Resume**: Save agent state and resume later
- **Multi-turn Context**: Each turn has access to full conversation history
- **Message Stores**: In-memory storage (easily swappable with Redis, Bedrock, etc.)
- **Lifecycle Management**: start(), pause(), shutdown()

**What it demonstrates**:
- Creating an agent with persistent state
- Executing multiple conversational turns
- Pausing and resuming conversations
- Viewing conversation history
- Context continuity across turns

**To run**:
```nu
pnpm tsx examples/agent-lifecycle.ts
```

**Key Concepts**:
- **Agent** vs **AgentLoop**: Agent manages lifecycle and state, AgentLoop executes single turns
- **contextId**: Unique identifier for a conversation session
- **MessageStore**: Persists conversation history
- **Turn-based execution**: Each `startTurn()` is one complete LLM interaction

**Design Reference**: See [design/agent-lifecycle.md](../design/agent-lifecycle.md)

### 3. `litellm-agent.ts`

**Status**: ✅ Complete

**Purpose**: Demonstrates AgentLoop with local tools using real LiteLLM provider.

**Features**:
- **LiteLLM Provider**: Real LLM integration (AWS Bedrock, OpenAI, etc.)
- **Local Tools**: Calculator and random number generator
- **Server-side Execution**: Tools execute directly on the server
- **OpenTelemetry**: Optional tracing support
- **State Persistence**: In-memory state store
- **Error Handling**: Comprehensive try/catch patterns

**Tools Provided**:
- `calculate` - Evaluate mathematical expressions
- `get_random_number` - Generate random numbers in a range

**Key Learning Points**:
- How to use the LiteLLM provider with real models
- Implementing local tool providers
- Tool parameter validation with JSON Schema
- Server-side tool execution pattern
- Real LLM interaction with tool calling

**Run**:
```nu
pnpm tsx examples/litellm-agent.ts
```

### 4. `client-tools-agent.ts`

**Status**: ✅ Complete

**Purpose**: Demonstrates artifact creation and streaming with A2A event emission using a simple mock LLM.

**Features**:
- Artifact creation and multi-part updates
- A2A protocol event emission
- Event-driven architecture with decorator pattern
- In-memory artifact storage
- Artifact tools (artifact_update, list_artifacts, get_artifact)
- Mock LLM for demonstration purposes

**What it does**:
- Creates an artifact with multiple parts
- Streams artifact updates as A2A events
- Shows how to subscribe to artifact changes
- Demonstrates the Store-First Architecture

**To run**:
```nu
pnpm tsx examples/artifacts-agent.ts
```

**Key concepts**:
- **ArtifactStoreWithEvents**: Decorator that automatically emits A2A events
- **createArtifactTools()**: Provides artifact manipulation tools for agents
- **artifact-update events**: A2A protocol events for streaming changes

### 6. `litellm-artifacts-agent.ts`

**Status**: ✅ Complete

**Purpose**: Demonstrates artifact creation and streaming with A2A events using a real LLM.

**Features**:
- **Real LLM Integration**: Uses LiteLLM with AWS Bedrock Nova Micro (or any LiteLLM model)
- **Artifact Creation**: Agent intelligently creates artifacts based on user requests
- **A2A Event Streaming**: Real-time artifact-update events
- **Hybrid Tools**: Combines math tools with artifact tools
- **OpenTelemetry**: Optional tracing support
- **Smart System Prompt**: Teaches agent when and how to use artifacts

**Example Prompts**:
- "Create a markdown report about the benefits of reactive programming"
- "Generate a random number and create an artifact with 5 facts about it"
- "Create a JSON artifact with the results of calculating 123 * 456 + 789"

**To run**:
```nu
pnpm tsx examples/litellm-artifacts-agent.ts
```

**Prerequisites**:
- LiteLLM proxy running (`litellm --model gpt-3.5-turbo` or similar)

**Key Learning Points**:
- How to prompt LLMs to use artifact tools effectively
- **Important**: LLMs must provide a consistent `artifactId` across multiple updates to the same artifact
- Combining multiple tool providers (math + artifacts)
- Real-time artifact event monitoring
- Structured artifact creation with multiple parts
- A2A protocol compliance with real LLM responses
- Using `append=true` to add content, `append=false` to replace content

### 7. `message-stores.ts`

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

## Tool Execution Patterns
```nu
pnpm tsx examples/litellm-agent.ts
```

### 4. `client-tools-agent.ts`

**Status**: ✅ Complete

**Purpose**: Demonstrates combining local tools (server-side) with client tools (client-side delegation).

**Features**:
- **Hybrid Tool Architecture**: Mix local and client tools
- **Local Tools** (Server-side):
  - `calculate` - Mathematical expression evaluation
  - `get_weather` - Simulated weather API (server-side)
- **Client Tools** (Client-side via input-required):
  - `search_users` - Search client database for users
  - `get_user_orders` - Retrieve user order history
  - `get_user_profile` - Get detailed user profile
- **Zod Validation**: Client tool definitions validated at runtime
- **A2A Protocol**: Simulates input-required flow for client tools
- **Multiple Scenarios**: 4 test scenarios demonstrating different tool combinations

**Key Learning Points**:
- How to use `ClientToolProvider` for client-side tools
- Zod schema validation for tool definitions
- `onInputRequired` callback pattern for client delegation
- Combining multiple `ToolProvider` instances
- Simulating A2A input-required state transitions
- Argument validation (required params, types, integers)

**Run**:
```nu
pnpm tsx examples/client-tools-agent.ts
```

**Example Output**:
```
🔧 [LOCAL] Executing: calculate
   Arguments: { expression: "15 * 8" }
   ✓ Result: 120

🌐 [CLIENT] Executing: search_users
   Arguments: { query: "alice" }
   ⏳ Waiting for client response...
   ✓ Found 1 users

📤 Final Response:
The calculation result is 120, and I found Alice Johnson (alice@example.com)
with total orders of $80.00.
```

### 5. `artifacts-agent.ts`

**Status**: ✅ Complete

**Purpose**: Demonstrates artifact creation and streaming with A2A event emission using a simple mock LLM.

**Features**:
- Artifact creation and multi-part updates
- A2A protocol event emission
- Event-driven architecture with decorator pattern
- In-memory artifact storage
- Artifact tools (artifact_update, list_artifacts, get_artifact)
- Mock LLM for demonstration purposes

**What it does**:
- Creates an artifact with multiple parts
- Streams artifact updates as A2A events
- Shows how to subscribe to artifact changes
- Demonstrates the Store-First Architecture

**To run**:
```nu
pnpm tsx examples/artifacts-agent.ts
```

**Key concepts**:
- **ArtifactStoreWithEvents**: Decorator that automatically emits A2A events
- **createArtifactTools()**: Provides artifact manipulation tools for agents
- **artifact-update events**: A2A protocol events for streaming changes

### 6. `litellm-artifacts-agent.ts`

### Local Tools (Server-side)

Tools execute directly on the agent server:

```typescript
class LocalToolProvider implements ToolProvider {
  async execute(toolCall: ToolCall, context: ExecutionContext): Promise<ToolResult> {
    // Execute directly on server
    const result = performCalculation(args);
    return { success: true, result };
  }
}
```

**Use cases**:
- Mathematical computations
- Server-side API calls
- Internal database queries
- File system operations

**Examples**: See `basic-agent.ts`, `litellm-agent.ts`

### Client Tools (Client-side Delegation)

Tools delegate execution to the client via A2A protocol:

```typescript
const clientTools = new ClientToolProvider({
  tools: clientToolDefinitions,
  onInputRequired: async (toolCall, context) => {
    // This triggers A2A input-required state
    // Client executes the tool and returns result
    return clientExecutionResult;
  },
});
```

**Use cases**:
- Client-side database access (privacy/security)
- Browser-based operations
- User-specific permissions
- Local file access on client machine

**Design References**:
- [design/agent-lifecycle.md](../design/agent-lifecycle.md) - Agent (multi-turn)
- [design/agent-loop.md](../design/agent-loop.md) - AgentLoop (single-turn)

## Example Progression

We recommend reviewing examples in this order:

1. **`basic-agent.ts`** - Start here for AgentLoop basics with mock LLM
2. **`agent-lifecycle.ts`** - Learn Agent API for multi-turn conversations ⭐
3. **`litellm-agent.ts`** - Real LLM integration with local tools
4. **`client-tools-agent.ts`** - Hybrid local + client tools
5. **`artifacts-agent.ts`** - Artifact system with mock LLM
6. **`litellm-artifacts-agent.ts`** - Artifacts with real LLM
7. **`message-stores.ts`** - Advanced message persistence strategies

## Agent vs AgentLoop

The framework provides two APIs for different use cases:

### Agent (Multi-turn, Stateful)

Use **Agent** when you need:
- ✅ Multi-turn conversations
- ✅ Automatic message persistence
- ✅ Session management
- ✅ Lazy initialization
- ✅ Lifecycle management (start/pause/shutdown)

**Examples**: `agent-lifecycle.ts`, `message-stores.ts`

### AgentLoop (Single-turn, Stateless)

Use **AgentLoop** when you need:
- ✅ One-off task execution
- ✅ Full control over state
- ✅ Custom message management
- ✅ Embedding in other systems
- ✅ Lower-level API access

**Examples**: `basic-agent.ts`, `litellm-agent.ts`, `client-tools-agent.ts`, `artifacts-agent.ts`, `litellm-artifacts-agent.ts`

**Design References**:
- [design/agent-lifecycle.md](../design/agent-lifecycle.md) - Agent (multi-turn)
- [design/agent-loop.md](../design/agent-loop.md) - AgentLoop (single-turn)

## A2A Protocol Integration

The `client-tools-agent.ts` example demonstrates the A2A (Agent-to-Agent) protocol flow:

```
1. Agent needs client tool → Enters "input-required" state
2. Server emits status-update event: { state: "input-required" }
3. Client receives event via SSE stream
4. Client executes tool with provided arguments
5. Client sends result back to agent
6. Agent continues execution with result
7. Agent completes task
```

See [docs/CLIENT_TOOL_PROVIDER.md](../docs/CLIENT_TOOL_PROVIDER.md) for detailed A2A integration patterns.

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

1. **Validate Early**: Use `ClientToolProvider` to validate tool definitions at startup
2. **Separate Concerns**: Keep local tools and client tools in separate providers
3. **Handle Errors**: Return structured errors in `ToolResult` objects
4. **Log Execution**: Add console logging for debugging (see examples)
5. **Use Type Safety**: Leverage TypeScript types from Zod schemas
6. **Test Scenarios**: Create multiple test prompts to verify behavior

## Next Steps

After reviewing the examples:

1. Read [docs/CLIENT_TOOL_PROVIDER.md](../docs/CLIENT_TOOL_PROVIDER.md) for detailed API
2. Review [design/tool-integration.md](../design/tool-integration.md) for architecture
3. Check [tests/client-tool-provider.test.ts](../tests/client-tool-provider.test.ts) for testing patterns
4. Explore [design/a2a-protocol.md](../design/a2a-protocol.md) for A2A protocol details

## Troubleshooting

**LiteLLM Connection Errors**:
```
Error: connect ECONNREFUSED 127.0.0.1:4000
```
→ Make sure LiteLLM proxy is running on port 4000

**Tool Validation Errors**:
```
Error: Tool validation failed
```
→ Check tool definitions against JSON Schema in [docs/CLIENT_TOOL_PROVIDER.md](../docs/CLIENT_TOOL_PROVIDER.md)

**Type Errors**:
```
Type 'unknown' is not assignable to type 'ToolDefinition'
```
→ Import `ExecutionContext` from `src/tools/interfaces`, not `src/core/types`

## Contributing Examples

When adding new examples:

1. Create descriptive filename: `{feature}-agent.ts`
2. Add comprehensive comments explaining each step
3. Include error handling patterns
4. Demonstrate realistic use cases
5. Add console output for visibility
6. Update this README with the new example
7. Test with `tsx examples/{your-example}.ts`
