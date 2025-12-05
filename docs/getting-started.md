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
   - `toolProviders`: Tool providers to enable (can be an empty array).
   - `messageStore`: Where conversation history is persisted (e.g., `InMemoryMessageStore`).
   - `plugins`: Optional plugins that can inject system prompts and other behavior. Use `literalPrompt(...)` for a static system prompt, `asyncPrompt(...)` to load a prompt from an external source or compose multiple plugins to layer prompts.
   ```typescript
   const llmProvider = new LiteLLMProvider({
     baseUrl: 'http://localhost:4000',
     model: 'gpt-4o-mini',
   });

   const localToolProvider = localTools([
     tool({
       name: 'echo',
       description: 'Echo text back to the caller',
       schema: z.object({ text: z.string() }),
       handler: ({ text }) => text,
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
     toolProviders: [localToolProvider],
     messageStore: new InMemoryMessageStore(),
     plugins: [promptPlugin],
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
