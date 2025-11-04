/**
 * OpenTelemetry Tracing Setup
 *
 * Design: design/observability.md
 */

import {
  type Context,
  context,
  propagation,
  type Span,
  SpanKind,
  type SpanOptions,
  SpanStatusCode,
  trace,
  type Tracer,
} from '@opentelemetry/api';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions/incubating';
import { DEFAULT_LOGGER } from '../core/logger';

/**
 * Trace context for propagation
 */
export interface TraceContext {
  traceId: string;
  spanId: string;
  traceFlags?: number;
  traceState?: string;
}

/**
 * OpenTelemetry configuration
 */
export interface TelemetryConfig {
  serviceName?: string;
  serviceVersion?: string;
  environment?: string;
  otlpEndpoint?: string;
  enabled?: boolean;
}

let tracerProvider: NodeTracerProvider | null = null;
let defaultTracer: Tracer | null = null;

/**
 * Parse OTLP export error for better debugging
 */
function parseOTLPError(error: unknown): Record<string, unknown> {
  const errorDetails: Record<string, unknown> = {
    message: error instanceof Error ? error.message : String(error),
  };

  if (!error || typeof error !== 'object') {
    return errorDetails;
  }

  // Extract status code
  if ('code' in error) {
    errorDetails.statusCode = error.code;
  }

  // Extract and analyze response data
  if ('data' in error && typeof error.data === 'string') {
    const data = error.data as string;

    // Truncate long responses
    errorDetails.responsePreview =
      data.length > 500
        ? `${data.substring(0, 500)}... (truncated ${data.length - 500} chars)`
        : data;

    // Detect common issues
    if (data.includes('<!DOCTYPE html>')) {
      errorDetails.likelyIssue =
        'Endpoint returned HTML instead of accepting OTLP - wrong URL or missing/invalid auth';
    } else if (data.includes('Unauthorized') || data.includes('401')) {
      errorDetails.likelyIssue = 'Authentication failed - check OTEL_EXPORTER_OTLP_HEADERS';
    } else if (data.includes('Forbidden') || data.includes('403')) {
      errorDetails.likelyIssue = 'Access forbidden - check API keys have correct permissions';
    }
  }

  if ('message' in error) {
    errorDetails.errorMessage = error.message;
  }

  return errorDetails;
}

/**
 * Validate and log auth header configuration
 */
function validateAuthHeaders(endpoint: string): void {
  const headers = process.env.OTEL_EXPORTER_OTLP_HEADERS || '';
  if (!headers) return;

  const hasBasicAuth = headers.includes('Authorization=Basic');
  const hasCustomHeaders = !hasBasicAuth && headers.includes('=');

  DEFAULT_LOGGER.trace(
    {
      authType: hasBasicAuth ? 'Basic Auth' : hasCustomHeaders ? 'Custom Headers' : 'Unknown',
      headerCount: headers.split(',').length,
    },
    'Authentication headers configured'
  );

  // Langfuse-specific validation
  if (endpoint.includes('langfuse.com') && !hasBasicAuth) {
    DEFAULT_LOGGER.warn(
      'Langfuse requires Basic Auth format: Authorization=Basic <base64>. Current headers may not work.'
    );
  }
}

/**
 * Validate OTLP endpoint URL
 */
function validateOTLPEndpoint(endpoint: string): void {
  // Check for common mistakes
  if (endpoint.includes('langfuse.com')) {
    // Langfuse requires /v1/traces suffix
    if (!endpoint.endsWith('/v1/traces')) {
      DEFAULT_LOGGER.trace(
        {
          endpoint,
          correctEndpoint: endpoint.replace(/\/?$/, '/v1/traces'),
        },
        'Langfuse OTLP endpoint should end with /v1/traces. Exports may fail without this.'
      );
    }
  }

  // Warn about common base URL mistakes
  if (endpoint.includes('/api/public/otel') && !endpoint.includes('/v1/traces')) {
    DEFAULT_LOGGER.trace(
      {
        endpoint,
        suggestion: `${endpoint}/v1/traces`,
      },
      'OTLP endpoint appears incomplete. Most OTLP collectors require /v1/traces path.'
    );
  }
}

/**
 * Initialize OpenTelemetry tracing
 */
export function initializeTracing(config?: TelemetryConfig): Tracer {
  if (!config?.enabled && process.env.OTEL_ENABLED !== 'true') {
    // Return no-op tracer if disabled
    DEFAULT_LOGGER.trace('OpenTelemetry tracing is disabled');
    return trace.getTracer('looopy-noop');
  }

  const serviceName = config?.serviceName || 'looopy';
  const serviceVersion = config?.serviceVersion || '1.0.0';
  const environment = config?.environment || process.env.NODE_ENV || 'development';

  DEFAULT_LOGGER.trace(
    {
      serviceName,
      serviceVersion,
      environment,
    },
    'Initializing OpenTelemetry tracing'
  );

  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: serviceName,
    [ATTR_SERVICE_VERSION]: serviceVersion,
    'deployment.environment': environment,
  });

  // Configure OTLP exporter
  // IMPORTANT: The endpoint must include the full path with /v1/traces suffix
  // Examples:
  //   - Langfuse: https://cloud.langfuse.com/api/public/otel/v1/traces
  //   - Jaeger:   http://localhost:4318/v1/traces
  //   - Zipkin:   http://localhost:9411/api/v2/spans
  const otlpEndpoint =
    config?.otlpEndpoint ||
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT ||
    'http://localhost:4318/v1/traces';

  const hasAuthHeaders = !!process.env.OTEL_EXPORTER_OTLP_HEADERS;

  DEFAULT_LOGGER.trace(
    {
      otlpEndpoint,
      hasAuthHeaders,
    },
    'Configuring OTLP exporter'
  );

  // Validate endpoint URL
  validateOTLPEndpoint(otlpEndpoint);

  // Validate auth headers if present
  if (hasAuthHeaders) {
    validateAuthHeaders(otlpEndpoint);
  } else if (otlpEndpoint.includes('cloud.langfuse.com')) {
    // Warn if using cloud endpoint without auth
    DEFAULT_LOGGER.trace(
      {
        otlpEndpoint,
      },
      'Using Langfuse cloud endpoint without OTEL_EXPORTER_OTLP_HEADERS. Authentication will likely fail.'
    );
  }

  const exporter = new OTLPTraceExporter({
    url: otlpEndpoint,
  });

  // Wrap exporter to log export attempts for debugging
  const originalExport = exporter.export.bind(exporter);
  exporter.export = (spans, resultCallback) => {
    DEFAULT_LOGGER.trace(
      {
        spanCount: spans.length,
        endpoint: otlpEndpoint,
      },
      'Exporting spans to OTLP collector'
    );

    originalExport(spans, (result) => {
      if (result.code !== 0) {
        // Export failed
        DEFAULT_LOGGER.trace(
          parseOTLPError(result.error),
          'Failed to export spans to OTLP collector'
        );
      } else {
        DEFAULT_LOGGER.trace({ spanCount: spans.length }, 'Successfully exported spans');
      }
      resultCallback(result);
    });
  };

  const spanProcessor = new BatchSpanProcessor(exporter, {
    maxQueueSize: 1000,
    scheduledDelayMillis: 1000,
    maxExportBatchSize: 512,
  });

  tracerProvider = new NodeTracerProvider({
    resource,
    spanProcessors: [spanProcessor],
  });

  tracerProvider.register();

  DEFAULT_LOGGER.trace('OpenTelemetry tracing initialized successfully');

  defaultTracer = tracerProvider.getTracer(serviceName, serviceVersion);

  return defaultTracer;
}

/**
 * Get the default tracer
 */
export function getTracer(): Tracer {
  if (!defaultTracer) {
    // Initialize with defaults if not already done
    return initializeTracing();
  }
  return defaultTracer;
}

/**
 * Shutdown tracing gracefully
 */
export async function shutdownTracing(): Promise<void> {
  if (tracerProvider) {
    DEFAULT_LOGGER.trace('Shutting down OpenTelemetry tracing');
    try {
      await tracerProvider.shutdown();
      DEFAULT_LOGGER.trace('OpenTelemetry tracing shutdown complete');
    } catch (error) {
      // Log warning but don't throw - shutdown errors are common if collector is unavailable
      const errorDetails = parseOTLPError(error);
      DEFAULT_LOGGER.error(
        errorDetails,
        'Error during OpenTelemetry shutdown (collector may be unavailable or misconfigured)'
      );
    } finally {
      tracerProvider = null;
      defaultTracer = null;
    }
  }
}

/**
 * Extract trace context from TraceContext object
 */
export function extractTraceContext(traceContext?: TraceContext): Context | undefined {
  if (!traceContext) return undefined;

  DEFAULT_LOGGER.trace(
    {
      traceId: traceContext.traceId,
      spanId: traceContext.spanId,
      traceFlags: traceContext.traceFlags,
    },
    'Extracting trace context'
  );

  // Create a carrier object with W3C Trace Context format
  const carrier: Record<string, string> = {
    traceparent: `00-${traceContext.traceId}-${traceContext.spanId}-0${(traceContext.traceFlags || 1).toString(16)}`,
  };

  if (traceContext.traceState) {
    carrier.tracestate = traceContext.traceState;
  }

  // Extract context from carrier
  return propagation.extract(context.active(), carrier);
}

/**
 * Inject trace context into TraceContext object
 */
export function injectTraceContext(ctx?: Context): TraceContext | undefined {
  const activeContext = ctx || context.active();
  const span = trace.getSpan(activeContext);

  if (!span) {
    DEFAULT_LOGGER.warn('No active span found for trace context injection');
    return undefined;
  }

  const spanContext = span.spanContext();

  DEFAULT_LOGGER.trace(
    {
      traceId: spanContext.traceId,
      spanId: spanContext.spanId,
      traceFlags: spanContext.traceFlags,
    },
    'Injecting trace context'
  );

  return {
    traceId: spanContext.traceId,
    spanId: spanContext.spanId,
    traceFlags: spanContext.traceFlags,
    traceState: spanContext.traceState?.serialize(),
  };
}

/**
 * Create a span and execute a function within its context
 */
export async function withSpan<T>(
  name: string,
  fn: (span: Span) => Promise<T>,
  options?: SpanOptions & { parentContext?: TraceContext }
): Promise<T> {
  const tracer = getTracer();

  // Extract parent context if provided
  const parentContext = options?.parentContext
    ? extractTraceContext(options.parentContext)
    : undefined;

  const ctx = parentContext || context.active();

  DEFAULT_LOGGER.trace({ spanName: name, hasParent: !!parentContext }, 'Starting span');

  return tracer.startActiveSpan(
    name,
    {
      kind: options?.kind || SpanKind.INTERNAL,
      attributes: options?.attributes,
    },
    ctx,
    async (span) => {
      try {
        const result = await fn(span);
        span.setStatus({ code: SpanStatusCode.OK });
        DEFAULT_LOGGER.trace({ spanName: name }, 'Span completed successfully');
        return result;
      } catch (error) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : String(error),
        });
        span.recordException(error as Error);
        DEFAULT_LOGGER.error(
          {
            spanName: name,
            error: error instanceof Error ? error.message : String(error),
          },
          'Span completed with error'
        );
        throw error;
      } finally {
        span.end();
      }
    }
  );
}

/**
 * Create a span synchronously
 */
export function startSpan(
  name: string,
  options?: SpanOptions & { parentContext?: TraceContext }
): Span {
  const tracer = getTracer();

  const parentContext = options?.parentContext
    ? extractTraceContext(options.parentContext)
    : undefined;

  const ctx = parentContext || context.active();

  DEFAULT_LOGGER.debug({ spanName: name, hasParent: !!parentContext }, 'Creating span');

  return tracer.startSpan(
    name,
    {
      kind: options?.kind || SpanKind.INTERNAL,
      attributes: options?.attributes,
    },
    ctx
  );
}

/**
 * Set span attributes for common agent operations
 */
export const SpanAttributes = {
  AGENT_ID: 'agent.id',
  TASK_ID: 'agent.task.id',
  CONTEXT_ID: 'agent.context.id',
  ITERATION: 'agent.iteration',
  TOOL_NAME: 'agent.tool.name',
  TOOL_CALL_ID: 'agent.tool.call_id',
  LLM_MODEL: 'llm.model',
  LLM_FINISH_REASON: 'llm.finish_reason',
  SUB_AGENT_ID: 'agent.sub_agent.id',
  SUB_AGENT_TASK_ID: 'agent.sub_agent.task_id',

  // Langfuse observation type (tells Langfuse how to display the span)
  // Types: "generation", "span", "event", "agent", "tool", "chain", "retriever", "evaluator", "embedding", "guardrail"
  // See: https://langfuse.com/docs/observability/data-model#types
  LANGFUSE_OBSERVATION_TYPE: 'langfuse.observation.type',

  // Langfuse-specific attributes for categorization and filtering
  // See: https://langfuse.com/docs/observability/features/tags
  // See: https://langfuse.com/docs/observability/features/metadata
  LANGFUSE_SESSION_ID: 'langfuse.session.id', // Group traces by conversation/thread
  LANGFUSE_USER_ID: 'langfuse.user.id', // Track user for analytics
  LANGFUSE_TAGS: 'langfuse.tags', // Array of tags (JSON string)
  LANGFUSE_METADATA: 'langfuse.metadata', // Additional metadata (JSON string)
  LANGFUSE_VERSION: 'langfuse.version', // Version/release tracking
  LANGFUSE_RELEASE: 'langfuse.release', // Release identifier

  // GenAI semantic conventions (OpenTelemetry standard)
  GEN_AI_SYSTEM: 'gen_ai.system', // e.g., "openai", "anthropic"
  GEN_AI_REQUEST_MODEL: 'gen_ai.request.model',
  GEN_AI_RESPONSE_MODEL: 'gen_ai.response.model',
  GEN_AI_PROMPT: 'gen_ai.prompt',
  GEN_AI_COMPLETION: 'gen_ai.completion',
  GEN_AI_USAGE_PROMPT_TOKENS: 'gen_ai.usage.prompt_tokens',
  GEN_AI_USAGE_COMPLETION_TOKENS: 'gen_ai.usage.completion_tokens',
  GEN_AI_USAGE_TOTAL_TOKENS: 'gen_ai.usage.total_tokens',
} as const;

/**
 * Semantic span names for consistency
 */
export const SpanNames = {
  AGENT_EXECUTE: 'loop.start',
  AGENT_ITERATION: 'loop.iteration',
  LLM_CALL: 'llm.call',
  TOOL_EXECUTE: 'tool.execute',
  TOOL_PROVIDE: 'tool.provide',
  SUB_AGENT_INVOKE: 'agent.invoke',
  CHECKPOINT_SAVE: 'checkpoint.save',
  CHECKPOINT_LOAD: 'checkpoint.load',
} as const;
