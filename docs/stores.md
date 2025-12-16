# Stores

Stores provide persistence for the runtime: conversation history, artifacts, task checkpoints, and the agent's own lifecycle state. The core package includes in-memory options for testing plus filesystem-backed implementations for local durability.

## Agent Stores

Agent stores persist `AgentState`, allowing the `Agent` to resume turn counters, lifecycle status, and timestamps across process restarts. Configure them via the `agentStore` field on `AgentConfig`.

### AgentStore Interface

```typescript
export interface AgentStore {
  load(contextId: string): Promise<AgentState | null>;
  save(contextId: string, state: AgentState): Promise<void>;
  delete?(contextId: string): Promise<void>;
}
```

### FileSystemAgentStore

`FileSystemAgentStore` stores one JSON document per context under `./_agent_store/agent={agentId}/context={contextId}/agent-state.json`. Dates are serialized to ISO strings and restored as `Date` objects on load.

```typescript
import { FileSystemAgentStore } from '@looopy-ai/core/stores/filesystem';

const agentStore = new FileSystemAgentStore({
  basePath: './_agent_store',
  agentId: 'my-agent',
});

const state = await agentStore.load('ctx-123');
await agentStore.save('ctx-123', {
  status: 'ready',
  turnCount: 4,
  createdAt: new Date(),
  lastActivity: new Date(),
});
```

Provide the store to `new Agent({ agentStore, ... })` to enable automatic persistence.

## Message Stores

Message stores keep the conversation history. The core package ships with:

- `InMemoryMessageStore` – simple in-memory storage for tests
- `FileSystemMessageStore` – filesystem-based JSON per message
- `HybridMessageStore`, `BedrockMemoryStore`, and `Mem0MessageStore` – integrations with external memory systems

A custom store implements the interface from `packages/core/src/stores/messages/interfaces.ts`:

```typescript
export interface MessageStore {
  append(contextId: string, messages: Message[]): Promise<void>;
  getRecent(
    contextId: string,
    options?: { maxMessages?: number; maxTokens?: number }
  ): Promise<Message[]>;
  getAll(contextId: string): Promise<Message[]>;
  getCount(contextId: string): Promise<number>;
  getRange(contextId: string, startIndex: number, endIndex: number): Promise<Message[]>;
  compact(contextId: string, options?: CompactionOptions): Promise<CompactionResult>;
  clear(contextId: string): Promise<void>;
}
```

## Artifact Stores

Artifact stores manage generated artifacts (files, datasets, structured data). The filesystem implementation writes metadata under the same context directory structure used by other stores, while in-memory versions remain available for fast tests. Implementations must satisfy the interfaces in `packages/core/src/stores/artifacts`.

### InternalEventArtifactStore

Wrap any artifact store with `InternalEventArtifactStore` to emit `file-write`, `data-write`, and `dataset-write` events whenever artifacts change. This keeps the internal event stream aligned with artifact persistence without modifying the underlying store.

```typescript
import type { AnyEvent } from '@looopy-ai/core';
import { InMemoryArtifactStore, InternalEventArtifactStore } from '@looopy-ai/core';

const eventEmitter = { emit: (event: AnyEvent) => eventBus.publish(event) };

const artifactStore = new InternalEventArtifactStore({
  delegate: new InMemoryArtifactStore(),
  eventEmitter,
});
```

Chunk indices, sizes, schema info, and completion flags are included in the emitted events for observability.

## Task State Stores

Task state stores keep per-turn checkpoints produced by the agent loop. Use `InMemoryStateStore` for tests or `FileSystemStateStore` for resilience across crashes. A custom store implements the `TaskStateStore` interface (`save`, `load`, `exists`, `delete`, `listTasks`, and `setTTL`).
