# Streaming & Eventing Architecture

## Overview

This document describes the end-to-end architecture of the streaming and eventing system in Looopy, from LLM response chunks to client consumption via Server-Sent Events (SSE).

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          CLIENT LAYER                                   │
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  SSE Client (Browser/CLI)                                        │  │
│  │  • EventSource connection                                        │  │
│  │  • Receives JSON events line-by-line                             │  │
│  │  • Handles reconnection with Last-Event-ID                       │  │
│  └───────────────────────────┬──────────────────────────────────────┘  │
└─────────────────────────────┼────────────────────────────────────────────┘
                              │
                      HTTP SSE Stream
                      (text/event-stream)
                              │
┌─────────────────────────────┼────────────────────────────────────────────┐
│                    SSE SERVER LAYER                                     │
│  ┌───────────────────────────▼──────────────────────────────────────┐  │
│  │  SSEServer (Express Endpoint)                                    │  │
│  │  • Maintains long-lived HTTP connections                         │  │
│  │  • Routes events to correct subscribers                          │  │
│  │  • Keep-alive pings every 30s                                    │  │
│  │  • Handles subscriber lifecycle                                  │  │
│  └───────────────────────────┬──────────────────────────────────────┘  │
│                              │                                          │
│                   EventRouter.route()                                  │
│                              │                                          │
│  ┌───────────────────────────▼──────────────────────────────────────┐  │
│  │  EventRouter                                                     │  │
│  │  • Maps taskId → Set<Subscriber>                                 │  │
│  │  • Broadcasts events to all subscribers                          │  │
│  │  • Filters internal:* events                                     │  │
│  │  • Handles subscriber errors gracefully                          │  │
│  └───────────────────────────┬──────────────────────────────────────┘  │
└─────────────────────────────┼────────────────────────────────────────────┘
                              │
                   InternalEvent objects
                              │
┌─────────────────────────────┼────────────────────────────────────────────┐
│                      AGENT LAYER                                        │
│  ┌───────────────────────────▼──────────────────────────────────────┐  │
│  │  Agent.startTurn()                                               │  │
│  │  • Creates LoopEventEmitter                                      │  │
│  │  • Subscribes to eventEmitter.events$                            │  │
│  │  • Routes events to SSE via EventRouter                          │  │
│  │  • Manages conversation state (MessageStore)                     │  │
│  └───────────────────────────┬──────────────────────────────────────┘  │
└─────────────────────────────┼────────────────────────────────────────────┘
                              │
                    Observable<InternalEvent>
                              │
┌─────────────────────────────┼────────────────────────────────────────────┐
│                   AGENT LOOP LAYER                                      │
│  ┌───────────────────────────▼──────────────────────────────────────┐  │
│  │  AgentLoop.startTurn()                                           │  │
│  │  • Creates LoopEventEmitter (emits to Subject)                   │  │
│  │  • Builds RxJS pipeline with operators                           │  │
│  │  • Returns Observable<InternalEvent> via events$                 │  │
│  └───────────────────────────┬──────────────────────────────────────┘  │
│                              │                                          │
│            RxJS Observable Pipeline                                    │
│                              │                                          │
│  ┌───────────────────────────▼──────────────────────────────────────┐  │
│  │  Operator Pipeline                                               │  │
│  │                                                                  │  │
│  │  1. prepareLLMCall() → emitLLMCall()                             │  │
│  │  2. switchMap(llmProvider.call())                                │  │
│  │  3. extractThoughtsFromStream()  ←── Extracts <thinking> tags   │  │
│  │  4. last() → Final response                                      │  │
│  │  5. Tool execution (if needed)                                   │  │
│  │  6. Loop or complete                                             │  │
│  └───────────────────────────┬──────────────────────────────────────┘  │
└─────────────────────────────┼────────────────────────────────────────────┘
                              │
                   Observable<LLMResponse>
                              │
┌─────────────────────────────┼────────────────────────────────────────────┐
│                    LLM PROVIDER LAYER                                   │
│  ┌───────────────────────────▼──────────────────────────────────────┐  │
│  │  LiteLLMProvider.call()                                          │  │
│  │  • Streaming HTTP request to LiteLLM proxy                       │  │
│  │  • Parses Server-Sent Events (SSE)                               │  │
│  │  • Accumulates content chunks                                    │  │
│  │  • Emits accumulated content (not deltas!)                       │  │
│  │  • Returns Observable<LLMResponse>                               │  │
│  └───────────────────────────┬──────────────────────────────────────┘  │
└─────────────────────────────┼────────────────────────────────────────────┘
                              │
                      HTTP SSE Stream
                              │
┌─────────────────────────────┼────────────────────────────────────────────┐
│                    LLM SERVICE (External)                               │
│  ┌───────────────────────────▼──────────────────────────────────────┐  │
│  │  LiteLLM Proxy / OpenAI / Anthropic                              │  │
│  │  • Streams response chunks via SSE                               │  │
│  │  • Format: data: {"choices":[{"delta":{"content":"..."}}]}       │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

## Data Flow: Request to Response

### 1. Client Initiates Request

```typescript
// Client makes HTTP POST to SSE endpoint
POST /api/sse/message
Content-Type: application/json

{
  "message": "What is 2+2?",
  "contextId": "session-123"
}

// Server responds with SSE stream
HTTP/1.1 200 OK
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
```

### 2. SSE Server Creates Subscription

```typescript
// SSEServer endpoint
app.post('/api/sse/message', async (req, res) => {
  const { message, contextId } = req.body;
  const taskId = generateTaskId();

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  // Create subscriber
  const subscriber = eventRouter.subscribe(taskId, {
    send: (event: InternalEvent) => {
      // Filter internal:* events
      if (event.kind.startsWith('internal:')) return;

      // Send to client
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }
  });

  // Get/create agent
  const agent = await getOrCreateAgent(contextId);

  // Start turn (non-blocking)
  agent.startTurn(message, { taskId }).then(events$ => {
    events$.subscribe({
      next: (event) => {
        // Events automatically routed via EventRouter
      },
      complete: () => {
        eventRouter.unsubscribe(taskId, subscriber);
        res.end();
      }
    });
  });
});
```

### 3. Agent Starts Turn

```typescript
// Agent.startTurn()
async startTurn(message: string, options?: { taskId?: string }) {
  const taskId = options?.taskId || generateTaskId();

  // Load message history
  const history = await this.messageStore.getRecent(this.contextId);

  // Append user message
  const messages = [...history, { role: 'user', content: message }];

  // Create event emitter for this turn
  const eventEmitter = new LoopEventEmitter();

  // Subscribe to events and route to EventRouter
  eventEmitter.events$.subscribe(event => {
    this.eventRouter?.route(event);
  });

  // Start AgentLoop
  const events$ = this.agentLoop.startTurn(messages, {
    taskId,
    contextId: this.contextId,
    eventEmitter
  });

  return events$;
}
```

### 4. AgentLoop Executes Pipeline

```typescript
// AgentLoop.startTurn()
startTurn(messages: Message[], options: StartTurnOptions): Observable<InternalEvent> {
  const eventEmitter = options.eventEmitter || new LoopEventEmitter();

  // Emit initial task-created event
  eventEmitter.emitTaskStatus(taskId, contextId, { state: 'submitted' });

  // Build execution pipeline
  const pipeline$ = defer(() => {
    // Emit working status
    eventEmitter.emitTaskStatus(taskId, contextId, { state: 'working' });

    return this.llmProvider.call({ messages, tools }).pipe(
      // Extract thoughts and emit content-delta events
      extractThoughtsFromStream(taskId, contextId, eventEmitter),

      // Get final response
      last(),

      // Clean and emit content-complete
      map(response => {
        const cleaned = cleanThinkingTags(response.message.content);
        eventEmitter.emitContentComplete(taskId, contextId, cleaned);
        return response;
      })
    );
  });

  // Execute pipeline and merge with event stream
  pipeline$.subscribe();

  // Return event stream for Agent to subscribe
  return eventEmitter.events$;
}
```

### 5. LLM Provider Streams Response

```typescript
// LiteLLMProvider.call()
call(params: LLMCallParams): Observable<LLMResponse> {
  return new Observable(subscriber => {
    const response = await fetch(this.baseUrl + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        messages: params.messages,
        tools: params.tools,
        stream: true  // Enable streaming
      })
    });

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    let accumulated = '';  // Accumulate content chunks

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      const lines = chunk.split('\n');

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = JSON.parse(line.slice(6));

          // Extract delta from SSE chunk
          const delta = data.choices[0]?.delta?.content;
          if (delta) {
            // Accumulate (not emit delta directly!)
            accumulated += delta;

            // Emit ACCUMULATED content
            subscriber.next({
              message: {
                role: 'assistant',
                content: accumulated  // Full content so far
              },
              finished: false
            });
          }
        }
      }
    }

    subscriber.complete();
  });
}
```

**Key Insight**: LiteLLM provider emits **accumulated content**, not deltas. This is crucial for the thought extraction operator to work correctly.

### 6. Thought Extraction Operator

```typescript
// extractThoughtsFromStream operator
export function extractThoughtsFromStream(
  taskId: string,
  contextId: string,
  eventEmitter: LoopEventEmitter
): OperatorFunction<LLMResponse, LLMResponse> {
  const buffer = {
    lastCleanedContent: '',
    emittedThoughts: new Set<string>()
  };

  return source$ => source$.pipe(
    scan((acc, response) => ({ response, chunkIndex: acc.chunkIndex + 1 }),
         { chunkIndex: -1 }),

    concatMap(({ response, chunkIndex }) => {
      const accumulated = response.message.content;

      // Extract complete <thinking> tags (all 3 formats)
      let cleaned = accumulated
        .replace(/<thinking>(.*?)<\/thinking>/gs, (_, thought) => {
          if (!buffer.emittedThoughts.has(thought)) {
            buffer.emittedThoughts.add(thought);
            eventEmitter.emitThought(taskId, contextId, 'reasoning', thought);
          }
          return '';
        })
        .replace(/<thinking\s+([^>]*)><\/thinking>/gs, (_, attrs) => {
          extractAttributeThought(attrs, eventEmitter);
          return '';
        })
        .replace(/<thinking\s+([^>]*?)\/>/gs, (_, attrs) => {
          extractAttributeThought(attrs, eventEmitter);
          return '';
        });

      // Check for incomplete tags and buffer
      cleaned = removeIncompleteTag(cleaned);

      // Compute delta from last cleaned content
      const delta = cleaned.substring(buffer.lastCleanedContent.length);

      if (delta) {
        // Emit content-delta event
        eventEmitter.emitContentDelta(taskId, contextId, delta, chunkIndex);
      }

      buffer.lastCleanedContent = cleaned;

      // Pass through original response unchanged
      return [response];
    })
  );
}
```

### 7. Event Emission Timeline

Here's what events flow through the system for a typical request:

```
Time  | Source              | Event Kind          | Content
------|---------------------|---------------------|---------------------------
T+0ms | AgentLoop           | task-status         | state: 'submitted'
T+1ms | AgentLoop           | task-status         | state: 'working'
T+2ms | AgentLoop           | internal:llm-call   | (filtered by SSE server)
      |                     |                     |
[LLM streaming begins]      |                     |
      |                     |                     |
T+100 | ThoughtExtractor    | content-delta       | "Let me "
T+150 | ThoughtExtractor    | content-delta       | "analyze "
T+200 | [incomplete tag]    | [buffered]          | (no event - "<thinking>")
T+250 | ThoughtExtractor    | thought-stream      | "I should verify first"
T+300 | ThoughtExtractor    | content-delta       | "The "
T+350 | ThoughtExtractor    | content-delta       | "answer "
T+400 | ThoughtExtractor    | content-delta       | "is 4"
      |                     |                     |
[LLM streaming ends]        |                     |
      |                     |                     |
T+450 | AgentLoop           | content-complete    | "Let me analyze The answer is 4"
T+451 | AgentLoop           | internal:checkpoint | (filtered by SSE server)
T+452 | AgentLoop           | task-complete       | finishReason: 'stop'
```

## Event Types & Structure

### Internal Event Protocol

All events follow the `InternalEvent` discriminated union type:

```typescript
type InternalEvent =
  | TaskStatusEvent
  | ContentDeltaEvent
  | ThoughtStreamEvent
  | ContentCompleteEvent
  | InternalLLMCallEvent     // Filtered before SSE
  | InternalToolStartEvent   // Filtered before SSE
  | InternalToolCompleteEvent // Filtered before SSE
  | InternalCheckpointEvent; // Filtered before SSE
```

### Event Emission Points

```
AgentLoop Pipeline:
├─ emitTaskStatus('submitted')        ← AgentLoop start
├─ emitTaskStatus('working')          ← Before LLM call
├─ emitLLMCall()                      ← internal:llm-call
│
├─ [LLM Streaming via extractThoughtsFromStream]
│   ├─ emitContentDelta()             ← Each chunk (thoughts removed)
│   └─ emitThought()                  ← Complete <thinking> tags
│
├─ emitContentComplete()              ← After last()
│
├─ [If tools requested]
│   ├─ emitToolStart()                ← internal:tool-start
│   └─ emitToolComplete()             ← internal:tool-complete
│
├─ emitCheckpoint()                   ← internal:checkpoint
└─ emitTaskComplete()                 ← Final status
```

## Key Design Patterns

### 1. Accumulated Content (Not Deltas)

**LiteLLM Provider emits accumulated content**, which simplifies thought extraction:

```typescript
// Chunk 1: "Hello"
subscriber.next({ message: { content: "Hello" } });

// Chunk 2: " world"
subscriber.next({ message: { content: "Hello world" } }); // ACCUMULATED

// NOT this:
subscriber.next({ message: { content: " world" } }); // Delta (❌)
```

This allows `extractThoughtsFromStream` to:
- Extract complete `<thinking>` tags from accumulated content
- Detect incomplete tags at the end
- Compute deltas by comparing with previous cleaned content

### 2. Hot Observable with shareReplay()

The execution pipeline is made "hot" to prevent duplicate executions:

```typescript
const execution$ = pipeline$.pipe(
  shareReplay(1)  // Multicast to subscribers, replay last value
);

// Multiple subscriptions = single execution
execution$.subscribe(observer1);
execution$.subscribe(observer2);
```

### 3. Event Filtering at SSE Layer

Internal observability events are filtered before sending to clients:

```typescript
send: (event: InternalEvent) => {
  // Filter internal:* events
  if (event.kind.startsWith('internal:')) return;

  res.write(`data: ${JSON.stringify(event)}\n\n`);
}
```

### 4. Operator Factory Pattern

Operators are created via factory functions with closures:

```typescript
export function extractThoughtsFromStream(
  taskId: string,
  contextId: string,
  eventEmitter: LoopEventEmitter
): OperatorFunction<LLMResponse, LLMResponse> {
  // Closure over taskId, contextId, eventEmitter

  return (source$) => source$.pipe(
    // Use captured values
    tap(() => eventEmitter.emitContentDelta(taskId, ...))
  );
}
```

Benefits:
- Operators can emit events via eventEmitter
- Clean separation of concerns
- Easy to test

## SSE Protocol Details

### Server-Side

```typescript
// Set SSE headers
res.setHeader('Content-Type', 'text/event-stream');
res.setHeader('Cache-Control', 'no-cache');
res.setHeader('Connection', 'keep-alive');

// Send event
res.write(`data: ${JSON.stringify(event)}\n\n`);

// Keep-alive ping (every 30s)
res.write(': ping\n\n');

// Complete stream
res.end();
```

### Client-Side

```typescript
const eventSource = new EventSource('/api/sse/message', {
  withCredentials: true
});

eventSource.onmessage = (e) => {
  const event = JSON.parse(e.data);

  switch (event.kind) {
    case 'content-delta':
      appendToUI(event.content);
      break;
    case 'thought-stream':
      showThought(event.thought);
      break;
    case 'task-complete':
      eventSource.close();
      break;
  }
};

eventSource.onerror = (err) => {
  console.error('SSE error:', err);
  eventSource.close();
};
```

## Thought Extraction: Supported Formats

The `extractThoughtsFromStream` operator supports three formats:

### Format 1: Content Between Tags
```xml
<thinking>This is my thought</thinking>
```

### Format 2: Attributes with Closing Tag
```xml
<thinking thought="This is my thought" thought_type="reflection" confidence="0.7"></thinking>
```

### Format 3: Self-Closing Tag
```xml
<thinking thought="This is my thought" thought_type="reflection" confidence="0.7" />
```

All formats:
- Extract thought content and emit `thought-stream` event
- Remove tags from content-delta events
- Handle incomplete tags across chunk boundaries
- Deduplicate thoughts (via Set)

## Error Handling & Recovery

### Connection Failures

```typescript
// Client reconnection with Last-Event-ID
const eventSource = new EventSource('/api/sse/message?lastEventId=123');

// Server resends events after lastEventId
if (req.query.lastEventId) {
  // Resend missed events
  const missedEvents = getMissedEvents(taskId, req.query.lastEventId);
  missedEvents.forEach(event => res.write(`data: ${JSON.stringify(event)}\n\n`));
}
```

### Subscriber Errors

```typescript
// EventRouter handles subscriber errors gracefully
try {
  subscriber.send(event);
} catch (error) {
  logger.warn('Failed to send event', { subscriberId, error });
  // Don't crash other subscribers
}
```

### LLM Stream Interruption

```typescript
llmProvider.call(params).pipe(
  catchError(error => {
    eventEmitter.emitTaskStatus(taskId, contextId, {
      state: 'failed',
      error: error.message
    });
    return throwError(() => error);
  })
)
```

## Performance Considerations

### 1. Event Buffering

Events are emitted immediately (no buffering) for real-time feel:

```typescript
// Emit as soon as delta is computed
if (delta) {
  eventEmitter.emitContentDelta(taskId, contextId, delta, chunkIndex);
}
```

### 2. Keep-Alive Interval

30-second pings prevent connection timeouts:

```typescript
const keepAliveInterval = setInterval(() => {
  res.write(': ping\n\n');
}, 30000);

req.on('close', () => clearInterval(keepAliveInterval));
```

### 3. Subscriber Cleanup

Unsubscribe when client disconnects:

```typescript
req.on('close', () => {
  eventRouter.unsubscribe(taskId, subscriber);
  clearInterval(keepAliveInterval);
});
```

## Testing Strategy

### Unit Tests
- `tests/thought-extraction.test.ts` - Thought extraction logic
- `tests/sanitize.test.ts` - Content cleaning
- `tests/agent-loop.test.ts` - Pipeline integration

### Manual Tests
- `tests/manual-thought-test.ts` - Split tags across chunks
- `tests/thought-streaming-edge-cases.ts` - Multiple thoughts, partial tags
- `tests/thought-attribute-format.ts` - Attribute-based format
- `tests/thought-self-closing.ts` - Self-closing tags

### Integration Tests
- `tests/sse-server.test.ts` - SSE server and EventRouter
- `examples/kitchen-sink.ts` - End-to-end with real LLM

## Future Enhancements

### 1. Binary Streaming for Large Artifacts

For large files (images, documents), use binary streaming instead of JSON:

```typescript
if (event.kind === 'artifact-update' && event.artifact.size > 1MB) {
  // Use multipart/mixed or separate binary endpoint
  res.write(`event: artifact-binary\n`);
  res.write(`data: ${artifactUrl}\n\n`);
}
```

### 2. Event Prioritization

High-priority events (errors, user input required) sent immediately:

```typescript
const priority = event.kind === 'task-status' && event.status.state === 'failed'
  ? 'high'
  : 'normal';
```

### 3. Compression

Enable gzip compression for text events:

```typescript
res.setHeader('Content-Encoding', 'gzip');
const gzip = zlib.createGzip();
gzip.pipe(res);
```

### 4. Sub-Agent Event Namespacing

Hierarchical event routing for sub-agent invocations:

```typescript
// Parent task: task-123
// Sub-agent task: task-123/sub-456
eventRouter.subscribe('task-123/**', subscriber);
```

## Related Documentation

- **[A2A Protocol](./a2a-protocol.md)** - Event format specification
- **[Agent Lifecycle](./agent-lifecycle.md)** - Agent state management
- **[Agent Loop](./agent-loop.md)** - Single-turn execution pipeline
- **[Internal Event Protocol](./internal-event-protocol.md)** - Event type definitions
- **[Observability](./observability.md)** - Tracing and logging

## Implementation References

- **LLM Provider**: `src/providers/litellm-provider.ts`
- **Thought Extraction**: `src/core/operators/thought-stream.ts`
- **Event Emitter**: `src/core/operators/event-emitter.ts`
- **SSE Server**: `src/server/sse-server.ts`
- **Event Router**: `src/server/event-router.ts`
- **Agent**: `src/core/agent.ts`
- **AgentLoop**: `src/core/agent-loop.ts`
