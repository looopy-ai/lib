/**
 * Server Module
 *
 * SSE (Server-Sent Events) streaming infrastructure for real-time event delivery.
 *
 * Design: design/internal-event-protocol.md (SSE Server section)
 */

// Event buffer exports
export {
  EventBuffer,
  type BufferedEvent,
  type EventBufferConfig
} from './event-buffer';

// Event router exports
export {
  EventRouter,
  type EventFilter, type Subscriber, type SubscriptionConfig
} from './event-router';

// SSE server exports
export {
  SSEConnection, SSEServer, type SSEConnectionConfig, type SSEResponse, type SSEServerConfig
} from './sse';

