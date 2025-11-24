/**
 * Server Module
 *
 * SSE (Server-Sent Events) streaming infrastructure for real-time event delivery.
 *
 * Design: design/internal-event-protocol.md (SSE Server section)
 */

// Event buffer exports
export {
  type BufferedEvent,
  EventBuffer,
  type EventBufferConfig,
} from './event-buffer';

// Event router exports
export {
  type EventFilter,
  EventRouter,
  type Subscriber,
  type SubscriptionConfig,
} from './event-router';

export * from './shutdown';

// SSE server exports
export {
  SSEConnection,
  type SSEConnectionConfig,
  type SSEResponse,
  SSEServer,
  type SSEServerConfig,
} from './sse';
