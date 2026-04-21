# Welcome to Looopy AI

Looopy AI is a reactive, extensible AI agent framework built with TypeScript and RxJS. It provides a powerful, stream-based architecture for creating advanced AI agents that can handle complex, multi-turn conversations and execute tasks in real-time.

## Packages

| Package | Description |
|---------|-------------|
| [`@looopy-ai/core`](https://www.npmjs.com/package/@looopy-ai/core) | Core framework: Agent, runLoop, tools, plugins, stores, providers, and observability |
| [`@looopy-ai/aws`](https://www.npmjs.com/package/@looopy-ai/aws) | AWS integrations: DynamoDB state store, Bedrock AgentCore memory, Secrets Manager, and AgentCore-compatible runtime |
| [`@looopy-ai/react`](https://www.npmjs.com/package/@looopy-ai/react) | React UI components and conversation reducer for building chat interfaces |

## Key Features

- **Reactive Architecture**: Built on RxJS, every agent turn is an observable stream of A2A-compliant events — including LLM chunks, tool calls, status updates, and artifacts.
- **Two Execution Primitives**: `Agent` manages stateful multi-turn conversations; `runLoop` executes a single stateless LLM reasoning cycle. Use `Agent` for most cases, or drop to `runLoop` directly for full control.
- **Tool Integration**: Register local functions as tools (Zod-validated), delegate tools to clients, or expose tools from other agents via the A2A protocol.
- **Plugin System**: Extend agent behaviour with plugins — static or dynamic system prompts, skill learning via Agent Academy, and input-required pause/resume flows.
- **Pluggable Stores**: Swap in file system, in-memory, or DynamoDB backends for message history, agent state, and artifacts. Bring your own by implementing the store interfaces.
- **Authentication**: Secure credential handoff using ECDH key exchange, JWE (A256GCM) encryption, and PKCE OAuth support.
- **Observability**: First-class OpenTelemetry distributed tracing with structured Pino logging. Spans cover the full execution hierarchy from agent turn down to individual LLM calls and tool executions.
- **Streaming & SSE**: Built-in Server-Sent Events server with event routing and buffering for real-time delivery of agent output to clients.
- **A2A Protocol**: Events are emitted as A2A-compliant types (`TaskEvent`, `StatusUpdateEvent`, `ArtifactUpdateEvent`) with no transformation required.
- **AWS Ready**: Drop-in DynamoDB and Bedrock AgentCore integrations for production deployments on AWS.

## Getting Help

If you have any questions or need help with the framework, please open an issue on our [GitHub repository](https://github.com/looopy-ai/looopy-ai).
