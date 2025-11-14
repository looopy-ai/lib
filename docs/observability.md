# Observability

Looopy AI includes built-in support for OpenTelemetry, which allows you to trace and monitor the execution of your agents.

## Tracing

The `Agent` and `AgentLoop` classes automatically create spans for each turn and for each call to an external service. This allows you to visualize the execution of your agents in a distributed tracing system like Jaeger or Zipkin.

To enable tracing, you need to configure an OpenTelemetry SDK. Here's an example of how to do this for a Node.js application:

```typescript
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

const sdk = new NodeSDK({
  traceExporter: new OTLPTraceExporter(),
});

sdk.start();
```

## Logging

The framework uses the `pino` logger, which is a fast, lightweight logger for Node.js. You can configure the logger to output logs in a variety of formats, including JSON.

To enable logging, you can pass a logger instance to the `Agent` or `AgentLoop` constructor:

```typescript
import pino from 'pino';
import { Agent } from '@looopy-ai/core';

const logger = pino();

const agent = new Agent({
  // ...
  logger,
});
```
