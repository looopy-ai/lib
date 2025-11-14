# Providers

Providers are connectors to external services, such as LLM providers and tool providers.

## LLM Providers

LLM providers are responsible for translating between the framework's internal data model and the external service's API. The `@looopy-ai/core` package includes a single LLM provider, `liteLLMProvider`, which connects to the [LiteLLM](https://github.com/BerriAI/litellm) proxy.

The `@looopy-ai/aws` package includes a `bedrockProvider`, which connects to the AWS Bedrock service.

### Creating a Custom LLM Provider

To create a custom LLM provider, you need to implement the `LLMProvider` interface:

```typescript
export interface LLMProvider {
  chat(messages: Message[], tools?: Tool[]): Observable<Message>;
}
```

## Tool Providers

Tool providers are responsible for executing tools. The `@looopy-ai/core` package includes two tool providers:

- `LocalToolProvider`: Executes tools as local functions.
- `ClientToolProvider`: Delegates the execution of tools to the client.

### Creating a Custom Tool Provider

To create a custom tool provider, you need to implement the `ToolProvider` interface:

```typescript
export interface ToolProvider {
  execute(toolCall: ToolCall): Promise<ToolResult>;
}
```
