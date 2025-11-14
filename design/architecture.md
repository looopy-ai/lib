# Architecture Overview

This document provides a high-level overview of the Looopy AI agent framework architecture.

## System Design Principles

Looopy is built on the following core principles:

1. **Reactive First**: All asynchronous operations use RxJS observables for composability and control
2. **Separation of Concerns**: Clear boundaries between Agent (multi-turn), AgentLoop (single-turn), and support components
3. **Streaming Native**: Updates flow in real-time through Server-Sent Events (SSE)
4. **Distributed by Default**: OpenTelemetry tracing across all operations
5. **A2A Protocol Compliant**: Events follow the A2A (Agent-to-Agent) protocol specification
6. **Operator-Based Pipeline**: Modular, testable operators for clean execution flow

## High-Level Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                           Client Layer                               │
│  ┌──────────────┐    ┌──────────────┐   ┌──────────────┐             │
│  │ Web Client   │    │ CLI Client   │   │ Other Agent  │             │
│  └──────┬───────┘    └──────┬───────┘   └──────┬───────┘             │
│         │                   │                  │                     │
│         └───────────────────┴──────────────────┘                     │
│                             │                                        │
│                     A2A SSE Protocol                                 │
└─────────────────────────────┼────────────────────────────────────────┘
                              │
┌─────────────────────────────┼────────────────────────────────────────┐
│                    A2A Server Layer (Not Yet Implemented)            │
│  ┌──────────────────────────▼───────────────────────────┐            │
│  │            A2A Request Handler                       │            │
│  │  • Authentication/Authorization                      │            │
│  │  • Request validation                                │            │
│  │  • SSE connection management                         │            │
│  │  • Event routing                                     │            │
│  └──────────────────────────┬───────────────────────────┘            │
└─────────────────────────────┼────────────────────────────────────────┘
                              │
┌─────────────────────────────┼────────────────────────────────────────┐
│                    Agent Layer (Multi-turn Manager)                  │
│  ┌──────────────────────────▼───────────────────────────┐            │
│  │                   Agent Class                        │            │
│  │                                                      │            │
│  │  Responsibilities:                                   │            │
│  │  • Manage conversation history (MessageStore)        │            │
│  │  • Persist artifacts (ArtifactStore)                 │            │
│  │  • Lifecycle management (created→ready→busy→ready)   │            │
│  │  • Coordinate turns via startTurn()                  │            │
│  │  • Lazy initialization on first turn                 │            │
│  │                                                      │            │
│  │  For each user message:                              │            │
│  │    1. Load message history from store                │            │
│  │    2. Call AgentLoop.startTurn(messages)             │            │
│  │    3. Collect events from Observable                 │            │
│  │    4. Save new messages to MessageStore              │            │
│  │    5. Return to ready state                          │            │
│  └──────────────────────────┬───────────────────────────┘            │
└─────────────────────────────┼────────────────────────────────────────┘
                              │
┌─────────────────────────────┼────────────────────────────────────────┐
│              AgentLoop Core (Single-turn Execution)                  │
│  ┌──────────────────────────▼───────────────────────────┐            │
│  │          AgentLoop Orchestrator (RxJS)               │            │
│  │                                                      │            │
│  │  Operator-Based Pipeline:                            │            │
│  │  ┌────────────────────────────────────────────────┐  │            │
│  │  │ defer(() => of(context))                       │  │            │
│  │  │  → tap(beforeExecute)  [root span, TaskEvent]  │  │            │
│  │  │  → switchMap(runLoop)  [iteration recursion]   │  │            │
│  │  │  → tap(afterExecute)   [final StatusUpdate]    │  │            │
│  │  │  → catchError()        [error handling]        │  │            │
│  │  │  → shareReplay(1)      [hot observable]        │  │            │
│  │  └────────────────────────────────────────────────┘  │            │
│  │                                                      │            │
│  │  Per Iteration:                                      │            │
│  │  • Start iteration span                              │            │
│  │  • Call LLM with messages + tools                    │            │
│  │  • Execute requested tools (parallel, max 5)         │            │
│  │  • Aggregate tool results                            │            │
│  │  • Loop or complete                                  │            │
│  │                                                      │            │
│  │  Operator Factories (packages/core/src/operators/):  │            │
│  │  • execute-operators.ts  (root span management)      │            │
│  │  • iteration-operators.ts (iteration spans)          │            │
│  │  • llm-operators.ts     (LLM calls, responses)       │            │
│  └──────────────────────────┬───────────────────────────┘            │
└─────────────────────────────┼────────────────────────────────────────┘
                              │
┌─────────────────────────────┼────────────────────────────────────────┐
│                    Tool Execution Layer                              │
│  ┌──────────────────────────▼──────────────────────────┐             │
│  │           Tool Providers (Array)                    │             │
│  │  • Merged tool definitions before LLM call          │             │
│  │  • Routed execution to correct provider             │             │
│  └──┬───────────────┬──────────────────────────────────┘             │
│     │               │                                                │
│     ▼               ▼                                                │
│  ┌────────┐   ┌──────────────┐                                       │
│  │ Local  │   │   Client     │                                       │
│  │  Tool  │   │     Tool     │                                       │
│  │Provider│   │   Provider   │                                       │
│  └────────┘   └──────────────┘                                       │
│                      │                                               │
│                      ▼                                               │
│           ┌──────────────────┐                                       │
│           │  A2A Input Req   │                                       │
│           │ (client provides) │                                      │
│           └──────────────────┘                                       │
│                                                                      │
│  Future: MCP Tool Provider (planned)                                 │
└──────────────────────────────────────────────────────────────────────┘
                             │
┌────────────────────────────┼─────────────────────────────────────────┐
│               Observability Layer                                    │
│  ┌──────────────────────────▼───────────────────────────┐            │
│  │         OpenTelemetry Integration                    │            │
│  │                                                      │            │
│  │  Span Hierarchy:                                     │            │
│  │  agent.turn                                          │            │
│  │    └─ agent.initialize (first turn only)             │            │
│  │    └─ agent.execute                                  │            │
│  │        ├─ iteration[0]                               │            │
│  │        │   ├─ llm.call                               │            │
│  │        │   └─ tools.execute                          │            │
│  │        │       ├─ tool[name1]                        │            │
│  │        │       └─ tool[name2]                        │            │
│  │        └─ iteration[1]...                            │            │
│  │                                                      │            │
│  │  Context Propagation:                                │            │
│  │  • W3C Trace Context in Context object               │            │
│  │  • Span refs passed via operator factories           │            │
│  │  • Parent-child relationships via OpenTelemetry API  │            │
│  └──────────────────────────────────────────────────────┘            │
└──────────────────────────────────────────────────────────────────────┘
```

## Component Responsibilities

### A2A Server Layer
**Status**: ❌ Not yet implemented

Planned responsibilities:
- **Request Authentication**: Validate incoming A2A requests
- **SSE Management**: Maintain long-lived connections for streaming
- **Event Routing**: Route task updates to correct SSE streams
- **Protocol Compliance**: Ensure A2A protocol adherence

### Agent Layer
**Status**: ✅ Fully implemented

See [`packages/core/src/agent.ts`](../packages/core/src/agent.ts)

- **Conversation Management**: Maintain message history across turns via MessageStore
- **Lifecycle Management**: Handle state transitions (created → ready → busy → ready)
- **Turn Coordination**: Load history, call AgentLoop.startTurn(), save new messages
- **Lazy Initialization**: Defer expensive setup until first turn
- **Artifact Persistence**: Store artifacts via ArtifactStore
- **Event Aggregation**: Collect and process events from AgentLoop Observable

### AgentLoop Core
**Status**: ✅ Fully implemented

See [`packages/core/src/agent-loop.ts`](../packages/core/src/agent-loop.ts) and [`packages/core/src/operators/`](../packages/core/src/operators/)

- **Single-turn Execution**: Execute one complete reasoning cycle (LLM calls + tool execution)
- **Operator Pipeline**: Modular RxJS operators for clean execution flow
- **Iteration Control**: Loop until LLM finishes or max iterations reached
- **State Management**: Track iteration state and tool calls
- **Event Emission**: Emit A2A-compliant events (TaskEvent, StatusUpdateEvent, etc.)
- **Span Management**: Create nested OpenTelemetry spans via operator factories
- **Error Handling**: Graceful error recovery at multiple pipeline stages
- **Checkpointing**: Optional state persistence via TaskStateStore
- **Resumption**: Resume from persisted state (static method)

### Tool Execution Layer
**Status**: ✅ Fully implemented (LocalToolProvider, ClientToolProvider); 🚧 MCP support planned

See [`packages/core/src/tools/`](../packages/core/src/tools/)

- **Tool Provider Interface**: Uniform interface across tool types (ToolProvider)
- **Local Tools**: Register JavaScript/TypeScript functions as tools
- **Client Tools**: Accept tools from client via A2A protocol
- **Parallel Execution**: Execute multiple tools concurrently (default: 5 concurrent)
- **Error Isolation**: Individual tool failures don't stop execution
- **Result Normalization**: Consistent ToolResult format

### Observability Layer
**Status**: ✅ Fully implemented

See [`packages/core/src/observability/`](../packages/core/src/observability/)

- **Span Creation**: OpenTelemetry spans for all operations
- **Span Hierarchy**: Nested spans with parent-child relationships
- **Context Propagation**: Trace context through Context object
- **Span Helpers**: Centralized helper functions for span operations
- **Selective Logging**: Trace-level logs for span operations, appropriate levels for application logs
- **Error Recording**: Capture errors in span attributes
