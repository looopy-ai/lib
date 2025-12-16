# API Reference

This document provides a detailed overview of the most important classes and interfaces in the `@looopy-ai/core` package.

# Agent

The `Agent` class is the main entry point for interacting with the framework. It manages message history, orchestrates each turn via the agent loop, and emits a unified event stream.

### `constructor(config: AgentConfig)`

Creates a new `Agent` instance.

- `config`: Agent configuration with the fields below.

### `startTurn(userMessage: string | null, options?: { authContext?: AuthContext; taskId?: string; }): Promise<Observable<ContextAnyEvent>>`

Starts a new turn in the conversation and streams events for that turn.

- `userMessage`: The user's input (or `null` for tool-only turns).
- `options.authContext`: Optional auth context that is forwarded to plugins (for tool execution, downstream headers, etc.).
- `options.taskId`: Optional task identifier; defaults to an auto-generated value.
- Returns: An RxJS `Observable` that emits agent events such as content deltas, tool calls, tool results, and task status updates.
  Events are emitted as `ContextAnyEvent`, which stamps `contextId` and `taskId` onto the base event payloads.

### `AgentConfig`

- `agentId`: Unique ID for the agent.
- `contextId`: Stable identifier for the conversation thread.
- `llmProvider`: The LLM provider to use.
- `messageStore`: Where conversation history is persisted.
- `agentStore?`: Optional persistence for agent state.
- `autoCompact?`: Whether to compact history automatically (default `false`).
- `maxMessages?`: Cap before compaction warnings (default `100`).
- `plugins?`: Plugins that inject system prompts and tools. Include tool plugins (e.g., `localTools`, `createArtifactTools`, `AgentToolProvider`, `McpToolProvider`) plus prompt plugins such as `literalPrompt()`/`asyncPrompt()` to shape system context.
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
