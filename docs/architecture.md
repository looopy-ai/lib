# Architecture

This document provides a detailed overview of the Looopy AI framework's architecture.

## Core Concepts

The framework is built around a few core concepts:

- **Agents**: Stateful entities that manage multi-turn conversations. They are responsible for maintaining the conversation history and orchestrating the execution of turns. An `Agent` is a long-lived object that can be used for multiple conversations.
- **Agent Loop**: The `runLoop` function executes a single turn of a conversation. It takes the current conversation history, calls the LLM, and executes any necessary tools. The loop runs statelessly for each turn.
- **Providers**: Connectors to external services, such as LLM providers (e.g., AWS Bedrock). Providers translate between the framework's internal data model and the external service's API.
- **Plugins**: Extensibility points that inject system prompts and tool capabilities. Plugins can expose tools, execute them, and/or add prompts before/after the conversation history.
- **Stores**: Persistence layers for storing conversation history, agent state, and artifacts. Stores are responsible for abstracting away the details of the underlying storage technology.

## Package Architecture

The framework is divided into several packages:

- **`@looopy-ai/core`**: Contains the core classes and interfaces, including `Agent`, `runLoop`, and the provider and store interfaces. This package is the heart of the framework and is the only package that is required to be used.
- **`@looopy-ai/aws`**: Implements providers and stores for AWS services, such as Bedrock and S3. This package is an example of how to implement providers and stores for a specific platform.
- **`@looopy-ai/examples`**: Contains example usage of the framework, including a kitchen-sink example that demonstrates all of the framework's features.

## Data Flow

A typical data flow for a single turn is as follows:

1. The client sends a message to the `Agent`.
2. The `Agent` retrieves the conversation history from the `MessageStore`.
3. The `Agent` calls `runLoop` with the conversation history for the current turn.
4. The `runLoop` function calls the LLM provider with the conversation history.
5. The LLM provider returns a response, which may include tool calls.
6. The `runLoop` function executes any tool calls using plugins that expose tools.
7. The `runLoop` function sends the tool results back to the LLM.
8. The LLM provider returns the final response.
9. The `runLoop` function returns the final response to the `Agent`.
10. The `Agent` saves the new messages to the `MessageStore` and returns the response to the client.

## Observability

The framework includes built-in support for OpenTelemetry, which allows you to trace and monitor the execution of your agents. The `Agent` class and `runLoop` function automatically create spans for each turn and for each call to an external service. For more details, see the [Observability](./observability.md) documentation.
