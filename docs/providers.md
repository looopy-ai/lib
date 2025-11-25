# Providers

Providers are connectors to external services, such as LLM providers and tool providers.

## LLM Providers

LLM providers are responsible for translating between the framework's internal data model and the external service's API.

### `LiteLLMProvider`

The `@looopy-ai/core` package includes a `LiteLLMProvider`, which connects to the [LiteLLM](https://github.com/BerriAI/litellm) proxy. This allows you to use a wide variety of LLMs with a single interface.

To use the `liteLLMProvider`, you first need to run the LiteLLM proxy. You can do this with the following command:

```bash
litellm --model openai/gpt-3.5-turbo
```

Then, you can create a `LiteLLMProvider` instance like this:

```typescript
import { LiteLLMProvider } from '@looopy-ai/core';

const provider = new LiteLLMProvider({
  baseUrl: 'http://localhost:4000',
  model: 'gpt-4o-mini',
});
```

### `bedrockProvider`

The `@looopy-ai/aws` package includes a `bedrockProvider`, which connects to the AWS Bedrock service. This allows you to use the models available in Bedrock, such as Claude and Llama.

To use the `bedrockProvider`, you need to have the AWS SDK for JavaScript v3 installed and configured. Then, you can create a `bedrockProvider` instance like this:

```typescript
import { bedrockProvider } from '@looopy-ai/aws';

const provider = bedrockProvider({
  model: 'anthropic.claude-v2',
});
```

### Creating a Custom LLM Provider

To create a custom LLM provider, implement the `LLMProvider` interface:

```typescript
export interface LLMProvider {
  call(request: {
    messages: Message[];
    tools?: ToolDefinition[];
    stream?: boolean;
    sessionId?: string;
  }): Observable<LLMEvent<AnyEvent>>;
}
```

## Tool Providers

Tool providers are responsible for executing tools. The `@looopy-ai/core` package includes three tool providers:

- `LocalToolProvider`: Executes tools as local functions.
- `ClientToolProvider`: Delegates the execution of tools to the client.
- `McpToolProvider`: Connects to an MCP server and proxies the server's tools over JSON-RPC.

```typescript
import { mcp } from '@looopy-ai/core';

const filesystemTools = mcp({
  serverId: 'filesystem',
  serverUrl: 'http://localhost:3100',
  getHeaders: (authContext) => ({
    Authorization: `Bearer ${authContext?.credentials?.accessToken ?? ''}`,
  }),
});
```

or

```typescript
import { McpToolProvider } from '@looopy-ai/core';

const filesystemTools = new McpToolProvider({
  serverId: 'filesystem',
  serverUrl: 'http://localhost:3100',
  getHeaders: (authContext) => ({
    Authorization: `Bearer ${authContext?.credentials?.accessToken ?? ''}`,
  }),
});
```

`McpToolProvider` automatically discovers tool definitions from the MCP server, caches them, and calls the server with the current execution's `authContext` so that per-user credentials can flow through to the remote system.

### Creating a Custom Tool Provider

To create a custom tool provider, implement the `ToolProvider` interface:

```typescript
export type ToolProvider = {
  readonly name: string;
  getTool(toolName: string): Promise<ToolDefinition | undefined>;
  getTools(): Promise<ToolDefinition[]>;
  execute(toolCall: ToolCall, context: ExecutionContext): Observable<AnyEvent>;
};
```

`execute` should emit an RxJS `Observable` of `AnyEvent` values (typically `tool-complete` and any related tool message events).
