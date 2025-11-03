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
pnpm tsx examples/litellm-agent.ts
pnpm tsx examples/client-tools-agent.ts
```

## Available Examples

### 1. `artifacts-agent.ts`

**Status**: ✅ Complete

**Purpose**: Demonstrates artifact creation and streaming with A2A event emission.

**Features**:
- Artifact creation and multi-part updates
- A2A protocol event emission
- Event-driven architecture with decorator pattern
- In-memory artifact storage
- Artifact tools (artifact_update, list_artifacts, get_artifact)

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

### 2. `basic-agent.ts` (Not yet implemented)

**Status**: Placeholder

**Purpose**: Minimal agent setup demonstrating core functionality.

**Features**:
- Simple LLM provider setup
- In-memory state storage
- Basic agent loop execution

### 3. `litellm-agent.ts`

**Status**: ✅ Complete

**Purpose**: Demonstrates agent with local tools using LiteLLM provider.

**Features**:
- **LiteLLM Provider**: AWS Bedrock Nova Micro model
- **Local Tools**: Calculator and random number generator
- **Server-side Execution**: Tools execute directly on the server
- **OpenTelemetry**: Optional tracing support
- **State Persistence**: In-memory state store
- **Error Handling**: Comprehensive try/catch patterns

**Tools Provided**:
- `calculate` - Evaluate mathematical expressions
- `get_random_number` - Generate random numbers in a range

**Key Learning Points**:
- How to create a custom `ToolProvider`
- Implementing `getTools()`, `canHandle()`, and `execute()` methods
- Tool parameter validation with JSON Schema
- Server-side tool execution pattern

**Run**:
```nu
tsx examples/litellm-agent.ts
```

### 3. `client-tools-agent.ts`

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
tsx examples/client-tools-agent.ts
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

## Tool Execution Patterns

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
