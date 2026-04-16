# Looopy AI

A reactive, extensible AI agent framework built with TypeScript and RxJS.

Looopy AI provides a powerful, stream-based architecture for creating advanced AI agents that can handle complex, multi-turn conversations and execute tasks in real-time. It's designed for scalability, observability, and extensibility.

## Core Packages

- **`@looopy-ai/core`**: The heart of the framework — the `Agent` class, `runLoop` function, tool/prompt plugins, streaming helpers, and stores.
- **`@looopy-ai/aws`**: AWS integrations: DynamoDB agent state store, Bedrock AgentCore memory message store, Secrets Manager helpers, and an AgentCore-compatible runtime server.
- **`@looopy-ai/react`**: React components and conversation reducer for building chat UIs.
- **`@looopy-ai/examples`**: Working examples to get started.

## Getting Started

To install the necessary dependencies, run the following command:

```bash
pnpm install
```

Here's a basic example of how to create and use an agent:

```typescript
import {
  Agent,
  asyncPrompt,
  InMemoryMessageStore,
  LiteLLMProvider,
  literalPrompt,
  localTools,
  tool,
} from '@looopy-ai/core';
import { z } from 'zod';

// LLM provider that points at your LiteLLM proxy
const llmProvider = new LiteLLMProvider({
  baseUrl: 'http://localhost:4000',
  model: 'gpt-4o-mini',
});

// Optional: add local tools with typed schemas
const tools = localTools([
  tool({
    id: 'echo',
    description: 'Echo text back to the caller',
    schema: z.object({ text: z.string() }),
    handler: ({ text }) => ({ success: true, result: text }),
  }),
]);

const promptPlugin = literalPrompt('You are a helpful assistant.');
// Dynamic prompts (e.g. loading from a prompt manager or injecting user info):
// const promptPlugin = asyncPrompt(async ({ authContext }) => myPromptFn(authContext));

// Create a new agent
const agent = new Agent({
  agentId: 'my-first-agent',
  contextId: 'demo-session',
  llmProvider,
  messageStore: new InMemoryMessageStore(),
  plugins: [promptPlugin, tools],
});

// Start a conversation
const events$ = await agent.startTurn('Hello, world!');

// Subscribe to events to get the agent's response
events$.subscribe({
  next: (event) => console.log(event),
  error: (err) => console.error(err),
  complete: () => console.log('Turn complete.'),
});
```

## Documentation

For more detailed information about the project, including architecture, API reference, and usage guides, please see our [full documentation](./docs/home.md).

## Contributing

We welcome contributions! Please read our [contributing guidelines](./docs/contributing.md) to get started.

## License

This project is licensed under the ISC License.
