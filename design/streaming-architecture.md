# Streaming & Eventing Architecture

## Overview

This document describes the end-to-end architecture of the streaming and eventing system in Looopy, from LLM response chunks to client consumption via Server-Sent Events (SSE).

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    CLIENT LAYER (Kitchen Sink CLI)                      │
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  Kitchen Sink CLI (examples/kitchen-sink.ts)                     │  │
│  │  • Subscribes to agent.startTurn() Observable                    │  │
│  │  • Handles events in handleAgentEvent()                          │  │
│  │  • Uses fs.writeSync() for ordered console output                │  │
│  │  • Logs all events to SSE log file                               │  │
│  └───────────────────────────┬──────────────────────────────────────┘  │
└─────────────────────────────┼────────────────────────────────────────────┘
                              │
                Observable<AgentEvent>.subscribe()
                              │
┌─────────────────────────────┼────────────────────────────────────────────┐
│                      AGENT LAYER                                        │
│  ┌───────────────────────────▼──────────────────────────────────────┐  │
│  │  Agent.startTurn() (src/core/agent.ts)                          │  │
│  │  • Loads message history from MessageStore                       │  │
│  │  • Appends user message to history                               │  │
│  │  • Calls AgentLoop.startTurn(messages)                           │  │
│  │  • Maps LLMEvents to AgentEvents (adds contextId/taskId)         │  │
│  │  • Saves conversation to MessageStore after completion           │  │
│  │  • Returns Observable<AgentEvent>                                │  │
│  └───────────────────────────┬──────────────────────────────────────┘  │
└─────────────────────────────┼────────────────────────────────────────────┘
                              │
                Observable<LLMEvent> from AgentLoop
                              │
┌─────────────────────────────┼────────────────────────────────────────────┐
│                   AGENT LOOP LAYER                                      │
│  ┌───────────────────────────▼──────────────────────────────────────┐  │
│  │  AgentLoop.startTurn() (src/core/agent-loop.ts)                 │  │
│  │  • Emits task-created and task-status events                     │  │
│  │  • Builds RxJS execution pipeline                                │  │
│  │  • Calls llmProvider.call() for each iteration                   │  │
│  │  • Executes tools if requested by LLM                            │  │
│  │  • Returns Observable<LLMEvent> (no contextId/taskId)            │  │
│  └───────────────────────────┬──────────────────────────────────────┘  │
└─────────────────────────────┼────────────────────────────────────────────┘
                              │
                   Observable<LLMEvent<AnyEvent>>
                              │
┌─────────────────────────────┼────────────────────────────────────────────┐
│                    LLM PROVIDER LAYER                                   │
│  ┌───────────────────────────▼──────────────────────────────────────┐  │
│  │  LiteLLMProvider.call() (src/providers/litellm-provider.ts)     │  │
│  │                                                                  │  │
│  │  1. Creates raw SSE stream from LiteLLM HTTP endpoint            │  │
│  │  2. Pipes through choices() operator                             │  │
│  │  3. Uses shareReplay() to multicast (single HTTP request)        │  │
│  │  4. Splits stream into three parallel paths:                     │  │
│  │                                                                  │  │
│  │     ┌─────────────────────────────────────────────┐              │  │
│  │     │ A. Content Deltas                            │              │  │
│  │     │    stream$ → getContent()                    │              │  │
│  │     │           → splitInlineXml()                 │              │  │
│  │     │           → content chunks                   │              │  │
│  │     │           → map to ContentDeltaEvent         │              │  │
│  │     └─────────────────────────────────────────────┘              │  │
│  │                                                                  │  │
│  │     ┌─────────────────────────────────────────────┐              │  │
│  │     │ B. Thought Streams                           │              │  │
│  │     │    stream$ → getContent()                    │              │  │
│  │     │           → splitInlineXml()                 │              │  │
│  │     │           → tags (InlineXml objects)         │              │  │
│  │     │           → filter <thinking> tags           │              │  │
│  │     │           → map to ThoughtStreamEvent        │              │  │
│  │     └─────────────────────────────────────────────┘              │  │
│  │                                                                  │  │
│  │     ┌─────────────────────────────────────────────┐              │  │
│  │     │ C. Content Complete + Tool Calls             │              │  │
│  │     │    stream$ → aggregateChoice()               │              │  │
│  │     │           → map to ContentCompleteEvent      │              │  │
│  │     └─────────────────────────────────────────────┘              │  │
│  │                                                                  │  │
│  │  5. Merges all three streams: merge(A, B, C)                     │  │
│  │  6. Returns Observable<LLMEvent<AnyEvent>>                       │  │
│  └───────────────────────────┬──────────────────────────────────────┘  │
└─────────────────────────────┼────────────────────────────────────────────┘
                              │
                      HTTP SSE Stream
                              │
┌─────────────────────────────┼────────────────────────────────────────────┐
│                    LLM SERVICE (External)                               │
│  ┌───────────────────────────▼──────────────────────────────────────┐  │
│  │  LiteLLM Proxy / OpenAI / Anthropic / Bedrock                    │  │
│  │  • Streams response chunks via SSE                               │  │
│  │  • Format: data: {"choices":[{"delta":{"content":"..."}}]}       │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

## Data Flow: Request to Response

### 1. Kitchen Sink CLI Initiates Request

```typescript
// Kitchen Sink CLI (examples/kitchen-sink.ts)
// User types a message in the interactive prompt
rl.on('line', async (line) => {
  const input = line.trim();
  if (!input) return;

  // Start turn with agent
  const events$ = await agent.startTurn(input);

  // Subscribe to event stream
  events$.subscribe({
    next: (event) => handleAgentEvent(event),
    complete: () => {
      console.log('');
      rl.prompt();
    }
  });
});
```

### 2. Agent Starts Turn

```typescript
// Agent.startTurn() (src/core/agent.ts)
async startTurn(userMessage: string): Promise<Observable<AgentEvent>> {
  const taskId = this.generateTaskId();

  // 1. Load message history from MessageStore
  const history = await this.messageStore.getAll(this.contextId);

  // 2. Append user message
  const messages = [
    ...history,
    { role: 'user', content: userMessage }
  ];

  // 3. Call AgentLoop with full history
  const llmEvents$ = this.agentLoop.startTurn(messages, {
    contextId: this.contextId,
    taskId,
    turnNumber: this.state.turnCount + 1
  });

  // 4. Map LLMEvents to AgentEvents (add contextId/taskId stamps)
  const agentEvents$ = llmEvents$.pipe(
    map(llmEvent => ({
      ...llmEvent,
      contextId: this.contextId,
      taskId
    }))
  );

  // 5. Subscribe to save messages after completion
  agentEvents$.pipe(last()).subscribe({
    complete: async () => {
      // Save conversation to MessageStore
      await this.messageStore.append(this.contextId, newMessages);
    }
  });

  // 6. Return event stream
  return agentEvents$;
}
```

### 3. AgentLoop Executes Pipeline

```typescript
// AgentLoop.startTurn() (src/core/agent-loop.ts)
startTurn(messages: Message[], options: StartTurnOptions): Observable<LLMEvent<AnyEvent>> {
  const { taskId, contextId, turnNumber } = options;

  // Emit initial events
  const initialEvents$ = of(
    { kind: 'task-created', taskId, initiator: 'user', timestamp: now() },
    { kind: 'task-status', taskId, status: 'working', timestamp: now() }
  );

  // Build execution pipeline
  const execution$ = this.executeIteration(messages, 1).pipe(
    // Handle tool calls and loop if needed
    expand((result) => {
      if (result.needsToolExecution) {
        return this.executeTools(result).pipe(
          switchMap(toolResults =>
            this.executeIteration([...messages, ...toolResults], result.iteration + 1)
          )
        );
      }
      return EMPTY;
    }),
    // Get final result
    last()
  );

  // Merge initial events with execution events
  return merge(initialEvents$, execution$);
}

private executeIteration(messages: Message[], iteration: number): Observable<LLMEvent<AnyEvent>> {
  // Call LLM provider - this returns a merged stream of:
  // - ContentDeltaEvents (text chunks)
  // - ThoughtStreamEvents (<thinking> tags)
  // - ContentCompleteEvent (final aggregated response)
  return this.llmProvider.call({ messages, tools: this.tools });
}
```



### 4. LLM Provider Streams Response (Three-Path Architecture)

This is the **heart of the streaming system**. The LiteLLM provider creates a single HTTP SSE connection and splits it into **three parallel observables**:

```typescript
// LiteLLMProvider.streamEvents() (src/providers/litellm-provider.ts)
private streamEvents(params: SSERequestParams): Observable<LLMEvent<AnyEvent>> {
  // 1. Create raw SSE stream (single HTTP connection)
  const rawStream$ = this.createSSEStream(params);

  // 2. Parse chunks and multicast with shareReplay()
  const stream$ = rawStream$.pipe(
    choices(),        // Extract choice deltas
    shareReplay()     // Share single connection for all paths
  );

  // ┌─────────────────────────────────────────────────────────────┐
  // │  Path A: Content Deltas (text chunks)                       │
  // └─────────────────────────────────────────────────────────────┘
  const { content, tags } = splitInlineXml(
    stream$.pipe(getContent())  // Extract content from choices
  );

  const contentDeltas$ = content.pipe(
    map((delta): LLMEvent<ContentDeltaEvent> => ({
      kind: 'content-delta',
      delta,
      timestamp: new Date().toISOString()
    }))
  );

  // ┌─────────────────────────────────────────────────────────────┐
  // │  Path B: Thought Streams (<thinking> tags)                  │
  // └─────────────────────────────────────────────────────────────┘
  const thoughts$ = tags.pipe(
    filter(tag => tag.name === 'thinking'),
    map((tag): LLMEvent<ThoughtStreamEvent> => ({
      kind: 'thought-stream',
      thoughtId: tag.id!,
      delta: tag.isClosed ? null : tag.content,
      isComplete: tag.isClosed,
      timestamp: new Date().toISOString()
    }))
  );

  // ┌─────────────────────────────────────────────────────────────┐
  // │  Path C: Content Complete (final aggregated message)        │
  // └─────────────────────────────────────────────────────────────┘
  const complete$ = stream$.pipe(
    aggregateChoice(),  // Collect all chunks into final message
    map((choice): LLMEvent<ContentCompleteEvent> => ({
      kind: 'content-complete',
      message: {
        role: 'assistant',
        content: choice.message.content || '',
        tool_calls: choice.message.tool_calls
      },
      finishReason: choice.finish_reason,
      timestamp: new Date().toISOString()
    }))
  );

  // ┌─────────────────────────────────────────────────────────────┐
  // │  Merge all three paths into single event stream             │
  // └─────────────────────────────────────────────────────────────┘
  return merge(
    contentDeltas$,  // Text chunks as they arrive
    thoughts$,       // <thinking> content and completion events
    complete$        // Final complete event
  );
}
```

**Key Points:**

1. **Single HTTP Request**: `shareReplay()` ensures only one SSE connection is made to the LLM service, even though three observables subscribe to `stream$`.

2. **splitInlineXml()**: This utility function parses the content stream and splits it into two observables:
   - `content`: Plain text chunks (non-XML content)
   - `tags`: XML tag objects with `name`, `id`, `content`, `isClosed`

3. **Synchronous Processing**: `splitInlineXml()` uses synchronous, left-to-right buffer processing with `ReplaySubject` to guarantee emission order. No race conditions possible.

4. **Event Ordering**: Events are emitted in real-time as they arrive:
   - `content-delta` events stream continuously as text arrives
   - `thought-stream` events emit when `<thinking>` tags are detected
   - `content-complete` event emits once at the end with full aggregated message

5. **Thought Extraction**: Inline XML tags like `<thinking id="abc">...</thinking>` are extracted from the content stream. The content observable emits text **without** the XML tags, while the tags observable emits structured tag objects.

### 5. splitInlineXml() Utility (Content/Tag Separation)

The `splitInlineXml()` utility is critical for thought extraction. It takes a stream of content deltas and splits it into two observables:

```typescript
// src/core/operators/chat-completions/content.ts
export function splitInlineXml(source: Observable<string>): {
  content: Observable<string>;
  tags: Observable<InlineXml>;
} {
  // Use ReplaySubject to buffer emissions (prevents timing issues)
  const contentSubj = new ReplaySubject<string>();
  const tagsSubj = new ReplaySubject<InlineXml>();

  const parser = new InlineXmlParser();

  source.subscribe({
    next: (chunk) => {
      // Parse chunk synchronously (guarantees left-to-right processing)
      const { content, tags } = parser.parse(chunk);

      // Emit to both subjects
      if (content) contentSubj.next(content);
      tags.forEach(tag => tagsSubj.next(tag));
    },
    complete: () => {
      contentSubj.complete();
      tagsSubj.complete();
    },
    error: (err) => {
      contentSubj.error(err);
      tagsSubj.error(err);
    }
  });

  return {
    content: contentSubj.asObservable(),
    tags: tagsSubj.asObservable()
  };
}

// Tag object emitted when XML tags are found
interface InlineXml {
  name: string;        // e.g., "thinking"
  id?: string;         // Extracted from id attribute
  content: string;     // Tag content (for closed tags)
  isClosed: boolean;   // true if </thinking> found
}
```

**Example Parsing:**

Input stream:
```
"Let me "
"analyze <thinking id=\"abc\">I should "
"verify first</thinking> The "
"answer is 4"
```

Output to `content` observable:
```
"Let me "
"analyze "
" The "
"answer is 4"
```

Output to `tags` observable:
```
{ name: "thinking", id: "abc", content: "I should verify first", isClosed: true }
```

**Key Properties:**

1. **Synchronous Processing**: Parser processes chunks left-to-right in order received. No race conditions.
2. **ReplaySubject Buffering**: Emissions are buffered so late subscribers don't miss events.
3. **Incremental Parsing**: Handles incomplete tags across chunk boundaries (e.g., `"<thi"` then `"nking>"`)
4. **Content Stripped**: XML tags are removed from content stream automatically.

### 6. Event Emission Timeline

Here's what events flow through the system for a typical request:

```
Time  | Source              | Event Kind          | Content
------|---------------------|---------------------|---------------------------
T+0ms | AgentLoop           | task-created        | taskId, initiator: 'user'
T+1ms | AgentLoop           | task-status         | status: 'working'
      |                     |                     |
[LLM streaming begins - three parallel paths]
      |                     |                     |
T+100 | LiteLLM (Path A)    | content-delta       | delta: "Let me "
T+150 | LiteLLM (Path A)    | content-delta       | delta: "analyze "
T+200 | [incomplete tag]    | [buffered in parser]| (no emission - "<thinking>")
T+210 | LiteLLM (Path B)    | thought-stream      | thoughtId: "abc", delta: "I should"
T+230 | LiteLLM (Path B)    | thought-stream      | thoughtId: "abc", delta: " verify first"
T+250 | LiteLLM (Path B)    | thought-stream      | thoughtId: "abc", isComplete: true
T+260 | LiteLLM (Path A)    | content-delta       | delta: " The "
T+300 | LiteLLM (Path A)    | content-delta       | delta: "answer "
T+350 | LiteLLM (Path A)    | content-delta       | delta: "is 4"
      |                     |                     |
[LLM streaming ends]        |                     |
      |                     |                     |
T+450 | LiteLLM (Path C)    | content-complete    | message: { content: "Let me analyze The answer is 4", tool_calls: [] }
T+451 | AgentLoop           | task-status         | status: 'completed', final: true
```

**Key Points:**

- **Path A** (content-delta): Emits text chunks with `<thinking>` tags removed
- **Path B** (thought-stream): Emits thought content and completion events
- **Path C** (content-complete): Emits once at the end with full aggregated message
- All three paths run **in parallel** from the same shared SSE stream
- Events are naturally ordered because `splitInlineXml()` processes synchronously

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



## Key Design Patterns

### 1. Three-Path Merge Pattern

The LiteLLM provider uses a **single HTTP connection** split into three parallel observables:

```typescript
const stream$ = rawStream$.pipe(choices(), shareReplay());

// Fork into three paths
const pathA = stream$.pipe(getContent(), splitInlineXml(), ...);
const pathB = stream$.pipe(getContent(), splitInlineXml(), filter(), ...);
const pathC = stream$.pipe(aggregateChoice(), ...);

// Merge back together
return merge(pathA, pathB, pathC);
```

**Benefits:**
- Single HTTP request (efficient)
- Parallel processing (low latency)
- Natural event ordering (synchronous operators)
- Easy to test each path independently

### 2. Content Deltas (Not Accumulated Content)

**LiteLLM Provider emits true deltas** from the SSE stream:

```typescript
// LLM sends:
chunk 1: { delta: { content: "Hello" } }
chunk 2: { delta: { content: " world" } }

// Provider emits:
{ kind: 'content-delta', delta: "Hello" }
{ kind: 'content-delta', delta: " world" }

// Kitchen sink accumulates:
process.stdout.write("Hello");   // First delta
process.stdout.write(" world");  // Second delta
// Result: "Hello world"
```

This is different from some LLM APIs that accumulate internally.

### 3. shareReplay() for Single HTTP Connection

The `shareReplay()` operator multicasts the SSE stream to all three paths:

```typescript
const stream$ = rawStream$.pipe(
  choices(),
  shareReplay()  // Single HTTP request, multiple subscribers
);

// All three paths subscribe to the same stream$
const contentDeltas$ = stream$.pipe(...);  // Path A
const thoughts$ = stream$.pipe(...);        // Path B
const complete$ = stream$.pipe(...);        // Path C
```

Without `shareReplay()`, each path would create its own HTTP request (wasteful).

### 4. ReplaySubject for Buffering

`splitInlineXml()` uses `ReplaySubject` to prevent timing issues:

```typescript
const contentSubj = new ReplaySubject<string>();
const tagsSubj = new ReplaySubject<InlineXml>();

// Emissions are buffered and replayed to late subscribers
```

If we used `Subject`, late subscribers could miss emissions. `ReplaySubject` guarantees delivery.

### 5. Synchronous Writes for Ordering

Kitchen sink uses **synchronous file writes** to guarantee console output order:

```typescript
// Synchronous write (blocks until complete)
fs.writeSync(process.stdout.fd, event.delta);

// NOT async (can complete out of order)
process.stdout.write(event.delta, callback);
```

This ensures rapid content-delta events display in the correct order.
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
## Kitchen Sink CLI Event Handling

The kitchen sink example consumes events directly from the Agent Observable:

```typescript
// examples/kitchen-sink.ts
const events$ = await agent.startTurn(userInput);

events$.subscribe({
  next: (event) => {
    switch (event.kind) {
      case 'content-delta':
        // Synchronous write to ensure ordering
        fs.writeSync(process.stdout.fd, event.delta);
        break;

      case 'thought-stream':
        if (event.isComplete) {
          // Thought complete - could display summary
          console.log(`\n[Thought ${event.thoughtId} complete]`);
        }
        break;

      case 'content-complete':
        // LLM finished - save to message history
        console.log('\n');
        break;

      case 'task-status':
        if (event.status === 'completed') {
          rl.prompt(); // Ready for next input
        }
        break;
    }
  },
  error: (err) => {
    console.error('Error:', err);
    rl.prompt();
  },
  complete: () => {
    // Turn complete
  }
});
```

**Key Points:**

- Direct Observable subscription (no SSE server layer)
- Synchronous writes (`fs.writeSync`) for guaranteed ordering
- Immediate event processing (no network latency)
- Simple error handling and recovery
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

The `splitInlineXml()` utility extracts `<thinking>` tags from the content stream. The LiteLLM provider filters these tags and emits `thought-stream` events:

### Format: Content Between Tags
```xml
<thinking id="abc">This is my reasoning</thinking>
```

**Parsing:**
- Tag name: `"thinking"`
- ID: `"abc"` (extracted from `id` attribute)
- Content: `"This is my reasoning"`
- isClosed: `true`

**Events Emitted:**

As content arrives:
```typescript
{ kind: 'thought-stream', thoughtId: 'abc', delta: 'This is my ', isComplete: false }
{ kind: 'thought-stream', thoughtId: 'abc', delta: 'reasoning', isComplete: false }
```

When tag closes:
```typescript
{ kind: 'thought-stream', thoughtId: 'abc', delta: null, isComplete: true }
```

**Key Properties:**
- `id` attribute is required (generates unique ID if missing)
- Content is streamed incrementally (not all at once)
- Closing event signals thought is complete
- Tags are removed from `content-delta` stream automatically

## Error Handling & Recovery

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

### 1. Synchronous Write Performance

Kitchen sink uses `fs.writeSync()` for guaranteed ordering:

```typescript
fs.writeSync(process.stdout.fd, event.delta);
```

**Performance Impact:**
- Blocks event loop briefly (microseconds per write)
- Fast enough to be imperceptible for terminal output
- Guarantees correct order (critical for readability)
- Trade-off: ordering guarantee > theoretical max throughput

### 2. shareReplay() Memory Usage

`shareReplay()` buffers the last emitted value:

```typescript
const stream$ = rawStream$.pipe(
  choices(),
  shareReplay()  // Buffers last value
);
```

**Memory Impact:**
- One buffered chunk per shared stream (typically <1KB)
- Negligible for typical LLM responses (<10KB total)
- Benefits: Single HTTP connection instead of 3 connections

### 3. ReplaySubject Buffer Size

`splitInlineXml()` uses `ReplaySubject` with unlimited buffer:

```typescript
const contentSubj = new ReplaySubject<string>();  // Buffers all emissions
```

**Memory Impact:**
- Buffers all content/tag emissions until source completes
- Typical usage: Source completes quickly (within seconds)
- Memory freed when Observable completes
- Alternative: `ReplaySubject(1)` would buffer only last emission (but could lose data)

## Testing Strategy

### Unit Tests
- `tests/content.test.ts` - splitInlineXml() utility, tag extraction logic (61 tests passing)
- `tests/agent-loop.test.ts` - Pipeline integration
- `tests/litellm-provider.test.ts` - LLM provider streaming

### Test Coverage for splitInlineXml
```typescript
describe('splitInlineXml', () => {
  it('emits content without tags');
  it('emits tag objects with correct structure');
  it('handles incomplete tags across chunks');
  it('extracts id attribute from tags');
  it('handles multiple tags in single chunk');
  it('handles nested tags');
  it('emits in correct order (content, tags)');
  // ... 54 more tests
});
```

### Integration Tests
- `examples/kitchen-sink.ts` - End-to-end with real LLM
- `examples/litellm-agent.ts` - LiteLLM provider integration

## Future Enhancements

### 1. Additional XML Tag Support

Extend `splitInlineXml()` to extract other tag types:

```typescript
// Support multiple tag types
const { content, thoughts, artifacts, citations } = splitInlineXml(stream$, {
  tagNames: ['thinking', 'artifact', 'cite']
});
```

### 2. Adaptive Buffering

Adjust `ReplaySubject` buffer size based on content length:

```typescript
// Small buffer for short responses, larger for long ones
const bufferSize = estimatedLength > 10000 ? 100 : undefined;
const contentSubj = new ReplaySubject<string>(bufferSize);
```

### 3. Parallel Tool Execution Events

Emit events showing parallel tool execution progress:

```typescript
{ kind: 'tools-started', toolNames: ['search', 'calculate', 'fetch'] }
{ kind: 'tool-progress', toolName: 'search', status: 'running' }
{ kind: 'tool-progress', toolName: 'calculate', status: 'complete' }
```

### 4. SSE Server Layer (Optional)

Add SSE server for web clients (currently only CLI example exists):

```typescript
// Server endpoint for remote clients
app.post('/api/sse/message', (req, res) => {
  const agent = getOrCreateAgent(req.body.contextId);
  const events$ = await agent.startTurn(req.body.message);

  res.setHeader('Content-Type', 'text/event-stream');

  events$.subscribe({
    next: (event) => res.write(`data: ${JSON.stringify(event)}\n\n`),
    complete: () => res.end()
  });
});
```

## Related Documentation

- **[A2A Protocol](./a2a-protocol.md)** - Event format specification
- **[Agent Lifecycle](./agent-lifecycle.md)** - Agent state management
- **[Agent Loop](./agent-loop.md)** - Single-turn execution pipeline
- **[Internal Event Protocol](./internal-event-protocol.md)** - Event type definitions
- **[Observability](./observability.md)** - Tracing and logging

## Implementation References

### Core Files

- **`src/providers/litellm-provider.ts`** - Three-path streaming architecture implementation
  - `streamEvents()` method creates the merge of three paths
  - Uses `splitInlineXml()`, `aggregateChoice()`, `shareReplay()`

- **`src/core/operators/chat-completions/content.ts`** - Content/tag splitting utilities
  - `splitInlineXml()` function with `ReplaySubject` buffering
  - `InlineXmlParser` class for synchronous parsing
  - `getContent()` operator to extract content from choices

- **`src/core/operators/chat-completions/aggregate.ts`** - Choice aggregation
  - `aggregateChoice()` operator for Path C (content-complete)
  - Collects all chunks into final message

- **`src/core/agent.ts`** - Multi-turn conversation manager
  - `startTurn()` method coordinates with AgentLoop
  - Maps LLMEvents to AgentEvents (adds contextId/taskId)

- **`src/core/agent-loop.ts`** - Single-turn execution engine
  - `startTurn()` method calls LLM provider
  - Emits task-created and task-status events

### Example Files

- **`examples/kitchen-sink.ts`** - Interactive CLI example
  - Direct Observable subscription (no SSE server)
  - Synchronous writes with `fs.writeSync()` for ordering
  - Event handling for content-delta, thought-stream, etc.

- **`examples/litellm-agent.ts`** - LiteLLM provider integration example
  - Shows basic usage without thought extraction

### Test Files

- **`tests/content.test.ts`** - 61 tests for splitInlineXml()
  - Tag extraction, incomplete tags, multiple tags, ordering

- **`tests/agent-loop.test.ts`** - Pipeline integration tests

- **`tests/litellm-provider.test.ts`** - Provider streaming tests

### Related Documentation

- **`docs/THOUGHT_EXTRACTION.md`** - Detailed thought extraction documentation
- **`ai-journal/CONTENT_DELTA_ORDER_FIX.md`** - Content ordering fix with synchronous writes
- **`ai-journal/THOUGHT_STREAMING_COMPLETE.md`** - Thought streaming implementation history

- **LLM Provider**: `src/providers/litellm-provider.ts`
- **Thought Extraction**: `src/core/operators/thought-stream.ts`
- **Event Emitter**: `src/core/operators/event-emitter.ts`
- **SSE Server**: `src/server/sse-server.ts`
- **Event Router**: `src/server/event-router.ts`
- **Agent**: `src/core/agent.ts`
- **AgentLoop**: `src/core/agent-loop.ts`
