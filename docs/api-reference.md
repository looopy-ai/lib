# API Reference

This document provides a detailed overview of the most important classes and interfaces in the `@looopy-ai/core` package.

## Agent

The `Agent` class is the main entry point for interacting with the framework. It manages the conversation history and orchestrates the execution of turns.

### `constructor(config: AgentConfig)`

Creates a new `Agent` instance.

- `config`: The agent's configuration. See `AgentConfig` for more details.

### `startTurn(prompt: string): Promise<Observable<A2A.Event>>`

Starts a new turn in the conversation.

- `prompt`: The user's message.
- Returns: An RxJS `Observable` that emits events from the agent.

### `AgentConfig`

The `AgentConfig` interface has the following properties:

- `agentId`: A unique ID for the agent.
- `llmProvider`: The LLM provider to use.
- `toolProviders`: An array of tool providers to use.
- `systemPrompt`: The system prompt to use.
- `maxIterations`: The maximum number of iterations to run the agent loop for.
- `messageStore`: The message store to use.
- `artifactStore`: The artifact store to use.
- `taskStateStore`: The task state store to use.

## AgentLoop

The `AgentLoop` class is the stateless engine that executes a single turn of a conversation.

### `constructor(config: AgentLoopConfig)`

Creates a new `AgentLoop` instance.

- `config`: The agent loop's configuration. See `AgentLoopConfig` for more details.

### `startTurn(messages: Message[], metadata: TaskMetadata): Observable<A2A.Event>`

Starts a new turn.

- `messages`: The conversation history.
- `metadata`: The task's metadata.
- Returns: An RxJS `Observable` that emits events from the agent loop.

### `AgentLoopConfig`

The `AgentLoopConfig` interface has the following properties:

- `agentId`: A unique ID for the agent.
- `llmProvider`: The LLM provider to use.
- `toolProviders`: An array of tool providers to use.
- `maxIterations`: The maximum number of iterations to run the agent loop for.

## LLMProvider

The `LLMProvider` interface is used to connect to external LLM providers.

### `chat(messages: Message[], tools?: Tool[]): Observable<Message>`

Sends a chat request to the LLM.

- `messages`: The conversation history.
- `tools`: The tools that the LLM can use.
- Returns: An RxJS `Observable` that emits the LLM's response.

## ToolProvider

The `ToolProvider` interface is used to execute tools.

### `getTools(): Promise<ToolDefinition[]>`

Returns the list of tool definitions that the provider can execute. Implementations normally fetch this list from their backing service (e.g., the MCP server) and may cache the results.

### `execute(toolCall: ToolCall, context: ExecutionContext): Promise<ToolResult>`

Executes a tool call with the current `ExecutionContext` so providers can forward metadata such as the `authContext` to downstream services.

### `canHandle(toolName: string): boolean`

Used by the agent runtime to route tool invocations to the correct provider.

### `executeBatch?(toolCalls: ToolCall[], context: ExecutionContext): Promise<ToolResult[]>`

Optional method that providers can implement when they support batching.

The core package ships with three implementations: `LocalToolProvider`, `ClientToolProvider`, and `McpToolProvider` for connecting to MCP-compliant servers.

## MessageStore

The `MessageStore` interface is used to store and retrieve conversation history.

### `getMessages(contextId: string): Promise<Message[]>`

Retrieves the conversation history for a given context.

- `contextId`: The context's ID.
- Returns: A `Promise` that resolves with the conversation history.

### `addMessage(contextId: string, message: Message): Promise<void>`

Adds a message to the conversation history.

- `contextId`: The context's ID.
- `message`: The message to add.
