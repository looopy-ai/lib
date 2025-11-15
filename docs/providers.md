# Providers

Providers are connectors to external services, such as LLM providers and tool providers.

## LLM Providers

LLM providers are responsible for translating between the framework's internal data model and the external service's API.

### `liteLLMProvider`

The `@looopy-ai/core` package includes a single LLM provider, `liteLLMProvider`, which connects to the [LiteLLM](https://github.com/BerriAI/litellm) proxy. This allows you to use a wide variety of LLMs with a single interface.

To use the `liteLLMProvider`, you first need to run the LiteLLM proxy. You can do this with the following command:

```bash
litellm --model openai/gpt-3.5-turbo
```

Then, you can create a `liteLLMProvider` instance like this:

```typescript
import { liteLLMProvider } from '@looopy-ai/core';

const provider = liteLLMProvider({
  model: 'openai/gpt-3.5-turbo',
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

To create a custom LLM provider, you need to implement the `LLMProvider` interface:

```typescript
export interface LLMProvider {
  chat(messages: Message[], tools?: Tool[]): Observable<Message>;
}
```

## Tool Providers

Tool providers are responsible for executing tools. The `@looopy-ai/core` package includes three tool providers:

- `LocalToolProvider`: Executes tools as local functions.
- `ClientToolProvider`: Delegates the execution of tools to the client.
- `McpToolProvider`: Connects to an MCP server and proxies the server's tools over JSON-RPC.

```typescript
import { McpToolProvider } from '@looopy-ai/core';

const filesystemTools = new McpToolProvider({
  serverId: 'filesystem',
  serverUrl: 'http://localhost:3100',
  getAuthHeaders: (authContext) => ({
    Authorization: `Bearer ${authContext?.credentials?.accessToken ?? ''}`,
  }),
});
```

`McpToolProvider` automatically discovers tool definitions from the MCP server, caches them, and calls the server with the current execution's `authContext` so that per-user credentials can flow through to the remote system.

### Creating a Custom Tool Provider

To create a custom tool provider, you need to implement the `ToolProvider` interface:

```typescript
export interface ToolProvider {
  getTools(): Promise<ToolDefinition[]>;
  execute(toolCall: ToolCall, context: ExecutionContext): Promise<ToolResult>;
  canHandle(toolName: string): boolean;
  executeBatch?(toolCalls: ToolCall[], context: ExecutionContext): Promise<ToolResult[]>;
}
```
