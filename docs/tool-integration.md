# Tool Integration

Tools flow through the plugin interface so LLM tool calls can be routed to local code, artifact helpers, MCP servers, or even other agents. Providers emit **events** instead of bare return values so tool execution can stream alongside LLM content.

## Tool Plugin Contract

```typescript
import type { Observable } from 'rxjs';
import type { AnyEvent, ContextAnyEvent, IterationContext } from '@looopy-ai/core';
import type { ToolCall, ToolDefinition } from '@looopy-ai/core/types/tools';

export type ToolPlugin<AuthContext> = {
  listTools: () => Promise<ToolDefinition[]>;
  getTool: (toolId: string) => Promise<ToolDefinition | undefined>;
  executeTool: (
    toolCall: ToolCall,
    context: IterationContext<AuthContext>,
  ) => Observable<ContextAnyEvent | AnyEvent>;
};

export interface ExecutionContext<AuthContext> {
  taskId: string;
  contextId: string;
  agentId: string;
  parentContext: import('@opentelemetry/api').Context;
  authContext?: AuthContext;
  metadata?: Record<string, unknown>;
}
```

- `runToolCall` automatically emits `tool-start`, stamps `contextId`/`taskId`, and adds `path: ["tool:<id>"]`.
- Providers should emit contextless tool events (e.g., `tool-complete`, `internal:tool-message`); use `toolResultToEvents` to convert a `ToolResult` into events.
- `ExecutionContext`/`IterationContext` includes `authContext` and OpenTelemetry parent context so downstream calls can forward identity and tracing headers.

## Local Tools with Zod

Use the `tool` helper to define Zod-typed handlers and `localTools` to build a plugin:

```typescript
import { localTools, tool } from '@looopy-ai/core';
import { z } from 'zod';

const localToolProvider = localTools([
  tool({
    id: 'echo',
    description: 'Echo text back to the caller.',
    schema: z.object({ text: z.string() }),
    handler: async ({ text }) => ({
      success: true,
      result: { echoed: text },
    }),
  }),
]);
```

`localTools` validates arguments with Zod and turns handler results into `tool-complete` (and optional `internal:tool-message`) events automatically.

## Artifact Tools

`createArtifactTools` ships built-in tools for creating and streaming file, data, and dataset artifacts while keeping task state in sync:

```typescript
import { Agent, createArtifactTools, InMemoryArtifactStore, InMemoryStateStore } from '@looopy-ai/core';

const artifactStore = new InMemoryArtifactStore();
const stateStore = new InMemoryStateStore();

const agent = new Agent({
  // ...
  plugins: [
    createArtifactTools(artifactStore, stateStore),
    localToolProvider,
  ],
});
```

These tools wrap `ArtifactScheduler` so chunked writes are serialized and tracked on the task.

## MCP Tools

Call any MCP-compliant server with `McpToolProvider` (or the `mcp` helper). Tool schemas are fetched lazily and cached; executions forward the current `authContext`:

```typescript
import { McpToolProvider } from '@looopy-ai/core';

const mcpProvider = new McpToolProvider({
  serverId: 'filesystem',
  serverUrl: 'http://localhost:3100',
  getHeaders: (authContext) => ({
    Authorization: `Bearer ${authContext?.credentials?.accessToken ?? ''}`,
  }),
  timeout: 15_000, // optional
});
```

## Remote Agents

`AgentToolProvider` treats another agent as a tool by calling its card endpoint and streaming SSE events back. Headers can be derived from the current auth context:

```typescript
import { AgentToolProvider } from '@looopy-ai/core';

const researchCopilot = AgentToolProvider.from({
  name: 'Research Copilot',
  description: 'Multi-tool research assistant',
  url: 'https://agent.example.com',
});

const withHeaders = await AgentToolProvider.fromUrl('https://agent.example.com/card.json', async (context) => ({
  Authorization: `Bearer ${context.authContext?.credentials?.accessToken ?? ''}`,
}));
```

SSE payloads are forwarded as `AnyEvent` with `parentTaskId`/`path` preserved so they can be multiplexed with local tool activity.

## Custom Providers

Emit tool lifecycle events directly or via `toolResultToEvents`:

```typescript
import { catchError, defer, mergeMap, of } from 'rxjs';
import { toolErrorEvent, toolResultToEvents, type Plugin } from '@looopy-ai/core';

const customProvider: Plugin<unknown> = {
  name: 'my-provider',
  async listTools() {
    return [{ id: 'hello', description: 'Say hello', parameters: { type: 'object', properties: {} } }];
  },
  getTool: async (id) => (id === 'hello' ? { id: 'hello', description: 'Say hello', parameters: { type: 'object', properties: {} } } : undefined),
  executeTool: (toolCall, context) =>
    defer(async () => ({
      toolCallId: toolCall.id,
      toolName: toolCall.function.name,
      success: true,
      result: `hello ${context.contextId}`,
    })).pipe(
      mergeMap((result) => toolResultToEvents(result)),
      catchError((err) => of(toolErrorEvent(toolCall, String(err)))),
    ),
};
```

This pattern matches the built-in plugins: produce a `ToolResult`, then convert it into a stream of tool events.
