# Observability & Tracing

## Overview

Looopy uses OpenTelemetry for comprehensive observability, providing:

1. **Distributed Tracing**: Track requests across agent and service boundaries
2. **Metrics**: Performance and usage metrics
3. **Logging**: Structured, correlated logs
4. **Context Propagation**: Trace context flows through all operations

## OpenTelemetry Integration

### Architecture

```
┌────────────────────────────────────────────────────────────┐
│                     Looopy                                 │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Tracer (generates spans)                            │  │
│  │  • agent.loop.iteration                              │  │
│  │  • llm.call                                          │  │
│  │  • tool.execute                                      │  │
│  │  • agent.invoke                                      │  │
│  └────────────────────┬─────────────────────────────────┘  │
│                       │                                     │
│  ┌────────────────────▼─────────────────────────────────┐  │
│  │  Meter (records metrics)                             │  │
│  │  • agent.loop.duration                               │  │
│  │  • tool.execution.count                              │  │
│  │  • llm.tokens.total                                  │  │
│  └────────────────────┬─────────────────────────────────┘  │
│                       │                                     │
│  ┌────────────────────▼─────────────────────────────────┐  │
│  │  Logger (structured logs)                            │  │
│  │  • Correlate with trace/span IDs                     │  │
│  │  • Contextual fields                                 │  │
│  └────────────────────┬─────────────────────────────────┘  │
└───────────────────────┼──────────────────────────────────────┘
                        │
                        │ OTLP Protocol
                        │
┌───────────────────────▼──────────────────────────────────────┐
│              OpenTelemetry Collector                          │
│  • Receives traces, metrics, logs                            │
│  • Batching, filtering, sampling                             │
│  • Enrichment with metadata                                  │
└───────────────────────┬──────────────────────────────────────┘
                        │
         ┌──────────────┼──────────────┐
         │              │              │
         ▼              ▼              ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│   Jaeger     │ │  Prometheus  │ │     Loki     │
│  (Traces)    │ │  (Metrics)   │ │    (Logs)    │
└──────────────┘ └──────────────┘ └──────────────┘
```

### Setup

```typescript
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';

// Initialize tracer
const tracerProvider = new NodeTracerProvider({
  resource: new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]: 'looopy',
    [SemanticResourceAttributes.SERVICE_VERSION]: '1.0.0',
    [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: process.env.NODE_ENV
  })
});

// Configure trace exporter
const traceExporter = new OTLPTraceExporter({
  url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318/v1/traces'
});

tracerProvider.addSpanProcessor(
  new BatchSpanProcessor(traceExporter, {
    maxQueueSize: 1000,
    scheduledDelayMillis: 1000
  })
);

tracerProvider.register();

// Initialize meter
const meterProvider = new MeterProvider({
  resource: tracerProvider.resource,
  readers: [
    new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({
        url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318/v1/metrics'
      }),
      exportIntervalMillis: 10000 // 10 seconds
    })
  ]
});

// Get instances
const tracer = tracerProvider.getTracer('looopy');
const meter = meterProvider.getMeter('looopy');
```

## Distributed Tracing

### Trace Context

```typescript
interface TraceContext {
  traceId: string;
  spanId: string;
  traceFlags: number;
  traceState?: string;
}

// Extract from HTTP headers
function extractTraceContext(headers: Headers): TraceContext | null {
  const traceparent = headers.get('traceparent');

  if (!traceparent) return null;

  const parts = traceparent.split('-');

  return {
    traceId: parts[1],
    spanId: parts[2],
    traceFlags: parseInt(parts[3], 16),
    traceState: headers.get('tracestate') || undefined
  };
}

// Inject into HTTP headers
function injectTraceContext(
  headers: Headers,
  context: TraceContext
): void {
  headers.set(
    'traceparent',
    `00-${context.traceId}-${context.spanId}-0${context.traceFlags.toString(16)}`
  );

  if (context.traceState) {
    headers.set('tracestate', context.traceState);
  }
}
```

### Agent Loop Spans

```typescript
const executeAgentLoop$ = (
  prompt: string,
  context: ExecutionContext
): Observable<string> => {
  // Start root span
  const span = tracer.startSpan('agent.loop', {
    attributes: {
      'agent.id': context.agentId,
      'task.id': context.taskId,
      'prompt.length': prompt.length
    }
  });

  // Create context
  const ctx = trace.setSpan(trace.context.active(), span);

  return of({ prompt, context }).pipe(
    // Execute within trace context
    map(data => trace.setSpan(trace.context.active(), span)),

    expand(state => {
      if (state.completed) return EMPTY;

      // Create iteration span
      const iterSpan = tracer.startSpan(
        'agent.loop.iteration',
        {
          attributes: {
            'iteration.number': state.iteration
          }
        },
        ctx
      );

      return of(state).pipe(
        switchMap(s => executeLLMCall$(s, iterSpan)),
        switchMap(s => executeTools$(s, iterSpan)),
        tap(() => iterSpan.end())
      );
    }),

    // Final result
    map(state => state.llmResponse.content),

    // Record completion
    tap(result => {
      span.setAttributes({
        'result.length': result.length,
        'iterations.total': context.iteration
      });
      span.setStatus({ code: SpanStatusCode.OK });
    }),

    // Handle errors
    catchError(error => {
      span.recordException(error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error.message
      });
      throw error;
    }),

    // Always end span
    finalize(() => span.end())
  );
};
```

### LLM Call Spans

```typescript
const callLLM$ = (
  state: LoopState,
  parentSpan: Span
): Observable<LLMResponse> => {
  const span = tracer.startSpan(
    'llm.call',
    {
      attributes: {
        'llm.provider': 'openai',
        'llm.model': 'gpt-4',
        'llm.messages.count': state.messages.length,
        'llm.tools.count': state.availableTools.length
      }
    },
    trace.setSpan(trace.context.active(), parentSpan)
  );

  return llmProvider.call({
    messages: state.messages,
    tools: state.availableTools
  }).pipe(
    tap(response => {
      span.setAttributes({
        'llm.response.finish_reason': response.finishReason,
        'llm.usage.prompt_tokens': response.usage?.promptTokens || 0,
        'llm.usage.completion_tokens': response.usage?.completionTokens || 0,
        'llm.usage.total_tokens': response.usage?.totalTokens || 0,
        'llm.tool_calls.count': response.toolCalls?.length || 0
      });

      span.addEvent('llm.response.received', {
        'response.type': response.finished ? 'final' : 'tool_calls'
      });
    }),
    finalize(() => span.end())
  );
};
```

### Tool Execution Spans

```typescript
const executeTool$ = (
  toolCall: ToolCall,
  context: ExecutionContext,
  parentSpan: Span
): Observable<ToolResult> => {
  const span = tracer.startSpan(
    'tool.execute',
    {
      attributes: {
        'tool.name': toolCall.function.name,
        'tool.call_id': toolCall.id,
        'tool.provider': toolRouter.getProvider(toolCall.function.name)
      }
    },
    trace.setSpan(trace.context.active(), parentSpan)
  );

  const startTime = Date.now();

  return toolRouter.execute(toolCall, context).pipe(
    tap(result => {
      const duration = Date.now() - startTime;

      span.setAttributes({
        'tool.success': result.success,
        'tool.execution_time_ms': duration,
        'tool.cached': result.metadata?.cached || false
      });

      if (result.error) {
        span.recordException(new Error(result.error));
        span.setStatus({ code: SpanStatusCode.ERROR });
      } else {
        span.setStatus({ code: SpanStatusCode.OK });
      }

      span.addEvent('tool.execution.complete', {
        'result.size': JSON.stringify(result.result).length
      });
    }),
    finalize(() => span.end())
  );
};
```

### Sub-Agent Invocation Spans

```typescript
const invokeSubAgent$ = (
  agentId: string,
  prompt: string,
  context: ExecutionContext,
  parentSpan: Span
): Observable<string> => {
  const span = tracer.startSpan(
    'agent.invoke',
    {
      attributes: {
        'agent.id': agentId,
        'agent.type': 'sub-agent',
        'parent.task_id': context.taskId
      }
    },
    trace.setSpan(trace.context.active(), parentSpan)
  );

  // Extract trace context for propagation
  const traceContext = {
    traceId: span.spanContext().traceId,
    spanId: span.spanContext().spanId,
    traceFlags: span.spanContext().traceFlags
  };

  return a2aClient.invoke({
    prompt,
    traceContext // Propagate to sub-agent
  }).pipe(
    tap(result => {
      span.setStatus({ code: SpanStatusCode.OK });
      span.addEvent('agent.invocation.complete');
    }),
    catchError(error => {
      span.recordException(error);
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw error;
    }),
    finalize(() => span.end())
  );
};
```

## Metrics

### Counter Metrics

```typescript
const taskCounter = meter.createCounter('agent.tasks', {
  description: 'Number of agent tasks executed',
  unit: '1'
});

const toolCounter = meter.createCounter('tool.executions', {
  description: 'Number of tool executions',
  unit: '1'
});

const llmTokenCounter = meter.createCounter('llm.tokens', {
  description: 'LLM tokens consumed',
  unit: 'tokens'
});

// Record task
taskCounter.add(1, {
  'agent.id': agentId,
  'task.status': 'completed'
});

// Record tool execution
toolCounter.add(1, {
  'tool.name': toolName,
  'tool.success': success.toString()
});

// Record tokens
llmTokenCounter.add(usage.totalTokens, {
  'llm.provider': 'openai',
  'llm.model': 'gpt-4',
  'llm.token_type': 'total'
});
```

### Histogram Metrics

```typescript
const loopDuration = meter.createHistogram('agent.loop.duration', {
  description: 'Agent loop execution duration',
  unit: 'ms'
});

const toolDuration = meter.createHistogram('tool.execution.duration', {
  description: 'Tool execution duration',
  unit: 'ms'
});

const llmDuration = meter.createHistogram('llm.call.duration', {
  description: 'LLM call duration',
  unit: 'ms'
});

// Record durations
loopDuration.record(executionTime, {
  'agent.id': agentId,
  'iterations': iterationCount.toString()
});

toolDuration.record(toolTime, {
  'tool.name': toolName,
  'tool.provider': provider
});

llmDuration.record(llmTime, {
  'llm.model': 'gpt-4'
});
```

### Gauge Metrics

```typescript
const activeTasksGauge = meter.createObservableGauge('agent.active_tasks', {
  description: 'Number of currently active tasks'
});

const toolCacheHitRate = meter.createObservableGauge('tool.cache.hit_rate', {
  description: 'Tool result cache hit rate'
});

// Update gauges
activeTasksGauge.addCallback((result) => {
  result.observe(getActiveTaskCount(), {
    'agent.id': agentId
  });
});

toolCacheHitRate.addCallback((result) => {
  const rate = getCacheHitRate();
  result.observe(rate, {
    'tool.provider': 'local'
  });
});
```

## Structured Logging

### Logger Setup

```typescript
import winston from 'winston';

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: {
    service: 'looopy',
    version: '1.0.0'
  },
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    }),
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error'
    }),
    new winston.transports.File({
      filename: 'logs/combined.log'
    })
  ]
});
```

### Trace-Correlated Logging

```typescript
const logWithTrace = (
  level: string,
  message: string,
  meta?: Record<string, unknown>
): void => {
  const span = trace.getActiveSpan();

  const logData = {
    message,
    ...meta,
    ...(span && {
      trace_id: span.spanContext().traceId,
      span_id: span.spanContext().spanId,
      trace_flags: span.spanContext().traceFlags
    })
  };

  logger.log(level, logData);
};

// Usage
logWithTrace('info', 'Agent loop started', {
  agent_id: agentId,
  task_id: taskId
});

logWithTrace('error', 'Tool execution failed', {
  tool_name: toolName,
  error: error.message
});
```

### Contextual Logging

```typescript
class ContextualLogger {
  constructor(
    private baseLogger: winston.Logger,
    private context: Record<string, unknown>
  ) {}

  child(additionalContext: Record<string, unknown>): ContextualLogger {
    return new ContextualLogger(
      this.baseLogger,
      { ...this.context, ...additionalContext }
    );
  }

  info(message: string, meta?: Record<string, unknown>): void {
    this.log('info', message, meta);
  }

  error(message: string, meta?: Record<string, unknown>): void {
    this.log('error', message, meta);
  }

  private log(
    level: string,
    message: string,
    meta?: Record<string, unknown>
  ): void {
    const span = trace.getActiveSpan();

    this.baseLogger.log(level, message, {
      ...this.context,
      ...meta,
      ...(span && {
        trace_id: span.spanContext().traceId,
        span_id: span.spanContext().spanId
      })
    });
  }
}

// Usage
const agentLogger = new ContextualLogger(logger, {
  agent_id: 'main-agent',
  task_id: 'task-123'
});

agentLogger.info('Starting execution');

const toolLogger = agentLogger.child({ tool_name: 'search' });
toolLogger.info('Executing tool');
```

## Performance Monitoring

### Span Events

```typescript
span.addEvent('cache.lookup', {
  'cache.key': cacheKey,
  'cache.hit': hit.toString()
});

span.addEvent('llm.streaming.start');
span.addEvent('llm.streaming.chunk', {
  'chunk.index': chunkIndex,
  'chunk.size': chunk.length
});
span.addEvent('llm.streaming.complete');

span.addEvent('tool.retry', {
  'retry.attempt': attemptNumber,
  'retry.delay_ms': delayMs
});
```

### Custom Attributes

```typescript
span.setAttributes({
  'custom.user_id': userId,
  'custom.tenant_id': tenantId,
  'custom.request_size': requestSize,
  'custom.response_size': responseSize,
  'custom.cache_hit': cacheHit.toString()
});
```

## Sampling

### Trace Sampling

```typescript
import { TraceIdRatioBasedSampler, ParentBasedSampler } from '@opentelemetry/sdk-trace-base';

const tracerProvider = new NodeTracerProvider({
  sampler: new ParentBasedSampler({
    root: new TraceIdRatioBasedSampler(0.1) // Sample 10% of traces
  })
});
```

### Conditional Sampling

```typescript
class ConditionalSampler implements Sampler {
  shouldSample(
    context: Context,
    traceId: string,
    spanName: string,
    spanKind: SpanKind,
    attributes: Attributes
  ): SamplingResult {
    // Always sample errors
    if (attributes['error']) {
      return { decision: SamplingDecision.RECORD_AND_SAMPLED };
    }

    // Always sample slow requests
    if (attributes['duration_ms'] && attributes['duration_ms'] > 5000) {
      return { decision: SamplingDecision.RECORD_AND_SAMPLED };
    }

    // Sample 10% of normal traces
    return Math.random() < 0.1
      ? { decision: SamplingDecision.RECORD_AND_SAMPLED }
      : { decision: SamplingDecision.NOT_RECORD };
  }
}
```

## Dashboards

### Example Queries

**Trace Duration Percentiles**:
```promql
histogram_quantile(0.95,
  sum(rate(agent_loop_duration_bucket[5m])) by (le, agent_id)
)
```

**Tool Success Rate**:
```promql
sum(rate(tool_executions_total{success="true"}[5m]))
/
sum(rate(tool_executions_total[5m]))
```

**LLM Token Usage**:
```promql
sum(rate(llm_tokens_total[5m])) by (llm_model, token_type)
```

**Active Tasks**:
```promql
agent_active_tasks{agent_id="main-agent"}
```
