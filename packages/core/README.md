# @looopy-ai/core

RxJS-based AI agent framework with multi-turn conversation management, streaming LLM integration, tool execution, and pluggable storage.

## Installation

```bash
pnpm add @looopy-ai/core
```

## Quick Start

```typescript
import {
  Agent,
  InMemoryMessageStore,
  LiteLLMProvider,
  literalPrompt,
  localTools,
  tool,
} from '@looopy-ai/core';
import { z } from 'zod';

const llmProvider = new LiteLLMProvider({
  baseUrl: 'http://localhost:4000',
  model: 'gpt-4o-mini',
});

const agent = new Agent({
  agentId: 'my-agent',
  contextId: 'session-1',
  llmProvider,
  messageStore: new InMemoryMessageStore(),
  plugins: [
    literalPrompt('You are a helpful assistant.'),
    localTools([
      tool({
        id: 'echo',
        description: 'Echo text back',
        schema: z.object({ text: z.string() }),
        handler: ({ text }) => ({ success: true, result: text }),
      }),
    ]),
  ],
});

const events$ = await agent.startTurn('Hello!');
events$.subscribe({
  next: (event) => console.log(event),
  complete: () => console.log('Done'),
});
```

## Core API

### `Agent`

Stateful multi-turn conversation manager. Handles message persistence, turn lifecycle, pause/resume, and graceful shutdown.

```typescript
const agent = new Agent<AuthContext>({
  agentId: string;
  contextId: string;
  llmProvider: LLMProvider;
  messageStore: MessageStore;
  agentStore?: AgentStore;         // persists AgentState across restarts
  plugins?: Plugin<AuthContext>[];
  autoCompact?: boolean;           // auto-summarize when message limit reached
  maxMessages?: number;
  logger?: pino.Logger;
});

// Start a turn (returns Observable<AgentEvent>)
const events$ = await agent.startTurn('User message');

// Resume after a tool-input-required pause
const events$ = await agent.startTurn('User message', {
  resolvedInputs: new Map([['toolCallId', 'user-supplied-value']]),
});

// Inspect state
agent.state; // AgentState { status, turnCount, lastActivity, ... }

// Graceful shutdown
await agent.shutdown();
```

**AgentState** statuses: `created` | `idle` | `busy` | `waiting-input` | `shutdown` | `error`

### `runLoop`

Stateless single-turn execution. Use directly when you don't need session management.

```typescript
import { runLoop } from '@looopy-ai/core';

const events$ = runLoop(context, { llmProvider }, messages);
```

## LLM Providers

### `LiteLLMProvider`

Connects to a [LiteLLM](https://docs.litellm.ai/) proxy, giving access to 100+ model providers.

```typescript
const llmProvider = new LiteLLMProvider({
  baseUrl: 'http://localhost:4000',
  model: 'gpt-4o-mini',         // or bedrock/..., claude-3-opus, etc.
  apiKey: process.env.API_KEY,  // optional
  maxTokens: 4096,
  logDir: './logs',             // optional JSONL request log
});
```

## Plugins

Plugins attach behaviour to the agent loop: system prompts, tool sets, skills, and input handling.

### System Prompts

```typescript
import { literalPrompt, asyncPrompt } from '@looopy-ai/core';

// Static string
literalPrompt('You are a helpful assistant.')

// Dynamic — loaded async per turn
asyncPrompt(async ({ authContext }) => `Hello ${authContext.userId}`)
```

### Local Tools

```typescript
import { localTools, tool, inputRequired } from '@looopy-ai/core';
import { z } from 'zod';

localTools([
  tool({
    id: 'search',
    description: 'Search the web',
    schema: z.object({ query: z.string() }),
    handler: async ({ query }, context) => {
      // Pause and ask for an API key if not yet resolved
      const apiKey = context.resolvedInputs?.get(context.toolCallId);
      if (!apiKey) {
        return inputRequired({ prompt: 'Please provide your search API key' });
      }
      const results = await searchWeb(query, apiKey);
      return { success: true, result: results };
    },
  }),
])
```

`inputRequired()` pauses the loop with status `waiting-input`. Resume by passing `resolvedInputs` to the next `startTurn` call.

### MCP Tools

Connect to any [Model Context Protocol](https://modelcontextprotocol.io/) server:

```typescript
import { mcp } from '@looopy-ai/core';

const mcpTools = mcp({
  serverId: 'filesystem',
  serverUrl: 'http://localhost:8080',
  getHeaders: () => ({ Authorization: `Bearer ${token}` }),
});
```

### Agent-as-Tool (A2A)

Call another Looopy agent as a tool via its HTTP endpoint:

```typescript
import { AgentToolProvider } from '@looopy-ai/core';

const subAgent = await AgentToolProvider.fromUrl('http://localhost:3001/card.json');
// or
const subAgent = AgentToolProvider.from(agentCard, getHeaders);
```

### Artifact Tools

Give the agent built-in tools to create and manage file, data, and dataset artifacts:

```typescript
import { createArtifactTools } from '@looopy-ai/core';

const artifactTools = createArtifactTools(artifactStore, taskStateStore);
```

Tools provided: `create_file_artifact`, `append_file_artifact`, `create_data_artifact`, `create_dataset_artifact`, `append_dataset_rows`, `list_artifacts`.

### LLM-Initiated Input Requests

Let the LLM itself ask for clarification mid-loop:

```typescript
import { requestInputPlugin } from '@looopy-ai/core';

plugins: [requestInputPlugin()]
```

The LLM can call the built-in `request_input` tool, which pauses the loop with a `tool-input-required` event. On resume, a synthetic `tool-complete` is injected so the LLM sees the answer.

### Agent Academy (Skills)

Teach the agent new skills dynamically:

```typescript
import { agentAcademy, skill } from '@looopy-ai/core';

agentAcademy([
  skill({
    name: 'diagramming',
    description: 'Create Mermaid diagrams',
    instruction: 'Use mermaid syntax wrapped in ```mermaid blocks.',
  }),
])
```

The agent can activate skills at runtime using the built-in `learn_skill` tool.

## Stores

### Message Stores

| Class | Use case |
|---|---|
| `InMemoryMessageStore` | Development and testing |
| `FileSystemMessageStore` | Local persistence |
| `HybridMessageStore` | Combines two stores (e.g., in-memory + filesystem) |
| `Mem0MessageStore` | [Mem0](https://mem0.ai/) memory service |

```typescript
import { InMemoryMessageStore, FileSystemMessageStore } from '@looopy-ai/core';

new InMemoryMessageStore()
new FileSystemMessageStore({ basePath: './_agent_store', agentId: 'my-agent' })
```

### Agent Stores (state persistence)

| Class | Use case |
|---|---|
| `InMemoryAgentStore` | Development and testing |
| `FileSystemAgentStore` | Local persistence |

### Artifact Stores

| Class | Use case |
|---|---|
| `MemoryArtifactStore` | Development and testing |
| `FileSystemArtifactStore` | Local persistence |

### Task State Store

| Class | Use case |
|---|---|
| `InMemoryStateStore` | Development and testing |
| `FileSystemStateStore` | Local persistence |

### Context Store

`FileSystemContextStore` manages session metadata (title, tags, lifecycle, locking) for multi-tenant or multi-session deployments.

## SSE Server

Stream agent events to HTTP clients via Server-Sent Events:

```typescript
import { SSEServer, SSEConnection } from '@looopy-ai/core';

const sseServer = new SSEServer();

// Pipe agent events into the server
events$.subscribe((event) => sseServer.publish(event));

// Subscribe a client (framework-agnostic)
const connection = new SSEConnection({
  subscription: { contextId: 'session-1' },
  response: res, // Node HTTP response or similar
});
sseServer.subscribe(connection);
```

## Secure Credential Handoff (Auth)

Utilities for encrypting credentials between agents and clients using ECDH-ES JWE and OAuth 2.0 PKCE. No raw secrets cross event/log boundaries.

```typescript
import { generateECDHKeyPair, generatePKCEPair, encryptCredential, decryptCredential } from '@looopy-ai/core';

// Agent side — generate keys, emit auth-required event
const { publicKey, privateKeyPem, keyId } = generateECDHKeyPair();
const { codeChallenge, codeVerifier } = generatePKCEPair();

// Client side — encrypt the credential
const jwe = await encryptCredential(userSecret, publicKey, claims);

// Agent side — decrypt on receipt
const credential = await decryptCredential(jwe, privateKeyPem, { authId, contextId });
```

Supported flows: `oauth2` (PKCE), `api-key`, `pat`, `password`, `custom`.

## Observability

OpenTelemetry tracing is built in. Enable via environment variables:

```bash
OTEL_ENABLED=true
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
```

Spans are created for agent turns, loop iterations, LLM calls, and tool executions.

## Event Stream

Every `agent.startTurn()` returns an `Observable<AgentEvent>`. Key event kinds:

| Kind | Description |
|---|---|
| `task-created` | New task started |
| `task-status` | Status update (`working`, `waiting-input`, etc.) |
| `content-delta` | Streaming text chunk |
| `content-complete` | Full content block finalized |
| `thought-stream` | Internal reasoning/thought |
| `tool-start` | Tool call beginning |
| `tool-complete` | Tool call result |
| `tool-input-required` | Loop paused — needs upstream input |
| `task-complete` | Turn finished |
| `llm-usage` | Token usage stats |

## Development

```bash
pnpm build          # Compile TypeScript
pnpm check:types    # Type check without emit
pnpm test           # Run test suite (Vitest)
pnpm lint           # Biome lint
```
