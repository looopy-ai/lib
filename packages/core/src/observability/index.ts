/**
 * Observability Module Exports
 *
 * Design: design/observability.md
 */

export {
  getTracer,
  initializeTracing,
  SpanAttributes,
  SpanNames,
  shutdownTracing,
  type TelemetryConfig,
  type TraceContext,
} from './tracing';
