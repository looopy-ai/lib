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
