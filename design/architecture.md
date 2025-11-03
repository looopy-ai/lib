# Architecture Overview

## System Design Principles

Looopy is built on the following core principles:

1. **Reactive First**: All asynchronous operations use RxJS observables for composability and control
2. **Protocol Agnostic**: Tool and agent interfaces are abstracted from transport mechanisms
3. **Streaming Native**: Updates flow in real-time through SSE streams
4. **Distributed by Default**: OpenTelemetry tracing across all boundaries
5. **Extensible**: Hook points throughout the execution pipeline
6. **Dynamic**: Tools and agents can be discovered and registered at runtime

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
│                    A2A Server Layer                                  │
│  ┌──────────────────────────▼───────────────────────────┐            │
│  │            A2A Request Handler                       │            │
│  │  • Authentication/Authorization                      │            │
│  │  • Request validation                                │            │
│  │  • SSE connection management                         │            │
│  │  • Event routing and namespacing                     │            │
│  └──────────────────────────┬───────────────────────────┘            │
└─────────────────────────────┼────────────────────────────────────────┘
                              │
┌─────────────────────────────┼────────────────────────────────────────┐
│                    Agent Loop Core                                   │
│  ┌──────────────────────────▼───────────────────────────┐            │
│  │          Agent Orchestrator (RxJS)                   │            │
│  │                                                      │            │
│  │  ┌────────────────────────────────────────────────┐  │            │
│  │  │  1. Receive Prompt                             │  │            │
│  │  │  2. LLM Invocation (with tools)                │  │            │
│  │  │  3. Parse Tool Calls                           │  │            │
│  │  │  4. Execute Tools (parallel via mergeMap)      │  │            │
│  │  │  5. Aggregate Results                          │  │            │
│  │  │  6. Loop or Complete                           │  │            │
│  │  └────────────────────────────────────────────────┘  │            │
│  │                                                      │            │
│  │  Extension Points:                                   │            │
│  │  • beforeLLMCall                                     │            │
│  │  • afterLLMCall                                      │            │
│  │  • beforeToolExecution                               │            │
│  │  • afterToolExecution                                │            │
│  │  • onTaskUpdate                                      │            │
│  └──────────────────────────┬───────────────────────────┘            │
└─────────────────────────────┼────────────────────────────────────────┘
                              │
┌─────────────────────────────┼────────────────────────────────────────┐
│                    Tool Execution Layer                              │
│  ┌──────────────────────────▼──────────────────────────┐             │
│  │           Tool Router & Registry                    │             │
│  │  • Dynamic tool discovery                           │             │
│  │  • Capability matching                              │             │
│  │  • Provider selection                               │             │
│  └──┬───────────────┬────────────────┬─────────────────┘             │
│     │               │                │                               │
│     ▼               ▼                ▼                               │
│  ┌────────┐   ┌──────────┐   ┌──────────────┐                      │
│  │ Local  │   │   MCP    │   │    Client    │                      │
│  │  Tool  │   │   Tool   │   │     Tool     │                      │
│  │Provider│   │ Provider │   │   Provider   │                      │
│  └────────┘   └──────────┘   └──────────────┘                      │
│                     │               │                                │
│                     │               └──────────┐                     │
│                     │                          │                     │
│                     ▼                          ▼                     │
│              ┌────────────┐         ┌──────────────────┐            │
│              │ MCP Server │         │  A2A Input Req   │            │
│              └────────────┘         └──────────────────┘            │
└──────────────────────────────────────────────────────────────────────┘
                             │
┌────────────────────────────┼─────────────────────────────────────────┐
│              Sub-Agent Invocation Layer                              │
│  ┌──────────────────────────▼──────────────────────────┐            │
│  │          Agent Registry & Discovery                  │            │
│  │  • Agent capability metadata                         │            │
│  │  • Dynamic agent registration                        │            │
│  │  • Load balancing / selection                        │            │
│  └──────────────────────────┬──────────────────────────┘            │
│                             │                                         │
│  ┌──────────────────────────▼──────────────────────────┐            │
│  │       Sub-Agent A2A Client                           │            │
│  │  • Invoke sub-agent via A2A                          │            │
│  │  • Namespace task IDs (sub-agent/task-id)            │            │
│  │  • Propagate auth context                            │            │
│  │  • Forward streaming updates to parent               │            │
│  └──────────────────────────────────────────────────────┘            │
└──────────────────────────────────────────────────────────────────────┘
                             │
┌────────────────────────────┼─────────────────────────────────────────┐
│               Observability Layer                                    │
│  ┌──────────────────────────▼──────────────────────────┐            │
│  │         OpenTelemetry Integration                    │            │
│  │                                                       │            │
│  │  Spans:                                              │            │
│  │  • agent.loop.iteration                              │            │
│  │  • llm.call                                          │            │
│  │  • tool.execute                                      │            │
│  │  • agent.invoke                                      │            │
│  │  • a2a.request                                       │            │
│  │                                                       │            │
│  │  Context Propagation:                                │            │
│  │  • W3C Trace Context headers                         │            │
│  │  • Baggage for auth tokens                           │            │
│  └──────────────────────────────────────────────────────┘            │
└──────────────────────────────────────────────────────────────────────┘
```

## Component Responsibilities

### A2A Server Layer
- **Request Authentication**: Validates incoming A2A requests
- **SSE Management**: Maintains long-lived connections for streaming
- **Event Routing**: Routes task updates to correct SSE streams
- **Namespace Management**: Handles sub-agent event namespacing

### Agent Loop Core
- **Orchestration**: Coordinates LLM calls, tool execution, and response aggregation
- **State Management**: Tracks conversation history and context
- **Extension Execution**: Invokes hooks at defined extension points
- **Error Handling**: Graceful degradation and retry logic

### Tool Execution Layer
- **Tool Registry**: Maintains catalog of available tools
- **Provider Abstraction**: Uniform interface across tool types
- **Execution Isolation**: Sandboxed tool execution
- **Result Normalization**: Consistent result format

### Sub-Agent Layer
- **Agent Discovery**: Finds capable agents for tasks
- **A2A Client**: Invokes sub-agents using A2A protocol
- **Update Forwarding**: Streams sub-agent updates to parent
- **Auth Propagation**: Passes credentials to sub-agents

### Observability Layer
- **Trace Creation**: Generates spans for all operations
- **Context Propagation**: Maintains trace context across boundaries
- **Metric Collection**: Records performance and usage metrics
- **Log Correlation**: Links logs to traces

## Data Flow

### Standard Request Flow

```
1. Client → A2A POST /invoke
   ↓
2. A2A Server authenticates and creates SSE stream
   ↓
3. Agent Loop receives prompt
   ↓
4. LLM called with available tools
   ↓
5. LLM returns tool calls
   ↓
6. Tool calls executed in parallel (RxJS mergeMap)
   ↓ ↓ ↓
   Local  MCP  Client Tool
   Tool   Tool  (input-required)
   ↓ ↓ ↓
7. Results aggregated
   ↓
8. Results sent to LLM (loop continues)
   ↓
9. LLM returns final response
   ↓
10. Response streamed to client via SSE
```

### Sub-Agent Invocation Flow

```
1. Main agent decides to invoke sub-agent
   ↓
2. Agent Registry queried for capable agent
   ↓
3. Sub-Agent A2A Client creates request
   ↓
4. Auth context propagated (with potential re-issue)
   ↓
5. SSE stream opened to sub-agent
   ↓
6. Sub-agent updates received: { id: "task-123", ... }
   ↓
7. Updates namespaced: "sub-agent/task-123"
   ↓
8. Forwarded to parent's SSE stream
   ↓
9. Client receives namespaced updates
   ↓
10. Sub-agent completes, result returned to main agent
```

## Technology Choices

### RxJS for Orchestration
- **Observables**: Natural fit for streaming data
- **Operators**: Rich set for async composition (mergeMap, concatMap, retry, etc.)
- **Backpressure**: Built-in handling for overwhelming data rates
- **Testing**: Marble testing for async behavior

### Server-Sent Events (SSE)
- **Unidirectional**: Perfect for status updates
- **Reconnection**: Automatic reconnection with Last-Event-ID
- **Browser Native**: No additional client libraries needed
- **Simple Protocol**: Text-based, easy to debug

### OpenTelemetry
- **Vendor Neutral**: Works with any backend
- **Distributed**: Trace across service boundaries
- **Rich Context**: Spans, metrics, logs in one framework
- **Industry Standard**: W3C Trace Context

### TypeScript
- **Type Safety**: Catch errors at compile time
- **Developer Experience**: Excellent IDE support
- **Ecosystem**: Rich library ecosystem
- **Async/Await**: Modern async patterns

## Scalability Considerations

### Horizontal Scaling
- Agents are stateless (except conversation context)
- SSE connections can be sticky-sessioned
- Tool execution can be distributed
- Sub-agent calls are location-transparent

### Performance
- Parallel tool execution via RxJS
- Connection pooling for sub-agent calls
- Caching for tool discovery
- Efficient event routing

### Reliability
- Retry logic for transient failures
- Circuit breakers for failing services
- Graceful degradation
- Health check endpoints

## Security Architecture

### Authentication Flow
```
Client Auth → A2A Server → Agent Loop → Tool/Sub-Agent
    ↓              ↓             ↓              ↓
  Bearer       Validate    Extension      Passthrough
  Token         Token        Hook          or Re-issue
```

### Security Layers
1. **Transport Security**: TLS for all connections
2. **Authentication**: Configurable strategies (JWT, OAuth, API Key)
3. **Authorization**: Tool-level permission checks
4. **Credential Management**: Secure storage and rotation
5. **Audit Logging**: All operations traced

## Extension Architecture

### Hook Points
Extensions can inject behavior at:
- **Pre-Request**: Modify/validate incoming requests
- **Pre-LLM**: Alter prompts or tool lists
- **Post-LLM**: Process LLM responses
- **Pre-Tool**: Validate/transform tool calls
- **Post-Tool**: Process tool results
- **Pre-Agent**: Modify sub-agent invocations
- **Post-Agent**: Process sub-agent results
- **Task Updates**: React to status changes

### Extension Interface
```typescript
interface Extension {
  name: string;
  priority: number;
  hooks: {
    beforeLLMCall?: (context: LLMContext) => Observable<LLMContext>;
    afterToolExecution?: (result: ToolResult) => Observable<ToolResult>;
    // ... other hooks
  };
}
```

## Next Steps

Refer to specialized design documents:
- [Agent Loop Design](./agent-loop.md) - Detailed loop mechanics
- [A2A Protocol](./a2a-protocol.md) - Protocol specification
- [Artifact Management](./artifact-management.md) - Artifact storage and A2A streaming
- [Tool Integration](./tool-integration.md) - Tool provider details
- [Authentication](./authentication.md) - Security implementation
- [Observability](./observability.md) - Tracing and monitoring
