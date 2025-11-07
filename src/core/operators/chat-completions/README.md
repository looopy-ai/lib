# Chat Completions Operators

RxJS operators for processing OpenAI-compatible streaming chat completion responses.

## Overview

This module provides operators for working with streaming LLM responses following the OpenAI streaming format. These operators help you:

- Aggregate streaming deltas into complete responses
- Extract and concatenate content chunks
- Assemble fragmented tool calls
- Parse inline XML tags from content streams

## Operators

### `aggregateChoice<T extends Choice>()`

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

### Pattern 1: Aggregate complete response

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

### Pattern 2: Stream content with extracted thoughts

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

### Pattern 3: Handle both content and tool calls

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
