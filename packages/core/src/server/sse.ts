/**
 * SSE Server Module
 *
 * Server-Sent Events streaming for real-time event delivery to clients.
 * Supports context-scoped subscriptions, event filtering, and reconnection.
 *
 * Design: design/internal-event-protocol.md (SSE Server section)
 */

import type { AnyEvent } from '../types/event';
import { EventBuffer, type EventBufferConfig } from './event-buffer';
import { EventRouter, type Subscriber, type SubscriptionConfig } from './event-router';

/**
 * HTTP Response interface (framework-agnostic)
 */
export interface SSEResponse {
  /** Set HTTP header */
  setHeader(name: string, value: string): void;

  /** Write data to response stream */
  write(chunk: string): void;

  /** End response stream */
  end(): void;

  /** Check if response is writable */
  writable?: boolean;

  /** Event emitter interface for 'close' event */
  on?(event: 'close', listener: () => void): void;
  once?(event: 'close', listener: () => void): void;
  removeListener?(event: 'close', listener: () => void): void;
}

/**
 * SSE connection configuration
 */
export interface SSEConnectionConfig {
  /** Subscription configuration */
  subscription: SubscriptionConfig;

  /** HTTP response to write events to */
  response: SSEResponse;

  /** Last event ID for reconnection (optional) */
  lastEventId?: string;

  /** Heartbeat interval in ms (default: 30s) */
  heartbeatInterval?: number;
}

/**
 * SSE connection to a client
 */
export class SSEConnection implements Subscriber {
  readonly id: string;
  readonly config: SubscriptionConfig;

  private response: SSEResponse;
  private heartbeatTimer?: NodeJS.Timeout;
  private heartbeatInterval: number;
  private closed = false;
  private lastEventId?: string;

  constructor(id: string, connectionConfig: SSEConnectionConfig) {
    this.id = id;
    this.config = connectionConfig.subscription;
    this.response = connectionConfig.response;
    this.lastEventId = connectionConfig.lastEventId;
    this.heartbeatInterval = connectionConfig.heartbeatInterval ?? 30000; // 30s default

    // Set SSE headers
    this.response.setHeader('Content-Type', 'text/event-stream');
    this.response.setHeader('Cache-Control', 'no-cache');
    this.response.setHeader('Connection', 'keep-alive');
    this.response.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering

    // Handle client disconnect
    if (this.response.on) {
      this.response.on('close', () => {
        this.close();
      });
    }

    // Start heartbeat
    this.startHeartbeat();
  }

  /**
   * Send event to client
   *
   * @param event - Event to send
   * @param eventId - Event ID for reconnection
   */
  send(event: AnyEvent, eventId: string): void {
    if (this.closed) {
      return;
    }

    try {
      // Write event to SSE stream
      const { kind, contextId: _contextId, ...data } = event;
      this.response.write(`id: ${eventId}\n`);
      this.response.write(`event: ${kind}\n`);
      this.response.write(`data: ${JSON.stringify(data)}\n\n`);

      this.lastEventId = eventId;
    } catch (error) {
      console.error(`Failed to send event to ${this.id}:`, error);
      this.close();
    }
  }

  /**
   * Send heartbeat comment to keep connection alive
   */
  private sendHeartbeat(): void {
    if (this.closed) {
      return;
    }

    try {
      // Check if response is still writable
      if (this.response.writable === false) {
        this.close();
        return;
      }

      // Send SSE comment (keeps connection alive)
      this.response.write(': heartbeat\n\n');
    } catch (error) {
      console.error(`Failed to send heartbeat to ${this.id}:`, error);
      this.close();
    }
  }

  /**
   * Start heartbeat timer
   */
  private startHeartbeat(): void {
    if (this.heartbeatTimer) {
      return;
    }

    this.heartbeatTimer = setInterval(() => {
      this.sendHeartbeat();
    }, this.heartbeatInterval);

    // Don't prevent Node.js from exiting
    this.heartbeatTimer.unref?.();
  }

  /**
   * Stop heartbeat timer
   */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }

  /**
   * Get last event ID client received
   *
   * @returns Last event ID or undefined
   */
  getLastEventId(): string | undefined {
    return this.lastEventId;
  }

  /**
   * Close the connection
   */
  close(): void {
    if (this.closed) {
      return;
    }

    this.closed = true;
    this.stopHeartbeat();

    try {
      this.response.end();
    } catch {
      // Ignore errors on close
    }
  }

  /**
   * Check if connection is closed
   *
   * @returns true if closed
   */
  isClosed(): boolean {
    return this.closed;
  }
}

/**
 * SSE server configuration
 */
export interface SSEServerConfig {
  /** Event buffer configuration */
  eventBuffer?: EventBufferConfig;

  /** Enable buffering for reconnection (default: true) */
  enableBuffering?: boolean;

  /** Enable heartbeat (default: true) */
  enableHeartbeat?: boolean;

  /** Heartbeat interval in ms (default: 30s) */
  heartbeatInterval?: number;
}

/**
 * SSE server for streaming events to clients
 */
export class SSEServer {
  private router: EventRouter;
  private buffer: EventBuffer | null;
  private connectionCounter = 0;
  private enableBuffering: boolean;
  private enableHeartbeat: boolean;
  private heartbeatInterval: number;

  constructor(config: SSEServerConfig = {}) {
    this.router = new EventRouter();
    this.enableBuffering = config.enableBuffering ?? true;
    this.enableHeartbeat = config.enableHeartbeat ?? true;
    this.heartbeatInterval = config.heartbeatInterval ?? 30000;

    // Create buffer if enabled
    this.buffer = this.enableBuffering ? new EventBuffer(config.eventBuffer) : null;
  }

  /**
   * Subscribe client to context events
   *
   * @param response - HTTP response to stream to
   * @param config - Subscription configuration
   * @param lastEventId - Last event ID for reconnection (optional)
   * @returns SSE connection
   */
  subscribe(
    response: SSEResponse,
    config: SubscriptionConfig,
    lastEventId?: string,
  ): SSEConnection {
    // Generate unique connection ID
    const connectionId = `conn-${++this.connectionCounter}`;

    // Create connection
    const connection = new SSEConnection(connectionId, {
      subscription: config,
      response,
      lastEventId,
      heartbeatInterval: this.enableHeartbeat ? this.heartbeatInterval : 0,
    });

    // Add to router
    this.router.subscribe(connection);

    // Replay buffered events if reconnecting
    if (lastEventId && this.buffer) {
      const bufferedEvents = this.buffer.getEventsSince(config.contextId, lastEventId);

      for (const buffered of bufferedEvents) {
        connection.send(buffered.event, buffered.id);
      }
    }

    // Handle connection close
    const originalClose = connection.close.bind(connection);
    connection.close = () => {
      this.router.unsubscribe(connectionId, config.contextId);
      originalClose();
    };

    return connection;
  }

  /**
   * Emit event to all subscribers
   *
   * @param contextId - Context the event belongs to
   * @param event - Event to emit
   * @returns Number of subscribers that received the event
   */
  emit(contextId: string, event: AnyEvent): number {
    // Buffer event if enabled
    let eventId = '';
    if (this.buffer) {
      eventId = this.buffer.add(contextId, event);
    } else {
      // Generate simple event ID even without buffering
      eventId = `${contextId}-${Date.now()}`;
    }

    // Route to subscribers
    return this.router.route(contextId, event, eventId);
  }

  /**
   * Get number of active subscribers for a context
   *
   * @param contextId - Context to check
   * @returns Number of active subscribers
   */
  getSubscriberCount(contextId: string): number {
    return this.router.getSubscriberCount(contextId);
  }

  /**
   * Get all context IDs with active subscribers
   *
   * @returns Array of context IDs
   */
  getActiveContexts(): string[] {
    return this.router.getActiveContexts();
  }

  /**
   * Get server statistics
   *
   * @returns Server stats for monitoring
   */
  getStats(): {
    router: ReturnType<EventRouter['getStats']>;
    buffer?: ReturnType<EventBuffer['getStats']>;
  } {
    return {
      router: this.router.getStats(),
      buffer: this.buffer?.getStats(),
    };
  }

  /**
   * Clear buffered events for a context
   *
   * @param contextId - Context to clear
   */
  clearBuffer(contextId: string): void {
    this.buffer?.clear(contextId);
  }

  /**
   * Shutdown server (close all connections, stop timers)
   */
  shutdown(): void {
    this.router.clear();
    this.buffer?.shutdown();
  }
}
