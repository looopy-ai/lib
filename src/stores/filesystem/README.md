# Filesystem Stores

Filesystem-based implementations of state, message, and artifact stores.

## Directory Structure

All data is stored in a structured directory hierarchy:

```
## Directory Structure

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
                └── {filename}
```
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

**Note:** StateStore has been renamed to TaskStateStore for clarity. This store is for per-task crash recovery, not session management (use ContextStore for that).

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

Stores artifacts with metadata and parts in structured directories.

**Features:**
- Artifact metadata and parts stored separately
- Consolidated content files (text or JSON)
- Efficient part-based updates
- Multi-part artifact support

**Example:**
```typescript
import { FileSystemArtifactStore } from '../src/stores/filesystem';

const artifactStore = new FileSystemArtifactStore({
  basePath: './_agent_store',
  agentId: 'my-agent',
});
```

## Store Architecture

Understanding the different stores:

- **ContextStore** - Session-level metadata (one per conversation)
  - Purpose: Discovery, locking, multi-user access, lifecycle management
  - Lifetime: Days/weeks (user-managed)
  - Granularity: per contextId

- **TaskStateStore** (formerly StateStore) - Per-task checkpoint state
  - Purpose: AgentLoop crash recovery (resume mid-turn)
  - Lifetime: Hours (auto-expires)
  - Granularity: per taskId

- **MessageStore** - Conversation history
  - Purpose: Multi-turn message persistence
  - Lifetime: Same as context
  - Granularity: per contextId

- **ArtifactStore** - Generated artifacts
  - Purpose: Store created content
  - Lifetime: Same as context
  - Granularity: per contextId/taskId

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

## Migration from StateStore to TaskStateStore

If you're upgrading from an older version:

```typescript
// Old (still works - deprecated)
import type { StateStore } from '../src/core/types';

// New (recommended)
import type { TaskStateStore } from '../src/core/types';
```

The `StateStore` type is now an alias for `TaskStateStore` and will be removed in v2.0.

## Design References

- [design/agent-lifecycle.md](../../../design/agent-lifecycle.md) - Agent and context management
- [design/agent-loop.md](../../../design/agent-loop.md) - Task state persistence
- [design/message-management.md](../../../design/message-management.md) - Message store design (if exists)
- [design/artifact-management.md](../../../design/artifact-management.md) - Artifact storage
