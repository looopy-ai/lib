# Extension Points

## Overview

Looopy provides a comprehensive extension system that allows developers to inject custom behavior at various points throughout the agent execution pipeline. Extensions enable:

- Custom pre/post processing
- Telemetry and monitoring
- Policy enforcement
- Request/response transformation
- Feature augmentation

## Extension Architecture

```
┌────────────────────────────────────────────────────────┐
│              Extension Manager                          │
│  • Register extensions                                  │
│  • Order by priority                                    │
│  • Execute extension chains                             │
└────────────────────┬───────────────────────────────────┘
                     │
        ┌────────────┴────────────┐
        │                         │
        ▼                         ▼
┌──────────────┐         ┌──────────────┐
│  Sync Hooks  │         │ Async Hooks  │
│              │         │  (RxJS based)│
└──────────────┘         └──────────────┘
```

## Extension Interface

### Base Extension

```typescript
interface Extension {
  /**
   * Unique extension identifier
   */
  name: string;

  /**
   * Execution priority (lower = earlier)
   */
  priority: number;

  /**
   * Extension metadata
   */
  metadata?: {
    version?: string;
    author?: string;
    description?: string;
  };

  /**
   * Hook implementations
   */
  hooks: ExtensionHooks;

  /**
   * Initialize extension
   */
  initialize?(context: ExtensionContext): void | Promise<void>;

  /**
   * Cleanup on shutdown
   */
  dispose?(): void | Promise<void>;
}

interface ExtensionContext {
  config: Record<string, unknown>;
  logger: Logger;
  tracer: Tracer;
  meter: Meter;
}
```

### Extension Hooks

```typescript
interface ExtensionHooks {
  // Request lifecycle
  beforeRequest?: BeforeRequestHook;
  afterRequest?: AfterRequestHook;
  onRequestError?: OnRequestErrorHook;

  // Agent loop
  beforeLLMCall?: BeforeLLMCallHook;
  afterLLMCall?: AfterLLMCallHook;
  onLLMError?: OnLLMErrorHook;

  // Tool execution
  beforeToolExecution?: BeforeToolExecutionHook;
  afterToolExecution?: AfterToolExecutionHook;
  onToolError?: OnToolErrorHook;

  // Sub-agent invocation
  beforeAgentInvoke?: BeforeAgentInvokeHook;
  afterAgentInvoke?: AfterAgentInvokeHook;
  onAgentError?: OnAgentErrorHook;

  // Task updates
  onTaskUpdate?: OnTaskUpdateHook;

  // Tool discovery
  onToolDiscovery?: OnToolDiscoveryHook;
  filterTools?: FilterToolsHook;
}

// Hook type definitions
type BeforeRequestHook = (
  request: AgentRequest,
  context: ExecutionContext
) => Observable<AgentRequest>;

type AfterRequestHook = (
  response: AgentResponse,
  context: ExecutionContext
) => Observable<AgentResponse>;

type BeforeLLMCallHook = (
  params: LLMCallParams,
  context: ExecutionContext
) => Observable<LLMCallParams>;

type AfterLLMCallHook = (
  response: LLMResponse,
  context: ExecutionContext
) => Observable<LLMResponse>;

type BeforeToolExecutionHook = (
  toolCall: ToolCall,
  context: ExecutionContext
) => Observable<ToolCall>;

type AfterToolExecutionHook = (
  result: ToolResult,
  context: ExecutionContext
) => Observable<ToolResult>;

type OnTaskUpdateHook = (
  event: TaskUpdateEvent,
  context: ExecutionContext
) => void;

type FilterToolsHook = (
  tools: ToolDefinition[],
  context: ExecutionContext
) => Observable<ToolDefinition[]>;
```

## Extension Manager

```typescript
class ExtensionManager {
  private extensions: Extension[] = [];

  register(extension: Extension): void {
    this.extensions.push(extension);
    this.extensions.sort((a, b) => a.priority - b.priority);

    logger.info('Extension registered', {
      name: extension.name,
      priority: extension.priority
    });
  }

  async initialize(context: ExtensionContext): Promise<void> {
    for (const ext of this.extensions) {
      if (ext.initialize) {
        await ext.initialize(context);
        logger.info('Extension initialized', { name: ext.name });
      }
    }
  }

  executeHook<T>(
    hookName: keyof ExtensionHooks,
    initialValue: T,
    context: ExecutionContext
  ): Observable<T> {
    const hooks = this.extensions
      .map(ext => ext.hooks[hookName])
      .filter(hook => hook !== undefined);

    if (hooks.length === 0) {
      return of(initialValue);
    }

    // Chain hooks sequentially
    return from(hooks).pipe(
      reduce(
        (value$, hook) => value$.pipe(
          switchMap(v => (hook as Function)(v, context))
        ),
        of(initialValue)
      ),
      switchMap(v => v)
    );
  }

  emitEvent(
    hookName: keyof ExtensionHooks,
    event: unknown,
    context: ExecutionContext
  ): void {
    this.extensions.forEach(ext => {
      const hook = ext.hooks[hookName];
      if (hook) {
        try {
          (hook as Function)(event, context);
        } catch (error) {
          logger.error('Extension event handler failed', {
            extension: ext.name,
            hook: hookName,
            error
          });
        }
      }
    });
  }

  async dispose(): Promise<void> {
    for (const ext of this.extensions) {
      if (ext.dispose) {
        await ext.dispose();
      }
    }
  }
}
```

## Built-in Extensions

### Rate Limiting Extension

```typescript
class RateLimitExtension implements Extension {
  name = 'rate-limit';
  priority = 10;

  private limiter: RateLimiter;

  constructor(config: RateLimitConfig) {
    this.limiter = new RateLimiter(config);
  }

  hooks: ExtensionHooks = {
    beforeRequest: (request, context) => {
      const key = context.auth.principal.id;

      return from(this.limiter.checkLimit(key)).pipe(
        switchMap(allowed => {
          if (!allowed) {
            throw new TooManyRequestsError('Rate limit exceeded');
          }
          return of(request);
        })
      );
    }
  };
}

// Usage
extensionManager.register(new RateLimitExtension({
  maxRequests: 100,
  windowMs: 60000 // 1 minute
}));
```

### Prompt Template Extension

```typescript
class PromptTemplateExtension implements Extension {
  name = 'prompt-template';
  priority = 20;

  private templates: Map<string, string>;

  constructor(templates: Record<string, string>) {
    this.templates = new Map(Object.entries(templates));
  }

  hooks: ExtensionHooks = {
    beforeLLMCall: (params, context) => {
      // Inject system prompt template
      const template = this.templates.get(context.agentId);

      if (template) {
        const systemMessage: Message = {
          role: 'system',
          content: this.renderTemplate(template, context)
        };

        return of({
          ...params,
          messages: [systemMessage, ...params.messages]
        });
      }

      return of(params);
    }
  };

  private renderTemplate(
    template: string,
    context: ExecutionContext
  ): string {
    return template
      .replace(/\{\{agentId\}\}/g, context.agentId)
      .replace(/\{\{taskId\}\}/g, context.taskId)
      .replace(/\{\{userId\}\}/g, context.auth.principal.id);
  }
}

// Usage
extensionManager.register(new PromptTemplateExtension({
  'data-agent': 'You are a data analysis expert. Task: {{taskId}}',
  'code-agent': 'You are a code generation assistant. User: {{userId}}'
}));
```

### Caching Extension

```typescript
class CachingExtension implements Extension {
  name = 'caching';
  priority = 30;

  private cache: Cache<LLMResponse>;

  constructor(cache: Cache<LLMResponse>) {
    this.cache = cache;
  }

  hooks: ExtensionHooks = {
    beforeLLMCall: (params, context) => {
      const cacheKey = this.computeCacheKey(params);

      return from(this.cache.get(cacheKey)).pipe(
        switchMap(cached => {
          if (cached) {
            logger.info('Cache hit', { cacheKey });

            // Store in context to skip LLM call
            context.metadata.cachedResponse = cached;
          }

          return of(params);
        })
      );
    },

    afterLLMCall: (response, context) => {
      if (context.metadata.cachedResponse) {
        // Return cached response
        return of(context.metadata.cachedResponse as LLMResponse);
      }

      // Cache new response
      const cacheKey = this.computeCacheKey(context.llmParams);
      this.cache.set(cacheKey, response, 300000); // 5 min TTL

      return of(response);
    }
  };

  private computeCacheKey(params: LLMCallParams): string {
    return createHash('sha256')
      .update(JSON.stringify(params.messages))
      .digest('hex');
  }
}
```

### Content Filtering Extension

```typescript
class ContentFilterExtension implements Extension {
  name = 'content-filter';
  priority = 40;

  private sensitivePatterns: RegExp[];

  constructor(patterns: string[]) {
    this.sensitivePatterns = patterns.map(p => new RegExp(p, 'gi'));
  }

  hooks: ExtensionHooks = {
    beforeLLMCall: (params, context) => {
      // Filter sensitive content from prompts
      const filteredMessages = params.messages.map(msg => ({
        ...msg,
        content: this.filterContent(msg.content)
      }));

      return of({
        ...params,
        messages: filteredMessages
      });
    },

    afterLLMCall: (response, context) => {
      // Filter sensitive content from responses
      const filtered = {
        ...response,
        message: {
          ...response.message,
          content: this.filterContent(response.message.content)
        }
      };

      return of(filtered);
    }
  };

  private filterContent(content: string): string {
    let filtered = content;

    this.sensitivePatterns.forEach(pattern => {
      filtered = filtered.replace(pattern, '[REDACTED]');
    });

    return filtered;
  }
}

// Usage
extensionManager.register(new ContentFilterExtension([
  '\\b\\d{3}-\\d{2}-\\d{4}\\b', // SSN
  '\\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}\\b', // Email (optional)
  '\\b\\d{16}\\b' // Credit card
]));
```

### Cost Tracking Extension

```typescript
class CostTrackingExtension implements Extension {
  name = 'cost-tracking';
  priority = 50;

  private costStore: CostStore;
  private pricing: Map<string, number>;

  constructor(costStore: CostStore, pricing: Record<string, number>) {
    this.costStore = costStore;
    this.pricing = new Map(Object.entries(pricing));
  }

  hooks: ExtensionHooks = {
    afterLLMCall: (response, context) => {
      if (response.usage) {
        const model = context.llmParams.model || 'gpt-4';
        const costPerToken = this.pricing.get(model) || 0;
        const cost = response.usage.totalTokens * costPerToken;

        this.costStore.record({
          taskId: context.taskId,
          userId: context.auth.principal.id,
          model,
          tokens: response.usage.totalTokens,
          cost,
          timestamp: new Date()
        });

        logger.info('LLM cost recorded', {
          taskId: context.taskId,
          tokens: response.usage.totalTokens,
          cost: cost.toFixed(4)
        });
      }

      return of(response);
    },

    afterToolExecution: (result, context) => {
      // Track tool costs
      const toolCost = this.getToolCost(result.toolName);

      if (toolCost > 0) {
        this.costStore.record({
          taskId: context.taskId,
          userId: context.auth.principal.id,
          resourceType: 'tool',
          resourceId: result.toolName,
          cost: toolCost,
          timestamp: new Date()
        });
      }

      return of(result);
    }
  };

  private getToolCost(toolName: string): number {
    const costs: Record<string, number> = {
      'web-search': 0.01,
      'image-generation': 0.05
    };
    return costs[toolName] || 0;
  }
}
```

### Logging Extension

```typescript
class LoggingExtension implements Extension {
  name = 'logging';
  priority = 5; // Run early

  hooks: ExtensionHooks = {
    beforeRequest: (request, context) => {
      logger.info('Request received', {
        taskId: context.taskId,
        userId: context.auth.principal.id,
        promptLength: request.prompt.length
      });
      return of(request);
    },

    afterRequest: (response, context) => {
      logger.info('Request completed', {
        taskId: context.taskId,
        responseLength: response.content.length,
        duration: Date.now() - context.startTime
      });
      return of(response);
    },

    beforeToolExecution: (toolCall, context) => {
      logger.info('Tool execution started', {
        taskId: context.taskId,
        toolName: toolCall.function.name,
        toolCallId: toolCall.id
      });
      return of(toolCall);
    },

    afterToolExecution: (result, context) => {
      logger.info('Tool execution completed', {
        taskId: context.taskId,
        toolName: result.toolName,
        success: result.success,
        executionTime: result.metadata?.executionTime
      });
      return of(result);
    },

    onTaskUpdate: (event, context) => {
      logger.debug('Task update', {
        taskId: event.taskId,
        type: event.type,
        data: event.data
      });
    }
  };
}
```

## Custom Extension Example

### PII Detection Extension

```typescript
class PIIDetectionExtension implements Extension {
  name = 'pii-detection';
  priority = 15;

  private detector: PIIDetector;
  private policy: 'block' | 'redact' | 'warn';

  constructor(config: {
    detector: PIIDetector;
    policy: 'block' | 'redact' | 'warn';
  }) {
    this.detector = config.detector;
    this.policy = config.policy;
  }

  hooks: ExtensionHooks = {
    beforeLLMCall: (params, context) => {
      const piiResults = params.messages.map(msg =>
        this.detector.detect(msg.content)
      );

      const hasPII = piiResults.some(r => r.findings.length > 0);

      if (!hasPII) {
        return of(params);
      }

      // Log PII detection
      logger.warn('PII detected in prompt', {
        taskId: context.taskId,
        findings: piiResults.flatMap(r => r.findings)
      });

      switch (this.policy) {
        case 'block':
          throw new SecurityError('PII detected in prompt');

        case 'redact':
          const redacted = params.messages.map((msg, i) => ({
            ...msg,
            content: this.detector.redact(msg.content, piiResults[i])
          }));
          return of({ ...params, messages: redacted });

        case 'warn':
          // Continue but track
          context.metadata.piiDetected = true;
          return of(params);
      }
    },

    afterLLMCall: (response, context) => {
      if (this.policy === 'redact') {
        const piiResult = this.detector.detect(response.message.content);

        if (piiResult.findings.length > 0) {
          return of({
            ...response,
            message: {
              ...response.message,
              content: this.detector.redact(
                response.message.content,
                piiResult
              )
            }
          });
        }
      }

      return of(response);
    }
  };
}

// Usage
const piiDetector = new PIIDetector({
  patterns: [
    { type: 'ssn', regex: /\b\d{3}-\d{2}-\d{4}\b/ },
    { type: 'email', regex: /\b[\w.-]+@[\w.-]+\.\w{2,}\b/ },
    { type: 'phone', regex: /\b\d{3}-\d{3}-\d{4}\b/ }
  ]
});

extensionManager.register(new PIIDetectionExtension({
  detector: piiDetector,
  policy: 'redact'
}));
```

## Extension Composition

### Conditional Extensions

```typescript
class ConditionalExtension implements Extension {
  name: string;
  priority: number;
  hooks: ExtensionHooks;

  constructor(
    config: {
      name: string;
      priority: number;
      condition: (context: ExecutionContext) => boolean;
      extension: Extension;
    }
  ) {
    this.name = config.name;
    this.priority = config.priority;

    // Wrap hooks with condition check
    this.hooks = Object.entries(config.extension.hooks).reduce(
      (acc, [hookName, hook]) => ({
        ...acc,
        [hookName]: (data: unknown, context: ExecutionContext) => {
          if (config.condition(context)) {
            return (hook as Function)(data, context);
          }
          return of(data);
        }
      }),
      {} as ExtensionHooks
    );
  }
}

// Usage
extensionManager.register(new ConditionalExtension({
  name: 'conditional-caching',
  priority: 30,
  condition: (ctx) => ctx.auth.principal.type === 'user',
  extension: new CachingExtension(cache)
}));
```

### Composite Extensions

```typescript
class CompositeExtension implements Extension {
  name: string;
  priority: number;
  hooks: ExtensionHooks = {};

  constructor(
    name: string,
    priority: number,
    private extensions: Extension[]
  ) {
    this.name = name;
    this.priority = priority;
    this.composeHooks();
  }

  private composeHooks(): void {
    // Combine hooks from all child extensions
    const hookNames = new Set<keyof ExtensionHooks>();

    this.extensions.forEach(ext => {
      Object.keys(ext.hooks).forEach(name =>
        hookNames.add(name as keyof ExtensionHooks)
      );
    });

    hookNames.forEach(hookName => {
      const childHooks = this.extensions
        .map(ext => ext.hooks[hookName])
        .filter(h => h !== undefined);

      if (childHooks.length > 0) {
        this.hooks[hookName] = (data: unknown, context: ExecutionContext) => {
          return from(childHooks).pipe(
            reduce(
              (value$, hook) => value$.pipe(
                switchMap(v => (hook as Function)(v, context))
              ),
              of(data)
            ),
            switchMap(v => v)
          );
        };
      }
    });
  }
}

// Usage
const securityExtension = new CompositeExtension(
  'security',
  10,
  [
    new RateLimitExtension(rateLimitConfig),
    new PIIDetectionExtension(piiConfig),
    new ContentFilterExtension(filterPatterns)
  ]
);

extensionManager.register(securityExtension);
```

## Testing Extensions

### Mock Extension Context

```typescript
class MockExtensionContext implements ExtensionContext {
  config = {};
  logger = createMockLogger();
  tracer = createMockTracer();
  meter = createMockMeter();
}

// Test example
describe('LoggingExtension', () => {
  it('should log before and after requests', async () => {
    const mockLogger = createMockLogger();
    const extension = new LoggingExtension();

    await extension.initialize!({
      ...new MockExtensionContext(),
      logger: mockLogger
    });

    const request: AgentRequest = { prompt: 'test' };
    const context: ExecutionContext = {
      taskId: 'task-123',
      auth: mockAuthContext()
    } as ExecutionContext;

    await firstValueFrom(
      extension.hooks.beforeRequest!(request, context)
    );

    expect(mockLogger.info).toHaveBeenCalledWith(
      'Request received',
      expect.objectContaining({ taskId: 'task-123' })
    );
  });
});
```

## Extension Registry

### Extension Discovery

```typescript
class ExtensionRegistry {
  private registry = new Map<string, ExtensionFactory>();

  register(name: string, factory: ExtensionFactory): void {
    this.registry.set(name, factory);
  }

  create(name: string, config: unknown): Extension {
    const factory = this.registry.get(name);

    if (!factory) {
      throw new Error(`Extension not found: ${name}`);
    }

    return factory(config);
  }

  list(): string[] {
    return Array.from(this.registry.keys());
  }
}

type ExtensionFactory = (config: unknown) => Extension;

// Register built-in extensions
const registry = new ExtensionRegistry();
registry.register('rate-limit', (cfg) => new RateLimitExtension(cfg));
registry.register('caching', (cfg) => new CachingExtension(cfg));
registry.register('logging', () => new LoggingExtension());

// Load from config
const config = {
  extensions: [
    { name: 'logging', priority: 5 },
    { name: 'rate-limit', priority: 10, config: { maxRequests: 100 } },
    { name: 'caching', priority: 30, config: { ttl: 300000 } }
  ]
};

config.extensions.forEach(ext => {
  const instance = registry.create(ext.name, ext.config);
  instance.priority = ext.priority;
  extensionManager.register(instance);
});
```
