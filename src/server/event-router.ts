/**
 * Event Router Module
 *
 * Routes events to appropriate SSE connections based on context and filters.
 * Manages subscriber sets and event filtering.
 *
 * Design: design/internal-event-protocol.md (SSE Server section)
 */

import type { AnyEvent } from '../events';
import { isDebugEvent } from '../events';

/**
 * Event filter function
 */
export type EventFilter = (event: AnyEvent) => boolean;

/**
 * Subscription configuration
 */
export interface SubscriptionConfig {
  /** Context ID to subscribe to */
  contextId: string;

  /** Optional task ID filter (only events for this task) */
  taskId?: string;

  /** Filter internal/debug events (default: true) */
  filterInternal?: boolean;

  /** Custom event filter function */
  filter?: EventFilter;

  /** Event kinds to include (undefined = all) */
  includeKinds?: string[];

  /** Event kinds to exclude */
  excludeKinds?: string[];
}

/**
 * Subscriber interface
 */
export interface Subscriber {
  /** Unique subscriber ID */
  id: string;

  /** Subscription configuration */
  config: SubscriptionConfig;

  /** Send event to subscriber */
  send(event: AnyEvent, eventId: string): void;

  /** Close the subscription */
  close(): void;
}

/**
 * Event router for managing subscriptions and routing events
 */
export class EventRouter {
  private subscribers = new Map<string, Map<string, Subscriber>>();

  /**
   * Subscribe to events for a context
   *
   * @param subscriber - Subscriber to add
   */
  subscribe(subscriber: Subscriber): void {
    const { contextId } = subscriber.config;

    // Get or create subscriber set for context
    let contextSubscribers = this.subscribers.get(contextId);
    if (!contextSubscribers) {
      contextSubscribers = new Map();
      this.subscribers.set(contextId, contextSubscribers);
    }

    // Add subscriber
    contextSubscribers.set(subscriber.id, subscriber);
  }

  /**
   * Unsubscribe a subscriber
   *
   * @param subscriberId - ID of subscriber to remove
   * @param contextId - Context the subscriber is in
   */
  unsubscribe(subscriberId: string, contextId: string): void {
    const contextSubscribers = this.subscribers.get(contextId);
    if (!contextSubscribers) {
      return;
    }

    contextSubscribers.delete(subscriberId);

    // Clean up empty context
    if (contextSubscribers.size === 0) {
      this.subscribers.delete(contextId);
    }
  }

  /**
   * Route event to matching subscribers
   *
   * @param contextId - Context the event belongs to
   * @param event - Event to route
   * @param eventId - Event ID for reconnection
   * @returns Number of subscribers that received the event
   */
  route(contextId: string, event: AnyEvent, eventId: string): number {
    const contextSubscribers = this.subscribers.get(contextId);
    if (!contextSubscribers || contextSubscribers.size === 0) {
      return 0;
    }

    let sentCount = 0;

    for (const subscriber of contextSubscribers.values()) {
      if (this.shouldSendToSubscriber(subscriber, event)) {
        try {
          subscriber.send(event, eventId);
          sentCount++;
        } catch (error) {
          // Log error but don't throw (one bad subscriber shouldn't break others)
          console.error(`Failed to send event to subscriber ${subscriber.id}:`, error);
        }
      }
    }

    return sentCount;
  }

  /**
   * Check if event should be sent to subscriber based on filters
   *
   * @param subscriber - Subscriber to check
   * @param event - Event to check
   * @returns true if event should be sent
   */
  private shouldSendToSubscriber(subscriber: Subscriber, event: AnyEvent): boolean {
    const { config } = subscriber;

    // Filter by task ID if specified
    if (config.taskId && event.taskId !== config.taskId) {
      return false;
    }

    // Filter internal/debug events
    if (config.filterInternal !== false && isDebugEvent(event)) {
      return false;
    }

    // Filter by included kinds
    if (config.includeKinds && !config.includeKinds.includes(event.kind)) {
      return false;
    }

    // Filter by excluded kinds
    if (config.excludeKinds?.includes(event.kind)) {
      return false;
    }

    // Apply custom filter
    if (config.filter && !config.filter(event)) {
      return false;
    }

    return true;
  }

  /**
   * Get number of subscribers for a context
   *
   * @param contextId - Context to check
   * @returns Number of active subscribers
   */
  getSubscriberCount(contextId: string): number {
    return this.subscribers.get(contextId)?.size ?? 0;
  }

  /**
   * Get all context IDs with active subscribers
   *
   * @returns Array of context IDs
   */
  getActiveContexts(): string[] {
    return Array.from(this.subscribers.keys());
  }

  /**
   * Get router statistics
   *
   * @returns Router stats for monitoring
   */
  getStats(): {
    totalContexts: number;
    totalSubscribers: number;
    averageSubscribersPerContext: number;
  } {
    const contexts = this.subscribers.size;
    let totalSubscribers = 0;

    for (const contextSubscribers of this.subscribers.values()) {
      totalSubscribers += contextSubscribers.size;
    }

    return {
      totalContexts: contexts,
      totalSubscribers,
      averageSubscribersPerContext: contexts > 0 ? totalSubscribers / contexts : 0,
    };
  }

  /**
   * Clear all subscribers (for testing/shutdown)
   */
  clear(): void {
    // Close all subscribers
    for (const contextSubscribers of this.subscribers.values()) {
      for (const subscriber of contextSubscribers.values()) {
        try {
          subscriber.close();
        } catch {
          // Ignore close errors
        }
      }
    }

    this.subscribers.clear();
  }
}
