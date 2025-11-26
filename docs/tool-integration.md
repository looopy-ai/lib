# Tool Integration

Looopy exposes a single `ToolProvider` contract so tools can be sourced from local code, clients, MCP servers, or even other agents. Providers stream **events** (not plain return values) so tool execution can be observed alongside LLM content streaming.

## Provider Contract

```typescript
import type { Observable } from 'rxjs';
import type { ExecutionContext, ContextAnyEvent } from '@looopy-ai/core';
import type { ToolCall, ToolDefinition } from '@looopy-ai/core/types/tools';

export type ToolProvider = {
  readonly name: string;
  getTool(toolName: string): Promise<ToolDefinition | undefined>;
  getTools(): Promise<ToolDefinition[]>;
  execute(toolCall: ToolCall, context: ExecutionContext): Observable<ContextAnyEvent>;
};
```

- `ExecutionContext` contains `contextId`, `taskId`, `agentId`, and optional `authContext` so providers can forward identity to downstream systems.
- `execute` should emit `tool-start`/`tool-progress`/`tool-complete` (or `tool-error`) events with the **same** `contextId`/`taskId` that were provided.

## Local Tools

Use the `tool` helper to define Zod-typed handlers and `localTools` to build a provider:

```typescript
import { localTools, tool } from '@looopy-ai/core';
import { z } from 'zod';

const localToolProvider = localTools([
  tool({
    name: 'echo',
    description: 'Echo text back to the caller.',
    schema: z.object({ text: z.string() }),
    handler: async ({ text }) => ({
      success: true,
      result: { echoed: text },
    }),
  }),
]);
```

`localTools` validates arguments with Zod and converts handler results into `tool-complete` events automatically.

## Client Tools

Use `ClientToolProvider` when the browser or another caller must execute the tool. The provider emits an `input-required` flow and waits for the callback to supply a `ToolResult`:

```typescript
import { ClientToolProvider } from '@looopy-ai/core';

const clientTools = new ClientToolProvider({
  tools: [
    {
      name: 'show_ui',
      description: 'Render a UI on the client',
      parameters: { type: 'object', properties: {} },
    },
  ],
  onInputRequired: async (toolCall, context) => {
    // Trigger a UI prompt or websocket message here
    const resultFromClient = await getClientResponse(toolCall, context);
    return {
      toolCallId: toolCall.id,
      toolName: toolCall.function.name,
      success: true,
      result: resultFromClient,
    };
  },
});
```

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

`AgentToolProvider` treats another agent as a tool by calling its card endpoint and streaming SSE events back as `ContextAnyEvent`:

```typescript
import { AgentToolProvider } from '@looopy-ai/core';

const researchCopilot = AgentToolProvider.from({
  name: 'Research Copilot',
  description: 'Multi-tool research assistant',
  url: 'https://agent.example.com',
});
```

## Custom Providers

When implementing your own provider, emit `ContextAnyEvent` values so the agent can multiplex events by task:

```typescript
import { of, defer, catchError, mergeMap } from 'rxjs';
import { toolErrorEvent, toolResultToEvents } from '@looopy-ai/core';
import type { ToolProvider } from '@looopy-ai/core';

const customProvider: ToolProvider = {
  name: 'my-provider',
  async getTools() {
    return [{ name: 'hello', description: 'Say hello', parameters: { type: 'object', properties: {} } }];
  },
  async getTool(name) {
    return name === 'hello' ? (await this.getTools())[0] : undefined;
  },
  execute(toolCall, context) {
    return defer(async () => ({
      toolCallId: toolCall.id,
      toolName: toolCall.function.name,
      success: true,
      result: `hello ${context.contextId}`,
    })).pipe(
      mergeMap((result) => toolResultToEvents(context, toolCall, result)),
      catchError((err) => of(toolErrorEvent(context, toolCall, String(err)))),
    );
  },
};
```

This pattern matches the built-in providers: create a `ToolResult`, then convert it into a stream of tool events.
