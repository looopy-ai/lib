# OpenTelemetry Observability

The Looopy framework includes built-in OpenTelemetry support for distributed tracing, enabling you to track requests across agent loops, LLM calls, tool executions, and sub-agent invocations.

## Features

- **Distributed Tracing**: Track execution across service boundaries
- **Automatic Context Propagation**: Trace context flows through all operations
- **Detailed Spans**: Capture execution details for:
  - Agent execution (root span)
  - Iterations
  - LLM calls
  - Tool executions
  - Sub-agent invocations (planned)
- **Error Tracking**: Automatic error recording in spans
- **OTLP Export**: Send traces to any OpenTelemetry collector

## Quick Start

### 1. Enable Tracing

Set the `OTEL_ENABLED` environment variable:

```bash
export OTEL_ENABLED=true
```

### 2. Initialize in Your Application

```typescript
import { initializeTracing, shutdownTracing } from 'looopy/observability';

// Initialize at application startup
initializeTracing({
  serviceName: 'my-agent-app',
  serviceVersion: '1.0.0',
  environment: 'production',
  otlpEndpoint: 'http://localhost:4318/v1/traces', // Optional, defaults to this
  enabled: true
});

// ... your agent code ...

// Shutdown gracefully on exit
process.on('SIGTERM', async () => {
  await shutdownTracing();
  process.exit(0);
});
```

### 3. Propagate Trace Context

When invoking agents with an existing trace context (e.g., from an HTTP request):

```typescript
import { extractTraceContext } from 'looopy/observability';

// Extract from HTTP headers (W3C Trace Context format)
const traceContext = {
  traceId: 'abc123...',
  spanId: 'def456...',
  traceFlags: 1
};

// Pass to agent
const events$ = agentLoop.execute(prompt, {
  traceContext  // Trace context will propagate through all operations
});
```

## Viewing Traces

### Option 1: Jaeger (Recommended for Development)

```bash
# Start Jaeger all-in-one
docker run -d --name jaeger \
  -p 16686:16686 \
  -p 4318:4318 \
  jaegertracing/all-in-one:latest

# View UI
open http://localhost:16686
```

**Note**: Jaeger's OTLP endpoint is at `http://localhost:4318/v1/traces`.

### Option 2: Langfuse (Recommended for Production)

Langfuse provides advanced LLM observability with cost tracking, prompt management, and analytics.

```bash
# 1. Start Langfuse (Docker Compose)
git clone https://github.com/langfuse/langfuse.git
cd langfuse
docker compose up -d

# Or use Langfuse Cloud: https://cloud.langfuse.com
```

#### Configure with Authentication

**Method 1: Environment Variables (Recommended)**

Langfuse uses Basic Authentication. First, encode your credentials:

```bash
# Encode your public and secret keys (format: public_key:secret_key)
export LANGFUSE_PUBLIC_KEY="pk-lf-..."
export LANGFUSE_SECRET_KEY="sk-lf-..."
export AUTH_STRING=$(echo -n "$LANGFUSE_PUBLIC_KEY:$LANGFUSE_SECRET_KEY" | base64)

# Configure OpenTelemetry (note the /v1/traces suffix is required!)
export OTEL_ENABLED=true
export OTEL_EXPORTER_OTLP_ENDPOINT="https://cloud.langfuse.com/api/public/otel/v1/traces"
export OTEL_EXPORTER_OTLP_HEADERS="Authorization=Basic $AUTH_STRING"
```

**Important**: The endpoint must end with `/v1/traces`. Without it, exports will fail with a 404 error.

Then initialize normally:

```typescript
import { initializeTracing } from 'looopy/observability';

initializeTracing({
  serviceName: 'my-agent-app',
  serviceVersion: '1.0.0',
  environment: 'production',
  enabled: true
  // Endpoint and headers will be read from env vars
});
```

**Method 2: Programmatic Configuration**

Or configure with Basic Auth headers programmatically:

```typescript
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { resourceFromAttributes } from '@opentelemetry/resources';

// Encode credentials for Basic Auth
const publicKey = process.env.LANGFUSE_PUBLIC_KEY!;
const secretKey = process.env.LANGFUSE_SECRET_KEY!;
const authString = Buffer.from(`${publicKey}:${secretKey}`).toString('base64');

// Create custom exporter with Basic Auth (note: /v1/traces is required!)
const exporter = new OTLPTraceExporter({
  url: 'https://cloud.langfuse.com/api/public/otel/v1/traces',
  headers: {
    Authorization: `Basic ${authString}`,
  },
});

const provider = new NodeTracerProvider({
  resource: resourceFromAttributes({
    'service.name': 'my-agent-app',
    'service.version': '1.0.0',
  }),
  spanProcessors: [new BatchSpanProcessor(exporter)],
});

provider.register();
```

**Run Your Agent:**
```bash
# Encode credentials
export LANGFUSE_PUBLIC_KEY="pk-lf-..."
export LANGFUSE_SECRET_KEY="sk-lf-..."
export AUTH_STRING=$(echo -n "$LANGFUSE_PUBLIC_KEY:$LANGFUSE_SECRET_KEY" | base64)

# Run with tracing (note: endpoint must end with /v1/traces)
OTEL_ENABLED=true \
OTEL_EXPORTER_OTLP_ENDPOINT="https://cloud.langfuse.com/api/public/otel/v1/traces" \
OTEL_EXPORTER_OTLP_HEADERS="Authorization=Basic $AUTH_STRING" \
pnpm example:litellm
```

**View Traces:**
- Self-hosted: `http://localhost:3000`
- Cloud: `https://cloud.langfuse.com`

### Option 3: Zipkin

```bash
# Start Zipkin
docker run -d -p 9411:9411 openzipkin/zipkin

# Configure OTLP endpoint
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:9411/api/v2/spans

# View UI
open http://localhost:9411
```

### Option 4: Custom Collector

Configure your own OpenTelemetry collector and point to it:

```typescript
initializeTracing({
  otlpEndpoint: 'https://your-collector.example.com/v1/traces',
  enabled: true
});
```

## Span Attributes

The framework automatically adds semantic attributes to spans:

| Attribute                         | Description                          | Example                  |
| --------------------------------- | ------------------------------------ | ------------------------ |
| `session.id`                      | Session or context ID                | `"session-1234abcde"`    |
| `user.id`                         | User ID                              | `"user-4321"`            |
| `agent.id`                        | Agent identifier                     | `"weather-assistant"`    |
| `agent.task.id`                   | Unique task ID                       | `"task_123..."`          |
| `agent.iteration`                 | Iteration number                     | `2`                      |
| `agent.tool.name`                 | Tool being executed                  | `"calculate"`            |
| `agent.tool.call_id`              | Tool call identifier                 | `"call_abc..."`          |
| `llm.finish_reason`               | LLM completion reason                | `"stop"`, `"tool_calls"` |
| `input`                           | Input to operation                   | User prompt, tool args   |
| `output`                          | Output from operation                | LLM response, tool result|
| `langfuse.observation.type`       | Langfuse observation type            | `"generation"`, `"span"` |
| `gen_ai.system`                   | LLM provider system                  | `"openai"`, `"anthropic"` |
| `gen_ai.request.model`            | Model requested                      | `"gpt-4"`                |
| `gen_ai.response.model`           | Model used in response               | `"gpt-4-0613"`           |
| `gen_ai.prompt`                   | Full prompt (JSON)                   | `[{"role":"user",...}]`  |
| `gen_ai.completion`               | LLM response content                 | `"The weather is..."`    |
| `gen_ai.usage.prompt_tokens`      | Prompt tokens used                   | `150`                    |
| `gen_ai.usage.completion_tokens`  | Completion tokens generated          | `75`                     |
| `gen_ai.usage.total_tokens`       | Total tokens                         | `225`                    |

### Input/Output Tracking

All operations track their inputs and outputs for full observability:

- **`agent.execute`** - `input`: user prompt, `output`: final assistant message
- **`llm.call`** - `input`: conversation history (`gen_ai.prompt`), `output`: LLM response (`gen_ai.completion`)
- **`tool.execute`** - `input`: tool arguments (JSON string), `output`: tool result or error message

### Langfuse Observation Types

When using Langfuse, spans are categorized by observation type for specialized UI views and analytics:

- **`generation`** - LLM calls (shown in Langfuse "Generations" view)
  - Includes model, tokens, prompt, completion
  - Enables cost tracking and prompt management
  - Automatically set on `llm.call` spans

- **`agent`** - Agent execution (root-level decision making)
  - Represents the agent that guides application flow
  - Automatically set on `agent.execute` spans

- **`chain`** - Sequential operations (links between steps)
  - Used for iterations, passing context between steps
  - Automatically set on `agent.iteration` spans

- **`tool`** - Tool calls (external function execution)
  - Used for tool/function executions
  - Automatically set on `tool.execute` spans

- **`span`** - Generic operations (catch-all)
  - For general-purpose operations

- **`event`** - Discrete events (logging-style observations)
  - For single-point events without duration

- **`retriever`** - Data retrieval (vector DB, database queries)
  - For RAG retrieval steps

- **`evaluator`** - Evaluation functions
  - For assessing output quality

- **`embedding`** - Embedding generation
  - For embedding model calls with cost tracking

- **`guardrail`** - Safety/security checks
  - For content filtering, jailbreak protection

See: [Langfuse Observation Types](https://langfuse.com/docs/observability/data-model#types)

### Langfuse Additional Attributes

Beyond observation types, you can enrich traces with:

- **`langfuse.tags`** - Array of tags (JSON string)
  - For categorization and filtering
  - Examples: `["production", "beta-feature", "v2"]`

- **`langfuse.metadata`** - Additional metadata (JSON object as string)
  - For arbitrary key-value data
  - Examples: `{"customer_tier": "premium", "region": "us-west"}`

- **`langfuse.version`** / **`langfuse.release`** - Version tracking
  - For A/B testing and rollout tracking
  - Examples: `"v1.2.3"`, `"release-2025-10"`

See: [Tags](https://langfuse.com/docs/observability/features/tags), [Metadata](https://langfuse.com/docs/observability/features/metadata), [Sessions](https://langfuse.com/docs/observability/features/sessions)

### GenAI Semantic Conventions

We follow [OpenTelemetry's GenAI Semantic Conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/) for LLM operations:

- `gen_ai.system` - The LLM provider (e.g., "openai", "anthropic", "bedrock")
- `gen_ai.request.model` - Model name in request
- `gen_ai.response.model` - Actual model used (may differ from request)
- `gen_ai.prompt` - Full conversation history as JSON
- `gen_ai.completion` - LLM response text
- `gen_ai.usage.prompt_tokens` - Number of tokens in the prompt
- `gen_ai.usage.completion_tokens` - Number of tokens in the completion
- `gen_ai.usage.total_tokens` - Total tokens used (prompt + completion)

**Note**: These use the standard OpenTelemetry GenAI attribute names (with underscores), which Langfuse recognizes for cost tracking and analytics.

These attributes enable:
- **Cost tracking** in Langfuse by model/provider
- **Prompt versioning** and experimentation
- **Performance analysis** by model
- **Debugging** with full input/output visibility


## Span Hierarchy

A typical agent execution creates spans like this:

```
agent.execute (root)
├── agent.iteration (1)
│   ├── llm.call
│   └── tool.execute (calculate)
├── agent.iteration (2)
│   └── llm.call
```

## Example: Running with Tracing

```bash
# Start Jaeger
docker run -d -p 16686:16686 -p 4318:4318 jaegertracing/all-in-one:latest

# Run your agent with tracing enabled
OTEL_ENABLED=true pnpm example:litellm

# View traces at http://localhost:16686
```

## Environment Variables

| Variable                      | Description       | Default                           |
| ----------------------------- | ----------------- | --------------------------------- |
| `OTEL_ENABLED`                | Enable tracing    | `false`                           |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OTLP endpoint URL | `http://localhost:4318/v1/traces` |
| `NODE_ENV`                    | Environment name  | `development`                     |

## Advanced Usage

### Custom Spans in Tools

Tool providers can create custom child spans:

```typescript
import { trace } from '@opentelemetry/api';
import { SpanNames, SpanAttributes } from 'looopy/observability';

class MyToolProvider implements ToolProvider {
  async execute(toolCall: ToolCall, context: ExecutionContext): Promise<ToolResult> {
    const tracer = trace.getTracer('my-tool');

    return tracer.startActiveSpan('my-tool.operation', async (span) => {
      try {
        span.setAttribute('operation.type', 'database-query');

        // Your tool logic
        const result = await performOperation();

        span.setStatus({ code: SpanStatusCode.OK });
        return { success: true, result };
      } catch (error) {
        span.setStatus({ code: SpanStatusCode.ERROR });
        span.recordException(error);
        throw error;
      } finally {
        span.end();
      }
    });
  }
}
```

### Sub-Agent Tracing

When invoking sub-agents, trace context is automatically propagated:

```typescript
// Parent agent
const parentEvents$ = parentAgent.execute(prompt, {
  contextId: 'parent-123'
});

// Sub-agent (trace context flows automatically)
const subEvents$ = subAgent.execute(subPrompt, {
  parentTaskId: parentTask.id,
  traceContext: parentTask.traceContext  // Propagate context
});
```

## Troubleshooting

### Debugging OTLP Export Issues

The framework includes detailed logging to help diagnose OTLP export problems. To enable debug logging:

```bash
LOG_LEVEL=debug OTEL_ENABLED=true pnpm example:litellm
```

**What you'll see:**

1. **Initialization logs:**
   ```
   [INFO] Initializing OpenTelemetry tracing
     serviceName: "my-agent-app"
     serviceVersion: "1.0.0"
   [DEBUG] Configuring OTLP exporter
     otlpEndpoint: "https://us.cloud.langfuse.com/api/public/otel"
     hasAuthHeaders: true
   [DEBUG] Authentication headers configured
     authType: "Basic Auth"
     headerCount: 1
   ```

2. **Export attempt logs:**
   ```
   [DEBUG] Exporting spans to OTLP collector
     spanCount: 5
     endpoint: "https://us.cloud.langfuse.com/api/public/otel"
   [DEBUG] Successfully exported spans
     spanCount: 5
   ```

3. **Detailed error logs (if export fails):**
   ```
   [ERROR] Failed to export spans to OTLP collector
     statusCode: 404
     likelyIssue: "Endpoint returned HTML instead of accepting OTLP - wrong URL or missing/invalid auth"
     responsePreview: "<!DOCTYPE html>..."
   ```

### No Traces Appearing

1. Check `OTEL_ENABLED=true` is set
2. Verify collector is running: `curl http://localhost:4318/v1/traces`
3. Check logs for initialization message: `Initializing OpenTelemetry tracing`
4. Look for export success logs: `Successfully exported spans`

### Shutdown Errors (404 Not Found)

If you see errors like `OTLPExporterError: Not Found` during shutdown, this usually means:

1. **Missing `/v1/traces` suffix**: This is the most common issue!
   - ❌ Wrong: `https://cloud.langfuse.com/api/public/otel`
   - ✅ Correct: `https://cloud.langfuse.com/api/public/otel/v1/traces`

   The framework will warn you if this is missing when `LOG_LEVEL=debug`.

2. **Incorrect endpoint URL**: Make sure you're using the correct OTLP endpoint
   - Langfuse: `https://cloud.langfuse.com/api/public/otel/v1/traces`
   - Langfuse US: `https://us.cloud.langfuse.com/api/public/otel/v1/traces`
   - Jaeger: `http://localhost:4318/v1/traces`

3. **Missing authentication**: For Langfuse, ensure you have the `OTEL_EXPORTER_OTLP_HEADERS` set with Basic Auth:
   ```bash
   export AUTH_STRING=$(echo -n "pk-lf-...:sk-lf-..." | base64)
   export OTEL_EXPORTER_OTLP_HEADERS="Authorization=Basic $AUTH_STRING"
   ```

4. **Collector not running**: If using local Jaeger/Zipkin, ensure it's started before running your agent

**Reading the error details:**

The shutdown error log will include:
- `statusCode`: HTTP status code (404, 401, 403, etc.)
- `likelyIssue`: Automatic diagnosis of common problems
- `responsePreview`: First 500 chars of response (often reveals the issue)

**Note**: Shutdown errors are logged as warnings and don't affect your application. They occur when the exporter tries to flush remaining spans to an unavailable collector.### Traces Not Connected

- Ensure `traceContext` is passed when invoking agents
- Check trace context extraction from HTTP headers
- Verify parent span context is active

### Performance Impact

Tracing adds minimal overhead (~1-2ms per span). For high-throughput scenarios:

- Use sampling (configure in collector)
- Disable tracing in production if not needed
- Use batch export (default configuration)

## References

- [OpenTelemetry JS Documentation](https://opentelemetry.io/docs/instrumentation/js/)
- [W3C Trace Context](https://www.w3.org/TR/trace-context/)
- [OTLP Specification](https://opentelemetry.io/docs/specs/otlp/)
- [Semantic Conventions](https://opentelemetry.io/docs/specs/semconv/)
