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
2. In this file, import the necessary classes and interfaces from `@looopy-ai/core`:
   ```typescript
   import { Agent, AgentConfig } from '@looopy-ai/core';
   import { liteLLMProvider } from './providers'; // Your LLM provider
   ```
3. Configure your agent. The `AgentConfig` interface has the following properties:
   - `agentId`: A unique ID for the agent.
   - `llmProvider`: The LLM provider to use.
   - `toolProviders`: An array of tool providers to use.
   - `systemPrompt`: The system prompt to use.
   - `maxIterations`: The maximum number of iterations to run the agent loop for.
   ```typescript
   const config: AgentConfig = {
     agentId: 'my-first-agent',
     llmProvider: liteLLMProvider,
     systemPrompt: 'You are a helpful assistant.',
   };
   ```
4. Create a new agent instance:
   ```typescript
   const agent = new Agent(config);
   ```
5. Start a conversation. The `startTurn` method returns an RxJS `Observable` that emits events from the agent.
   ```typescript
   const events$ = await agent.startTurn('Hello, world!');
   ```
6. Subscribe to the events to get the agent's response. The `A2A.Event` type is a discriminated union that can be one of the following:
   - `TaskEvent`: An event that represents the start or end of a task.
   - `StatusUpdateEvent`: An event that represents a status update.
   - `ArtifactUpdateEvent`: An event that represents an update to an artifact.
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
