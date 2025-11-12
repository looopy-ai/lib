# Chat Completions Operators

RxJS operators for processing OpenAI-compatible streaming chat completion responses.

## Overview

This module provides operators for working with streaming LLM responses following the OpenAI streaming format. These operators help you:

- Aggregate streaming deltas into complete responses
- Extract and concatenate content chunks
- Assemble fragmented tool calls
- Parse inline XML tags from content streams
- Compose multiple operations into reusable pipelines

## Quick Start

### High-Level Pipelines (Recommended)

For most use cases, use the composed pipeline functions:

```typescript
import { createStreamPipeline } from 'looopy/operators/chat-completions';

// Automatically splits stream into content, thoughts, tools, and final aggregation
const pipeline = createStreamPipeline(streamingChoices$);

pipeline.content.subscribe(chunk => console.log(chunk));
pipeline.tags.subscribe(tag => console.log(tag));
pipeline.toolCalls.subscribe(call => executeTool(call));
await pipeline.aggregated.toPromise(); // Final result
```

### Low-Level Operators

For fine-grained control, compose individual operators:

```typescript
import { aggregateChoice, getContent, splitInlineXml } from 'looopy/operators/chat-completions';

// Custom pipeline
const final$ = choices$.pipe(aggregateChoice());
const content$ = choices$.pipe(getContent());
const { content, tags } = splitInlineXml(content$);
```

## Operators

### High-Level Pipelines

#### `createStreamPipeline<T>(source: Observable<T>)`

Creates a complete streaming pipeline that splits a Choice stream into multiple specialized outputs.

**Returns**: `{ content, tags, toolCalls, aggregated }`

```typescript
const pipeline = createStreamPipeline(choices$);
// Access: pipeline.content, pipeline.tags, pipeline.toolCalls, pipeline.aggregated
```

#### `streamContentWithThoughts<T>(source: Observable<T>)`

Simplified pipeline for content-only responses with thought extraction.

**Returns**: `{ content, thoughts, aggregated }`

```typescript
const { content, thoughts } = streamContentWithThoughts(choices$);
```

#### `streamToolCalls<T>(source: Observable<T>)`

Simplified pipeline for tool-call only responses.

**Returns**: `{ toolCalls, aggregated }`

```typescript
const { toolCalls, aggregated } = streamToolCalls(choices$);
```

#### `observeStreams<T>(source: Observable<T>, handlers)`

Pipeline with side-effect callbacks for each stream type.

**Parameters**:
- `handlers.onContent?: (chunk: string) => void`
- `handlers.onThought?: (thought: InlineXml) => void`
- `handlers.onToolCall?: (toolCall: ToolCall) => void`

**Returns**: `Observable<T>` (aggregated result)

```typescript
const final$ = observeStreams(choices$, {
  onContent: (chunk) => updateUI(chunk),
  onThought: (thought) => logDebug(thought),
  onToolCall: (call) => executeTool(call),
});
```

#### `collectStreams<T>(source: Observable<T>)`

Collects all stream outputs into arrays for testing or batch processing.

**Returns**: `Promise<{ contentChunks, thoughts, toolCalls, final }>`

```typescript
const result = await collectStreams(choices$);
console.log(result.contentChunks); // ['chunk1', 'chunk2', ...]
console.log(result.thoughts); // [{ name: 'thinking', content: '...' }]
console.log(result.toolCalls); // [{ function: { name: '...' } }]
console.log(result.final); // Final aggregated Choice
```

### Low-Level Operators

#### `aggregateChoice<T extends Choice>()`

Aggregates streaming Choice deltas into a single complete Choice object emitted at the end.

**Use case**: Convert a stream of delta chunks into a final, complete response.

```typescript
import { aggregateChoice } from 'looopy/operators/chat-completions';

const chunks$ = from([
  { index: 0, delta: { content: 'Hello' }, finish_reason: null },
  { index: 0, delta: { content: ' world' }, finish_reason: null },
  { index: 0, delta: { content: '!' }, finish_reason: 'stop' },
]);

const complete$ = chunks$.pipe(aggregateChoice());
// Emits: { index: 0, delta: { content: 'Hello world!' }, finish_reason: 'stop' }
```

**Features**:
- Concatenates content chunks
- Assembles tool calls by index
- Preserves finish_reason from final chunk
- Handles multiple tool calls simultaneously

### `getContent<T extends Choice>()`

Extracts content strings from Choice deltas.

```typescript
import { getContent } from 'looopy/operators/chat-completions';

const chunks$ = from([
  { index: 0, delta: { content: 'Hello' } },
  { index: 0, delta: { content: ' world' } },
]);

const content$ = chunks$.pipe(getContent());
// Emits: 'Hello', ' world'
```

### `getToolCalls<T extends Choice>()`

Extracts tool call deltas from Choice objects.

```typescript
import { getToolCalls } from 'looopy/operators/chat-completions';

const chunks$ = from([
  {
    index: 0,
    delta: {
      tool_calls: [
        { index: 0, id: 'call_1', type: 'function', function: { name: 'search', arguments: '{}' } }
      ]
    }
  },
]);

const toolCalls$ = chunks$.pipe(getToolCalls());
// Emits individual ToolCall objects
```

### `assembleToolCalls()`

Assembles fragmented tool call deltas into complete ToolCall objects.

```typescript
import { getToolCalls, assembleToolCalls } from 'looopy/operators/chat-completions';

const chunks$ = from([
  { index: 0, delta: { tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'search', arguments: '' } }] } },
  { index: 0, delta: { tool_calls: [{ index: 0, id: null, type: 'function', function: { name: '', arguments: '{"q":"test"}' } }] } },
]);

const complete$ = chunks$.pipe(
  getToolCalls(),
  assembleToolCalls()
);
// Emits: { index: 0, id: 'call_1', type: 'function', function: { name: 'search', arguments: '{"q":"test"}' } }
```

### `splitInlineXml(source: Observable<string>)`

Splits a text stream into content and inline XML tags.

```typescript
import { getContent, splitInlineXml } from 'looopy/operators/chat-completions';

const chunks$ = from([
  { index: 0, delta: { content: 'Here is <thinking>my thought</thinking> text' } },
]);

const { content, tags } = splitInlineXml(
  chunks$.pipe(getContent())
);

// content emits: 'Here is ', ' text'
// tags emits: { name: 'thinking', content: 'my thought', attributes: {} }
```

### `choices<T extends ChatCompletionStreamData>()`

Extracts choices array from ChatCompletionStreamData and flattens into individual Choice objects.

```typescript
import { choices } from 'looopy/operators/chat-completions';

const data$ = from([
  {
    id: '1',
    created: '2024-01-01',
    model: 'gpt-4',
    object: 'chat.completion.chunk',
    choices: [
      { index: 0, delta: { content: 'Hello' } }
    ]
  },
]);

const choice$ = data$.pipe(choices());
// Emits: { index: 0, delta: { content: 'Hello' } }
```

## Common Patterns

### Pattern 1: Full Streaming Pipeline

```typescript
import { createStreamPipeline } from 'looopy/operators/chat-completions';

// Note: Use actual streaming sources, not from([]) for synchronous arrays
const pipeline = createStreamPipeline(streamingChoices$);

// Display content to user in real-time
pipeline.content.subscribe(chunk => updateUI(chunk));

// Extract and log thoughts
pipeline.tags.pipe(
  filter(tag => tag.name === 'thinking')
).subscribe(thought => console.log(thought.content));

// Execute tools as they arrive
pipeline.toolCalls.subscribe(toolCall => executeTool(toolCall));

// Get final complete response
pipeline.aggregated.subscribe(final => saveFinalResponse(final));
```

### Pattern 2: Stream content with extracted thoughts

```typescript
import { streamContentWithThoughts } from 'looopy/operators/chat-completions';

const { content, thoughts, aggregated } = streamContentWithThoughts(choices$);

content.subscribe(chunk => display(chunk));
thoughts.subscribe(thought => logThought(thought));
aggregated.subscribe(final => saveFinal(final));
```

### Pattern 3: Observable callbacks pattern

```typescript
import { observeStreams } from 'looopy/operators/chat-completions';

const result$ = observeStreams(choices$, {
  onContent: (chunk) => updateUI(chunk),
  onThought: (thought) => logThought(thought),
  onToolCall: (call) => executeTool(call),
});

await lastValueFrom(result$); // Wait for completion
```

### Pattern 4: Testing with collected streams

```typescript
import { collectStreams } from 'looopy/operators/chat-completions';

const result = await collectStreams(choices$);
console.log('All content:', result.contentChunks.join(''));
console.log('All thoughts:', result.thoughts);
console.log('All tool calls:', result.toolCalls);
```

### Pattern 5: Aggregate complete response

```typescript
import { choices, aggregateChoice } from 'looopy/operators/chat-completions';

streamingResponse$
  .pipe(
    choices(),
    aggregateChoice()
  )
  .subscribe(completeChoice => {
    console.log('Final response:', completeChoice.delta?.content);
  });
```

### Pattern 6: Stream content with extracted thoughts

```typescript
import { choices, getContent, splitInlineXml } from 'looopy/operators/chat-completions';

const content$ = streamingResponse$.pipe(
  choices(),
  getContent()
);

const { content, tags } = splitInlineXml(content$);

// Display content to user in real-time
content.subscribe(chunk => updateUI(chunk));

// Log thoughts for debugging
tags.pipe(
  filter(tag => tag.name === 'thinking')
).subscribe(thought => console.log('Thought:', thought.content));
```

### Pattern 7: Handle both content and tool calls

```typescript
import { choices, aggregateChoice } from 'looopy/operators/chat-completions';

streamingResponse$
  .pipe(
    choices(),
    aggregateChoice()
  )
  .subscribe(choice => {
    if (choice.delta?.content) {
      console.log('Assistant:', choice.delta.content);
    }

    if (choice.delta?.tool_calls) {
      for (const toolCall of choice.delta.tool_calls) {
        const args = JSON.parse(toolCall.function.arguments);
        console.log(`Calling ${toolCall.function.name} with`, args);
      }
    }
  });
```

## Important Notes

**Streaming vs Synchronous Sources**: The pipeline operators are designed for true streaming observables (like SSE streams or HTTP responses). When using synchronous sources like `from([...])` for testing, you may need to subscribe to all output streams immediately after creating the pipeline, or use `defer()` to delay source execution.

**Hot vs Cold Observables**: The pipelines use `share()` to multicast the source, but internal operators like `splitInlineXml` subscribe immediately. For production use with real streaming sources, this works correctly. For testing, use the `collect Streams()` helper or ensure subscriptions happen before the source completes.

## Type Definitions

```typescript
export type ToolCall = {
  index: number;
  id: string | null;
  function: {
    name: string;
    arguments: string; // JSON string
  };
  type: 'function';
};

export type Choice = {
  delta?: {
    content?: string;
    tool_calls?: ToolCall[]
  };
  index: number;
  finish_reason?: string | null;
};

export type ChatCompletionStreamData = {
  id: string;
  created: string;
  model: string;
  object: string;
  choices: Choice[];
};

export type InlineXml = {
  name: string;
  content?: string;
  attributes: Record<string, string | string[]>;
};
```

## References

- [OpenAI Streaming Responses](https://platform.openai.com/docs/guides/streaming-responses)
- [RxJS Operators Guide](https://rxjs.dev/guide/operators)
