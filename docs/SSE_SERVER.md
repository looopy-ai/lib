# SSE Server Implementation

Server-Sent Events (SSE) infrastructure for streaming internal events to clients in real-time.

## Overview

The SSE server provides a complete solution for streaming agent events to clients over HTTP using the Server-Sent Events protocol. It includes:

- **Event Buffer**: Circular buffer with TTL-based expiry for event replay on reconnection
- **Event Router**: Pub/sub system with multi-level filtering
- **SSE Connections**: Individual client connection management with heartbeat
- **SSE Server**: Orchestration layer integrating buffer, router, and connections

## Architecture

```
┌───────────────────────────────────────────────────────────┐
│                      SSE Server                           │
│                                                           │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │ Event Buffer │  │ Event Router │  │ SSE Conns    │     │
│  │ (circular)   │  │ (pub/sub)    │  │ (heartbeat)  │     │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘     │
│         │                 │                 │             │
│         └─────────────────┴─────────────────┘             │
│                           │                               │
└───────────────────────────┼───────────────────────────────┘
                            │
                            ▼
                     ┌──────────────┐
                     │   Clients    │
                     │ (EventSource)│
                     └──────────────┘
```

## Quick Start

### Basic SSE Endpoint Using Express

```typescript
import express from 'express';
import { SSEServer } from '@looopy-ai/server';

const app = express();
const sseServer = new SSEServer();

// SSE endpoint
app.get('/events/:contextId', (req, res) => {
  const { contextId } = req.params;
  const lastEventId = req.headers['last-event-id'] as string | undefined;

  sseServer.subscribe(res, {
    contextId,
    lastEventId,
  });
});

// Emit events
sseServer.emit(contextId, event);

app.listen(3000);
```

### Hono SSE Endpoint

```typescript
import { Hono } from 'hono';
import { SSEServer } from '@looopy-ai/server';

const app = new Hono();
const sseServer = new SSEServer();

// SSE endpoint
app.get('/events/:contextId', async (c) => {
  const contextId = c.req.param('contextId');
  const lastEventId = c.req.header('last-event-id');

  // Set SSE headers
  c.header('Content-Type', 'text/event-stream');
  c.header('Cache-Control', 'no-cache');
  c.header('Connection', 'keep-alive');
  c.header('Access-Control-Allow-Origin', '*');

  // Get the native response object for Hono
  const res = c.env.outgoing || c.res;

  sseServer.subscribe(res, {
    contextId,
    lastEventId,
  });

  return c.newResponse(null);
});

// Emit events
app.post('/events/:contextId/emit', async (c) => {
  const contextId = c.req.param('contextId');
  const event = await c.req.json();

  sseServer.emit(contextId, event);

  return c.json({ success: true });
});

export default app;
```

### Client Connection

```typescript
// Browser/Node.js client
const eventSource = new EventSource('/events/my-context-id');

eventSource.addEventListener('task-created', (e) => {
  const event = JSON.parse(e.data);
  console.log('Task created:', event.taskId);
});

eventSource.addEventListener('task-status', (e) => {
  const event = JSON.parse(e.data);
  console.log('Status:', event.status);
});

eventSource.onerror = (error) => {
  console.error('Connection error:', error);
};
```

## Components

### EventBuffer

Circular buffer for storing events with automatic TTL-based expiry.

#### Features

- **Circular Buffer**: Fixed size with FIFO eviction
- **TTL Expiry**: Automatic cleanup of old events (default: 5 minutes)
- **Monotonic IDs**: Sequential event IDs per context (`{contextId}-{counter}`)
- **Event Replay**: Retrieve events since last ID for reconnection

#### API

```typescript
interface EventBufferConfig {
  maxSize?: number;        // Max events per context (default: 100)
  ttl?: number;            // Event TTL in ms (default: 300000 = 5 min)
  autoCleanup?: boolean;   // Enable periodic cleanup (default: true)
  cleanupInterval?: number; // Cleanup interval in ms (default: 30000 = 30s)
}

class EventBuffer {
  constructor(config?: EventBufferConfig);

  // Add event and return its ID
  add(contextId: string, event: InternalEvent): string;

  // Get all events for a context
  getAll(contextId: string): BufferedEvent[];

  // Get events since a given ID (for reconnection)
  getEventsSince(contextId: string, lastEventId: string): BufferedEvent[];

  // Clear all events for a context
  clear(contextId: string): void;

  // Manually trigger cleanup
  cleanup(): number; // Returns count of removed events

  // Get buffer statistics
  stats(): BufferStats;

  // Cleanup and stop auto-cleanup timer
  shutdown(): void;
}
```

#### Example

```typescript
import { EventBuffer } from 'looopy/server';

const buffer = new EventBuffer({
  maxSize: 200,
  ttl: 600000, // 10 minutes
});

// Add events
const id1 = buffer.add('ctx-1', createTaskCreatedEvent({
  contextId: 'ctx-1',
  taskId: 'task-1',
  initiator: 'user',
}));

const id2 = buffer.add('ctx-1', createTaskStatusEvent({
  contextId: 'ctx-1',
  taskId: 'task-1',
  status: 'working',
}));

// Get events since last connection
const events = buffer.getEventsSince('ctx-1', id1);
console.log(`${events.length} events since ${id1}`);

// Cleanup
buffer.shutdown();
```

### EventRouter

Pub/sub event routing with multi-level filtering.

#### Features

- **Context-scoped**: Events routed by context ID
- **Multi-level Filtering**: 5 filter levels executed in order
- **Graceful Errors**: One subscriber error doesn't affect others
- **Subscription Management**: Add/remove subscribers dynamically

#### Filter Levels

1. **Context Filter**: Route to correct context (required)
2. **Task Filter**: Filter by specific task ID
3. **Internal Filter**: Exclude internal events (e.g., `internal:*`)
4. **Include Kinds**: Whitelist specific event kinds
5. **Exclude Kinds**: Blacklist specific event kinds
6. **Custom Filter**: User-defined filter function

#### API

```typescript
interface SubscriptionConfig {
  contextId: string;           // Required: context to subscribe to
  taskId?: string;             // Optional: filter by task ID
  filterInternal?: boolean;    // Optional: exclude internal:* events
  includeKinds?: string[];     // Optional: whitelist event kinds
  excludeKinds?: string[];     // Optional: blacklist event kinds
  customFilter?: (event: InternalEvent) => boolean;
}

interface Subscriber {
  id: string;
  send(event: InternalEvent): void;
  close?(): void;
}

class EventRouter {
  constructor();

  // Subscribe to events
  subscribe(config: SubscriptionConfig, subscriber: Subscriber): void;

  // Unsubscribe
  unsubscribe(subscriberId: string): void;

  // Route event to matching subscribers
  route(event: InternalEvent): void;

  // Get router statistics
  stats(): RouterStats;

  // Cleanup
  shutdown(): void;
}
```

#### Example

```typescript
import { EventRouter } from 'looopy/server';

const router = new EventRouter();

// Subscribe with filtering
router.subscribe(
  {
    contextId: 'ctx-1',
    taskId: 'task-1',
    filterInternal: true,
    includeKinds: ['task-created', 'task-status', 'task-complete'],
  },
  {
    id: 'subscriber-1',
    send: (event) => {
      console.log('Received:', event.kind);
    },
  }
);

// Route events
router.route(createTaskCreatedEvent({ /* ... */ }));
router.route(createInternalLLMCallEvent({ /* ... */ })); // Filtered out

// Cleanup
router.shutdown();
```

### SSEConnection

Individual SSE client connection with heartbeat.

#### Features

- **SSE Wire Format**: Standard `id:`, `event:`, `data:` format
- **Heartbeat**: Periodic comments to keep connection alive (default: 30s)
- **Automatic Cleanup**: Cleanup on close
- **Implements Subscriber**: Works with EventRouter

#### API

```typescript
interface SSEConnectionConfig {
  id: string;              // Unique connection ID
  res: SSEResponse;        // HTTP response object
  heartbeatInterval?: number; // Heartbeat interval in ms (default: 30000)
}

class SSEConnection implements Subscriber {
  readonly id: string;

  constructor(config: SSEConnectionConfig);

  // Send event (Subscriber interface)
  send(event: InternalEvent): void;

  // Close connection (Subscriber interface)
  close(): void;
}
```

#### SSEResponse Interface

Framework-agnostic HTTP response interface:

```typescript
interface SSEResponse {
  setHeader(name: string, value: string): void;
  write(chunk: string): void;
  end(): void;
  on?(event: 'close', listener: () => void): void;
  once?(event: 'close', listener: () => void): void;
  removeListener?(event: 'close', listener: () => void): void;
}
```

Works with:
- Express: `res` object directly
- Fastify: `reply.raw`
- Node.js http: `res` object directly
- Deno: Custom wrapper

#### Example

```typescript
import { SSEConnection } from 'looopy/server';

// Express handler
app.get('/events', (req, res) => {
  const connection = new SSEConnection({
    id: generateId(),
    res,
    heartbeatInterval: 30000,
  });

  // Send events
  connection.send(createTaskCreatedEvent({ /* ... */ }));
  connection.send(createTaskStatusEvent({ /* ... */ }));

  // Connection closes automatically when client disconnects
});
```

### SSEServer

Orchestration layer integrating buffer, router, and connections.

#### Features

- **Integrated**: Combines buffer, router, and connections
- **Reconnection Support**: Automatic event replay via `Last-Event-ID`
- **Context Isolation**: Events scoped by context ID
- **Automatic Cleanup**: Connections cleaned up on close

#### API

```typescript
interface SSEServerConfig {
  bufferConfig?: EventBufferConfig;
  heartbeatInterval?: number;
}

class SSEServer {
  readonly buffer: EventBuffer;
  readonly router: EventRouter;

  constructor(config?: SSEServerConfig);

  // Subscribe a client to events
  subscribe(
    res: SSEResponse,
    config: {
      contextId: string;
      taskId?: string;
      filterInternal?: boolean;
      includeKinds?: string[];
      excludeKinds?: string[];
      customFilter?: (event: InternalEvent) => boolean;
      lastEventId?: string; // For reconnection
    }
  ): SSEConnection;

  // Emit an event
  emit(contextId: string, event: InternalEvent): void;

  // Get server statistics
  stats(): {
    buffer: BufferStats;
    router: RouterStats;
    activeConnections: number;
  };

  // Cleanup
  shutdown(): void;
}
```

#### Example

```typescript
import express from 'express';
import { SSEServer } from 'looopy/server';
import { AgentLoop } from 'looopy';

const app = express();
const sseServer = new SSEServer({
  bufferConfig: {
    maxSize: 200,
    ttl: 600000, // 10 minutes
  },
  heartbeatInterval: 30000,
});

// SSE endpoint
app.get('/events/:contextId', (req, res) => {
  const { contextId } = req.params;
  const lastEventId = req.headers['last-event-id'] as string | undefined;

  sseServer.subscribe(res, {
    contextId,
    filterInternal: true, // Don't send internal:* events to client
    lastEventId,
  });
});

// Execute agent and emit events
app.post('/chat/:contextId', async (req, res) => {
  const { contextId } = req.params;
  const { message } = req.body;

  const agentLoop = new AgentLoop({ /* ... */ });

  const events$ = agentLoop.startTurn([
    { role: 'user', content: message }
  ], {
    contextId,
    taskId: generateId(),
    turnNumber: 1,
  });

  events$.subscribe({
    next: (event) => {
      // Emit to SSE clients
      sseServer.emit(contextId, event);
    },
    complete: () => {
      res.json({ success: true });
    },
    error: (err) => {
      res.status(500).json({ error: err.message });
    },
  });
});

app.listen(3000, () => {
  console.log('SSE server listening on port 3000');
});
```

## SSE Wire Format

Events are sent using standard SSE format:

```
id: ctx-123-1
event: task-created
data: {"kind":"task-created","contextId":"ctx-123","taskId":"task-1","initiator":"user","timestamp":"2025-11-06T10:00:00Z"}

id: ctx-123-2
event: task-status
data: {"kind":"task-status","contextId":"ctx-123","taskId":"task-1","status":"working","timestamp":"2025-11-06T10:00:01Z"}

: heartbeat

id: ctx-123-3
event: task-complete
data: {"kind":"task-complete","contextId":"ctx-123","taskId":"task-1","content":"Done!","timestamp":"2025-11-06T10:00:15Z"}

```

- **id**: Monotonic event ID for reconnection
- **event**: Event kind (e.g., `task-created`, `task-status`)
- **data**: JSON-encoded event payload
- **: comment** - Heartbeat to keep connection alive

## Client Usage

### Basic EventSource

```typescript
const eventSource = new EventSource('/events/my-context-id');

eventSource.addEventListener('task-created', (e) => {
  const event = JSON.parse(e.data);
  console.log('Task:', event.taskId);
});

eventSource.addEventListener('task-status', (e) => {
  const event = JSON.parse(e.data);
  console.log('Status:', event.status);
});

eventSource.addEventListener('task-complete', (e) => {
  const event = JSON.parse(e.data);
  console.log('Complete:', event.content);
});

eventSource.onerror = (error) => {
  console.error('SSE error:', error);
  eventSource.close();
};
```

### Reconnection with Last-Event-ID

EventSource automatically includes the `Last-Event-ID` header when reconnecting. The server uses this to replay missed events:

```typescript
// Client reconnects automatically
const eventSource = new EventSource('/events/my-context-id');

// Server handles reconnection
app.get('/events/:contextId', (req, res) => {
  const lastEventId = req.headers['last-event-id'] as string | undefined;

  sseServer.subscribe(res, {
    contextId: req.params.contextId,
    lastEventId, // Events since this ID will be replayed
  });
});
```

### Task-Specific Events

```typescript
const taskId = 'task-123';
const eventSource = new EventSource(`/events/my-context-id?taskId=${taskId}`);

// Server filters by task
app.get('/events/:contextId', (req, res) => {
  sseServer.subscribe(res, {
    contextId: req.params.contextId,
    taskId: req.query.taskId as string | undefined,
  });
});
```

### Filtering Internal Events

```typescript
// Client receives only public events (no internal:* events)
app.get('/events/:contextId', (req, res) => {
  sseServer.subscribe(res, {
    contextId: req.params.contextId,
    filterInternal: true, // Excludes internal:llm-call, internal:checkpoint, etc.
  });
});
```

## Advanced Usage

### Custom Event Filtering

```typescript
sseServer.subscribe(res, {
  contextId: 'ctx-1',
  customFilter: (event) => {
    // Only send tool events
    return event.kind === 'tool-start' ||
           event.kind === 'tool-complete';
  },
});
```

### Multiple Event Types

```typescript
sseServer.subscribe(res, {
  contextId: 'ctx-1',
  includeKinds: [
    'task-created',
    'task-status',
    'task-complete',
    'tool-start',
    'tool-complete',
  ],
});
```

### Exclude Specific Events

```typescript
sseServer.subscribe(res, {
  contextId: 'ctx-1',
  filterInternal: true,
  excludeKinds: [
    'content-delta', // Too many chunks
    'tool-progress',  // Too verbose
  ],
});
```

### Error Handling

```typescript
const eventSource = new EventSource('/events/my-context-id');

let reconnectAttempts = 0;
const maxReconnectAttempts = 5;

eventSource.onerror = (error) => {
  reconnectAttempts++;

  if (reconnectAttempts > maxReconnectAttempts) {
    console.error('Max reconnection attempts reached');
    eventSource.close();
    return;
  }

  console.log(`Reconnection attempt ${reconnectAttempts}/${maxReconnectAttempts}`);
};

eventSource.onopen = () => {
  reconnectAttempts = 0; // Reset on successful connection
  console.log('Connected to SSE stream');
};
```

### Progress Tracking

```typescript
const progress = {
  tasksCreated: 0,
  tasksCompleted: 0,
  toolsExecuted: 0,
};

eventSource.addEventListener('task-created', () => {
  progress.tasksCreated++;
  updateProgressUI();
});

eventSource.addEventListener('task-complete', () => {
  progress.tasksCompleted++;
  updateProgressUI();
});

eventSource.addEventListener('tool-complete', () => {
  progress.toolsExecuted++;
  updateProgressUI();
});

function updateProgressUI() {
  console.log(`Progress: ${progress.tasksCompleted}/${progress.tasksCreated} tasks, ${progress.toolsExecuted} tools`);
}
```

## Configuration

### EventBuffer Configuration

```typescript
const sseServer = new SSEServer({
  bufferConfig: {
    maxSize: 500,           // Max 500 events per context
    ttl: 1800000,           // 30 minute TTL
    autoCleanup: true,      // Enable auto-cleanup
    cleanupInterval: 60000, // Cleanup every minute
  },
});
```

### SSEConnection Configuration

```typescript
const sseServer = new SSEServer({
  heartbeatInterval: 15000, // Send heartbeat every 15 seconds
});
```

### Combined Configuration

```typescript
const sseServer = new SSEServer({
  bufferConfig: {
    maxSize: 1000,
    ttl: 3600000, // 1 hour
  },
  heartbeatInterval: 20000, // 20 seconds
});
```

## Performance Considerations

### Buffer Size

- **Small buffers** (50-100): Good for short-lived sessions, low memory
- **Large buffers** (500-1000): Support longer disconnections, higher memory
- **Per-context isolation**: Each context has its own buffer

### TTL Configuration

- **Short TTL** (5 min): Frequent cleanup, good for transient data
- **Long TTL** (30-60 min): Better reconnection support, higher memory
- **Auto-cleanup**: Periodic cleanup prevents memory leaks

### Heartbeat Interval

- **Short interval** (10-15s): Better for detecting dead connections, more network traffic
- **Long interval** (30-60s): Less network traffic, slower dead connection detection
- **Default (30s)**: Good balance for most use cases

### Subscriber Limits

- **Filter early**: Use `filterInternal`, `includeKinds`, `excludeKinds` to reduce events sent
- **Task-specific**: Subscribe to specific tasks to reduce noise
- **Custom filters**: Add business logic filtering to reduce client processing

## Monitoring

### Buffer Statistics

```typescript
const bufferStats = sseServer.buffer.stats();
console.log('Buffer stats:', {
  totalContexts: bufferStats.contextCount,
  totalEvents: bufferStats.totalEvents,
  oldestEvent: bufferStats.oldestEvent,
});
```

### Router Statistics

```typescript
const routerStats = sseServer.router.stats();
console.log('Router stats:', {
  totalContexts: routerStats.contextCount,
  totalSubscribers: routerStats.subscriberCount,
  contextsWithSubscribers: routerStats.contextsWithSubscribers,
});
```

### Server Statistics

```typescript
const stats = sseServer.stats();
console.log('Server stats:', {
  buffer: stats.buffer,
  router: stats.router,
  activeConnections: stats.activeConnections,
});
```

## Testing

See `tests/sse-server.test.ts` for comprehensive test examples covering:

- Event buffer (7 tests)
- Event router (10 tests)
- SSE connections (4 tests)
- SSE server (9 tests)

Run tests:

```bash
pnpm test -- sse-server.test.ts
```

## Troubleshooting

### Events Not Received

1. **Check connection**: Verify EventSource is connected
2. **Check filtering**: Ensure event kind not filtered out
3. **Check context ID**: Verify correct contextId in URL
4. **Check internal filter**: Ensure `filterInternal: true` not excluding wanted events

### Connection Drops

1. **Check heartbeat**: Lower `heartbeatInterval` to detect drops faster
2. **Check network**: Firewalls/proxies may close idle connections
3. **Check logs**: Look for subscriber errors in server logs

### Memory Issues

1. **Reduce buffer size**: Lower `maxSize` per context
2. **Reduce TTL**: Lower `ttl` for faster cleanup
3. **Check cleanup**: Ensure `autoCleanup: true`
4. **Monitor stats**: Use `stats()` to track buffer growth

### Missed Events on Reconnection

1. **Check buffer size**: Ensure buffer large enough to hold events during disconnect
2. **Check TTL**: Ensure events not expired before reconnection
3. **Check Last-Event-ID**: Verify header sent by client
4. **Check event IDs**: Ensure monotonic IDs working correctly

## Related Documentation

- [Internal Event Protocol](../design/internal-event-protocol.md) - Event type definitions
- [Agent Loop](../design/agent-loop.md) - Event emission from AgentLoop
- [Observability](./OBSERVABILITY.md) - Logging and tracing

## See Also

- **EventSource API**: [MDN Documentation](https://developer.mozilla.org/en-US/docs/Web/API/EventSource)
- **Server-Sent Events**: [HTML Spec](https://html.spec.whatwg.org/multipage/server-sent-events.html)
- **RxJS Observables**: [RxJS Documentation](https://rxjs.dev/guide/observable)
