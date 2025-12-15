# Providers and Plugins

Providers connect to external services (e.g., LLM backends). Plugins extend the agent with system prompts and tools—tool execution now flows through plugins instead of a separate `toolProviders` array.

## LLM Providers

LLM providers translate between the framework's internal data model and an LLM API.

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

### AWS Bedrock via LiteLLM

The `@looopy-ai/aws` package provides AWS-specific stores and runtime helpers, but LLM providers are typically configured through LiteLLM. You can use Bedrock models via LiteLLM by configuring the model name:

```typescript
import { LiteLLMProvider } from '@looopy-ai/core';

const provider = new LiteLLMProvider({
  baseUrl: 'http://localhost:4000', // LiteLLM proxy
  model: 'bedrock/us.amazon.nova-micro-v1:0', // Bedrock model via LiteLLM
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
  }): Observable<AnyEvent>;
}
```

LLM providers should emit contextless `AnyEvent` values (content deltas, tool calls, usage metrics, etc.). The agent loop wraps them as `ContextAnyEvent` so downstream consumers always receive `contextId` and `taskId`.

## Plugins

Plugins handle prompts and tools in a single extension point. The core ships with tool-capable plugins like:

- `localTools`: Runs Zod-validated functions in-process.
- `createArtifactTools`: Manages file/data/dataset artifacts and tracks them in task state.
- `ClientToolProvider`: Delegates tool execution to a connected client.
- `McpToolProvider`: Proxies tools from an MCP server over JSON-RPC.
- `AgentToolProvider`: Calls another agent via its published card and streams SSE events.

Prompt-only helpers such as `literalPrompt` and `asyncPrompt` compose in the same `plugins` array.

```typescript
import { Agent, literalPrompt, mcp } from '@looopy-ai/core';

const llmProvider = /* e.g., new LiteLLMProvider(...) */;
const messageStore = /* e.g., new InMemoryMessageStore() */;

const filesystemTools = mcp({
  serverId: 'filesystem',
  serverUrl: 'http://localhost:3100',
  getHeaders: (authContext) => ({
    Authorization: `Bearer ${authContext?.credentials?.accessToken ?? ''}`,
  }),
});

const agent = new Agent({
  agentId: 'docs-agent',
  contextId: 'demo',
  llmProvider,
  messageStore,
  plugins: [literalPrompt('You are a helpful assistant.'), filesystemTools],
});
```

You can also instantiate the class form directly:

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

### Creating a Custom Plugin

To create a custom plugin, implement any of the optional hooks below:

```typescript
export type Plugin<AuthContext> = {
  readonly name: string;
  readonly version?: string;
  generateSystemPrompts?: (
    context: IterationContext<AuthContext>,
  ) => SystemPrompt[] | Promise<SystemPrompt[]>;
  getTool?: (toolId: string) => Promise<ToolDefinition | undefined>;
  listTools?: () => Promise<ToolDefinition[]>;
  executeTool?: (
    toolCall: ToolCall,
    context: IterationContext<AuthContext>,
  ) => Observable<ContextAnyEvent>;
};
```

`executeTool` should emit an RxJS `Observable` of `ContextAnyEvent` values (typically `tool-start`, any intermediate progress, and a final `tool-complete` event). The `IterationContext` includes `contextId`/`taskId` so plugins can forward those IDs to downstream systems (e.g., MCP headers or remote agent calls).

### Remote agents with `AgentToolProvider`

Use the `AgentToolProvider` to invoke another agent that exposes a card endpoint:

```typescript
import { Agent, AgentToolProvider } from '@looopy-ai/core';

const remoteAgent = AgentToolProvider.from({
  name: 'Research Copilot',
  description: 'Multi-tool research assistant',
  url: 'https://agent.example.com',
  skills: [{ name: 'search', description: 'Web search' }],
});

const agent = new Agent({
  // ...
  plugins: [remoteAgent],
});
```

The provider posts to `{card.url}/invocations?qualifier=DEFAULT` and consumes the Server-Sent Events stream, emitting each SSE as a `ContextAnyEvent` so it can be multiplexed with local tool activity.
