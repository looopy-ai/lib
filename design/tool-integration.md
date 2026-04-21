# Tool Integration

## Overview

Tools are provided to agents via the **plugin system**. A plugin that implements `listTools`, `getTool`, and `executeTool` is a `ToolPlugin<AuthContext>` and is automatically discovered and used by the agent loop.

Supported tool backends:

1. **Local Functions** — TypeScript functions defined inline with Zod schemas
2. **MCP (Model Context Protocol)** — Tools hosted on an external MCP server
3. **Remote Agents** — Other Looopy agents exposed as tools via their agent card
4. **Built-in Plugins** — Framework-provided tools (input requests, artifact management)

## Plugin Interface

All tools are provided through the `ToolPlugin<AuthContext>` interface, which is a member of the `Plugin<AuthContext>` union type passed to the agent at construction time.

```typescript
type ToolPlugin<AuthContext> = {
  readonly name: string;
  readonly version?: string;

  /** Return all tools available in this context */
  listTools: (context: IterationContext<AuthContext>) => Promise<ToolDefinition[]>;

  /** Return a single tool by ID, or undefined if not found / not enabled */
  getTool: (
    toolId: string,
    context: IterationContext<AuthContext>,
  ) => Promise<ToolDefinition | undefined>;

  /** Execute a tool call; returns an observable stream of events */
  executeTool: (
    toolCall: ToolCall,
    context: IterationContext<AuthContext>,
  ) => Observable<ContextAnyEvent | AnyEvent>;
};
```

Key design points:
- `listTools` and `getTool` are **async** (Promise-based), not Observable
- `executeTool` returns an **Observable of events** — the tool emits `tool-complete`, `tool-input-required`, or nested agent events rather than returning a plain result
- `isEnabled` filtering is the responsibility of the plugin (checked inside `getTool` / `listTools`)

### Tool Definition

```typescript
interface ToolDefinition {
  id: string;          // alphanumeric, underscores, hyphens; max 64 chars
  description: string; // shown to the LLM; max 1024 chars
  icon?: string;       // optional display icon
  parameters: {
    type: 'object';
    properties: Record<string, JsonSchemaProperty>;
    required?: string[];
    additionalProperties?: boolean;
  };
}
```

## Tool Routing

There is no dedicated router class. Routing is handled inline inside `runToolCall()` in `src/core/tools.ts`:

```
┌──────────────┐    ┌──────────────────────────────┐
│ tool-call    │───►│ runToolCall()                │
│ event        │    │                              │
└──────────────┘    │  1. Validate tool call       │
                    │  2. Query each ToolPlugin via │
                    │     getTool(name, context)    │
                    │  3. First match wins          │
                    │  4. Call executeTool()        │
                    │  5. Emit tool-start then      │
                    │     stream plugin events      │
                    └──────────────────────────────┘
```

The execution lifecycle per tool call:

1. Emit `tool-start` event
2. Call `plugin.executeTool(toolCall, context)`
3. Stream all events from the plugin (including nested agent events)
4. Catch any thrown errors and emit a `tool-complete { success: false }` event

## Local Tool Provider

Local tools are TypeScript functions defined inline. Use the `localTools()` factory and the `tool()` helper with Zod schemas.

```typescript
interface LocalToolDefinition<TSchema extends z.ZodObject, AuthContext> {
  id: string;
  description: string;
  icon?: string;
  schema: TSchema;                                      // Zod schema for parameters
  isEnabled?: (context: ExecutionContext<AuthContext>) => boolean;
  handler: (
    params: z.infer<TSchema>,
    context: ExecutionContext<AuthContext>,
  ) => Promise<ToolResult | InputRequiredResult> | ToolResult | InputRequiredResult;
}
```

The `localTools()` factory returns a `ToolPlugin<AuthContext>` that:
- Converts Zod schemas to JSON Schema for the LLM
- Validates and parses inputs before calling the handler
- Wraps the handler result into the appropriate events
- Filters tools via `isEnabled` at both `listTools` and `getTool` time

### Input-Required Pattern

A handler can pause execution by returning an `InputRequiredResult` instead of a normal result. The loop is interrupted with a `tool-input-required` event. On resume, the resolved value is provided in `context.resolvedInputs` keyed by `toolCallId`.

```typescript
// Conceptual handler using input-required
handler: async (params, context) => {
  const apiKey = context.resolvedInputs?.get(context.toolCallId);
  if (!apiKey) {
    return inputRequired({ inputType: 'data', prompt: 'Please provide your API key' });
  }
  return { success: true, result: await callApi(params, apiKey) };
}
```

See `src/tools/local-tools.ts` for the complete implementation.

## MCP Tool Provider

`McpToolProvider<AuthContext>` connects to an external MCP server via HTTP/JSON-RPC.

```
┌──────────────────┐         ┌──────────────────┐
│  McpToolProvider │  HTTP   │   MCP Server     │
│                  │────────►│  tools/list      │
│  listTools()     │         │  tools/call      │
│  executeTool()   │         │                  │
└──────────────────┘         └──────────────────┘
```

Configuration:

```typescript
interface MCPProviderConfig<AuthContext> {
  serverId: string;
  serverUrl: string;
  timeout?: number;
  getHeaders: (authContext?: AuthContext) => Record<string, string>;
}

// Factory helper
const myMcpPlugin = mcp<MyAuthContext>({
  serverId: 'filesystem',
  serverUrl: 'http://localhost:3100',
  getHeaders: (auth) => ({ Authorization: `Bearer ${auth?.token}` }),
});
```

Tool definitions are cached for 5 minutes with deduplication of concurrent fetch requests.

See `src/tools/mcp-tool-provider.ts` and `src/tools/mcp-client.ts` for the complete implementation.

## Remote Agent Tool Provider

`AgentToolProvider<AuthContext>` exposes another Looopy-compatible agent as a single tool. It loads an **agent card** (a JSON descriptor) from a URL and creates an `invoke` tool that sends a prompt to the remote agent via SSE.

```typescript
// From a URL
const remotePlugin = await AgentToolProvider.fromUrl<MyAuthContext>(
  'https://other-agent.example.com/agent-card.json',
  async (context, card) => ({ Authorization: `Bearer ${context.authContext?.token}` }),
);

// From a parsed card object
const remotePlugin = AgentToolProvider.from<MyAuthContext>(card, getHeaders);
```

The generated tool has ID `agent__<agent-name>__invoke` and accepts a single `prompt` string argument. Nested events from the remote agent are streamed through with path tracking.

See `src/tools/agent-tool-provider.ts` for the complete implementation.

## Built-in Plugins

### Request Input Plugin

`requestInputPlugin()` advertises a special `request_input` tool to the LLM. When the LLM calls it, the loop is **never executed**; instead `runIteration` intercepts the call and emits a `tool-input-required` event directly.

On resume, a synthetic `tool-complete` is injected so the LLM sees the answer as a normal tool result.

```typescript
const agent = new Agent({
  plugins: [requestInputPlugin(), ...otherPlugins],
});
```

See `src/tools/request-input-tool.ts`.

### Artifact Tools Plugin

`createArtifactTools(artifactStore, taskStateStore)` provides tools for creating and managing file, data, and dataset artifacts. It is built on top of `localTools()`.

```typescript
const artifactPlugin = createArtifactTools<MyAuthContext>(artifactStore, taskStateStore);
```

See `src/tools/artifact-tools.ts` and `design/artifact-management.md`.

## Tool Execution Flow (Iteration Level)

```
runIteration()
  ├── prepareTools()   — calls listTools() on all ToolPlugin instances in parallel
  ├── LLM call        — tools array sent to LLM
  └── for each tool-call event from LLM:
        runToolCall()
          ├── validate tool call format
          ├── find matching plugin via getTool()
          ├── emit tool-start
          └── stream plugin.executeTool() events
```

See `src/core/iteration.ts` and `src/core/tools.ts`.
