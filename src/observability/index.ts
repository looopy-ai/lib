/**
 * Observability Module Exports
 *
 * Design: design/observability.md
 */

export {
  extractTraceContext,
  getTracer,
  initializeTracing,
  injectTraceContext,
  shutdownTracing,
  SpanAttributes,
  SpanNames,
  startSpan,
  withSpan,
  type TelemetryConfig,
  type TraceContext,
} from './tracing';
