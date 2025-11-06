/**
 * Event Buffer Module
 *
 * Implements circular buffer for SSE event replay after client reconnection.
 * Events are stored with monotonic IDs and TTL-based expiry.
 *
 * Design: design/internal-event-protocol.md (SSE Reconnection section)
 */

import type { InternalEvent } from '../events';

/**
 * Buffered event with metadata
 */
export interface BufferedEvent {
  /** Monotonic event ID for ordering and replay */
  id: string;

  /** The actual event */
  event: InternalEvent;

  /** Timestamp when buffered (for TTL expiry) */
  timestamp: number;
}

/**
 * Event buffer configuration
 */
export interface EventBufferConfig {
  /** Maximum events to buffer per context (default: 100) */
  maxSize?: number;

  /** TTL for buffered events in ms (default: 5 minutes) */
  ttl?: number;

  /** Enable automatic cleanup of expired events (default: true) */
  autoCleanup?: boolean;

  /** Cleanup interval in ms (default: 30 seconds) */
  cleanupInterval?: number;
}

/**
 * Circular event buffer for SSE reconnection support
 *
 * Stores recent events per context to enable client reconnection
 * with Last-Event-ID header.
 */
export class EventBuffer {
  private buffers = new Map<string, BufferedEvent[]>();
  private eventCounters = new Map<string, number>();
  private cleanupTimer?: NodeJS.Timeout;

  private readonly maxSize: number;
  private readonly ttl: number;
  private readonly autoCleanup: boolean;
  private readonly cleanupInterval: number;

  constructor(config: EventBufferConfig = {}) {
    this.maxSize = config.maxSize ?? 100;
    this.ttl = config.ttl ?? 5 * 60 * 1000; // 5 minutes default
    this.autoCleanup = config.autoCleanup ?? true;
    this.cleanupInterval = config.cleanupInterval ?? 30 * 1000; // 30 seconds

    if (this.autoCleanup) {
      this.startCleanup();
    }
  }

  /**
   * Add event to buffer
   *
   * @param contextId - Context to buffer event for
   * @param event - Event to buffer
   * @returns Event ID for this buffered event
   */
  add(contextId: string, event: InternalEvent): string {
    // Generate monotonic event ID
    const counter = (this.eventCounters.get(contextId) ?? 0) + 1;
    this.eventCounters.set(contextId, counter);
    const id = `${contextId}-${counter}`;

    // Get or create buffer for context
    let buffer = this.buffers.get(contextId);
    if (!buffer) {
      buffer = [];
      this.buffers.set(contextId, buffer);
    }

    // Add to buffer
    buffer.push({
      id,
      event,
      timestamp: Date.now(),
    });

    // Enforce max size (circular buffer behavior)
    if (buffer.length > this.maxSize) {
      buffer.shift(); // Remove oldest
    }

    return id;
  }

  /**
   * Get events since a given event ID (for reconnection)
   *
   * @param contextId - Context to get events for
   * @param lastEventId - Last event ID client received
   * @returns Events since lastEventId (empty if not found or expired)
   */
  getEventsSince(contextId: string, lastEventId: string): BufferedEvent[] {
    const buffer = this.buffers.get(contextId);
    if (!buffer || buffer.length === 0) {
      return [];
    }

    // Find index of last event ID
    const lastIndex = buffer.findIndex((e) => e.id === lastEventId);

    if (lastIndex === -1) {
      // Event ID not found - either too old or invalid
      // Return empty array (client should re-subscribe from scratch)
      return [];
    }

    // Return events after lastEventId
    return buffer.slice(lastIndex + 1);
  }

  /**
   * Get all buffered events for a context
   *
   * @param contextId - Context to get events for
   * @returns All buffered events (oldest first)
   */
  getAll(contextId: string): BufferedEvent[] {
    return this.buffers.get(contextId) ?? [];
  }

  /**
   * Clear buffer for a context
   *
   * @param contextId - Context to clear
   */
  clear(contextId: string): void {
    this.buffers.delete(contextId);
    this.eventCounters.delete(contextId);
  }

  /**
   * Clear all buffers
   */
  clearAll(): void {
    this.buffers.clear();
    this.eventCounters.clear();
  }

  /**
   * Remove expired events based on TTL
   *
   * @returns Number of events removed
   */
  cleanup(): number {
    const now = Date.now();
    let removedCount = 0;

    for (const [contextId, buffer] of this.buffers.entries()) {
      const originalLength = buffer.length;

      // Filter out expired events
      const filtered = buffer.filter((e) => now - e.timestamp < this.ttl);

      if (filtered.length < originalLength) {
        removedCount += originalLength - filtered.length;

        if (filtered.length === 0) {
          // No events left, remove context entirely
          this.buffers.delete(contextId);
        } else {
          // Update buffer with filtered events
          this.buffers.set(contextId, filtered);
        }
      }
    }

    return removedCount;
  }

  /**
   * Get buffer statistics
   *
   * @returns Buffer stats for monitoring
   */
  getStats(): {
    contexts: number;
    totalEvents: number;
    averageEventsPerContext: number;
    oldestEventAge: number;
  } {
    const contexts = this.buffers.size;
    let totalEvents = 0;
    let oldestTimestamp = Date.now();

    for (const buffer of this.buffers.values()) {
      totalEvents += buffer.length;
      if (buffer.length > 0) {
        const oldest = buffer[0].timestamp;
        if (oldest < oldestTimestamp) {
          oldestTimestamp = oldest;
        }
      }
    }

    return {
      contexts,
      totalEvents,
      averageEventsPerContext: contexts > 0 ? totalEvents / contexts : 0,
      oldestEventAge: Date.now() - oldestTimestamp,
    };
  }

  /**
   * Start automatic cleanup timer
   */
  private startCleanup(): void {
    if (this.cleanupTimer) {
      return; // Already started
    }

    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, this.cleanupInterval);

    // Don't prevent Node.js from exiting
    this.cleanupTimer.unref?.();
  }

  /**
   * Stop automatic cleanup
   */
  stopCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
  }

  /**
   * Shutdown the buffer (cleanup and stop timers)
   */
  shutdown(): void {
    this.stopCleanup();
    this.clearAll();
  }
}
