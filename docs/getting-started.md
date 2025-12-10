# Getting Started

This guide will walk you through the process of setting up your development environment and creating your first Looopy AI agent.

## Prerequisites

- Node.js (v18 or higher)
- pnpm

## Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/looopy-ai/looopy-ai.git
   ```
2. Install the dependencies:
   ```bash
   pnpm install
   ```

## Creating Your First Agent

1. Create a new file, for example, `my-agent.ts`.
2. Import the core runtime, a message store, and (optionally) tool/helpers:
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
   ```
3. Configure your agent. The important `AgentConfig` properties are:
   - `agentId`: A unique ID for the agent.
   - `contextId`: A stable identifier for the conversation thread.
   - `llmProvider`: The LLM provider to use (e.g., `LiteLLMProvider`).
   - `messageStore`: Where conversation history is persisted (e.g., `InMemoryMessageStore`).
   - `plugins`: Plugins that inject system prompts and tools. Use helpers like `literalPrompt(...)`/`asyncPrompt(...)` for prompts and `localTools(...)`/`createArtifactTools(...)` for tool execution.
   ```typescript
   const llmProvider = new LiteLLMProvider({
     baseUrl: 'http://localhost:4000',
     model: 'gpt-4o-mini',
   });

  const toolPlugin = localTools([
    tool({
      id: 'echo',
      description: 'Echo text back to the caller',
      schema: z.object({ text: z.string() }),
      handler: ({ text }) => ({ success: true, result: text }),
    }),
  ]);

   const promptPlugin = literalPrompt('You are a helpful assistant.');
   // or
   const promptPlugin = asyncPrompt(async ({authContext}) => {
    // load prompt from langfuse or similar prompt manager
    // inject user's name from authContext
    return prompt;
   });

   const agent = new Agent({
     agentId: 'my-first-agent',
     contextId: 'demo-session',
     llmProvider,
     messageStore: new InMemoryMessageStore(),
     plugins: [promptPlugin, toolPlugin],
   });
   ```
4. Start a conversation. The `startTurn` method returns an `Observable<ContextAnyEvent>` stream stamped with `contextId` and `taskId`.
   ```typescript
   const events$ = await agent.startTurn('Hello, world!');
   ```
5. Subscribe to the events to get the agent's response. Event kinds include task status updates, content deltas/finals, thought streams, and tool lifecycle events.
   ```typescript
   events$.subscribe({
     next: (event) => console.log(event),
     error: (err) => console.error(err),
     complete: () => console.log('Turn complete.'),
   });
   ```

## Running the Examples

The `@looopy-ai/examples` package contains a number of examples that you can run to see the framework in action. To run an example, use the `tsx` command:

```bash
pnpm tsx packages/examples/src/kitchen-sink.ts
```
