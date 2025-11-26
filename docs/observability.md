# Observability

Looopy instruments tracing and logging out of the box so you can see every turn, LLM call, and tool execution. Events already carry `contextId`/`taskId`; spans add richer attributes for debugging or Langfuse-style analytics.

## Tracing

Spans are created automatically when you call `agent.startTurn`:

- `agent[<agentId>]` (agent turn)  
  - Attributes: `session.id` (contextId), `agent.id`, `agent.task.id`, `agent.turn.number`, `langfuse.observation.type=agent`, `input` (user message), `output` (assistant content on completion).
- `loop.start` (per turn)  
  - Attributes: `session.id`, `agent.id`, `agent.task.id`, `input` (prompt sent to the loop), `langfuse.observation.type=event`.
- `loop.iteration` (per iteration)  
  - Attributes: `session.id`, `agent.id`, `agent.task.id`, `agent.iteration`, `output`/`llm.finish_reason` when a response completes, `langfuse.observation.type=chain`.
- `llm.call` (per provider call)  
  - Attributes: `agent.id`, `agent.task.id`, full prompt JSON, available tool names, prompt name/version, token usage, finish reason, `langfuse.observation.type=generation`.
- `tool.execute` (per tool call)  
  - Attributes: `agent.id`, `agent.task.id`, `agent.tool.name`, `agent.tool.call_id`, input arguments, output JSON (if serializable), `langfuse.observation.type=tool`.

These spans nest under the parent context passed to the agent so downstream collectors can reconstruct the full turn.

### Enabling OTLP export

Configure OpenTelemetry before running your agent:

```typescript
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

const sdk = new NodeSDK({
  traceExporter: new OTLPTraceExporter({
    url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4318/v1/traces',
  }),
});

sdk.start();
```

Set `OTEL_EXPORTER_OTLP_HEADERS` for authenticated collectors (e.g., Langfuse) and ensure the endpoint includes `/v1/traces`.

## Logging

Looopy uses `pino` and scopes child loggers with `contextId`, `taskId`, `agentId`, and component names. Pass your own logger into the `Agent` config to integrate with your logging pipeline:

```typescript
import pino from 'pino';
import { Agent } from '@looopy-ai/core';

const logger = pino({ level: 'debug' });

const agent = new Agent({
  // ...
  logger,
});
```

Tool and LLM providers should also use the provided logger to keep traces and logs correlated.
