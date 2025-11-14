# Artifact Management and A2A Change Communication

## Overview

Artifact management is a critical component of the agent loop that enables agents to create, update, and stream structured outputs (artifacts) to clients via the A2A protocol. This design ensures that all artifact changes are:

1. **Persisted** in an artifact store
2. **Synchronized** with task state
3. **Streamed** over A2A protocol as `artifact-update` events
4. **Resumable** after disconnection or failure

## ⚠️ API Update (November 2025)

**The artifact store API has been updated to use context-scoped, type-specific methods:**

### Key Changes

1. **Context Scoping**: All methods now require `contextId` as the first parameter
   - Old: `getArtifact(artifactId)`
   - New: `getArtifact(contextId, artifactId)`

2. **Type-Specific Creation**: Separate creation methods for each artifact type
   - Old: `createArtifact({ type: 'file', ... })`
   - New: `createFileArtifact(...)`, `createDataArtifact(...)`, `createDatasetArtifact(...)`

3. **Type-Specific Content Methods**: Separate methods for reading content by type
   - Old: `getArtifactContent(artifactId)` (generic)
   - New: `getFileContent(contextId, artifactId)`, `getDataContent(contextId, artifactId)`, `getDatasetRows(contextId, artifactId)`

4. **Type-Specific Update Methods**: Separate methods for updating each type
   - Old: `appendPart(artifactId, part)`
   - New: `appendFileChunk(contextId, artifactId, chunk)`, `writeData(contextId, artifactId, data)`, `appendDatasetBatch(contextId, artifactId, rows)`

5. **Removed Deprecated Methods**:
   - ❌ `createArtifact()` - Use type-specific `createFileArtifact()`, `createDataArtifact()`, or `createDatasetArtifact()`
   - ❌ `appendPart()` - Use type-specific `appendFileChunk()`, `writeData()`, or `appendDatasetBatch()`
   - ❌ `replacePart()` - Not supported in new API
   - ❌ `replaceParts()` - Not supported in new API
   - ❌ `getArtifactParts()` - Use type-specific content methods
   - ❌ `getArtifactContent()` - Use type-specific `getFileContent()`, `getDataContent()`, or `getDatasetRows()`
   - ❌ `getTaskArtifacts()` - Use `listArtifacts(contextId, taskId)`
   - ❌ `queryArtifacts()` - Use `listArtifacts(contextId, taskId?)`
   - ❌ `getArtifactByContext()` - Use `getArtifact(contextId, artifactId)`

**Note**: Code examples in this document may still reference the old API and should be updated as a reference. See `packages/core/src/stores/artifacts/memory-artifact-store.ts` for the current implementation.

## Core Principles

### 1. Store-First Architecture

All artifact operations go through the artifact store first:

```
LLM/Tool → Artifact Store → A2A Event Emission → Client
                    ↓
              State Update
```

This ensures:
- **Consistency**: Artifact state is persisted before notification
- **Resumability**: Clients can resubscribe and get full artifact history
- **Atomicity**: Changes are atomic at the store level

### 2. Change Streaming

Every artifact mutation triggers an A2A `artifact-update` event:

```typescript
// Pattern
await artifactStore.appendPart(artifactId, part);
// ↓ Automatically triggers
emitA2AEvent({
  kind: "artifact-update",
  taskId,
  contextId,
  artifact: convertToA2AArtifact(artifact),
  append: true,
  lastChunk: part.isLastChunk
});
```

## State Synchronization

> **Note**: The code examples in this section use the deprecated API for historical context.
> The current implementation uses type-specific methods with context scoping. See the
> "API Update" section at the top of this document for the current API.

### Client-Side State Management

Task state maintains artifact references for resumption:

```typescript
interface PersistedLoopState {
  // ...
  artifactIds: string[];  // All artifacts created during this task
  // ...
}
```

When a task is resumed, artifacts are:
1. Loaded from artifact store
2. Included in initial `task` event
3. Ready for continued streaming

## Artifact Lifecycle

### Creation Flow

```
┌─────────────┐
│   LLM or    │
│    Tool     │
└──────┬──────┘
       │ 1. Create artifact
       ▼
┌─────────────────────────────────────────┐
│        Artifact Store                   │
│  • Generate artifact ID                 │
│  • Initialize metadata                  │
│  • Persist to storage                   │
└──────┬──────────────────────────────────┘
       │ 2. artifactId returned
       ▼
┌─────────────────────────────────────────┐
│      A2A Event Emitter                  │
│  • Emit artifact-update event           │
│  • kind: "artifact-update"              │
│  • append: false                        │
│  • artifact: { artifactId, parts: [] }  │
└──────┬──────────────────────────────────┘
       │ 3. SSE stream
       ▼
┌─────────────────────────────────────────┐
│       Client receives                   │
│  data: {"jsonrpc":"2.0","id":1,         │
│    "result":{"kind":"artifact-update",  │
│      "artifact":{"artifactId":"art-1"}}}│
└─────────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────┐
│      State Store Update                 │
│  • Add artifactId to state.artifactIds  │
│  • Checkpoint updated state             │
└─────────────────────────────────────────┘
```

### Streaming Update Flow (LLM Chunks)

```
┌─────────────┐
│ LLM Stream  │ "Based on "
└──────┬──────┘
       │ 1. Chunk received
       ▼
┌─────────────────────────────────────────┐
│    Artifact Store                       │
│  • appendPart(artifactId, {             │
│      kind: "text",                      │
│      content: "Based on "               │
│    })                                   │
│  • Update artifact.parts[n]             │
│  • Increment version                    │
└──────┬──────────────────────────────────┘
       │ 2. Part appended
       ▼
┌─────────────────────────────────────────┐
│      A2A Event Emitter                  │
│  • Emit artifact-update event           │
│  • kind: "artifact-update"              │
│  • append: true                         │
│  • artifact: { parts: [new part] }      │
│  • lastChunk: false                     │
└──────┬──────────────────────────────────┘
       │ 3. SSE stream
       ▼
┌─────────────────────────────────────────┐
│       Client updates                    │
│  • Appends to local artifact            │
│  • Renders incrementally                │
└─────────────────────────────────────────┘

... (repeated for each chunk)

┌─────────────┐
│ LLM Stream  │ "15%" [FINAL]
└──────┬──────┘
       │
       ▼
┌─────────────────────────────────────────┐
│    Artifact Store                       │
│  • appendPart(..., isLastChunk: true)   │
│  • Mark artifact.status = "complete"    │
└──────┬──────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────┐
│      A2A Event Emitter                  │
│  • append: true                         │
│  • lastChunk: true ✓                    │
└─────────────────────────────────────────┘
```

### Multi-Part Artifact Flow

```
┌─────────────┐
│    Tool     │ Creates report with text + chart
└──────┬──────┘
       │
       ├─ 1. Create artifact
       │     artifactId = "report-1"
       │
       ├─ 2. Append text part
       │     appendPart(artifactId, {
       │       kind: "text",
       │       content: "## Sales Report..."
       │     })
       │     → A2A event: append=false
       │
       ├─ 3. Append file part (chart image)
       │     appendPart(artifactId, {
       │       kind: "file",
       │       content: "iVBORw0KGgoAAAANS...", // base64
       │       metadata: {
       │         fileName: "chart.png",
       │         mimeType: "image/png"
       │       }
       │     })
       │     → A2A event: append=true
       │
       └─ 4. Complete artifact
             appendPart(..., isLastChunk: true)
             → A2A event: append=true, lastChunk=true
```

## Artifact Store Interface (Current)

### Core Operations

```typescript
interface ArtifactStore {
  // ============================================================================
  // File Artifact Methods (streaming text/binary content)
  // ============================================================================

  /**
   * Create a new file artifact for streaming content
   * Context-scoped: artifacts are isolated by contextId
   */
  createFileArtifact(params: {
    artifactId: string;
    taskId: string;
    contextId: string;
    name?: string;
    description?: string;
    mimeType?: string;
    encoding?: 'utf-8' | 'base64';
    override?: boolean;  // If true, replaces existing artifact
  }): Promise<string>;

  /**
   * Append a chunk to a file artifact
   * Triggers A2A artifact-update event
   */
  appendFileChunk(
    contextId: string,
    artifactId: string,
    chunk: string,
    options?: {
      isLastChunk?: boolean;
    }
  ): Promise<void>;

  /**
   * Get complete file content as a string
   */
  getFileContent(
    contextId: string,
    artifactId: string
  ): Promise<string>;

  // ============================================================================
  // Data Artifact Methods (structured JSON objects)
  // ============================================================================

  /**
   * Create a new data artifact for JSON objects
   */
  createDataArtifact(params: {
    artifactId: string;
    taskId: string;
    contextId: string;
    name?: string;
    description?: string;
    override?: boolean;
  }): Promise<string>;

  /**
   * Write/update data artifact content (atomic operation)
   * Triggers A2A artifact-update event
   */
  writeData(
    contextId: string,
    artifactId: string,
    data: Record<string, unknown>
  ): Promise<void>;

  /**
   * Get data artifact content
   */
  getDataContent(
    contextId: string,
    artifactId: string
  ): Promise<Record<string, unknown>>;

  // ============================================================================
  // Dataset Artifact Methods (tabular data with batching)
  // ============================================================================

  /**
   * Create a new dataset artifact for tabular data
   */
  createDatasetArtifact(params: {
    artifactId: string;
    taskId: string;
    contextId: string;
    name?: string;
    description?: string;
    schema?: DatasetSchema;
    override?: boolean;
  }): Promise<string>;

  /**
   * Append a batch of rows to a dataset
   * Triggers A2A artifact-update event
   */
  appendDatasetBatch(
    contextId: string,
    artifactId: string,
    rows: Record<string, unknown>[],
    options?: {
      isLastBatch?: boolean;
    }
  ): Promise<void>;

  /**
   * Get all dataset rows
   */
  getDatasetRows(
    contextId: string,
    artifactId: string
  ): Promise<Record<string, unknown>[]>;

  // ============================================================================
  // Common Methods
  // ============================================================================

  /**
   * Get artifact metadata (context-scoped)
   */
  getArtifact(
    contextId: string,
    artifactId: string
  ): Promise<StoredArtifact | null>;

  /**
   * List artifacts by context and optionally filter by task
   */
  listArtifacts(
    contextId: string,
    taskId?: string
  ): Promise<string[]>;

  /**
   * Delete artifact (context-scoped)
   */
  deleteArtifact(
    contextId: string,
    artifactId: string
  ): Promise<void>;
}
```

### Artifact Data Model

```typescript
interface StoredArtifact {
  // Identity
  artifactId: string;
  taskId: string;
  contextId: string;

  // Metadata (A2A compatible)
  name?: string;
  description?: string;

  // Content composition
  parts: ArtifactPart[];
  totalParts: number;

  // Versioning for change tracking
  version: number;
  operations: ArtifactOperation[];

  // Lifecycle
  status: 'building' | 'complete' | 'failed';
  createdAt: string;  // ISO 8601
  updatedAt: string;
  completedAt?: string;

  // Streaming state
  lastChunkIndex: number;
  isLastChunk: boolean;
}

interface ArtifactPart {
  index: number;
  kind: 'text' | 'file' | 'data';

  // Inline content (for small parts)
  content?: string;  // For text
  data?: Record<string, unknown>;  // For structured data

  // External reference (for large files)
  fileReference?: {
    storageKey: string;
    size: number;
    checksum?: string;
  };

  // Metadata includes content-type information for file parts
  metadata?: {
    mimeType?: string;      // Content type for file parts
    fileName?: string;      // Original file name
    [key: string]: unknown; // Additional metadata
  };
}

interface ArtifactOperation {
  operationId: string;
  type: 'create' | 'append' | 'replace' | 'complete';
  timestamp: string;
  partIndex?: number;
  chunkIndex?: number;
  replacedPartIndexes?: number[];
}
```

## A2A Event Emission

> **Note**: The code examples in this section use the deprecated API for historical context.
> The current implementation uses type-specific methods (`createFileArtifact`, `createDataArtifact`,
> `createDatasetArtifact`, etc.) with context scoping (contextId as first parameter). See the
> "API Update" section at the top of this document for the current API.

### Event Emitter Decorator Pattern

To ensure all artifact changes trigger A2A events, we use a decorator:

```typescript
class ArtifactStoreWithEvents implements ArtifactStore {
  constructor(
    private delegate: ArtifactStore,
    private eventEmitter: A2AEventEmitter
  ) {}

  async createArtifact(params: {
    artifactId: string;
    taskId: string;
    contextId: string;
    name?: string;
    description?: string;
  }): Promise<string> {
    // 1. Create in store
    const artifactId = await this.delegate.createArtifact(params);

    // 2. Emit A2A event
    await this.emitArtifactUpdate(
      params.taskId,
      params.contextId,
      artifactId,
      'create',
      false,  // append
      false   // lastChunk
    );

    return artifactId;
  }

  async appendPart(
    artifactId: string,
    part: Omit<ArtifactPart, 'index'>,
    isLastChunk: boolean = false
  ): Promise<void> {
    // 1. Append to store
    await this.delegate.appendPart(artifactId, part, isLastChunk);

    // 2. Get artifact metadata
    const artifact = await this.delegate.getArtifact(artifactId);
    if (!artifact) throw new Error('Artifact not found');

    // 3. Emit A2A event
    await this.emitArtifactUpdate(
      artifact.taskId,
      artifact.contextId,
      artifactId,
      'append',
      true,         // append
      isLastChunk
    );
  }

  async replacePart(
    artifactId: string,
    partIndex: number,
    part: Omit<ArtifactPart, 'index'>
  ): Promise<void> {
    // 1. Replace in store
    await this.delegate.replacePart(artifactId, partIndex, part);

    // 2. Get artifact metadata
    const artifact = await this.delegate.getArtifact(artifactId);
    if (!artifact) throw new Error('Artifact not found');

    // 3. Emit A2A event
    await this.emitArtifactUpdate(
      artifact.taskId,
      artifact.contextId,
      artifactId,
      'replace',
      false,  // Not append, full replacement
      false   // Replace is never final
    );
  }

  // Delegate other methods directly
  async getArtifact(artifactId: string): Promise<StoredArtifact | null> {
    return this.delegate.getArtifact(artifactId);
  }

  async getArtifactParts(artifactId: string, resolveExternal?: boolean): Promise<ArtifactPart[]> {
    return this.delegate.getArtifactParts(artifactId, resolveExternal);
  }

  async getTaskArtifacts(taskId: string): Promise<string[]> {
    return this.delegate.getTaskArtifacts(taskId);
  }

  async queryArtifacts(params: {
    contextId: string;
    taskId?: string;
  }): Promise<string[]> {
    return this.delegate.queryArtifacts(params);
  }

  async getArtifactByContext(
    contextId: string,
    artifactId: string
  ): Promise<StoredArtifact | null> {
    return this.delegate.getArtifactByContext(contextId, artifactId);
  }

  async deleteArtifact(artifactId: string): Promise<void> {
    return this.delegate.deleteArtifact(artifactId);
  }

  async getArtifactContent(artifactId: string): Promise<string | object> {
    return this.delegate.getArtifactContent(artifactId);
  }

  private async emitArtifactUpdate(
    taskId: string,
    contextId: string,
    artifactId: string,
    operation: 'create' | 'append' | 'replace',
    append: boolean,
    lastChunk: boolean
  ): Promise<void> {
    // Get current artifact state
    const artifact = await this.delegate.getArtifact(artifactId);
    if (!artifact) return;

    // Convert to A2A format
    const a2aArtifact = await this.convertToA2AArtifact(artifact, operation);

    // Emit event
    const event: ArtifactUpdateEvent = {
      kind: 'artifact-update',
      taskId,
      contextId,
      artifact: a2aArtifact,
      append,
      lastChunk,
      metadata: {
        operation,
        version: artifact.version
      }
    };

    await this.eventEmitter.emit(taskId, event);
  }

  private async convertToA2AArtifact(
    artifact: StoredArtifact,
    operation: 'create' | 'append' | 'replace'
  ): Promise<A2AArtifact> {
    // For append operations, only send the latest part
    // For create/replace, send all parts
    const parts = operation === 'append'
      ? [artifact.parts[artifact.parts.length - 1]]
      : artifact.parts;

    return {
      artifactId: artifact.artifactId,
      name: artifact.name,
      description: artifact.description,
      parts: await Promise.all(parts.map(p => this.convertToA2APart(p))),
      metadata: {
        status: artifact.status,
        version: artifact.version
      }
    };
  }

  private async convertToA2APart(part: ArtifactPart): Promise<A2APart> {
    if (part.kind === 'text') {
      return {
        kind: 'text',
        text: part.content || '',
        metadata: part.metadata
      };
    }

    if (part.kind === 'file') {
      // Load from external storage if needed
      const content = part.fileReference
        ? await this.delegate.getArtifactContent(part.fileReference.storageKey)
        : part.content;

      return {
        kind: 'file',
        file: {
          name: part.metadata?.name as string,
          mimeType: part.metadata?.mimeType as string,
          bytes: typeof content === 'string' ? content : JSON.stringify(content)
        },
        metadata: part.metadata
      };
    }

    if (part.kind === 'data') {
      return {
        kind: 'data',
        data: part.data || {},
        metadata: part.metadata
      };
    }

    throw new Error(`Unknown part kind: ${part.kind}`);
  }
}
```

### Event Emitter Interface

```typescript
interface A2AEventEmitter {
  /**
   * Emit an A2A event for a task
   * This sends to all connected SSE clients subscribed to this task
   */
  emit(taskId: string, event: AgentEvent): Promise<void>;

  /**
   * Check if there are active subscribers for a task
   */
  hasSubscribers(taskId: string): boolean;

  /**
   * Get event history for resubscription
   */
  getEventHistory(taskId: string, since?: number): AgentEvent[];
}
```

### SSE Integration

```typescript
// In A2A server
app.post('/api/a2a', async (req, res) => {
  const { method, params } = req.body;

  if (method === 'message/stream') {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Create artifact store with event emission
    const artifactStore = new ArtifactStoreWithEvents(
      baseArtifactStore,
      a2aEventEmitter
    );

    // Create agent loop with artifact store
    const agentLoop = new AgentLoop({
      artifactStore,
      taskStateStore,
      // ...
    });

    // Execute and stream events
    const events$ = agentLoop.execute(params.message.parts[0].text, {
      contextId: params.message.contextId
    });

    events$.subscribe({
      next: (event) => {
        // Filter internal events
        if (!event.kind.startsWith('internal:')) {
          const response = {
            jsonrpc: '2.0',
            id: req.body.id,
            result: event
          };
          res.write(`data: ${JSON.stringify(response)}\n\n`);
        }
      },
      error: (err) => {
        const errorResponse = {
          jsonrpc: '2.0',
          id: req.body.id,
          error: {
            code: -32000,
            message: err.message
          }
        };
        res.write(`data: ${JSON.stringify(errorResponse)}\n\n`);
        res.end();
      },
      complete: () => res.end()
    });
  }
});
```

## State Synchronization

### Adding Artifacts to Task State

When artifacts are created, they must be added to task state:

```typescript
const trackArtifactInState = async (
  taskId: string,
  artifactId: string,
  taskStateStore: TaskStateStore
): Promise<void> => {
  // Load current state
  const state = await taskStateStore.load(taskId);
  if (!state) return;

  // Add artifact ID if not already present
  if (!state.artifactIds.includes(artifactId)) {
    state.artifactIds.push(artifactId);
    await taskStateStore.save(taskId, state);
  }
};
```

### RxJS Integration

```typescript
const createArtifactWithTracking$ = (
  params: {
    taskId: string;
    contextId: string;
    name?: string;
    description?: string;
  },
  artifactStore: ArtifactStore,
  taskStateStore: TaskStateStore
): Observable<string> => {
  return defer(async () => {
    // Create artifact (automatically emits A2A event)
    const artifactId = await artifactStore.createArtifact(params);

    // Track in state
    await trackArtifactInState(params.taskId, artifactId, taskStateStore);

    return artifactId;
  });
};
```

## Agent Loop Integration

> **Note**: The code examples in this section use the deprecated API for historical context.
> The current implementation uses type-specific methods with context scoping. See the
> "API Update" section at the top of this document for the current API.

### Creating Artifacts from LLM Responses

```typescript
const handleLLMStream$ = (
  state: LoopState,
  llmProvider: LLMProvider
): Observable<AgentEvent> => {
  let currentArtifactId: string | null = null;

  return llmProvider.call({
    messages: state.messages,
    tools: state.availableTools,
    stream: true
  }).pipe(
    concatMap(async (chunk) => {
      // Create artifact on first chunk
      if (!currentArtifactId) {
        currentArtifactId = await state.artifactStore.createArtifact({
          taskId: state.taskId,
          contextId: state.contextId,
          name: 'LLM Response'
        });
      }

      // Append chunk
      const isLastChunk = chunk.finished;
      await state.artifactStore.appendPart(
        currentArtifactId,
        {
          kind: 'text',
          content: chunk.message.content
        },
        isLastChunk
      );

      // Events are automatically emitted by ArtifactStoreWithEvents
      // Return internal event for logging
      return {
        kind: 'internal:llm-chunk' as const,
        taskId: state.taskId,
        artifactId: currentArtifactId,
        timestamp: new Date().toISOString()
      };
    })
  );
};
```

### Built-in Artifact Tools

Provide a single `artifact_update` tool that mirrors the A2A protocol using the `localTools()` helper:

```typescript
import { z } from 'zod';
import { localTools, tool } from './tools/local-tools';

// Zod schemas matching A2A protocol
const A2APartSchema = z.union([
  z.object({
    kind: z.literal('text'),
    text: z.string(),
    metadata: z.record(z.unknown()).optional()
  }),
  z.object({
    kind: z.literal('file'),
    file: z.object({
      name: z.string().optional(),
      mimeType: z.string().optional(),
      bytes: z.string().optional().describe('Base64 encoded content'),
      uri: z.string().optional()
    }),
    metadata: z.record(z.unknown()).optional()
  }),
  z.object({
    kind: z.literal('data'),
    data: z.record(z.unknown()),
    metadata: z.record(z.unknown()).optional()
  })
]);

const A2AArtifactSchema = z.object({
  artifactId: z.string(),
  name: z.string().optional(),
  description: z.string().optional(),
  parts: z.array(A2APartSchema),
  metadata: z.record(z.unknown()).optional()
});

/**
 * Create artifact management tool provider
 */
function createArtifactTools(
  artifactStore: ArtifactStore,
  taskStateStore: TaskStateStore
): ToolProvider {
  return localTools([
    tool(
      'artifact_update',
      'Create or update an artifact with one or more parts. Use append=false to replace all parts of an artifact, append=true to append parts to existing artifacts.',
      z.object({
        artifact: A2AArtifactSchema.describe('Artifact with parts to create or update'),
        append: z.boolean().optional().default(false).describe('If true, append parts to existing artifact. If false, replace all parts of the artifact.'),
        lastChunk: z.boolean().optional().default(false).describe('If true, marks the artifact as complete (no more updates expected)')
      }),
      async ({ artifact, append, lastChunk }, context) => {
        const { artifactId, name, description, parts } = artifact;

        // Check if artifact exists
        const existing = await artifactStore.getArtifact(artifactId);

        if (!existing && append) {
          throw new Error(`Cannot append to non-existent artifact: ${artifactId}`);
        }

        if (!existing) {
          // Create new artifact
          await artifactStore.createArtifact({
            taskId: context.taskId,
            contextId: context.contextId,
            name,
            description
          });

          // Track in state
          await trackArtifactInState(context.taskId, artifactId, taskStateStore);
        }

        // Convert A2A parts to internal format and append
        for (const part of parts) {
          const internalPart: Omit<ArtifactPart, 'index'> =
            part.kind === 'text'
              ? { kind: 'text', content: part.text, metadata: part.metadata }
            : part.kind === 'file'
              ? {
                  kind: 'file',
                  content: part.file.bytes,
                  metadata: {
                    fileName: part.file.name,
                    mimeType: part.file.mimeType,
                    uri: part.file.uri,
                    ...part.metadata
                  }
                }
            : { kind: 'data', data: part.data, metadata: part.metadata };

          await artifactStore.appendPart(
            artifactId,
            internalPart,
            lastChunk && parts.indexOf(part) === parts.length - 1
          );
        }

        return {
          artifactId,
          partsAdded: parts.length,
          complete: lastChunk
        };
      }
    ),

    tool(
      'list_artifacts',
      'List all artifacts for the current context, optionally filtered by task',
      z.object({
        taskId: z.string().optional().describe('Optional task ID to filter artifacts')
      }),
      async (params, context) => {
        const artifactIds = await artifactStore.queryArtifacts({
          contextId: context.contextId,
          taskId: params.taskId
        });

        const artifacts = await Promise.all(
          artifactIds.map(id => artifactStore.getArtifactByContext(context.contextId, id))
        );

        return {
          artifacts: artifacts.filter(a => a !== null).map(a => ({
            artifactId: a!.artifactId,
            taskId: a!.taskId,
            name: a!.name,
            description: a!.description,
            status: a!.status,
            totalParts: a!.totalParts
          }))
        };
      }
    ),

    tool(
      'get_artifact',
      'Get a specific artifact by ID within the current context',
      z.object({
        artifactId: z.string().describe('The artifact ID to retrieve')
      }),
      async (params, context) => {
        const artifact = await artifactStore.getArtifactByContext(
          context.contextId,
          params.artifactId
        );

        if (!artifact) {
          throw new Error(`Artifact not found: ${params.artifactId}`);
        }

        const parts = await artifactStore.getArtifactParts(params.artifactId, true);

        return {
          artifactId: artifact.artifactId,
          taskId: artifact.taskId,
          name: artifact.name,
          description: artifact.description,
          status: artifact.status,
          parts: parts.map(p => ({
            index: p.index,
            kind: p.kind,
            content: p.content,
            data: p.data,
            metadata: p.metadata
          }))
        };
      }
    )
  ]);
}
```

**Benefits of this approach:**
- **A2A Protocol Alignment**: Tool parameters match A2A `artifact-update` event structure exactly
- **Flexibility**: Single tool handles create, append, and multi-part updates
- **Simplicity**: LLM learns one tool instead of 4+ separate tools
- **Type Safety**: Zod schemas validate A2A protocol compliance at runtime
- **Multi-Part Support**: Can append multiple parts in one call (text + file + data)

**Example Usage:**

```typescript
// Create new artifact with initial content
await tool_call('artifact_update', {
  artifact: {
    artifactId: 'report-1',
    name: 'Sales Report',
    parts: [
      { kind: 'text', text: '# Q4 Sales Report\n\n' }
    ]
  },
  append: false,
  lastChunk: false
});

// Append more text
await tool_call('artifact_update', {
  artifact: {
    artifactId: 'report-1',
    parts: [
      { kind: 'text', text: '## Summary\n\nSales increased by 15%\n\n' }
    ]
  },
  append: true,
  lastChunk: false
});

// Append chart image and complete
await tool_call('artifact_update', {
  artifact: {
    artifactId: 'report-1',
    parts: [
      {
        kind: 'file',
        file: {
          name: 'chart.png',
          mimeType: 'image/png',
          bytes: 'iVBORw0KGgo...' // base64
        }
      }
    ]
  },
  append: true,
  lastChunk: true  // Marks artifact as complete
});
```

## Resumption and Resubscription

> **Note**: The code examples in this section use the deprecated API for historical context.
> The current implementation uses type-specific methods with context scoping. See the
> "API Update" section at the top of this document for the current API.

### Loading Artifacts on Resume

When a task is resumed, all artifacts must be included:

```typescript
const resumeTask$ = async (
  taskId: string,
  taskStateStore: TaskStateStore,
  artifactStore: ArtifactStore
): Promise<Observable<AgentEvent>> => {
  // Load persisted state
  const state = await taskStateStore.load(taskId);
  if (!state) throw new Error('Task not found');

  // Load all artifacts
  const artifacts = await Promise.all(
    state.artifactIds.map(async (artifactId) => {
      const artifact = await artifactStore.getArtifact(artifactId);
      if (!artifact) return null;

      // Convert to A2A format
      const parts = await artifactStore.getArtifactParts(artifactId, true);
      return {
        artifactId: artifact.artifactId,
        name: artifact.name,
        description: artifact.description,
        parts: parts.map(p => convertPartToA2A(p)),
        metadata: {
          status: artifact.status,
          version: artifact.version
        }
      };
    })
  );

  // Emit initial task event with artifacts
  return of<AgentEvent>({
    kind: 'task',
    id: taskId,
    contextId: state.contextId,
    status: {
      state: state.completed ? 'completed' : 'working',
      timestamp: state.lastActivity
    },
    history: state.messages,
    artifacts: artifacts.filter(a => a !== null) as A2AArtifact[],
    metadata: {
      iteration: state.iteration,
      resumedFrom: state.resumeFrom
    }
  }).pipe(
    // Continue execution if not completed
    state.completed
      ? tap(() => {}) // No-op, just emit task event
      : concatWith(continueExecution$(state))
  );
};
```

### A2A Resubscribe Endpoint

```typescript
// In A2A server
app.post('/api/a2a/tasks/resubscribe', async (req, res) => {
  const { taskId } = req.body.params;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    // Load task state
    const state = await taskStateStore.load(taskId);
    if (!state) {
      res.write(`data: ${JSON.stringify({
        jsonrpc: '2.0',
        id: req.body.id,
        error: { code: -32001, message: 'Task not found' }
      })}\n\n`);
      res.end();
      return;
    }

    // Load artifacts
    const artifacts = await Promise.all(
      state.artifactIds.map(id => artifactStore.getArtifact(id))
    );

    // Send initial task event with full history
    const taskEvent: TaskEvent = {
      kind: 'task',
      id: taskId,
      contextId: state.contextId,
      status: {
        state: state.completed ? 'completed' : 'working',
        timestamp: state.lastActivity
      },
      history: state.messages,
      artifacts: await Promise.all(
        artifacts.filter(a => a !== null).map(a => convertArtifactToA2A(a!))
      )
    };

    res.write(`data: ${JSON.stringify({
      jsonrpc: '2.0',
      id: req.body.id,
      result: taskEvent
    })}\n\n`);

    if (state.completed) {
      // Send final status
      const finalEvent: StatusUpdateEvent = {
        kind: 'status-update',
        taskId,
        contextId: state.contextId,
        status: {
          state: 'completed',
          timestamp: state.lastActivity
        },
        final: true
      };

      res.write(`data: ${JSON.stringify({
        jsonrpc: '2.0',
        id: req.body.id,
        result: finalEvent
      })}\n\n`);
      res.end();
    } else {
      // Continue streaming live updates
      const resume$ = await resumeTask$(taskId, taskStateStore, artifactStore);

      resume$.subscribe({
        next: (event) => {
          if (!event.kind.startsWith('internal:')) {
            res.write(`data: ${JSON.stringify({
              jsonrpc: '2.0',
              id: req.body.id,
              result: event
            })}\n\n`);
          }
        },
        complete: () => res.end()
      });
    }
  } catch (error) {
    res.write(`data: ${JSON.stringify({
      jsonrpc: '2.0',
      id: req.body.id,
      error: {
        code: -32000,
        message: error instanceof Error ? error.message : String(error)
      }
    })}\n\n`);
    res.end();
  }
});
```

## Storage Strategies

### Small Content: Redis Inline Storage

For small artifacts (< 100KB), store directly in Redis:

```typescript
class RedisArtifactStore implements ArtifactStore {
  private readonly INLINE_THRESHOLD = 100 * 1024; // 100KB

  async appendPart(
    artifactId: string,
    part: Omit<ArtifactPart, 'index'>,
    isLastChunk: boolean = false
  ): Promise<void> {
    const artifact = await this.getArtifact(artifactId);
    if (!artifact) throw new Error('Artifact not found');

    const estimatedSize = this.estimateSize(part);

    if (estimatedSize <= this.INLINE_THRESHOLD) {
      // Store inline
      artifact.parts.push({
        ...part,
        index: artifact.parts.length
      });
    } else {
      // Store externally
      const storageKey = `artifact:${artifactId}:part:${artifact.parts.length}`;
      await this.storeExternally(storageKey, part);

      artifact.parts.push({
        index: artifact.parts.length,
        kind: part.kind,
        fileReference: {
          storageKey,
          size: estimatedSize,
          checksum: await this.calculateChecksum(content)
        },
        metadata: part.metadata
      });
    }

    artifact.version++;
    artifact.updatedAt = new Date().toISOString();
    if (isLastChunk) {
      artifact.status = 'complete';
      artifact.completedAt = artifact.updatedAt;
    }

    await this.saveArtifact(artifact);
  }

  private estimateSize(part: Omit<ArtifactPart, 'index'>): number {
    if (part.content) return Buffer.byteLength(part.content, 'utf8');
    if (part.data) return Buffer.byteLength(JSON.stringify(part.data), 'utf8');
    return 0;
  }

  private async storeExternally(key: string, part: Omit<ArtifactPart, 'index'>): Promise<void> {
    const content = part.content || JSON.stringify(part.data);

    if (this.s3Client) {
      // Store in S3
      await this.s3Client.putObject({
        Bucket: this.s3Bucket,
        Key: key,
        Body: content
      }).promise();
    } else {
      // Fallback to Redis with compression
      const compressed = await gzip(content);
      await this.redis.set(`external:${key}`, compressed);
    }
  }
}
```

### Large Files: S3/External Storage

For large files, use external storage and store references. MIME type is stored in part metadata:

```
Redis (Metadata):
{
  artifactId: "report-123",
  parts: [
    {
      index: 0,
      kind: "text",
      content: "# Report..." // Small, inline
    },
    {
      index: 1,
      kind: "file",
      fileReference: {
        storageKey: "s3://bucket/artifact-123-part-1.png",
        size: 2048576,
        checksum: "sha256:abc123..."
      },
      metadata: {
        fileName: "sales-chart.png",
        mimeType: "image/png"
      }
    }
  ]
}

S3 (Content):
s3://bucket/artifact-123-part-1.png → [binary image data]
```

## Error Handling

### Artifact Creation Failures

```typescript
try {
  const artifactId = await artifactStore.createArtifact({
    taskId: state.taskId,
    contextId: state.contextId,
    name: 'Output'
  });
} catch (error) {
  // Emit error status update
  const errorEvent: StatusUpdateEvent = {
    kind: 'status-update',
    taskId: state.taskId,
    contextId: state.contextId,
    status: {
      state: 'failed',
      message: {
        role: 'assistant',
        content: 'Failed to create artifact'
      },
      timestamp: new Date().toISOString()
    },
    final: true,
    metadata: {
      error: error instanceof Error ? error.message : String(error)
    }
  };

  await eventEmitter.emit(state.taskId, errorEvent);
  throw error;
}
```

### Partial Upload Recovery

```typescript
const resumeArtifactUpload = async (
  artifactId: string,
  artifactStore: ArtifactStore
): Promise<void> => {
  const artifact = await artifactStore.getArtifact(artifactId);
  if (!artifact) throw new Error('Artifact not found');

  if (artifact.status === 'building' && !artifact.isLastChunk) {
    // Artifact was incomplete, can continue appending
    return;
  }

  if (artifact.status === 'failed') {
    // Mark as building again to retry
    artifact.status = 'building';
    await artifactStore.saveArtifact(artifact);
  }
};
```

## Performance Considerations

### Batching A2A Events

For high-frequency updates (e.g., LLM streaming), batch events:

```typescript
class BatchedEventEmitter implements A2AEventEmitter {
  private batchInterval = 50; // ms
  private pending = new Map<string, AgentEvent[]>();
  private timers = new Map<string, NodeJS.Timeout>();

  async emit(taskId: string, event: AgentEvent): Promise<void> {
    if (!this.pending.has(taskId)) {
      this.pending.set(taskId, []);
    }

    this.pending.get(taskId)!.push(event);

    // Clear existing timer
    const existingTimer = this.timers.get(taskId);
    if (existingTimer) clearTimeout(existingTimer);

    // Set new timer
    const timer = setTimeout(() => this.flush(taskId), this.batchInterval);
    this.timers.set(taskId, timer);
  }

  private async flush(taskId: string): Promise<void> {
    const events = this.pending.get(taskId);
    if (!events || events.length === 0) return;

    // Combine consecutive artifact-update events
    const combined = this.combineArtifactUpdates(events);

    // Send to SSE clients
    for (const event of combined) {
      this.sseServer.send(taskId, event);
    }

    this.pending.delete(taskId);
    this.timers.delete(taskId);
  }

  private combineArtifactUpdates(events: AgentEvent[]): AgentEvent[] {
    const result: AgentEvent[] = [];
    let buffer: ArtifactUpdateEvent | null = null;

    for (const event of events) {
      if (event.kind === 'artifact-update') {
        if (buffer && buffer.artifact.artifactId === event.artifact.artifactId) {
          // Combine consecutive updates for same artifact
          buffer.artifact.parts.push(...event.artifact.parts);
          buffer.lastChunk = event.lastChunk;
        } else {
          if (buffer) result.push(buffer);
          buffer = { ...event };
        }
      } else {
        if (buffer) {
          result.push(buffer);
          buffer = null;
        }
        result.push(event);
      }
    }

    if (buffer) result.push(buffer);
    return result;
  }
}
```

### Caching Artifact Metadata

```typescript
class CachedArtifactStore implements ArtifactStore {
  private cache = new Map<string, { artifact: StoredArtifact; expiry: number }>();
  private cacheTTL = 60000; // 1 minute

  async getArtifact(artifactId: string): Promise<StoredArtifact | null> {
    const cached = this.cache.get(artifactId);
    if (cached && cached.expiry > Date.now()) {
      return cached.artifact;
    }

    const artifact = await this.delegate.getArtifact(artifactId);
    if (artifact) {
      this.cache.set(artifactId, {
        artifact,
        expiry: Date.now() + this.cacheTTL
      });
    }

    return artifact;
  }

  async appendPart(...args: Parameters<ArtifactStore['appendPart']>): Promise<void> {
    await this.delegate.appendPart(...args);
    // Invalidate cache
    this.cache.delete(args[0]);
  }
}
```

## Testing

### Testing Artifact Creation and Streaming

```typescript
describe('Artifact Management', () => {
  it('should emit artifact-update event on creation', async () => {
    const events: AgentEvent[] = [];
    const eventEmitter = new MockEventEmitter(events);

    const artifactStore = new ArtifactStoreWithEvents(
      new InMemoryArtifactStore(),
      eventEmitter
    );

    const artifactId = await artifactStore.createArtifact({
      taskId: 'task-1',
      contextId: 'ctx-1',
      name: 'Test Artifact'
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: 'artifact-update',
      taskId: 'task-1',
      contextId: 'ctx-1',
      artifact: {
        artifactId,
        name: 'Test Artifact'
      },
      append: false,
      lastChunk: false
    });
  });

  it('should emit artifact-update events on streaming', async () => {
    const events: AgentEvent[] = [];
    const eventEmitter = new MockEventEmitter(events);

    const artifactStore = new ArtifactStoreWithEvents(
      new InMemoryArtifactStore(),
      eventEmitter
    );

    const artifactId = await artifactStore.createArtifact({
      taskId: 'task-1',
      contextId: 'ctx-1'
    });

    // Append chunks
    await artifactStore.appendPart(artifactId, {
      kind: 'text',
      content: 'Part 1'
    });

    await artifactStore.appendPart(artifactId, {
      kind: 'text',
      content: 'Part 2'
    }, true); // Last chunk

    expect(events).toHaveLength(3); // Create + 2 appends
    expect(events[2]).toMatchObject({
      kind: 'artifact-update',
      append: true,
      lastChunk: true
    });
  });
});
```

## Implementation Checklist

- [ ] Implement `ArtifactStoreWithEvents` decorator
- [ ] Implement `RedisArtifactStore` with S3 fallback
- [ ] Implement `InMemoryArtifactStore` for testing
- [ ] Add `ArtifactToolProvider` with built-in tools
- [ ] Integrate artifact creation in LLM streaming
- [ ] Add artifact tracking to state store
- [ ] Implement resubscribe with artifact history
- [ ] Add batched event emission for performance
- [ ] Add artifact metadata caching
- [ ] Write comprehensive tests

## References

- [A2A Protocol Specification](https://a2a-protocol.org/latest/specification/)
- [Agent Loop Design](./agent-loop.md)
- [Architecture Overview](./architecture.md)
- Implementation: `packages/core/src/stores/` (to be created)
