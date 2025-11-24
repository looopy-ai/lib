# API Reference

This document provides a detailed overview of the most important classes and interfaces in the `@looopy-ai/core` package.

# Agent

The `Agent` class is the main entry point for interacting with the framework. It manages message history, orchestrates each turn via the agent loop, and emits a unified event stream.

### `constructor(config: AgentConfig)`

Creates a new `Agent` instance.

- `config`: Agent configuration with the fields below.

### `startTurn(userMessage: string | null, options?: { authContext?: AuthContext; taskId?: string; }): Promise<Observable<AnyEvent>>`

Starts a new turn in the conversation and streams events for that turn.

- `userMessage`: The user's input (or `null` for tool-only turns).
- `options.authContext`: Optional auth context that is forwarded to tool providers.
- `options.taskId`: Optional task identifier; defaults to an auto-generated value.
- Returns: An RxJS `Observable` that emits agent events such as content deltas, tool calls, tool results, and task status updates.

### `AgentConfig`

- `agentId`: Unique ID for the agent.
- `contextId`: Stable identifier for the conversation thread.
- `llmProvider`: The LLM provider to use.
- `toolProviders`: Array of tool providers to enable (can be empty).
- `messageStore`: Where conversation history is persisted.
- `agentStore?`: Optional persistence for agent state.
- `autoCompact?`: Whether to compact history automatically (default `false`).
- `maxMessages?`: Cap before compaction warnings (default `100`).
- `systemPrompt?`: Either a string, `{ prompt, name?, version? }`, or an async function returning that shape.
- `logger?`: Optional pino logger instance.

# LLMProvider

Connects to external LLMs.

### `call(request: { messages: Message[]; tools?: ToolDefinition[]; stream?: boolean; sessionId?: string; }): Observable<LLMEvent<AnyEvent>>`

- `messages`: The conversation history to send to the LLM.
- `tools`: Tool definitions the LLM may invoke.
- `stream`: Whether to stream responses (core always passes `true`).
- `sessionId`: Stable identifier for tracing/logging.
- Returns: An `Observable` of LLM events (content deltas, tool calls, usage metrics, etc.).

# ToolProvider

Executes tools for the agent runtime.

### Interface

```typescript
export type ToolProvider = {
  readonly name: string;
  getTool(toolName: string): Promise<ToolDefinition | undefined>;
  getTools(): Promise<ToolDefinition[]>;
  execute(toolCall: ToolCall, context: ExecutionContext): Promise<ToolResult>;
  executeBatch?(toolCalls: ToolCall[], context: ExecutionContext): Promise<ToolResult[]>;
};
```

- `getTool`: Fetch a single tool definition by name (used for routing).
- `getTools`: List all tool definitions exposed by the provider.
- `execute`: Run a tool call with the current `ExecutionContext`.
- `executeBatch`: Optional bulk execution helper.

The core package ships with `localTools` for in-process tools, `ClientToolProvider` for client-executed tools, and `McpToolProvider` for MCP-compliant servers.

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
