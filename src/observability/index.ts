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
  SpanAttributes,
  SpanNames,
  shutdownTracing,
  startSpan,
  type TelemetryConfig,
  type TraceContext,
  withSpan,
} from './tracing';
