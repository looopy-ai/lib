# Tool Integration

## Overview

Looopy supports three types of tool backends:

1. **Local Functions**: Direct TypeScript function calls
2. **MCP (Model Context Protocol)**: Integration with MCP servers
3. **Client Tools**: Delegated execution via A2A input-required

All tool types share a common interface for uniform execution.

> Note: Tool routing now flows through the plugin interface. The provider terminology below maps directly to plugins that implement `listTools`/`executeTool`.

## Tool Provider Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Tool Router                          │
│  • Route tool calls to appropriate provider             │
│  • Capability matching                                  │
│  • Load balancing                                       │
│  • Fallback handling                                    │
└────────────┬────────────────────────────────────────────┘
             │
      ┌──────┴──────┬──────────────┬──────────────┐
      │             │              │              │
      ▼             ▼              ▼              ▼
┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐
│  Local   │  │   MCP    │  │  Client  │  │  Custom  │
│ Provider │  │ Provider │  │ Provider │  │ Provider │
└──────────┘  └──────────┘  └──────────┘  └──────────┘
```

### Common Interface

```typescript
interface ToolProvider {
  /**
   * Unique identifier for this provider
   */
  readonly id: string;

  /**
   * Get all tools available from this provider
   */
  getTools(context: ExecutionContext): Observable<ToolDefinition[]>;

  /**
   * Execute a tool call
   */
  execute(
    toolCall: ToolCall,
    context: ExecutionContext
  ): Observable<ToolResult>;

  /**
   * Check if provider supports a specific tool
   */
  supports(toolName: string): boolean;

  /**
   * Get tool definition by name
   */
  getTool(toolName: string): Observable<ToolDefinition | null>;

  /**
   * Health check
   */
  healthCheck(): Observable<HealthStatus>;
}

interface ToolDefinition {
  name: string;
  description: string;
  parameters: JSONSchema;
  returnType?: JSONSchema;
  metadata?: {
    provider: string;
    version?: string;
    tags?: string[];
    requiresAuth?: boolean;
  };
}

interface ToolResult {
  toolCallId: string;
  toolName: string;
  success: boolean;
  result?: unknown;
  error?: string;
  metadata?: {
    executionTime?: number;
    cached?: boolean;
    provider?: string;
  };
}
```

## Local Tool Provider

### Definition

Local tools are TypeScript functions registered directly with the agent.

### Implementation

```typescript
interface LocalTool<TInput = unknown, TOutput = unknown> {
  name: string;
  description: string;
  parameters: JSONSchema;
  execute: (input: TInput, context: ExecutionContext) => Observable<TOutput>;
}

class LocalToolProvider implements ToolProvider {
  readonly id = 'local';
  private tools = new Map<string, LocalTool>();

  register(tool: LocalTool): void {
    this.tools.set(tool.name, tool);
  }

  getTools(context: ExecutionContext): Observable<ToolDefinition[]> {
    return of(Array.from(this.tools.values()).map(tool => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      metadata: { provider: 'local' }
    })));
  }

  execute(
    toolCall: ToolCall,
    context: ExecutionContext
  ): Observable<ToolResult> {
    const tool = this.tools.get(toolCall.function.name);

    if (!tool) {
      return throwError(() => new Error(`Tool not found: ${toolCall.function.name}`));
    }

    const startTime = Date.now();
    const input = JSON.parse(toolCall.function.arguments);

    return tool.execute(input, context).pipe(
      map(result => ({
        toolCallId: toolCall.id,
        toolName: tool.name,
        success: true,
        result,
        metadata: {
          executionTime: Date.now() - startTime,
          provider: 'local'
        }
      })),
      catchError(error => of({
        toolCallId: toolCall.id,
        toolName: tool.name,
        success: false,
        error: error.message,
        metadata: {
          executionTime: Date.now() - startTime,
          provider: 'local'
        }
      }))
    );
  }
}
```

### Example Local Tool

```typescript
const searchTool: LocalTool<{ query: string }, SearchResult[]> = {
  name: 'search',
  description: 'Search the web for information',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search query'
      }
    },
    required: ['query']
  },
  execute: (input, context) => {
    return from(searchAPI.search(input.query)).pipe(
      map(results => results.items),
      timeout(5000),
      retry({ count: 2, delay: 1000 })
    );
  }
};

// Register
localProvider.register(searchTool);
```

## MCP Tool Provider

### Overview

MCP (Model Context Protocol) is a standard protocol for connecting AI models to external tools and data sources.

### Architecture

```
┌──────────────────┐         ┌──────────────────┐
│   Looopy        │         │   MCP Server     │
│                  │         │                  │
│  MCPProvider ────┼────────►│  - File System   │
│                  │  HTTP   │  - Database      │
│                  │  /JSON  │  - API Gateway   │
│                  │  -RPC   │  - Custom Tools  │
└──────────────────┘         └──────────────────┘
```

### Implementation

```typescript
class MCPToolProvider implements ToolProvider {
  readonly id: string;
  private client: MCPClient;
  private toolCache = new Map<string, ToolDefinition>();
  private cacheTTL = 60000; // 1 minute

  constructor(config: MCPProviderConfig) {
    this.id = `mcp:${config.serverId}`;
    this.client = new MCPClient({
      baseUrl: config.serverUrl,
      auth: config.auth,
      timeout: config.timeout || 30000
    });
  }

  getTools(context: ExecutionContext): Observable<ToolDefinition[]> {
    // Check cache
    if (this.toolCache.size > 0) {
      return of(Array.from(this.toolCache.values()));
    }

    // Fetch from MCP server
    return this.client.listTools().pipe(
      map(tools => tools.map(this.convertMCPTool)),
      tap(tools => {
        tools.forEach(tool => this.toolCache.set(tool.name, tool));

        // Clear cache after TTL
        setTimeout(() => this.toolCache.clear(), this.cacheTTL);
      })
    );
  }

  execute(
    toolCall: ToolCall,
    context: ExecutionContext
  ): Observable<ToolResult> {
    const span = context.tracer.startSpan('mcp.tool.execute', {
      'tool.name': toolCall.function.name,
      'mcp.server': this.id
    });

    return this.client.callTool({
      name: toolCall.function.name,
      arguments: JSON.parse(toolCall.function.arguments)
    }).pipe(
      map(response => ({
        toolCallId: toolCall.id,
        toolName: toolCall.function.name,
        success: true,
        result: response.result,
        metadata: {
          executionTime: response.executionTime,
          provider: this.id
        }
      })),
      catchError(error => {
        span.setStatus({ code: SpanStatusCode.ERROR });
        return of({
          toolCallId: toolCall.id,
          toolName: toolCall.function.name,
          success: false,
          error: error.message,
          metadata: { provider: this.id }
        });
      }),
      finalize(() => span.end())
    );
  }

  private convertMCPTool(mcpTool: MCPTool): ToolDefinition {
    return {
      name: mcpTool.name,
      description: mcpTool.description,
      parameters: mcpTool.inputSchema,
      metadata: {
        provider: 'mcp',
        version: mcpTool.version
      }
    };
  }
}
```

### MCP Client

```typescript
class MCPClient {
  private baseUrl: string;
  private auth?: AuthConfig;

  listTools(): Observable<MCPTool[]> {
    return this.request<{ tools: MCPTool[] }>({
      method: 'tools/list',
      params: {}
    }).pipe(
      map(response => response.tools)
    );
  }

  callTool(params: {
    name: string;
    arguments: Record<string, unknown>;
  }): Observable<MCPToolResponse> {
    return this.request<MCPToolResponse>({
      method: 'tools/call',
      params
    });
  }

  private request<T>(req: MCPRequest): Observable<T> {
    return from(
      fetch(`${this.baseUrl}/rpc`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.getAuthHeaders()
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: generateId(),
          ...req
        })
      })
    ).pipe(
      switchMap(res => {
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        return from(res.json());
      }),
      map(json => {
        if (json.error) {
          throw new Error(json.error.message);
        }
        return json.result as T;
      })
    );
  }
}
```

### Example MCP Server Configuration

```typescript
const mcpProvider = new MCPToolProvider({
  serverId: 'filesystem',
  serverUrl: 'http://localhost:3100',
  auth: {
    type: 'bearer',
    token: process.env.MCP_TOKEN
  },
  timeout: 30000
});

agent.registerToolProvider(mcpProvider);
```

## Client Tool Provider

### Overview

Client tools allow the agent to request execution of tools that exist on the client side via the A2A `input-required` mechanism.

### Implementation

```typescript
class ClientToolProvider implements ToolProvider {
  readonly id = 'client';
  private declaredTools = new Map<string, ToolDefinition>();
  private pendingInputs = new Map<string, Subject<ToolResult>>();

  constructor(private a2aServer: A2AServer) {
    // Listen for client input responses
    a2aServer.on('input-response', (response) => {
      this.handleInputResponse(response);
    });
  }

  /**
   * Client declares tools it can execute
   */
  declareTools(tools: ToolDefinition[]): void {
    tools.forEach(tool => {
      this.declaredTools.set(tool.name, {
        ...tool,
        metadata: { ...tool.metadata, provider: 'client' }
      });
    });
  }

  getTools(context: ExecutionContext): Observable<ToolDefinition[]> {
    return of(Array.from(this.declaredTools.values()));
  }

  execute(
    toolCall: ToolCall,
    context: ExecutionContext
  ): Observable<ToolResult> {
    const inputId = generateId();
    const result$ = new Subject<ToolResult>();

    this.pendingInputs.set(inputId, result$);

    // Send input-required to client
    this.a2aServer.emit(context.taskId, {
      event: 'input-required',
      data: JSON.stringify({
        taskId: context.taskId,
        inputId,
        type: 'tool-call',
        toolCall: {
          name: toolCall.function.name,
          arguments: JSON.parse(toolCall.function.arguments)
        },
        timeout: 30000
      })
    });

    // Wait for client response
    return result$.pipe(
      timeout(30000),
      catchError(error => {
        this.pendingInputs.delete(inputId);

        if (error.name === 'TimeoutError') {
          return of({
            toolCallId: toolCall.id,
            toolName: toolCall.function.name,
            success: false,
            error: 'Client tool call timed out'
          });
        }

        throw error;
      }),
      finalize(() => this.pendingInputs.delete(inputId))
    );
  }

  private handleInputResponse(response: InputResponse): void {
    const pending = this.pendingInputs.get(response.inputId);

    if (pending) {
      pending.next({
        toolCallId: response.toolCallId || '',
        toolName: response.toolName || '',
        success: response.success,
        result: response.result,
        error: response.error,
        metadata: { provider: 'client' }
      });
      pending.complete();
    }
  }
}
```

### Client-Side Tool Handler

```typescript
class ClientToolHandler {
  private tools = new Map<string, ClientTool>();

  register(tool: ClientTool): void {
    this.tools.set(tool.name, tool);
  }

  async handleInputRequired(event: InputRequiredEvent): Promise<void> {
    if (event.type !== 'tool-call') return;

    const tool = this.tools.get(event.toolCall.name);

    if (!tool) {
      await this.sendResponse({
        taskId: event.taskId,
        inputId: event.inputId,
        success: false,
        error: `Tool not found: ${event.toolCall.name}`
      });
      return;
    }

    try {
      const result = await tool.execute(event.toolCall.arguments);

      await this.sendResponse({
        taskId: event.taskId,
        inputId: event.inputId,
        success: true,
        result
      });
    } catch (error) {
      await this.sendResponse({
        taskId: event.taskId,
        inputId: event.inputId,
        success: false,
        error: error.message
      });
    }
  }

  private async sendResponse(response: InputResponse): Promise<void> {
    await fetch('/api/a2a/input', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.token}`
      },
      body: JSON.stringify(response)
    });
  }
}
```

## Tool Router

### Dynamic Tool Selection

```typescript
class ToolRouter {
  private providers: ToolProvider[] = [];
  private toolIndex = new Map<string, ToolProvider>();

  registerProvider(provider: ToolProvider): void {
    this.providers.push(provider);
    this.rebuildIndex();
  }

  private rebuildIndex(): void {
    this.toolIndex.clear();

    // Build index of tool name -> provider
    this.providers.forEach(provider => {
      provider.getTools({} as ExecutionContext).subscribe(tools => {
        tools.forEach(tool => {
          // First provider wins (can be made configurable)
          if (!this.toolIndex.has(tool.name)) {
            this.toolIndex.set(tool.name, provider);
          }
        });
      });
    });
  }

  getAvailableTools(context: ExecutionContext): Observable<ToolDefinition[]> {
    return from(this.providers).pipe(
      mergeMap(provider => provider.getTools(context)),
      reduce((acc, tools) => [...acc, ...tools], [] as ToolDefinition[]),
      map(tools => this.deduplicateTools(tools))
    );
  }

  execute(
    toolCall: ToolCall,
    context: ExecutionContext
  ): Observable<ToolResult> {
    const provider = this.toolIndex.get(toolCall.function.name);

    if (!provider) {
      return throwError(() =>
        new Error(`No provider found for tool: ${toolCall.function.name}`)
      );
    }

    return provider.execute(toolCall, context);
  }

  private deduplicateTools(tools: ToolDefinition[]): ToolDefinition[] {
    const seen = new Set<string>();
    return tools.filter(tool => {
      if (seen.has(tool.name)) return false;
      seen.add(tool.name);
      return true;
    });
  }
}
```

## Tool Discovery

### Dynamic Registration

```typescript
class DynamicToolDiscovery {
  constructor(
    private router: ToolRouter,
    private registry: ServiceRegistry
  ) {}

  /**
   * Discover and register MCP servers from service registry
   */
  discoverMCPServers(): Observable<void> {
    return this.registry.findServices({ type: 'mcp-server' }).pipe(
      mergeMap(services => from(services)),
      mergeMap(service => {
        const provider = new MCPToolProvider({
          serverId: service.id,
          serverUrl: service.url,
          auth: service.auth
        });

        return provider.healthCheck().pipe(
          tap(health => {
            if (health.healthy) {
              this.router.registerProvider(provider);
              logger.info('Registered MCP provider', { id: service.id });
            }
          }),
          catchError(error => {
            logger.warn('MCP provider unhealthy', { id: service.id, error });
            return EMPTY;
          })
        );
      }),
      toArray(),
      map(() => void 0)
    );
  }

  /**
   * Watch for new tool plugins
   */
  watchForProviders(): Observable<ToolProvider> {
    return this.registry.watchServices({ type: 'mcp-server' }).pipe(
      filter(event => event.type === 'added'),
      map(event => new MCPToolProvider({
        serverId: event.service.id,
        serverUrl: event.service.url,
        auth: event.service.auth
      })),
      tap(provider => this.router.registerProvider(provider))
    );
  }
}
```

### Task-Based Discovery

```typescript
interface TaskRequirements {
  requiredTools?: string[];
  requiredCapabilities?: string[];
  preferredProviders?: string[];
}

class TaskBasedDiscovery {
  async findToolsForTask(
    requirements: TaskRequirements,
    context: ExecutionContext
  ): Promise<ToolDefinition[]> {
    const allTools = await firstValueFrom(
      this.router.getAvailableTools(context)
    );

    let matchingTools = allTools;

    // Filter by required tool names
    if (requirements.requiredTools) {
      matchingTools = matchingTools.filter(tool =>
        requirements.requiredTools!.includes(tool.name)
      );
    }

    // Filter by capabilities
    if (requirements.requiredCapabilities) {
      matchingTools = matchingTools.filter(tool =>
        requirements.requiredCapabilities!.every(cap =>
          tool.metadata?.tags?.includes(cap)
        )
      );
    }

    // Prefer specific providers
    if (requirements.preferredProviders) {
      matchingTools.sort((a, b) => {
        const aPreferred = requirements.preferredProviders!.includes(
          a.metadata?.provider || ''
        );
        const bPreferred = requirements.preferredProviders!.includes(
          b.metadata?.provider || ''
        );
        return bPreferred ? 1 : aPreferred ? -1 : 0;
      });
    }

    return matchingTools;
  }
}
```

## Tool Caching

### Result Caching

```typescript
class CachingToolProvider implements ToolProvider {
  constructor(
    private wrapped: ToolProvider,
    private cache: Cache<ToolResult>
  ) {}

  execute(
    toolCall: ToolCall,
    context: ExecutionContext
  ): Observable<ToolResult> {
    const cacheKey = this.getCacheKey(toolCall);

    return defer(() => this.cache.get(cacheKey)).pipe(
      switchMap(cached => {
        if (cached) {
          return of({
            ...cached,
            metadata: { ...cached.metadata, cached: true }
          });
        }

        return this.wrapped.execute(toolCall, context).pipe(
          tap(result => {
            if (result.success && this.isCacheable(toolCall)) {
              this.cache.set(cacheKey, result, this.getTTL(toolCall));
            }
          })
        );
      })
    );
  }

  private getCacheKey(toolCall: ToolCall): string {
    return `${toolCall.function.name}:${toolCall.function.arguments}`;
  }

  private isCacheable(toolCall: ToolCall): boolean {
    // Implement caching policy
    const noCacheTols = ['random', 'timestamp', 'getUserInput'];
    return !noCacheTols.includes(toolCall.function.name);
  }

  private getTTL(toolCall: ToolCall): number {
    // Tool-specific TTL
    const ttlMap: Record<string, number> = {
      'search': 300000,  // 5 minutes
      'weather': 600000, // 10 minutes
      'default': 60000   // 1 minute
    };
    return ttlMap[toolCall.function.name] || ttlMap.default;
  }
}
```

## Testing Tools

### Mock Tool Provider

```typescript
class MockToolProvider implements ToolProvider {
  readonly id = 'mock';
  private mockResponses = new Map<string, ToolResult>();

  mockTool(name: string, response: ToolResult): void {
    this.mockResponses.set(name, response);
  }

  execute(
    toolCall: ToolCall,
    context: ExecutionContext
  ): Observable<ToolResult> {
    const response = this.mockResponses.get(toolCall.function.name);

    if (!response) {
      return throwError(() => new Error(`No mock for: ${toolCall.function.name}`));
    }

    return of({
      ...response,
      toolCallId: toolCall.id
    }).pipe(delay(100)); // Simulate async
  }
}

// Usage in tests
const mockProvider = new MockToolProvider();
mockProvider.mockTool('search', {
  toolCallId: '',
  toolName: 'search',
  success: true,
  result: [{ title: 'Test Result' }]
});
```
