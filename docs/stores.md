# Stores

Stores are persistence layers for storing conversation history, agent state, and artifacts.

## Message Stores

Message stores are used to store and retrieve conversation history.

### `InMemoryMessageStore`

The `@looopy-ai/core` package includes a single message store, `InMemoryMessageStore`, which stores messages in memory. This is useful for development and testing, but should not be used in production.

### `S3MessageStore`

The `@looopy-ai/aws` package includes a `S3MessageStore`, which stores messages in an S3 bucket. This is a durable, scalable option for production use.

### Creating a Custom Message Store

To create a custom message store, you need to implement the `MessageStore` interface:

```typescript
export interface MessageStore {
  getMessages(contextId: string): Promise<Message[]>;
  addMessage(contextId: string, message: Message): Promise<void>;
}
```

## Artifact Stores

Artifact stores are used to store and retrieve artifacts.

### `InMemoryArtifactStore`

The `@looopy-ai/core` package includes a single artifact store, `InMemoryArtifactStore`, which stores artifacts in memory.

### `S3ArtifactStore`

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

Task state stores are used to store and retrieve the state of a task.

### `InMemoryTaskStateStore`

The `@looopy-ai/core` package includes a single task state store, `InMemoryTaskStateStore`, which stores task state in memory.

### `S3TaskStateStore`

The `@looopy-ai/aws` package includes a `S3TaskStateStore`, which stores task state in an S3 bucket.

### Creating a Custom Task State Store

To create a custom task state store, you need to implement the `TaskStateStore` interface:

```typescript
export interface TaskStateStore {
  save(state: TaskState): Promise<void>;
  load(taskId: string): Promise<TaskState | undefined>;
}
```
