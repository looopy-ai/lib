# @looopy-ai/react

React UI components and conversation state management for Looopy AI agents.

## Installation

```bash
pnpm add @looopy-ai/react
```

### Peer Dependencies

Requires React 19:

```bash
pnpm add react react-dom
```

## Overview

This package provides two building blocks for chat UIs:

- **Conversation reducer** — state management for SSE event streams from a Looopy agent
- **UI components** — `ScrollContainer` (auto-scroll) and `LucideIcon` (dynamic icon rendering)

## Conversation State

Use `conversationReducer` with `useReducer` to maintain conversation state from an SSE agent stream.

```tsx
import { useReducer } from 'react';
import { consumeSSEStream } from '@geee-be/sse-stream-parser';
import { conversationReducer } from '@looopy-ai/react';

function Chat() {
  const [conversation, dispatch] = useReducer(conversationReducer, {
    turns: new Map(),
    turnOrder: [],
  });

  const sendMessage = async (prompt: string) => {
    const id = `prompt-${Date.now()}`;
    dispatch({
      event: 'prompt',
      id,
      data: JSON.stringify({ promptId: id, content: prompt, timestamp: new Date().toISOString(), metadata: {} }),
    });

    const res = await fetch('/api/agent', {
      method: 'POST',
      headers: { Accept: 'text/event-stream' },
      body: JSON.stringify({ prompt }),
    });

    consumeSSEStream(res.body!, (event) => dispatch(event));
  };

  return (
    <div>
      {conversation.turnOrder.map((id) => {
        const turn = conversation.turns.get(id);
        if (turn?.source === 'agent') return <div key={id}>{turn.stream}</div>;
        if (turn?.source === 'client') return <div key={id}>{turn.prompt}</div>;
      })}
    </div>
  );
}
```

### Handled SSE Events

The reducer handles all standard Looopy agent events:

| Event | Effect |
|---|---|
| `task-created` | Creates a new agent turn |
| `task-status` | Updates turn status |
| `content-delta` | Appends streaming text to `turn.stream` |
| `content-complete` | Finalises content, adds to `turn.content` |
| `thought-stream` | Appends a `Thought` event to the turn |
| `tool-start` | Appends a started `ToolCall` event |
| `tool-complete` | Updates the `ToolCall` with result and status |
| `task-complete` | Marks the turn as complete |
| `prompt` | Adds a client turn |
| `prompt-error` | Attaches an error to a client turn |

### Types

```ts
type Conversation = {
  turns: Map<string, Turn>;
  turnOrder: string[];
};

type Turn = AgentTurn | PromptTurn;

type AgentTurn = {
  source: 'agent';
  id: string;
  status: string;
  content: string[];   // completed content blocks
  stream: string;      // current streaming content
  events: TaskEvent[]; // thoughts, tool calls, sub-tasks
};

type PromptTurn = {
  source: 'client';
  id: string;
  prompt: string;
  error?: string;
};

type TaskEvent = Thought | ToolCall | Content | SubTask;
```

## Components

### `ScrollContainer`

A render-prop component that tracks scroll position and automatically pins to the bottom when new content arrives. Exposes a `showScrollToBottom` flag and `scrollToBottom` function for a "scroll to bottom" button.

```tsx
import { ScrollContainer } from '@looopy-ai/react';

<ScrollContainer pinThreshold={32}>
  {({ containerRef, showScrollToBottom, scrollToBottom }) => (
    <div ref={containerRef} style={{ overflowY: 'auto', height: '100%' }}>
      {messages}
      {showScrollToBottom && (
        <button onClick={() => scrollToBottom()}>↓ Scroll to bottom</button>
      )}
    </div>
  )}
</ScrollContainer>
```

#### Props

| Prop | Type | Default | Description |
|---|---|---|---|
| `children` | `(props: ScrollContainerRenderProps) => ReactNode` | required | Render function |
| `pinThreshold` | `number` | `32` | Pixels from bottom that counts as "pinned" |
| `repinScrollBehavior` | `ScrollBehavior` | `'smooth'` | Scroll behavior when user re-pins |
| `pinnedScrollBehavior` | `ScrollBehavior` | `'auto'` | Scroll behavior when keeping up with new content |

#### `useScrollContainer`

Access scroll state from a child component inside `<ScrollContainer>`:

```tsx
import { useScrollContainer } from '@looopy-ai/react';

function ScrollToBottomButton() {
  const { showScrollToBottom, scrollToBottom } = useScrollContainer();
  if (!showScrollToBottom) return null;
  return <button onClick={() => scrollToBottom()}>↓</button>;
}
```

### `LucideIcon`

Dynamically renders any [Lucide](https://lucide.dev) icon by name. Supports case-insensitive matching and a fallback for unknown names.

```tsx
import { LucideIcon } from '@looopy-ai/react';

<LucideIcon name="brain" size={16} />
<LucideIcon name="unknown-icon" fallback={<span>?</span>} />
```

#### Props

Accepts all standard `LucideProps` plus:

| Prop | Type | Default | Description |
|---|---|---|---|
| `name` | `LucideIconName` | required | Lucide icon name (case-insensitive) |
| `fallback` | `ReactNode` | `null` | Rendered when `name` doesn't match any icon |

## Storybook

```bash
pnpm storybook
```

A full `AgentDemo` story is included that connects to a live AWS Bedrock AgentCore runtime endpoint and renders a working chat UI using all the components and reducer from this package.

## Development

```bash
pnpm build          # Build ESM + CJS
pnpm build:watch    # Build in watch mode
pnpm check:types    # TypeScript type checking
pnpm lint           # Biome lint
pnpm test           # Run tests
```
