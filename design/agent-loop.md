# Agent Loop Design

## Implementation Status

### ✅ Fully Implemented
- Core agent loop execution (`src/core/agent-loop.ts`)
- State machine and RxJS pipeline
- LLM integration with streaming support
- Tool execution (parallel with concurrency)
- Checkpointing and state persistence
- Session resumption from persisted state
- Error handling with retry logic
- OpenTelemetry tracing integration
- A2A event emission (task, status-update)
- State store interface and implementations (Redis + In-Memory)
- Store factory pattern
- State cleanup service
- shareReplay() for hot observables

### 🚧 Partially Implemented
- Artifact management (interface defined, implementations missing)
- Tool result aggregation (basic implementation exists)
- A2A artifact streaming (structure exists, needs artifact stores)

### ❌ Not Yet Implemented
The following features from this design are **NOT YET IMPLEMENTED** and should be evaluated for implementation:

1. **Artifact Store Implementations** (Lines 806-1405)
   - `RedisArtifactStore` - Hybrid Redis/S3 storage for large artifacts
   - `InMemoryArtifactStore` - Testing/development artifact storage
   - `ArtifactStoreWithEvents` - Decorator for A2A event emission
   - External storage integration (S3, local filesystem)

2. **Artifact Management Tools** (Lines 1411-1676)
   - `ArtifactToolProvider` - Built-in tools for LLM artifact creation
   - Tools: `create_artifact`, `append_artifact`, `append_artifact_data`, `replace_artifact_part`, `complete_artifact`, `list_artifacts`

3. **Advanced Features** (Various sections)
   - Sub-agent invocation as tools (Lines 338-388)
   - Streaming LLM response with chunks (Lines 233-266)
   - Tool execution caching (Lines 575-591)
   - Tool execution batching/optimization (Lines 598-623)
   - Tool execution idempotency tracking (Lines 2413-2447)
   - Extension hooks (beforeRequest, beforeLLMCall, etc.)
   - Performance optimizations (LLM caching, tool batching)

4. **Testing Infrastructure** (Lines 2454-2525)
   - Marble testing examples
   - RxJS TestScheduler integration
   - Comprehensive test coverage for resumption

**Recommendation**: Focus on implementing artifact stores first (items 1-2) as they're referenced by the core agent loop and enable important A2A protocol features (artifact streaming, multi-part responses).

---

## Overview

The Agent Loop is the core execution engine of Looopy, responsible for orchestrating interactions between LLMs, tools, and sub-agents. It uses RxJS observables to manage the asynchronous, iterative nature of agent execution.

## Loop Architecture

### State Machine

```
    ┌──────────────┐
    │     IDLE     │
    └──────┬───────┘
           │ invoke(prompt)
           ▼
    ┌──────────────┐
    │  PREPARING   │◄────────────┐
    └──────┬───────┘             │
           │                     │
           ▼                     │
    ┌──────────────┐             │
    │  LLM_CALL    │             │
    └──────┬───────┘             │
           │                     │
           ├─────────────────┐   │
           │                 │   │
           ▼                 ▼   │
    ┌──────────────┐  ┌──────────────┐
    │ TOOL_EXECUTE │  │  COMPLETED   │
    └──────┬───────┘  └──────────────┘
           │
           └─────────────────────┘
              (loop iteration)
```

### RxJS Pipeline

```typescript
const agentLoop$ = (prompt: string, context: Context): Observable<AgentEvent> => {
  return of({ prompt, context }).pipe(
    // Extension: beforeRequest
    extensionHook('beforeRequest'),

    // Prepare tools and build context
    switchMap(ctx => prepareExecution$(ctx)),

    // Enter loop
    expand(state => {
      if (state.completed) {
        return EMPTY;
      }

      return of(state).pipe(
        // Extension: beforeLLMCall
        extensionHook('beforeLLMCall'),

        // Call LLM
        switchMap(s => callLLM$(s)),

        // Extension: afterLLMCall
        extensionHook('afterLLMCall'),

        // Check if done or has tool calls
        switchMap(s => {
          if (s.llmResponse.finished) {
            return of({ ...s, completed: true });
          }

          if (s.llmResponse.toolCalls?.length > 0) {
            return executeTools$(s.llmResponse.toolCalls, s).pipe(
              map(toolResults => ({
                ...s,
                messages: [
                  ...s.messages,
                  s.llmResponse.message,
                  ...toolResults.map(toMessage)
                ]
              }))
            );
          }

          return of({ ...s, completed: true });
        })
      );
    }),

    // Take only completed state
    filter(state => state.completed),

    // Extension: afterCompletion
    extensionHook('afterCompletion'),

    // Extract final response
    map(state => state.llmResponse.content)
  );
};
```

## Loop State

### State Structure

```typescript
interface LoopState {
  // Execution metadata
  taskId: string;
  agentId: string;
  parentTaskId?: string;

  // Conversation state
  messages: Message[];
  systemPrompt: string;

  // Tool state
  availableTools: ToolDefinition[];
  toolResults: Map<string, ToolResult>;

  // Agent state
  subAgents: AgentDefinition[];
  activeSubAgents: Set<string>;

  // Control flow
  completed: boolean;
  iteration: number;
  maxIterations: number;

  // Context
  context: ExecutionContext;
  traceContext: TraceContext;
  authContext: AuthContext;

  // Latest LLM response
  llmResponse?: LLMResponse;
}
```

### Message Format

```typescript
interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;  // For tool messages
  toolCallId?: string;
  metadata?: Record<string, unknown>;
}
```

## LLM Integration

### LLM Provider Interface

```typescript
interface LLMProvider {
  /**
   * Call the LLM with conversation context and available tools
   */
  call(params: LLMCallParams): Observable<LLMResponse>;

  /**
   * Stream LLM response chunks
   */
  stream(params: LLMCallParams): Observable<LLMChunk>;

  /**
   * Get provider capabilities
   */
  getCapabilities(): LLMCapabilities;
}

interface LLMCallParams {
  messages: Message[];
  tools?: ToolDefinition[];
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
  metadata?: Record<string, unknown>;
}

interface LLMResponse {
  message: Message;
  toolCalls?: ToolCall[];
  finished: boolean;
  finishReason?: 'stop' | 'length' | 'tool_calls' | 'content_filter';
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;  // JSON string
  };
}
```

### Streaming LLM Response

```typescript
const streamLLMCall$ = (state: LoopState): Observable<AgentEvent> => {
  return llmProvider.stream({
    messages: state.messages,
    tools: state.availableTools
  }).pipe(
    // Emit chunks as events
    map(chunk => ({
      type: 'llm-chunk',
      taskId: state.taskId,
      data: chunk
    })),

    // Accumulate chunks
    scan((acc, chunk) => ({
      ...acc,
      content: acc.content + chunk.delta
    }), { content: '' }),

    // Emit accumulated result
    last(),

    // Convert to LLM response
    map(accumulated => ({
      type: 'llm-complete',
      taskId: state.taskId,
      data: accumulated
    }))
  );
};
```

## Tool Execution

### Parallel Tool Execution

```typescript
const executeTools$ = (
  toolCalls: ToolCall[],
  state: LoopState
): Observable<ToolResult[]> => {
  return from(toolCalls).pipe(
    // Execute tools in parallel with concurrency limit
    mergeMap(
      toolCall => executeSingleTool$(toolCall, state),
      5  // Max concurrent tool executions
    ),

    // Collect all results
    toArray(),

    // Emit task updates
    tap(results => {
      results.forEach(result => {
        emitTaskUpdate({
          taskId: state.taskId,
          type: 'tool-complete',
          toolName: result.toolName,
          success: result.success
        });
      });
    })
  );
};

const executeSingleTool$ = (
  toolCall: ToolCall,
  state: LoopState
): Observable<ToolResult> => {
  const span = startSpan('tool.execute', {
    'tool.name': toolCall.function.name,
    'tool.call_id': toolCall.id
  });

  return of(toolCall).pipe(
    // Extension: beforeToolExecution
    extensionHook('beforeToolExecution', state),

    // Emit task update
    tap(() => emitTaskUpdate({
      taskId: state.taskId,
      type: 'tool-start',
      toolCallId: toolCall.id,
      toolName: toolCall.function.name
    })),

    // Route to appropriate provider
    switchMap(tc => toolRouter.execute(tc, state.context)),

    // Extension: afterToolExecution
    extensionHook('afterToolExecution', state),

    // Handle errors
    catchError(error => {
      span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
      return of({
        toolCallId: toolCall.id,
        toolName: toolCall.function.name,
        success: false,
        error: error.message,
        result: null
      });
    }),

    // Finalize span
    finalize(() => span.end())
  );
};
```

### Tool Result Aggregation

```typescript
const aggregateToolResults = (
  toolCalls: ToolCall[],
  results: ToolResult[]
): Message[] => {
  return results.map(result => ({
    role: 'tool',
    content: result.success
      ? JSON.stringify(result.result)
      : `Error: ${result.error}`,
    name: result.toolName,
    toolCallId: result.toolCallId
  }));
};
```

## Sub-Agent Invocation

### Agent as Tool

Sub-agents are treated as special tools in the loop:

```typescript
const invokeSubAgent$ = (
  agentCall: ToolCall,  // Actually an agent invocation
  state: LoopState
): Observable<ToolResult> => {
  const agentId = extractAgentId(agentCall);
  const subTaskId = `${state.agentId}/${generateId()}`;

  return of(agentCall).pipe(
    // Find agent
    switchMap(() => agentRegistry.find(agentId)),

    // Create A2A request
    switchMap(agent => {
      const a2aClient = new A2AClient({
        baseUrl: agent.endpoint,
        auth: prepareAuth(state.authContext, agent)
      });

      return a2aClient.invoke({
        prompt: parsePrompt(agentCall.function.arguments),
        taskId: subTaskId,
        stream: true,
        traceContext: state.traceContext
      });
    }),

    // Forward sub-agent updates
    tap(event => {
      if (event.type === 'task-update') {
        emitTaskUpdate({
          taskId: `${state.agentId}/${event.taskId}`,  // Namespace!
          ...event.data
        });
      }
    }),

    // Wait for completion
    filter(event => event.type === 'complete'),

    // Return as tool result
    map(event => ({
      toolCallId: agentCall.id,
      toolName: `agent:${agentId}`,
      success: true,
      result: event.data
    }))
  );
};
```

## Event Emission

### Task Update Events

```typescript
interface TaskUpdateEvent {
  taskId: string;
  timestamp: string;
  type: 'started' | 'llm-call' | 'tool-start' | 'tool-complete' |
        'agent-invoke' | 'iteration' | 'complete' | 'error';
  data: Record<string, unknown>;
  traceId?: string;
  spanId?: string;
}

const emitTaskUpdate = (event: TaskUpdateEvent): void => {
  // Emit via A2A SSE stream
  a2aServer.emit(event.taskId, {
    event: 'task-update',
    data: JSON.stringify(event)
  });

  // Record metric
  meter.counter('task_updates').add(1, {
    'task.type': event.type,
    'agent.id': extractAgentId(event.taskId)
  });
};
```

### Event Types

- **started**: Loop execution began
- **llm-call**: LLM is being called
- **llm-chunk**: Streaming LLM response chunk
- **llm-complete**: LLM call completed
- **tool-start**: Tool execution started
- **tool-complete**: Tool execution finished
- **agent-invoke**: Sub-agent invocation started
- **iteration**: Loop iteration completed
- **complete**: Final result ready
- **error**: Error occurred

## Error Handling

### Retry Strategy

```typescript
const callLLMWithRetry$ = (state: LoopState): Observable<LLMResponse> => {
  return llmProvider.call({
    messages: state.messages,
    tools: state.availableTools
  }).pipe(
    retry({
      count: 3,
      delay: (error, retryCount) => {
        // Exponential backoff
        const delayMs = Math.min(1000 * Math.pow(2, retryCount), 10000);

        // Emit retry event
        emitTaskUpdate({
          taskId: state.taskId,
          type: 'retry',
          data: {
            attempt: retryCount + 1,
            error: error.message,
            delayMs
          }
        });

        return timer(delayMs);
      },
      resetOnSuccess: true
    }),

    catchError(error => {
      // Log and emit error
      logger.error('LLM call failed after retries', { error, state });
      emitTaskUpdate({
        taskId: state.taskId,
        type: 'error',
        data: { error: error.message, component: 'llm' }
      });

      throw error;
    })
  );
};
```

### Graceful Degradation

```typescript
const executeWithFallback$ = (
  toolCall: ToolCall,
  state: LoopState
): Observable<ToolResult> => {
  return toolRouter.execute(toolCall, state.context).pipe(
    timeout(30000),  // 30 second timeout

    catchError(error => {
      // Try fallback provider
      if (toolRouter.hasFallback(toolCall.function.name)) {
        logger.warn('Using fallback provider', { tool: toolCall.function.name });
        return toolRouter.executeFallback(toolCall, state.context);
      }

      // Return error result instead of throwing
      return of({
        toolCallId: toolCall.id,
        toolName: toolCall.function.name,
        success: false,
        error: error.message,
        result: null
      });
    })
  );
};
```

## Loop Control

### Max Iterations

```typescript
const agentLoopWithLimit$ = (prompt: string, context: Context) => {
  return agentLoop$(prompt, context).pipe(
    scan((acc, state) => ({ ...state, iteration: acc.iteration + 1 }),
         { iteration: 0 } as LoopState),

    takeWhile(state => state.iteration < MAX_ITERATIONS || state.completed),

    tap(state => {
      if (state.iteration >= MAX_ITERATIONS && !state.completed) {
        logger.warn('Max iterations reached', { taskId: state.taskId });
        emitTaskUpdate({
          taskId: state.taskId,
          type: 'warning',
          data: { message: 'Max iterations reached' }
        });
      }
    })
  );
};
```

### Cancellation

```typescript
class AgentLoop {
  private cancellationTokens = new Map<string, Subject<void>>();

  invoke(prompt: string, context: Context): Observable<string> {
    const taskId = generateTaskId();
    const cancel$ = new Subject<void>();
    this.cancellationTokens.set(taskId, cancel$);

    return agentLoop$(prompt, context).pipe(
      takeUntil(cancel$),
      finalize(() => {
        this.cancellationTokens.delete(taskId);
        cancel$.complete();
      })
    );
  }

  cancel(taskId: string): void {
    const cancel$ = this.cancellationTokens.get(taskId);
    if (cancel$) {
      cancel$.next();
      emitTaskUpdate({
        taskId,
        type: 'cancelled',
        data: { timestamp: new Date().toISOString() }
      });
    }
  }
}
```

## Performance Optimization

### Caching

```typescript
const callLLMWithCache$ = (state: LoopState): Observable<LLMResponse> => {
  const cacheKey = computeCacheKey(state.messages, state.availableTools);

  return defer(() => cache.get(cacheKey)).pipe(
    switchMap(cached => {
      if (cached) {
        return of(cached);
      }

      return llmProvider.call({
        messages: state.messages,
        tools: state.availableTools
      }).pipe(
        tap(response => cache.set(cacheKey, response, TTL_MS))
      );
    })
  );
};
```

### Tool Execution Optimization

```typescript
// Group tools by provider for batch execution
const executeToolsBatched$ = (
  toolCalls: ToolCall[],
  state: LoopState
): Observable<ToolResult[]> => {
  const groupedByProvider = groupBy(
    toolCalls,
    tc => toolRouter.getProvider(tc.function.name)
  );

  return from(Object.entries(groupedByProvider)).pipe(
    mergeMap(([provider, calls]) => {
      // Some providers support batch execution
      if (provider.supportsBatch) {
        return provider.executeBatch(calls, state.context);
      }

      // Fall back to individual execution
      return from(calls).pipe(
        mergeMap(call => provider.execute(call, state.context))
      );
    }),
    toArray()
  );
};
```

## Session Persistence and Restoration

### State Persistence Strategy

The agent loop must support resumption after disconnection, server restart, or client reconnection. This is critical for A2A protocol compliance with `tasks/resubscribe`.

#### State Data Model

```typescript
interface PersistedLoopState {
  // Core state
  taskId: string;
  agentId: string;
  parentTaskId?: string;
  contextId: string;

  // Execution state
  messages: Message[];
  systemPrompt: string;
  iteration: number;
  completed: boolean;

  // Tool state
  availableTools: ToolDefinition[];
  pendingToolCalls: ToolCall[];
  completedToolCalls: Map<string, ToolResult>;

  // Artifact references
  artifactIds: string[];  // References to artifact store

  // Sub-agent state
  activeSubAgents: {
    agentId: string;
    taskId: string;
    status: 'running' | 'completed' | 'failed';
    result?: unknown;
  }[];

  // Latest state
  lastLLMResponse?: LLMResponse;
  lastActivity: string;  // ISO timestamp

  // Resumption hints
  resumeFrom: 'llm-call' | 'tool-execution' | 'sub-agent' | 'completed';
  checkpointMetadata?: Record<string, unknown>;
}
```

#### State Store Interface

```typescript
interface StateStore {
  /**
   * Save task state to persistent storage
   */
  save(taskId: string, state: PersistedLoopState): Promise<void>;

  /**
   * Load task state from persistent storage
   */
  load(taskId: string): Promise<PersistedLoopState | null>;

  /**
   * Check if task state exists
   */
  exists(taskId: string): Promise<boolean>;

  /**
   * Delete task state
   */
  delete(taskId: string): Promise<void>;

  /**
   * List all task IDs (optionally filtered)
   */
  listTasks(filter?: {
    agentId?: string;
    contextId?: string;
    completedAfter?: Date;
  }): Promise<string[]>;

  /**
   * Set TTL for task state
   */
  setTTL(taskId: string, ttlSeconds: number): Promise<void>;
}
```

## Artifact Store

### Artifact Store Interface

```typescript
interface ArtifactStore {
  /**
   * Create a new artifact
   */
  createArtifact(params: {
    taskId: string;
    contextId: string;
    name?: string;
    description?: string;
    mimeType?: string;
  }): Promise<string>;

  /**
   * Append a new part to an artifact
   */
  appendPart(
    artifactId: string,
    part: Omit<ArtifactPart, 'index'>,
    isLastChunk?: boolean
  ): Promise<void>;

  /**
   * Replace a specific part in an artifact
   */
  replacePart(
    artifactId: string,
    partIndex: number,
    part: Omit<ArtifactPart, 'index'>
  ): Promise<void>;

  /**
   * Get artifact metadata
   */
  getArtifact(artifactId: string): Promise<StoredArtifact | null>;

  /**
   * Get artifact parts with optional external resolution
   */
  getArtifactParts(
    artifactId: string,
    resolveExternal?: boolean
  ): Promise<ArtifactPart[]>;

  /**
   * List all artifacts for a task
   */
  getTaskArtifacts(taskId: string): Promise<string[]>;

  /**
   * Delete an artifact and its external storage
   */
  deleteArtifact(artifactId: string): Promise<void>;

  /**
   * Get artifact content as a complete string or object
   */
  getArtifactContent(artifactId: string): Promise<string | object>;
}
```

### Artifact Data Model

Artifacts are the outputs generated by the agent during task execution. They support streaming/chunking, multi-part composition, and versioning.

```typescript
interface StoredArtifact {
  artifactId: string;
  taskId: string;
  contextId: string;

  // Metadata
  name?: string;
  description?: string;
  mimeType?: string;

  // Parts composition
  parts: ArtifactPart[];
  totalParts: number;

  // Versioning for append/replace operations
  version: number;
  operations: ArtifactOperation[];

  // Lifecycle
  status: 'building' | 'complete' | 'failed';
  createdAt: string;
  updatedAt: string;
  completedAt?: string;

  // Storage
  storageBackend: 'redis' | 's3' | 'local';
  storageKey?: string;  // For external storage

  // A2A streaming state
  lastChunkIndex: number;
  isLastChunk: boolean;
}

interface ArtifactPart {
  index: number;
  kind: 'text' | 'file' | 'data';

  // Content (for small parts stored inline)
  content?: string;  // For text/data
  data?: Record<string, unknown>;  // For structured data

  // File reference (for large parts stored externally)
  fileReference?: {
    storageKey: string;
    size: number;
    mimeType: string;
    checksum?: string;
  };

  metadata?: Record<string, unknown>;
}

interface ArtifactOperation {
  operationId: string;
  type: 'create' | 'append' | 'replace' | 'complete';
  timestamp: string;
  partIndex?: number;
  chunkIndex?: number;

  // For replace operations
  replacedPartIndexes?: number[];
}
```

### Artifact Store Implementations

#### Redis/S3 Hybrid Implementation

```typescript
class RedisArtifactStore implements ArtifactStore {
  constructor(
    private redis: RedisClient,
    private s3?: S3Client,  // Optional external storage
    private config: {
      inlineMaxSize: number;  // Max size for inline storage (e.g., 1MB)
      ttl: number;  // Time to live in seconds
      storageBackend: 'redis' | 's3' | 'local';
    }
  ) {}

  async createArtifact(params: {
    taskId: string;
    contextId: string;
    name?: string;
    mimeType?: string;
  }): Promise<string> {
    const artifactId = `artifact:${params.taskId}:${generateId()}`;

    const artifact: StoredArtifact = {
      artifactId,
      taskId: params.taskId,
      contextId: params.contextId,
      name: params.name,
      mimeType: params.mimeType,
      parts: [],
      totalParts: 0,
      version: 1,
      operations: [{
        operationId: generateId(),
        type: 'create',
        timestamp: new Date().toISOString()
      }],
      status: 'building',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      storageBackend: this.config.storageBackend,
      lastChunkIndex: -1,
      isLastChunk: false
    };

    await this.saveArtifact(artifact);

    // Add to task's artifact list
    await this.redis.sadd(`task:${params.taskId}:artifacts`, artifactId);

    return artifactId;
  }

  async appendPart(
    artifactId: string,
    part: Omit<ArtifactPart, 'index'>,
    isLastChunk: boolean = false
  ): Promise<void> {
    const artifact = await this.loadArtifact(artifactId);
    if (!artifact) {
      throw new Error(`Artifact ${artifactId} not found`);
    }

    if (artifact.status === 'complete') {
      throw new Error(`Cannot append to completed artifact ${artifactId}`);
    }

    const partIndex = artifact.parts.length;
    const chunkIndex = artifact.lastChunkIndex + 1;

    // Determine storage location based on size
    const partWithIndex: ArtifactPart = { ...part, index: partIndex };

    if (this.shouldStoreExternally(part)) {
      // Store large content externally
      const storageKey = `${artifactId}/part-${partIndex}`;
      await this.storeExternally(storageKey, part);

      partWithIndex.fileReference = {
        storageKey,
        size: this.estimateSize(part),
        mimeType: artifact.mimeType || 'application/octet-stream'
      };

      // Clear inline content
      delete partWithIndex.content;
      delete partWithIndex.data;
    }

    artifact.parts.push(partWithIndex);
    artifact.totalParts = artifact.parts.length;
    artifact.version++;
    artifact.lastChunkIndex = chunkIndex;
    artifact.isLastChunk = isLastChunk;
    artifact.updatedAt = new Date().toISOString();

    artifact.operations.push({
      operationId: generateId(),
      type: 'append',
      timestamp: new Date().toISOString(),
      partIndex,
      chunkIndex
    });

    if (isLastChunk) {
      artifact.status = 'complete';
      artifact.completedAt = new Date().toISOString();
    }

    await this.saveArtifact(artifact);
  }

  async replacePart(
    artifactId: string,
    partIndex: number,
    part: Omit<ArtifactPart, 'index'>
  ): Promise<void> {
    const artifact = await this.loadArtifact(artifactId);
    if (!artifact) {
      throw new Error(`Artifact ${artifactId} not found`);
    }

    if (partIndex >= artifact.parts.length) {
      throw new Error(`Part index ${partIndex} out of bounds`);
    }

    const oldPart = artifact.parts[partIndex];

    // Clean up old external storage if needed
    if (oldPart.fileReference) {
      await this.deleteExternalStorage(oldPart.fileReference.storageKey);
    }

    const partWithIndex: ArtifactPart = { ...part, index: partIndex };

    if (this.shouldStoreExternally(part)) {
      const storageKey = `${artifactId}/part-${partIndex}-v${artifact.version}`;
      await this.storeExternally(storageKey, part);

      partWithIndex.fileReference = {
        storageKey,
        size: this.estimateSize(part),
        mimeType: artifact.mimeType || 'application/octet-stream'
      };

      delete partWithIndex.content;
      delete partWithIndex.data;
    }

    artifact.parts[partIndex] = partWithIndex;
    artifact.version++;
    artifact.updatedAt = new Date().toISOString();

    artifact.operations.push({
      operationId: generateId(),
      type: 'replace',
      timestamp: new Date().toISOString(),
      partIndex,
      replacedPartIndexes: [partIndex]
    });

    await this.saveArtifact(artifact);
  }

  async getArtifact(artifactId: string): Promise<StoredArtifact | null> {
    return this.loadArtifact(artifactId);
  }

  async getArtifactParts(
    artifactId: string,
    resolveExternal: boolean = true
  ): Promise<ArtifactPart[]> {
    const artifact = await this.loadArtifact(artifactId);
    if (!artifact) {
      throw new Error(`Artifact ${artifactId} not found`);
    }

    if (!resolveExternal) {
      return artifact.parts;
    }

    // Resolve external storage references
    return Promise.all(
      artifact.parts.map(async (part) => {
        if (part.fileReference) {
          const content = await this.loadExternalStorage(
            part.fileReference.storageKey
          );

          return {
            ...part,
            content: part.kind === 'text' ? content : undefined,
            data: part.kind === 'data' ? JSON.parse(content) : undefined
          };
        }

        return part;
      })
    );
  }

  async getTaskArtifacts(taskId: string): Promise<string[]> {
    return this.redis.smembers(`task:${taskId}:artifacts`);
  }

  async deleteArtifact(artifactId: string): Promise<void> {
    const artifact = await this.loadArtifact(artifactId);
    if (!artifact) return;

    // Delete external storage
    for (const part of artifact.parts) {
      if (part.fileReference) {
        await this.deleteExternalStorage(part.fileReference.storageKey);
      }
    }

    // Delete from Redis
    await this.redis.del(`artifact:${artifactId}`);
    await this.redis.srem(`task:${artifact.taskId}:artifacts`, artifactId);
  }

  async getArtifactContent(artifactId: string): Promise<string | object> {
    const parts = await this.getArtifactParts(artifactId, true);

    if (parts.length === 0) {
      return '';
    }

    // If all parts are text, concatenate
    if (parts.every(p => p.kind === 'text')) {
      return parts.map(p => p.content || '').join('');
    }

    // If all parts are data, merge into array
    if (parts.every(p => p.kind === 'data')) {
      return parts.map(p => p.data);
    }

    // Mixed content - return structured
    return {
      parts: parts.map(p => {
        if (p.kind === 'text') return { type: 'text', content: p.content };
        if (p.kind === 'data') return { type: 'data', data: p.data };
        return { type: 'file', reference: p.fileReference };
      })
    };
  }

  private async saveArtifact(artifact: StoredArtifact): Promise<void> {
    await this.redis.setex(
      `artifact:${artifact.artifactId}`,
      this.config.ttl,
      JSON.stringify(artifact)
    );
  }

  private async loadArtifact(artifactId: string): Promise<StoredArtifact | null> {
    const data = await this.redis.get(`artifact:${artifactId}`);
    return data ? JSON.parse(data) : null;
  }

  private shouldStoreExternally(part: Omit<ArtifactPart, 'index'>): boolean {
    const size = this.estimateSize(part);
    return size > this.config.inlineMaxSize;
  }

  private estimateSize(part: Omit<ArtifactPart, 'index'>): number {
    if (part.content) {
      return Buffer.byteLength(part.content, 'utf8');
    }
    if (part.data) {
      return Buffer.byteLength(JSON.stringify(part.data), 'utf8');
    }
    return 0;
  }

  private async storeExternally(key: string, part: Omit<ArtifactPart, 'index'>): Promise<void> {
    const content = part.content || JSON.stringify(part.data);

    switch (this.config.storageBackend) {
      case 's3':
        if (!this.s3) throw new Error('S3 client not configured');
        await this.s3.putObject({
          Bucket: process.env.ARTIFACT_BUCKET!,
          Key: key,
          Body: content,
          ContentType: part.kind === 'text' ? 'text/plain' : 'application/json'
        });
        break;

      case 'local':
        const fs = require('fs').promises;
        const path = require('path');
        const filePath = path.join(process.env.ARTIFACT_DIR || '/tmp/artifacts', key);
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, content);
        break;

      case 'redis':
        // Store in separate Redis key with longer TTL
        await this.redis.setex(`artifact:storage:${key}`, this.config.ttl * 2, content);
        break;
    }
  }

  private async loadExternalStorage(key: string): Promise<string> {
    switch (this.config.storageBackend) {
      case 's3':
        if (!this.s3) throw new Error('S3 client not configured');
        const response = await this.s3.getObject({
          Bucket: process.env.ARTIFACT_BUCKET!,
          Key: key
        });
        return response.Body?.toString() || '';

      case 'local':
        const fs = require('fs').promises;
        const path = require('path');
        const filePath = path.join(process.env.ARTIFACT_DIR || '/tmp/artifacts', key);
        return fs.readFile(filePath, 'utf8');

      case 'redis':
        return (await this.redis.get(`artifact:storage:${key}`)) || '';
    }
  }

  private async deleteExternalStorage(key: string): Promise<void> {
    switch (this.config.storageBackend) {
      case 's3':
        if (!this.s3) throw new Error('S3 client not configured');
        await this.s3.deleteObject({
          Bucket: process.env.ARTIFACT_BUCKET!,
          Key: key
        });
        break;

      case 'local':
        const fs = require('fs').promises;
        const path = require('path');
        const filePath = path.join(process.env.ARTIFACT_DIR || '/tmp/artifacts', key);
        await fs.unlink(filePath).catch(() => {});
        break;

      case 'redis':
        await this.redis.del(`artifact:storage:${key}`);
        break;
    }
  }
}

class InMemoryArtifactStore implements ArtifactStore {
  private artifacts = new Map<string, StoredArtifact>();
  private taskArtifacts = new Map<string, Set<string>>();
  private storage = new Map<string, string>();

  async createArtifact(params: {
    taskId: string;
    contextId: string;
    name?: string;
    description?: string;
    mimeType?: string;
  }): Promise<string> {
    const artifactId = `artifact:${params.taskId}:${generateId()}`;

    const artifact: StoredArtifact = {
      artifactId,
      taskId: params.taskId,
      contextId: params.contextId,
      name: params.name,
      description: params.description,
      mimeType: params.mimeType,
      parts: [],
      totalParts: 0,
      version: 1,
      operations: [{
        operationId: generateId(),
        type: 'create',
        timestamp: new Date().toISOString()
      }],
      status: 'building',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      storageBackend: 'local',
      lastChunkIndex: -1,
      isLastChunk: false
    };

    this.artifacts.set(artifactId, artifact);

    if (!this.taskArtifacts.has(params.taskId)) {
      this.taskArtifacts.set(params.taskId, new Set());
    }
    this.taskArtifacts.get(params.taskId)!.add(artifactId);

    return artifactId;
  }

  async appendPart(
    artifactId: string,
    part: Omit<ArtifactPart, 'index'>,
    isLastChunk: boolean = false
  ): Promise<void> {
    const artifact = this.artifacts.get(artifactId);
    if (!artifact) {
      throw new Error(`Artifact ${artifactId} not found`);
    }

    if (artifact.status === 'complete') {
      throw new Error(`Cannot append to completed artifact ${artifactId}`);
    }

    const partIndex = artifact.parts.length;
    const chunkIndex = artifact.lastChunkIndex + 1;

    const partWithIndex: ArtifactPart = { ...part, index: partIndex };

    // Store content in memory
    if (part.content || part.data) {
      const storageKey = `${artifactId}/part-${partIndex}`;
      const content = part.content || JSON.stringify(part.data);
      this.storage.set(storageKey, content);
    }

    artifact.parts.push(partWithIndex);
    artifact.totalParts = artifact.parts.length;
    artifact.version++;
    artifact.lastChunkIndex = chunkIndex;
    artifact.isLastChunk = isLastChunk;
    artifact.updatedAt = new Date().toISOString();

    artifact.operations.push({
      operationId: generateId(),
      type: 'append',
      timestamp: new Date().toISOString(),
      partIndex,
      chunkIndex
    });

    if (isLastChunk) {
      artifact.status = 'complete';
      artifact.completedAt = new Date().toISOString();
    }
  }

  async replacePart(
    artifactId: string,
    partIndex: number,
    part: Omit<ArtifactPart, 'index'>
  ): Promise<void> {
    const artifact = this.artifacts.get(artifactId);
    if (!artifact) {
      throw new Error(`Artifact ${artifactId} not found`);
    }

    if (partIndex >= artifact.parts.length) {
      throw new Error(`Part index ${partIndex} out of bounds`);
    }

    const partWithIndex: ArtifactPart = { ...part, index: partIndex };

    // Update storage
    if (part.content || part.data) {
      const storageKey = `${artifactId}/part-${partIndex}`;
      const content = part.content || JSON.stringify(part.data);
      this.storage.set(storageKey, content);
    }

    artifact.parts[partIndex] = partWithIndex;
    artifact.version++;
    artifact.updatedAt = new Date().toISOString();

    artifact.operations.push({
      operationId: generateId(),
      type: 'replace',
      timestamp: new Date().toISOString(),
      partIndex,
      replacedPartIndexes: [partIndex]
    });
  }

  async getArtifact(artifactId: string): Promise<StoredArtifact | null> {
    const artifact = this.artifacts.get(artifactId);
    return artifact ? { ...artifact } : null;
  }

  async getArtifactParts(
    artifactId: string,
    resolveExternal: boolean = true
  ): Promise<ArtifactPart[]> {
    const artifact = this.artifacts.get(artifactId);
    if (!artifact) {
      throw new Error(`Artifact ${artifactId} not found`);
    }

    if (!resolveExternal) {
      return [...artifact.parts];
    }

    // Resolve from storage
    return artifact.parts.map(part => {
      const storageKey = `${artifactId}/part-${part.index}`;
      const content = this.storage.get(storageKey);

      if (content && part.kind === 'text') {
        return { ...part, content };
      } else if (content && part.kind === 'data') {
        return { ...part, data: JSON.parse(content) };
      }

      return { ...part };
    });
  }

  async getTaskArtifacts(taskId: string): Promise<string[]> {
    const artifacts = this.taskArtifacts.get(taskId);
    return artifacts ? Array.from(artifacts) : [];
  }

  async deleteArtifact(artifactId: string): Promise<void> {
    const artifact = this.artifacts.get(artifactId);
    if (!artifact) return;

    // Delete storage
    for (const part of artifact.parts) {
      const storageKey = `${artifactId}/part-${part.index}`;
      this.storage.delete(storageKey);
    }

    this.artifacts.delete(artifactId);
    this.taskArtifacts.get(artifact.taskId)?.delete(artifactId);
  }

  async getArtifactContent(artifactId: string): Promise<string | object> {
    const parts = await this.getArtifactParts(artifactId, true);

    if (parts.length === 0) {
      return '';
    }

    if (parts.every(p => p.kind === 'text')) {
      return parts.map(p => p.content || '').join('');
    }

    if (parts.every(p => p.kind === 'data')) {
      return parts.map(p => p.data);
    }

    return {
      parts: parts.map(p => {
        if (p.kind === 'text') return { type: 'text', content: p.content };
        if (p.kind === 'data') return { type: 'data', data: p.data };
        return { type: 'file', reference: p.fileReference };
      })
    };
  }
}
```

### Built-in Artifact Management Tools

The agent loop provides built-in tools for artifact creation and management that the LLM can use. These tools work with any `ArtifactStore` implementation.

```typescript
const artifactTools: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'create_artifact',
      description: 'Create a new artifact to store generated content. Use this when you need to build up a response incrementally or create a file/document.',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'A descriptive name for the artifact (e.g., "analysis_report.md", "data_export.json")'
          },
          description: {
            type: 'string',
            description: 'Optional description of what this artifact contains'
          },
          mimeType: {
            type: 'string',
            description: 'MIME type of the artifact content',
            enum: ['text/plain', 'text/markdown', 'text/html', 'application/json', 'text/csv']
          }
        },
        required: ['name']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'append_artifact',
      description: 'Append content to an existing artifact. Use this to build up content incrementally. The content will be added as a new part.',
      parameters: {
        type: 'object',
        properties: {
          artifactId: {
            type: 'string',
            description: 'The ID of the artifact to append to'
          },
          content: {
            type: 'string',
            description: 'The content to append'
          },
          isLastChunk: {
            type: 'boolean',
            description: 'Set to true if this is the final chunk of content',
            default: false
          }
        },
        required: ['artifactId', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'append_artifact_data',
      description: 'Append structured data to an artifact. Use this for JSON data or structured content.',
      parameters: {
        type: 'object',
        properties: {
          artifactId: {
            type: 'string',
            description: 'The ID of the artifact to append to'
          },
          data: {
            type: 'object',
            description: 'The structured data to append'
          },
          isLastChunk: {
            type: 'boolean',
            description: 'Set to true if this is the final chunk',
            default: false
          }
        },
        required: ['artifactId', 'data']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'replace_artifact_part',
      description: 'Replace a specific part of an artifact. Use this to correct or update previously added content.',
      parameters: {
        type: 'object',
        properties: {
          artifactId: {
            type: 'string',
            description: 'The ID of the artifact'
          },
          partIndex: {
            type: 'number',
            description: 'The index of the part to replace (0-based)'
          },
          content: {
            type: 'string',
            description: 'The new content for this part'
          }
        },
        required: ['artifactId', 'partIndex', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'complete_artifact',
      description: 'Mark an artifact as complete. No more content can be added after this.',
      parameters: {
        type: 'object',
        properties: {
          artifactId: {
            type: 'string',
            description: 'The ID of the artifact to mark as complete'
          }
        },
        required: ['artifactId']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_artifacts',
      description: 'List all artifacts created during this task',
      parameters: {
        type: 'object',
        properties: {}
      }
    }
  }
];

// Tool implementations
class ArtifactToolProvider implements ToolProvider {
  constructor(private artifactStore: ArtifactStore) {}

  async execute(toolCall: ToolCall, context: ExecutionContext): Promise<ToolResult> {
    const args = JSON.parse(toolCall.function.arguments);

    try {
      switch (toolCall.function.name) {
        case 'create_artifact':
          const artifactId = await this.artifactStore.createArtifact({
            taskId: context.taskId,
            contextId: context.contextId,
            name: args.name,
            mimeType: args.mimeType
          });

          return {
            toolCallId: toolCall.id,
            toolName: toolCall.function.name,
            success: true,
            result: {
              artifactId,
              message: `Created artifact "${args.name}" with ID: ${artifactId}`
            }
          };

        case 'append_artifact':
          await this.artifactStore.appendPart(
            args.artifactId,
            { kind: 'text', content: args.content },
            args.isLastChunk || false
          );

          return {
            toolCallId: toolCall.id,
            toolName: toolCall.function.name,
            success: true,
            result: {
              message: `Appended content to artifact ${args.artifactId}`,
              isComplete: args.isLastChunk
            }
          };

        case 'append_artifact_data':
          await this.artifactStore.appendPart(
            args.artifactId,
            { kind: 'data', data: args.data },
            args.isLastChunk || false
          );

          return {
            toolCallId: toolCall.id,
            toolName: toolCall.function.name,
            success: true,
            result: {
              message: `Appended data to artifact ${args.artifactId}`,
              isComplete: args.isLastChunk
            }
          };

        case 'replace_artifact_part':
          await this.artifactStore.replacePart(
            args.artifactId,
            args.partIndex,
            { kind: 'text', content: args.content }
          );

          return {
            toolCallId: toolCall.id,
            toolName: toolCall.function.name,
            success: true,
            result: {
              message: `Replaced part ${args.partIndex} in artifact ${args.artifactId}`
            }
          };

        case 'complete_artifact':
          const artifact = await this.artifactStore.getArtifact(args.artifactId);
          if (artifact && artifact.status !== 'complete') {
            await this.artifactStore.appendPart(
              args.artifactId,
              { kind: 'text', content: '' },
              true  // Mark as last chunk
            );
          }

          return {
            toolCallId: toolCall.id,
            toolName: toolCall.function.name,
            success: true,
            result: {
              message: `Marked artifact ${args.artifactId} as complete`
            }
          };

        case 'list_artifacts':
          const artifactIds = await this.artifactStore.getTaskArtifacts(context.taskId);
          const artifacts = await Promise.all(
            artifactIds.map(id => this.artifactStore.getArtifact(id))
          );

          return {
            toolCallId: toolCall.id,
            toolName: toolCall.function.name,
            success: true,
            result: {
              artifacts: artifacts.map(a => ({
                artifactId: a!.artifactId,
                name: a!.name,
                status: a!.status,
                totalParts: a!.totalParts,
                mimeType: a!.mimeType
              }))
            }
          };

        default:
          throw new Error(`Unknown artifact tool: ${toolCall.function.name}`);
      }
    } catch (error: any) {
      return {
        toolCallId: toolCall.id,
        toolName: toolCall.function.name,
        success: false,
        error: error.message,
        result: null
      };
    }
  }

  getTools(): ToolDefinition[] {
    return artifactTools;
  }
}
```

### Store Factory Pattern

```typescript
interface StoreConfig {
  state: {
    type: 'redis' | 'memory';
    redis?: RedisClient;
    ttl?: number;
  };
  artifact: {
    type: 'redis' | 'memory' | 's3';
    redis?: RedisClient;
    s3?: S3Client;
    inlineMaxSize?: number;
    ttl?: number;
    storageBackend?: 'redis' | 's3' | 'local';
  };
}

class StoreFactory {
  static createStateStore(config: StoreConfig['state']): StateStore {
    switch (config.type) {
      case 'redis':
        if (!config.redis) {
          throw new Error('Redis client required for redis state store');
        }
        return new RedisStateStore(config.redis, config.ttl);

      case 'memory':
        return new InMemoryStateStore();

      default:
        throw new Error(`Unknown state store type: ${config.type}`);
    }
  }

  static createArtifactStore(config: StoreConfig['artifact']): ArtifactStore {
    switch (config.type) {
      case 'redis':
      case 's3':
        if (!config.redis) {
          throw new Error('Redis client required for redis/s3 artifact store');
        }
        return new RedisArtifactStore(config.redis, config.s3, {
          inlineMaxSize: config.inlineMaxSize || 1024 * 1024,
          ttl: config.ttl || 24 * 60 * 60,
          storageBackend: config.storageBackend || 'redis'
        });

      case 'memory':
        return new InMemoryArtifactStore();

      default:
        throw new Error(`Unknown artifact store type: ${config.type}`);
    }
  }
}
```

### Integration with Agent Loop

```typescript
const prepareExecution$ = (ctx: Context): Observable<LoopState> => {
  return defer(async () => {
    const taskId = ctx.taskId || generateTaskId();

    // Initialize stores using factory
    const storeConfig: StoreConfig = {
      state: {
        type: process.env.STATE_STORE_TYPE as 'redis' | 'memory' || 'redis',
        redis: redisClient,
        ttl: 24 * 60 * 60
      },
      artifact: {
        type: process.env.ARTIFACT_STORE_TYPE as 'redis' | 'memory' || 'redis',
        redis: redisClient,
        s3: s3Client,
        inlineMaxSize: 1024 * 1024,
        ttl: 24 * 60 * 60,
        storageBackend: process.env.ARTIFACT_STORAGE as 'redis' | 's3' | 'local' || 'redis'
      }
    };

    const stateStore = StoreFactory.createStateStore(storeConfig.state);
    const artifactStore = StoreFactory.createArtifactStore(storeConfig.artifact);

    // Register artifact management tools
    const artifactToolProvider = new ArtifactToolProvider(artifactStore);

    // Combine with other tools
    const allTools = [
      ...artifactToolProvider.getTools(),
      ...await loadUserTools(ctx),
      ...await loadMCPTools(ctx)
    ];

    return {
      taskId,
      agentId: ctx.agentId,
      messages: buildInitialMessages(ctx),
      systemPrompt: ctx.systemPrompt,
      availableTools: allTools,
      toolResults: new Map(),
      subAgents: [],
      activeSubAgents: new Set(),
      completed: false,
      iteration: 0,
      maxIterations: MAX_ITERATIONS,
      context: ctx,
      traceContext: ctx.traceContext,
      authContext: ctx.authContext,
      stateStore,      // Add to state
      artifactStore    // Add to state
    };
  });
};
```

### A2A Artifact Streaming

When artifacts are created/updated, emit artifact-update events via A2A SSE:

```typescript
const emitArtifactUpdate = async (
  artifactStore: ArtifactStore,
  taskId: string,
  artifactId: string,
  operation: 'create' | 'append' | 'replace' | 'complete'
): Promise<void> => {
  const artifact = await artifactStore.getArtifact(artifactId);

  if (!artifact) return;

  // Get the latest part(s)
  const parts = await artifactStore.getArtifactParts(artifactId, true);
  const latestPart = parts[parts.length - 1];

  // Convert to A2A format
  const a2aParts: Part[] = parts.map(part => {
    if (part.kind === 'text') {
      return { kind: 'text', text: part.content || '' };
    } else if (part.kind === 'data') {
      return { kind: 'data', data: part.data || {} };
    } else {
      // File reference
      return {
        kind: 'file',
        file: {
          uri: part.fileReference?.storageKey,
          mimeType: part.fileReference?.mimeType
        }
      };
    }
  });

  // Emit A2A artifact-update event
  a2aServer.emit(taskId, {
    jsonrpc: "2.0",
    id: getCurrentRequestId(),
    result: {
      kind: "artifact-update",
      taskId,
      contextId: artifact.contextId,
      artifact: {
        artifactId,
        name: artifact.name,
        description: artifact.description,
        parts: a2aParts
      },
      append: operation === 'append',
      lastChunk: artifact.isLastChunk,
      timestamp: new Date().toISOString()
    }
  });
};

// Decorator pattern for adding event emission to any artifact store
class ArtifactStoreWithEvents implements ArtifactStore {
  constructor(private delegate: ArtifactStore) {}

  async createArtifact(params: {
    taskId: string;
    contextId: string;
    name?: string;
    description?: string;
    mimeType?: string;
  }): Promise<string> {
    const artifactId = await this.delegate.createArtifact(params);
    await emitArtifactUpdate(this.delegate, params.taskId, artifactId, 'create');
    return artifactId;
  }

  async appendPart(
    artifactId: string,
    part: Omit<ArtifactPart, 'index'>,
    isLastChunk: boolean = false
  ): Promise<void> {
    await this.delegate.appendPart(artifactId, part, isLastChunk);

    const artifact = await this.delegate.getArtifact(artifactId);
    if (artifact) {
      await emitArtifactUpdate(
        this.delegate,
        artifact.taskId,
        artifactId,
        isLastChunk ? 'complete' : 'append'
      );
    }
  }

  async replacePart(
    artifactId: string,
    partIndex: number,
    part: Omit<ArtifactPart, 'index'>
  ): Promise<void> {
    await this.delegate.replacePart(artifactId, partIndex, part);

    const artifact = await this.delegate.getArtifact(artifactId);
    if (artifact) {
      await emitArtifactUpdate(this.delegate, artifact.taskId, artifactId, 'replace');
    }
  }

  async getArtifact(artifactId: string): Promise<StoredArtifact | null> {
    return this.delegate.getArtifact(artifactId);
  }

  async getArtifactParts(artifactId: string, resolveExternal?: boolean): Promise<ArtifactPart[]> {
    return this.delegate.getArtifactParts(artifactId, resolveExternal);
  }

  async getTaskArtifacts(taskId: string): Promise<string[]> {
    return this.delegate.getTaskArtifacts(taskId);
  }

  async deleteArtifact(artifactId: string): Promise<void> {
    return this.delegate.deleteArtifact(artifactId);
  }

  async getArtifactContent(artifactId: string): Promise<string | object> {
    return this.delegate.getArtifactContent(artifactId);
  }
}

// Usage with factory
const createArtifactStoreWithEvents = (config: StoreConfig['artifact']): ArtifactStore => {
  const baseStore = StoreFactory.createArtifactStore(config);
  return new ArtifactStoreWithEvents(baseStore);
};
```

### State Store Implementations

#### Redis Implementation

```typescript
class RedisStateStore implements StateStore {
  constructor(private redis: RedisClient, private ttl: number = 24 * 60 * 60) {}

  async save(taskId: string, state: PersistedLoopState): Promise<void> {
    const key = `task:${taskId}:state`;
    await this.redis.setex(key, this.ttl, JSON.stringify(state));
  }

  async load(taskId: string): Promise<PersistedLoopState | null> {
    const data = await this.redis.get(`task:${taskId}:state`);
    return data ? JSON.parse(data) : null;
  }

  async exists(taskId: string): Promise<boolean> {
    return (await this.redis.exists(`task:${taskId}:state`)) === 1;
  }

  async delete(taskId: string): Promise<void> {
    await this.redis.del(`task:${taskId}:state`);
  }

  async listTasks(filter?: {
    agentId?: string;
    contextId?: string;
    completedAfter?: Date;
  }): Promise<string[]> {
    const pattern = 'task:*:state';
    const keys = await this.redis.keys(pattern);

    if (!filter) {
      return keys.map(key => key.replace('task:', '').replace(':state', ''));
    }

    // Filter by loading and checking each state
    const taskIds: string[] = [];
    for (const key of keys) {
      const taskId = key.replace('task:', '').replace(':state', '');
      const state = await this.load(taskId);

      if (!state) continue;

      if (filter.agentId && state.agentId !== filter.agentId) continue;
      if (filter.contextId && state.contextId !== filter.contextId) continue;
      if (filter.completedAfter) {
        const lastActivity = new Date(state.lastActivity);
        if (lastActivity <= filter.completedAfter) continue;
      }

      taskIds.push(taskId);
    }

    return taskIds;
  }

  async setTTL(taskId: string, ttlSeconds: number): Promise<void> {
    await this.redis.expire(`task:${taskId}:state`, ttlSeconds);
  }
}

class InMemoryStateStore implements StateStore {
  private states = new Map<string, { state: PersistedLoopState; expiresAt: number }>();

  async save(taskId: string, state: PersistedLoopState): Promise<void> {
    this.states.set(taskId, {
      state: JSON.parse(JSON.stringify(state)),
      expiresAt: Date.now() + (24 * 60 * 60 * 1000)
    });
  }

  async load(taskId: string): Promise<PersistedLoopState | null> {
    this.cleanup();
    const entry = this.states.get(taskId);
    return entry ? JSON.parse(JSON.stringify(entry.state)) : null;
  }

  async exists(taskId: string): Promise<boolean> {
    this.cleanup();
    return this.states.has(taskId);
  }

  async delete(taskId: string): Promise<void> {
    this.states.delete(taskId);
  }

  async listTasks(filter?: {
    agentId?: string;
    contextId?: string;
    completedAfter?: Date;
  }): Promise<string[]> {
    this.cleanup();

    const taskIds: string[] = [];
    for (const [taskId, entry] of this.states.entries()) {
      const state = entry.state;

      if (filter) {
        if (filter.agentId && state.agentId !== filter.agentId) continue;
        if (filter.contextId && state.contextId !== filter.contextId) continue;
        if (filter.completedAfter) {
          const lastActivity = new Date(state.lastActivity);
          if (lastActivity <= filter.completedAfter) continue;
        }
      }

      taskIds.push(taskId);
    }

    return taskIds;
  }

  async setTTL(taskId: string, ttlSeconds: number): Promise<void> {
    const entry = this.states.get(taskId);
    if (entry) {
      entry.expiresAt = Date.now() + (ttlSeconds * 1000);
    }
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [taskId, entry] of this.states.entries()) {
      if (entry.expiresAt < now) {
        this.states.delete(taskId);
      }
    }
  }
}
```

### Checkpointing During Execution

```typescript
const checkpointExecution$ = (state: LoopState): Observable<LoopState> => {
  return defer(async () => {
    if (shouldCheckpoint(state)) {
      await state.stateStore.save(state.taskId, serializeState(state));
    }
    return state;
  });
};

const shouldCheckpoint = (state: LoopState): boolean => {
  // Checkpoint after:
  // 1. LLM call completes
  // 2. Tool execution completes
  // 3. Every N iterations (e.g., every 3)

  return (
    state.lastLLMResponse !== undefined ||
    state.toolResults.size > 0 ||
    state.iteration % 3 === 0
  );
};
```

### Session Restoration

```typescript
class AgentLoop {
  static async resume(
    taskId: string,
    context: Partial<Context>,
    stateStore: StateStore,
    artifactStore: ArtifactStore
  ): Promise<Observable<LoopState>> {
    const state = await stateStore.load(taskId);

    if (!state) {
      throw new Error(`Task ${taskId} not found or expired`);
    }

    if (state.completed) {
      // Already completed, just return final result
      return of({
        type: 'complete',
        taskId,
        data: state.lastLLMResponse?.message.content
      });
    }

    // Restore state and continue execution
    return this.resumeFromState$(state, context, stateStore, artifactStore);
  }

  private static resumeFromState$(
    state: PersistedLoopState,
    partialContext: Partial<Context>,
    stateStore: StateStore,
    artifactStore: ArtifactStore
  ): Observable<AgentEvent> {
    emitTaskUpdate({
      taskId: state.taskId,
      type: 'resumed',
      data: {
        iteration: state.iteration,
        resumeFrom: state.resumeFrom,
        lastActivity: state.lastActivity
      }
    });

    // Reconstruct loop state with hydrated context and stores
    const loopState: LoopState = {
      ...state,
      context: { ...context, ...partialContext },
      toolResults: new Map(Object.entries(state.completedToolCalls)),
      stateStore,
      artifactStore
    };

    // Resume based on where we left off
    switch (state.resumeFrom) {
      case 'tool-execution':
        return this.resumeFromToolExecution$(loopState, state.pendingToolCalls);

      case 'sub-agent':
        return this.resumeFromSubAgent$(loopState, state.activeSubAgents);

      case 'llm-call':
      default:
        return this.continueLoop$(loopState);
    }
  }

  private resumeFromToolExecution$(
    state: LoopState,
    pendingCalls: ToolCall[]
  ): Observable<AgentEvent> {
    // Check which tool calls are still pending
    const stillPending = pendingCalls.filter(
      tc => !state.toolResults.has(tc.id)
    );

    if (stillPending.length === 0) {
      // All tools completed, continue to next LLM call
      return this.continueLoop$(state);
    }

    // Re-execute pending tools
    return executeTools$(stillPending, state).pipe(
      switchMap(results => {
        // Update state with results
        results.forEach(result => {
          state.toolResults.set(result.toolCallId, result);
        });

        // Continue loop
        return this.continueLoop$(state);
      })
    );
  }

  private resumeFromSubAgent$(
    state: LoopState,
    activeAgents: PersistedLoopState['activeSubAgents']
  ): Observable<AgentEvent> {
    // Check status of sub-agents
    return from(activeAgents).pipe(
      mergeMap(async (agent) => {
        if (agent.status === 'completed') {
          return agent;
        }

        // Resubscribe to sub-agent
        const a2aClient = new A2AClient({
          baseUrl: await getAgentEndpoint(agent.agentId),
          auth: state.authContext
        });

        return a2aClient.resubscribe(agent.taskId).pipe(
          filter(event => event.type === 'complete'),
          map(event => ({
            ...agent,
            status: 'completed' as const,
            result: event.data
          }))
        ).toPromise();
      }),

      toArray(),

      switchMap(completedAgents => {
        // All sub-agents done, continue loop
        const results = completedAgents.map(a => ({
          toolCallId: a.taskId,
          toolName: `agent:${a.agentId}`,
          success: a.status === 'completed',
          result: a.result
        }));

        results.forEach(r => state.toolResults.set(r.toolCallId, r));
        return this.continueLoop$(state);
      })
    );
  }

  private continueLoop$(state: LoopState): Observable<AgentEvent> {
    // Resume normal execution from current state
    return agentLoop$(null, state.context, state).pipe(
      // Note: Pass existing state to resume
    );
  }
}
```

### Handling Partial Tool Executions

```typescript
interface ToolExecutionRecord {
  toolCallId: string;
  toolName: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  startTime: string;
  endTime?: string;
  result?: ToolResult;
  retryCount: number;
}

const executeToolWithTracking$ = (
  toolCall: ToolCall,
  state: LoopState
): Observable<ToolResult> => {
  const record: ToolExecutionRecord = {
    toolCallId: toolCall.id,
    toolName: toolCall.function.name,
    status: 'running',
    startTime: new Date().toISOString(),
    retryCount: 0
  };

  return defer(async () => {
    // Save execution record
    await saveToolExecutionRecord(state.taskId, record);
  }).pipe(
    switchMap(() => toolRouter.execute(toolCall, state.context)),

    tap(async (result) => {
      // Update record on success
      record.status = 'completed';
      record.endTime = new Date().toISOString();
      record.result = result;
      await saveToolExecutionRecord(state.taskId, record);
    }),

    catchError(async (error) => {
      // Update record on failure
      record.status = 'failed';
      record.endTime = new Date().toISOString();
      await saveToolExecutionRecord(state.taskId, record);
      throw error;
    })
  );
};

const recoverToolExecutions = async (
  taskId: string
): Promise<Map<string, ToolResult>> => {
  const records = await loadToolExecutionRecords(taskId);
  const results = new Map<string, ToolResult>();

  for (const record of records) {
    if (record.status === 'completed' && record.result) {
      results.set(record.toolCallId, record.result);
    }
  }

  return results;
};
```

### Message History Reconstruction

```typescript
const reconstructMessages = async (
  taskId: string,
  persistedState: PersistedLoopState
): Promise<Message[]> => {
  // Start with persisted messages
  const messages = [...persistedState.messages];

  // Add tool results that completed after last checkpoint
  const toolRecords = await loadToolExecutionRecords(taskId);
  const newToolResults = toolRecords.filter(r =>
    r.status === 'completed' &&
    !messages.some(m => m.toolCallId === r.toolCallId)
  );

  for (const record of newToolResults) {
    messages.push({
      role: 'tool',
      content: JSON.stringify(record.result?.result),
      name: record.toolName,
      toolCallId: record.toolCallId
    });
  }

  return messages;
};
```

### A2A Resubscribe Integration

```typescript
// In A2A server implementation
// A2A server integration
app.post('/a2a/tasks/resubscribe', async (req, res) => {
  const { taskId } = req.body.params;
  const context = extractContextFromRequest(req);

  // Get stores from app context
  const stateStore = req.app.get('stateStore') as StateStore;
  const artifactStore = req.app.get('artifactStore') as ArtifactStore;

  const loop$ = await AgentLoop.resume(taskId, context, stateStore, artifactStore);

  // Stream SSE responses
  res.setHeader('Content-Type', 'text/event-stream');
  loop$.subscribe({
    next: event => res.write(`data: ${JSON.stringify({
      jsonrpc: "2.0",
      id: req.body.id,
      result: event
    })}\n\n`),
    complete: () => res.end(),
    error: err => {
      res.write(`data: ${JSON.stringify({
        jsonrpc: "2.0",
        id: req.body.id,
        error: { code: -32603, message: err.message }
      })}\n\n`);
      res.end();
    }
  });
});
```

### State Cleanup and Expiration

```typescript
// Cleanup service for expired tasks
class StateCleanupService {
  constructor(
    private stateStore: StateStore,
    private artifactStore: ArtifactStore,
    private intervalMs: number = 60 * 60 * 1000
  ) {}

  start(): void {
    setInterval(() => this.cleanupExpiredTasks(), this.intervalMs);
  }

  async cleanupExpiredTasks(): Promise<void> {
    // Get all tasks completed more than 24 hours ago
    const cutoffDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const taskIds = await this.stateStore.listTasks({
      completedAfter: cutoffDate
    });

    for (const taskId of taskIds) {
      const state = await this.stateStore.load(taskId);
      if (!state) continue;

      // Delete artifacts first
      for (const artifactId of state.artifactIds || []) {
        await this.artifactStore.deleteArtifact(artifactId);
      }

      // Then delete state
      await this.stateStore.delete(taskId);
    }
  }
}
```

### Idempotency Considerations

```typescript
// Ensure tool executions are idempotent on resume
const executeToolIdempotent$ = (
  toolCall: ToolCall,
  state: LoopState
): Observable<ToolResult> => {
  // Check if we already have a result
  const existingResult = state.toolResults.get(toolCall.id);
  if (existingResult) {
    return of(existingResult);
  }

  // Check persisted execution records
  return defer(async () => {
    const records = await loadToolExecutionRecords(state.taskId);
    const existing = records.find(r => r.toolCallId === toolCall.id);

    if (existing?.status === 'completed' && existing.result) {
      return existing.result;
    }

    return null;
  }).pipe(
    switchMap(cached => {
      if (cached) {
        return of(cached);
      }

      // Execute fresh
      return executeToolWithTracking$(toolCall, state);
    })
  );
};
```

## Testing

### Marble Testing Example

```typescript
import { TestScheduler } from 'rxjs/testing';

describe('AgentLoop', () => {
  it('should execute tool and loop back to LLM', () => {
    const scheduler = new TestScheduler((actual, expected) => {
      expect(actual).toEqual(expected);
    });

    scheduler.run(({ cold, expectObservable }) => {
      const mockLLM = {
        call: jest.fn()
          .mockReturnValueOnce(cold('a|', {
            a: { toolCalls: [{ id: '1', function: { name: 'search' } }] }
          }))
          .mockReturnValueOnce(cold('b|', {
            b: { finished: true, message: { content: 'Done' } }
          }))
      };

      const result$ = agentLoop$('test prompt', context);

      expectObservable(result$).toBe('--b|', {
        b: 'Done'
      });
    });
  });

  it('should resume from persisted state', async () => {
    // Setup: Save a state mid-execution
    const taskId = 'test-task-123';
    const persistedState: PersistedLoopState = {
      taskId,
      agentId: 'test-agent',
      messages: [
        { role: 'user', content: 'Search for cats' },
        { role: 'assistant', content: '', toolCalls: [/*...*/] }
      ],
      iteration: 1,
      completed: false,
      resumeFrom: 'tool-execution',
      pendingToolCalls: [{ id: 'tool-1', function: { name: 'search' } }],
      // ... other fields
    };

    const stateStore = new StateStore(mockRedis);
    await stateStore.save(taskId, persistedState);

    // Test: Resume execution
    const agentLoop = new AgentLoop();
    const result$ = agentLoop.resume(taskId);

    const events = await result$.pipe(toArray()).toPromise();

    expect(events).toContainEqual(
      expect.objectContaining({ type: 'resumed' })
    );
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'complete' })
    );
  });
});
```
