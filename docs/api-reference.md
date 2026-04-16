# API Reference

This document provides a detailed overview of the most important classes and interfaces in the `@looopy-ai/core` package.

# Agent

The `Agent` class is the main entry point for interacting with the framework. It manages message history, orchestrates each turn via the agent loop, and emits a unified event stream.

### `constructor(config: AgentConfig)`

Creates a new `Agent` instance.

- `config`: Agent configuration with the fields below.

### `startTurn(userMessage: string | null, options?: StartTurnOptions): Promise<Observable<ContextAnyEvent>>`

Starts a new turn in the conversation and streams events for that turn.

- `userMessage`: The user's input, or `null` when resuming from `waiting-input` without a new user message.
- `options.authContext`: Optional auth context forwarded to plugins (tool execution, downstream headers, etc.).
- `options.taskId`: Optional task identifier; auto-generated when omitted.
- `options.metadata`: Optional key-value metadata attached to the turn.
- `options.inputs`: Resolved values for a `waiting-input` resume. Each entry maps an `inputId` (from a prior `tool-input-required` event) to the user-supplied value. On resume, the pending tool is re-invoked with the value injected via `ExecutionContext.resolvedInputs`. When omitted while status is `waiting-input`, a new `userMessage` cancels all pending tool calls with synthetic errors and restarts the loop.
- Returns: An RxJS `Observable` streaming `ContextAnyEvent` — content deltas, tool lifecycle events, task status updates, and more.
  **Status transitions**: `idle → busy → idle` (normal), `idle → busy → waiting-input` (tool needs input), `waiting-input → busy → idle` (resume resolves).

### `AgentConfig`

- `agentId`: Unique ID for the agent.
- `contextId`: Stable identifier for the conversation thread.
- `llmProvider`: The LLM provider to use.
- `filterPlugins?`: Optional function to restrict which plugins run on a given iteration.
- `messageStore`: Where conversation history is persisted.
- `agentStore?`: Optional persistence for `AgentState` across process restarts.
- `autoCompact?`: Whether to compact history automatically (default `false`).
- `maxMessages?`: Cap before compaction warnings (default `100`).
- `plugins?`: Plugins providing system prompts and tools. Combine tool plugins (`localTools`, `createArtifactTools`, `AgentToolProvider`, `McpToolProvider`, `requestInputPlugin`) with prompt plugins (`literalPrompt`, `asyncPrompt`).
- `logger?`: Optional pino logger instance.

## Event Types

The core defines base event payloads as `AnyEvent` (content streaming, tool execution, task lifecycle, etc.).
Before events are emitted to consumers they are wrapped as `ContextAnyEvent` via:

```typescript
type ContextEvent<T> = T & { contextId: string; taskId: string };
type ContextAnyEvent = ContextEvent<AnyEvent>;
```

LLM providers and plugins that execute tools should emit contextless `AnyEvent` values; the agent/loop layers stamp `contextId` and `taskId` for multiplexing and observability.

# LLMProvider

Connects to external LLMs.

### `call(request: { messages: Message[]; tools?: ToolDefinition[]; stream?: boolean; sessionId?: string; }): Observable<AnyEvent>`

- `messages`: The conversation history to send to the LLM.
- `tools`: Tool definitions the LLM may invoke.
- `stream`: Whether to stream responses (core always passes `true`).
- `sessionId`: Stable identifier for tracing/logging.
- Returns: An `Observable` of LLM events (content deltas, tool calls, usage metrics, etc.).
  LLM providers should emit contextless `AnyEvent` objects; the agent layer wraps them as `ContextAnyEvent` with `contextId` and `taskId`.

# Plugin

Extends the agent with prompts and/or tools.

### Interface

```typescript
export type Plugin<AuthContext> = {
  readonly name: string;
  readonly version?: string;

  /**
   * Generate system prompts for the iteration
   */
  generateSystemPrompts?: (
    context: IterationContext<AuthContext>,
  ) => SystemPrompt[] | Promise<SystemPrompt[]>;

  /**
   * Get tool definition by ID
   */
  getTool?: (toolId: string) => Promise<ToolDefinition | undefined>;

  /**
   * Get available tools from this provider
   */
  listTools?: () => Promise<ToolDefinition[]>;

  /**
   * Execute a tool call
   */
  executeTool?: (
    toolCall: ToolCall,
    context: IterationContext<AuthContext>,
  ) => Observable<ContextAnyEvent | AnyEvent>;
};
```

- `generateSystemPrompts`: Inject static or dynamic system prompts before/after the conversation history.
- `listTools`/`getTool`/`executeTool`: Declare and run tools. Implementations should emit tool events; the agent loop prepends `tool-start` and stamps `contextId`/`taskId` so providers can emit contextless payloads.

The core package ships with tool-capable plugins like `localTools` (in-process), `createArtifactTools`, `McpToolProvider`, and `AgentToolProvider`. Prompt-only helpers (`literalPrompt`, `asyncPrompt`) compose with these in the same `plugins` array.

## Tool-Input-Required Pattern

Tools can interrupt the loop to request upstream input (credentials, user confirmation, clarifications). When a tool returns `inputRequired(...)` the loop stops, `AgentState.status` becomes `'waiting-input'`, and `AgentState.pendingToolInputs` lists what's needed.

```typescript
import { inputRequired, localTools, tool } from '@looopy-ai/core';
import { z } from 'zod';

const apiTool = tool({
  id: 'call_api',
  description: 'Call an external API',
  schema: z.object({ endpoint: z.string() }),
  handler: async (params, ctx) => {
    const apiKey = ctx.resolvedInputs?.get(ctx.toolCallId ?? '');
    if (!apiKey) {
      return inputRequired({ inputType: 'data', prompt: 'Enter your API key' });
    }
    return { success: true, result: `called ${params.endpoint}` };
  },
});
```

On resume, pass the resolved values to `startTurn`:

```typescript
// First turn — tool fires, agent pauses
const events$ = await agent.startTurn('Call the API');
await lastValueFrom(events$.pipe(toArray()));
// agent.state.status === 'waiting-input'

const [{ inputId }] = agent.state.pendingToolInputs!;

// Resume turn — tool is re-called with the resolved value
await lastValueFrom(
  (await agent.startTurn(null, { inputs: [{ inputId, value: 'sk-secret' }] })).pipe(toArray()),
);
```

Alternatively, add `requestInputPlugin()` so the LLM itself can call `request_input` when it needs clarification:

```typescript
import { requestInputPlugin } from '@looopy-ai/core';

const agent = new Agent({
  plugins: [requestInputPlugin(), localTools([...])],
  // ...
});
```

The `request_input` tool call is intercepted before execution and converted to `tool-input-required` automatically. On resume, a synthetic `tool-complete` is injected into the message history so the LLM sees the answer.

### `PendingToolInput`

Stored in `AgentState.pendingToolInputs` when the agent is `waiting-input`:

- `inputId`: Unique ID to reference when calling `startTurn(..., { inputs })`.
- `toolCallId`: Internal LLM tool-call ID used to match the resume.
- `toolName`: Tool that requested input.
- `toolArguments`: Original arguments the LLM passed.
- `inputType`: `'confirmation' | 'clarification' | 'selection' | 'data'`.
- `prompt`: Human-readable description of what's needed.
- `schema?`: Optional JSON Schema for the expected value.
- `options?`: List of choices (for `selection` type).
- `isLlmRequest?`: `true` when originating from an intercepted `request_input` call.

### `ToolInputRequiredEvent`

Emitted when a tool or LLM calls `request_input`:

```typescript
interface ToolInputRequiredEvent {
  kind: 'tool-input-required';
  toolCallId: string;
  toolName: string;
  toolArguments: Record<string, unknown>;
  inputId: string;
  inputType: InputType; // 'confirmation' | 'clarification' | 'selection' | 'data'
  prompt: string;
  schema?: JSONSchema;
  options?: unknown[];
  timestamp: string;
}
```

# MessageStore

Stores and retrieves conversation history.

```typescript
export interface MessageStore {
  append(contextId: string, messages: Message[]): Promise<void>;
  getRecent(contextId: string, options?: { maxMessages?: number; maxTokens?: number }): Promise<Message[]>;
  getAll(contextId: string): Promise<Message[]>;
  getCount(contextId: string): Promise<number>;
  getRange(contextId: string, startIndex: number, endIndex: number): Promise<Message[]>;
  compact(contextId: string, options?: CompactionOptions): Promise<CompactionResult>;
  clear(contextId: string): Promise<void>;
}
```

Implementations include `InMemoryMessageStore` (development), `MemoryAgentStore` for agent state, and filesystem-based stores for persistence.
