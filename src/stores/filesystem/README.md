# Filesystem Stores

Filesystem-based implementations of state, message, and artifact stores.

## Directory Structure

All data is stored in a structured directory hierarchy:

```
./_agent_store/
└── agent={agentId}/
    └── context={contextId}/
        ├── context.json                  # Context/session metadata
        ├── context.lock                  # Context lock file
        ├── task/                         # Per-task checkpoint state
        │   └── {taskId}.json
        ├── messages/                     # Conversation history
        │   └── {timestamp}.json
        └── artifacts/                    # Generated artifacts
            └── {artifactId}/
                ├── metadata.json         # Artifact metadata
                ├── content.txt           # File content (FileArtifact - chunks appended)
                ├── data.json             # Data content (DataArtifact)
                └── rows.jsonl            # Dataset rows (DatasetArtifact)
```

## Stores

### FileSystemContextStore

**NEW** - Stores agent context/session state for multi-turn conversation management.

**Features:**
- Session metadata (title, description, tags)
- Lifecycle tracking (status, turn count, timestamps)
- Concurrency control with file-based locking
- Discovery and search capabilities
- Access control (ownership, sharing, permissions)
- Partial updates without full reload

**Example:**
```typescript
import { FileSystemContextStore } from '../src/stores/filesystem';

const contextStore = new FileSystemContextStore({
  basePath: './_agent_store',
  defaultLockTTL: 300, // 5 minutes
});

// Create or load context
let context = await contextStore.load(contextId);
if (!context) {
  context = {
    contextId,
    agentId,
    status: 'active',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastActivityAt: new Date().toISOString(),
    turnCount: 0,
  };
  await contextStore.save(context);
}

// List all contexts
const contexts = await contextStore.list({ agentId, status: 'active' });

// Search contexts
const found = await contextStore.search('project', { agentId });

// Acquire lock for concurrent processing
const acquired = await contextStore.acquireLock(contextId, processId);
```

### FileSystemStateStore (now FileSystemTaskStateStore)

Stores per-task checkpoint state for AgentLoop crash recovery.

**Note:** TaskStateStore has been renamed to TaskStateStore for clarity. This store is for per-task crash recovery, not session management (use ContextStore for that).

**Features:**
- JSON dump of complete per-turn state
- TTL support with automatic expiration
- Efficient task lookup and filtering
- Resumption after server crashes mid-turn

**Example:**
```typescript
import { FileSystemStateStore } from '../src/stores/filesystem';

const taskStateStore = new FileSystemStateStore({
  basePath: './_agent_store',
  defaultTTL: 86400, // 24 hours
});
```

### FileSystemMessageStore

Stores conversation messages as individual timestamped JSON files.

**Features:**
- One file per message with ISO timestamp
- Chronological ordering
- Efficient recent message retrieval
- Sliding-window compaction

**Example:**
```typescript
import { FileSystemMessageStore } from '../src/stores/filesystem';

const messageStore = new FileSystemMessageStore({
  basePath: './_agent_store',
  agentId: 'my-agent',
});
```

### FileSystemArtifactStore

Stores artifacts with discriminated union types for files, data, and datasets.

**Features:**
- **Discriminated union types** - Separate interfaces for FileArtifact, DataArtifact, DatasetArtifact
- **Type-specific methods** - Each artifact type has dedicated creation and access methods
- **Efficient file storage** - Chunks appended to single `content.txt` file (not separate chunk files)
- **Structured data support** - JSON data storage with schema validation
- **Dataset rows** - Newline-delimited JSON for streaming dataset access
- **Version tracking** - Operation history and versioning
- **Metadata separation** - Artifacts stored independently of messages

#### Artifact Types

**FileArtifact** - Text/binary file content:
```typescript
{
  type: 'file',
  artifactId: string,
  mimeType: string,
  encoding: 'utf-8' | 'base64',
  chunks: ChunkMetadata[],    // Metadata only, actual content in content.txt
  totalChunks: number,
  totalSize: number,
  status: 'building' | 'complete' | 'error'
}
```

**DataArtifact** - Structured JSON data:
```typescript
{
  type: 'data',
  artifactId: string,
  data: Record<string, unknown>,  // Stored in data.json
  schema?: DataSchema
}
```

**DatasetArtifact** - Tabular data with streaming:
```typescript
{
  type: 'dataset',
  artifactId: string,
  schema: DatasetSchema,          // Column definitions
  rows: DataRow[],                // Row metadata (actual rows in rows.jsonl)
  totalRows: number
}
```

#### Directory Structure per Artifact Type

**FileArtifact:**
```
artifacts/{artifactId}/
├── metadata.json       # FileArtifact metadata with chunks array
└── content.txt         # All chunks appended to single file
```

**DataArtifact:**
```
artifacts/{artifactId}/
├── metadata.json       # DataArtifact metadata with schema
└── data.json          # Actual data object
```

**DatasetArtifact:**
```
artifacts/{artifactId}/
├── metadata.json       # DatasetArtifact metadata with schema
└── rows.jsonl         # Newline-delimited JSON rows
```

#### Type-Specific Methods

**File Operations:**
```typescript
// Create file artifact
const artifactId = await artifactStore.createFileArtifact({
  contextId: 'ctx-123',
  taskId: 'task-456',
  name: 'analysis.txt',
  mimeType: 'text/plain',
  encoding: 'utf-8'
});

// Append chunks (appended to single content.txt file)
await artifactStore.appendFileChunk(artifactId, 'First chunk\n');
await artifactStore.appendFileChunk(artifactId, 'Second chunk\n');
await artifactStore.appendFileChunk(artifactId, 'Final chunk', { isLastChunk: true });

// Get content (reads single content.txt file)
const content = await artifactStore.getFileContent(artifactId);
```

**Data Operations:**
```typescript
// Create data artifact
const artifactId = await artifactStore.createDataArtifact({
  contextId: 'ctx-123',
  taskId: 'task-456',
  name: 'results',
  data: { status: 'success', count: 42 },
  schema: {
    type: 'object',
    properties: {
      status: { type: 'string' },
      count: { type: 'number' }
    }
  }
});

// Update data
await artifactStore.updateDataContent(artifactId, {
  status: 'complete',
  count: 100
});

// Get data
const data = await artifactStore.getDataContent(artifactId);
```

**Dataset Operations:**
```typescript
// Create dataset artifact
const artifactId = await artifactStore.createDatasetArtifact({
  contextId: 'ctx-123',
  taskId: 'task-456',
  name: 'sales',
  schema: {
    columns: [
      { name: 'date', type: 'string' },
      { name: 'amount', type: 'number' }
    ]
  }
});

// Append rows (appended to rows.jsonl)
await artifactStore.appendDatasetRow(artifactId, {
  date: '2025-01-01',
  amount: 100
});

await artifactStore.appendDatasetRows(artifactId, [
  { date: '2025-01-02', amount: 150 },
  { date: '2025-01-03', amount: 200 }
]);

// Get all rows
const rows = await artifactStore.getDatasetRows(artifactId);

// Stream rows for large datasets
for await (const row of artifactStore.streamDatasetRows(artifactId)) {
  console.log(row);
}
```

#### Complete Example

```typescript
import { FileSystemArtifactStore } from '../src/stores/filesystem';

const artifactStore = new FileSystemArtifactStore({
  basePath: './_agent_store',
  agentId: 'my-agent',
});

// Create file artifact with streaming chunks
const fileId = await artifactStore.createFileArtifact({
  contextId: 'ctx-123',
  taskId: 'task-456',
  name: 'report.txt',
  mimeType: 'text/plain'
});

// Chunks are appended to single content.txt file
await artifactStore.appendFileChunk(fileId, 'Based on the analysis, ');
await artifactStore.appendFileChunk(fileId, 'sales increased by 15% in Q4.');
await artifactStore.appendFileChunk(fileId, '\n\nEnd of report.', { isLastChunk: true });

// Read complete content
const report = await artifactStore.getFileContent(fileId);

// Create data artifact
const dataId = await artifactStore.createDataArtifact({
  contextId: 'ctx-123',
  taskId: 'task-456',
  name: 'summary',
  data: {
    quarter: 'Q4',
    increase: 0.15,
    revenue: 1_250_000
  }
});

// Create dataset artifact
const datasetId = await artifactStore.createDatasetArtifact({
  contextId: 'ctx-123',
  taskId: 'task-456',
  name: 'sales_data',
  schema: {
    columns: [
      { name: 'month', type: 'string' },
      { name: 'sales', type: 'number' }
    ]
  }
});

await artifactStore.appendDatasetRows(datasetId, [
  { month: 'October', sales: 400_000 },
  { month: 'November', sales: 425_000 },
  { month: 'December', sales: 425_000 }
]);
```

## Store Architecture

Understanding the different stores:

- **ContextStore** - Session-level metadata (one per conversation)
  - Purpose: Discovery, locking, multi-user access, lifecycle management
  - Lifetime: Days/weeks (user-managed)
  - Granularity: per contextId

- **TaskStateStore** (formerly TaskStateStore) - Per-task checkpoint state
  - Purpose: AgentLoop crash recovery (resume mid-turn)
  - Lifetime: Hours (auto-expires)
  - Granularity: per taskId

- **MessageStore** - Conversation history
  - Purpose: Multi-turn message persistence
  - Lifetime: Same as context
  - Granularity: per contextId

- **ArtifactStore** - Generated artifacts
  - Purpose: Store created content (files, data, datasets)
  - Lifetime: Same as context
  - Granularity: per contextId/taskId
  - **NEW:** Discriminated union types for type-safe operations

## Usage with Agent

All stores work together with the Agent class:

```typescript
import { Agent } from '../src/core/agent';
import {
  FileSystemContextStore,
  FileSystemStateStore,
  FileSystemMessageStore,
  FileSystemArtifactStore,
} from '../src/stores/filesystem';

const agentId = 'my-agent';
const contextId = 'user-session-123';

// Initialize stores
const contextStore = new FileSystemContextStore();
const taskStateStore = new FileSystemStateStore(); // Used by AgentLoop internally
const messageStore = new FileSystemMessageStore({ agentId });
const artifactStore = new FileSystemArtifactStore({ agentId });

// Load or create context
let context = await contextStore.load(contextId);
if (!context) {
  context = {
    contextId,
    agentId,
    status: 'active',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastActivityAt: new Date().toISOString(),
    turnCount: 0,
  };
  await contextStore.save(context);
}

// Create agent
const agent = new Agent({
  contextId,
  agentId,
  llmProvider,
  toolProviders,
  messageStore,
  artifactStore,
  // Note: Agent passes NoopStateStore to AgentLoop by default
});

// Update context after each turn
const events$ = await agent.startTurn(userMessage);
await lastValueFrom(events$);
await contextStore.update(contextId, {
  turnCount: context.turnCount + 1,
  lastActivityAt: new Date().toISOString(),
});
```

## Complete Example

See [`examples/kitchen-sink.ts`](../../../examples/kitchen-sink.ts) for a full interactive CLI example using all filesystem stores.

## Migration from TaskStateStore to TaskStateStore

If you're upgrading from an older version:

```typescript
// Old (still works - deprecated)
import type { TaskStateStore } from '../src/core/types';

// New (recommended)
import type { TaskStateStore } from '../src/core/types';
```

The `TaskStateStore` type is now an alias for `TaskStateStore` and will be removed in v2.0.

## Design References

- [design/agent-lifecycle.md](../../../design/agent-lifecycle.md) - Agent and context management
- [design/agent-loop.md](../../../design/agent-loop.md) - Task state persistence
- [design/artifact-management.md](../../../design/artifact-management.md) - Artifact storage with discriminated unions
