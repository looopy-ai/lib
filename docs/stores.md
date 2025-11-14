# Stores

Stores are persistence layers for storing conversation history, agent state, and artifacts.

## Message Stores

Message stores are used to store and retrieve conversation history. The `@looopy-ai/core` package includes a single message store, `InMemoryMessageStore`, which stores messages in memory.

The `@looopy-ai/aws` package includes a `S3MessageStore`, which stores messages in an S3 bucket.

### Creating a Custom Message Store

To create a custom message store, you need to implement the `MessageStore` interface:

```typescript
export interface MessageStore {
  getMessages(contextId: string): Promise<Message[]>;
  addMessage(contextId: string, message: Message): Promise<void>;
}
```

## Artifact Stores

Artifact stores are used to store and retrieve artifacts. The `@looopy-ai/core` package includes a single artifact store, `InMemoryArtifactStore`, which stores artifacts in memory.

The `@looopy-ai/aws` package includes a `S3ArtifactStore`, which stores artifacts in an S3 bucket.

### Creating a Custom Artifact Store

To create a custom artifact store, you need to implement the `ArtifactStore` interface:

```typescript
export interface ArtifactStore {
  create(artifact: Artifact): Promise<void>;
  get(artifactId: string): Promise<Artifact | undefined>;
}
```

## Task State Stores

Task state stores are used to store and retrieve the state of a task. The `@looopy-ai/core` package includes a single task state store, `InMemoryTaskStateStore`, which stores task state in memory.

The `@looopy-ai/aws` package includes a `S3TaskStateStore`, which stores task state in an S3 bucket.

### Creating a Custom Task State Store

To create a custom task state store, you need to implement the `TaskStateStore` interface:

```typescript
export interface TaskStateStore {
  save(state: TaskState): Promise<void>;
  load(taskId: string): Promise<TaskState | undefined>;
}
```
