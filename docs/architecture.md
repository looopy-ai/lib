# Architecture

This document provides a detailed overview of the Looopy AI framework's architecture.

## Core Concepts

The framework is built around a few core concepts:

- **Agents**: Stateful entities that manage multi-turn conversations. They are responsible for maintaining the conversation history and orchestrating the execution of turns. An `Agent` is a long-lived object that can be used for multiple conversations.
- **Agent Loops**: Stateless engines that execute a single turn of a conversation. They take the current conversation history, call the LLM, and execute any necessary tools. An `AgentLoop` is a short-lived object that is created for each turn.
- **Providers**: Connectors to external services, such as LLM providers (e.g., AWS Bedrock). Providers translate between the framework's internal data model and the external service's API.
- **Plugins**: Extensibility points that inject system prompts and tool capabilities. Plugins can expose tools, execute them, and/or add prompts before/after the conversation history.
- **Stores**: Persistence layers for storing conversation history, agent state, and artifacts. Stores are responsible for abstracting away the details of the underlying storage technology.

## Package Architecture

The framework is divided into several packages:

- **`@looopy-ai/core`**: Contains the core classes and interfaces, including `Agent`, `AgentLoop`, and the provider and store interfaces. This package is the heart of the framework and is the only package that is required to be used.
- **`@looopy-ai/aws`**: Implements providers and stores for AWS services, such as Bedrock and S3. This package is an example of how to implement providers and stores for a specific platform.
- **`@looopy-ai/examples`**: Contains example usage of the framework, including a kitchen-sink example that demonstrates all of the framework's features.

## Data Flow

A typical data flow for a single turn is as follows:

1. The client sends a message to the `Agent`.
2. The `Agent` retrieves the conversation history from the `MessageStore`.
3. The `Agent` creates a new `AgentLoop` for the current turn.
4. The `Agent` calls the `AgentLoop` with the conversation history.
5. The `AgentLoop` calls the LLM provider with the conversation history.
6. The LLM provider returns a response, which may include tool calls.
7. The `AgentLoop` executes any tool calls using plugins that expose tools.
8. The `AgentLoop` sends the tool results back to the LLM.
9. The LLM provider returns the final response.
10. The `AgentLoop` returns the final response to the `Agent`.
11. The `Agent` saves the new messages to the `MessageStore` and returns the response to the client.

## Observability

The framework includes built-in support for OpenTelemetry, which allows you to trace and monitor the execution of your agents. The `Agent` and `AgentLoop` classes automatically create spans for each turn and for each call to an external service. For more details, see the [Observability](./observability.md) documentation.
