# Tool Integration

Looopy AI provides a flexible system for integrating tools into your agents.

## Local Tools

Local tools are functions that are executed in the same process as the agent. To create a local tool, you need to create a `Tool` object:

```typescript
import { Tool } from '@looopy-ai/core';

const myTool: Tool = {
  name: 'my-tool',
  description: 'A tool that does something.',
  inputSchema: {
    type: 'object',
    properties: {
      arg1: { type: 'string' },
    },
    required: ['arg1'],
  },
  execute: async (args) => {
    // ...
  },
};
```

Then, you can pass the tool to the `Agent` or `AgentLoop` constructor in a `LocalToolProvider`:

```typescript
import { Agent, LocalToolProvider } from '@looopy-ai/core';

const agent = new Agent({
  // ...
  toolProviders: [new LocalToolProvider([myTool])],
});
```

## Client Tools

Client tools are tools that are executed on the client. To use client tools, you need to create a `ClientToolProvider`:

```typescript
import { Agent, ClientToolProvider } from '@looopy-ai/core';

const agent = new Agent({
  // ...
  toolProviders: [new ClientToolProvider()],
});
```

When the agent needs to execute a client tool, it will emit an `InputRequestEvent`. The client is responsible for handling this event, executing the tool, and then sending the result back to the agent.

## MCP Tools

MCP (Model Context Protocol) tools allow your agent to call any MCP-compliant server. The `McpToolProvider` fetches the available tools from the remote server over JSON-RPC, caches the schema for one minute, and forwards executions through the same endpoint.

```typescript
import { Agent, McpToolProvider } from '@looopy-ai/core';

const mcpProvider = new McpToolProvider({
  serverId: 'filesystem',
  serverUrl: 'http://localhost:3100',
  getAuthHeaders: (authContext) => ({
    Authorization: `Bearer ${authContext?.credentials?.accessToken ?? ''}`,
  }),
  timeout: 15_000, // optional, defaults to 30s
});

const agent = new Agent({
  // ...
  toolProviders: [mcpProvider],
});
```

The provider automatically uses the `authContext` from the `ExecutionContext` so you can propagate user-level credentials to the MCP server. Tool listings are fetched lazily and reused until the cache expires or the process is restarted.
