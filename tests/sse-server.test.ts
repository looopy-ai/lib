/**
 * SSE Server Tests
 *
 * Comprehensive tests for SSE server, event buffer, and event router.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnyEvent } from '../src/events';
import { createTaskCreatedEvent, createTaskStatusEvent } from '../src/events';
import { EventBuffer } from '../src/server/event-buffer';
import { EventRouter, type Subscriber } from '../src/server/event-router';
import { SSEConnection, type SSEResponse, SSEServer } from '../src/server/sse';

// Mock SSE Response
class MockSSEResponse implements SSEResponse {
  headers: Record<string, string> = {};
  chunks: string[] = [];
  writable = true;
  ended = false;
  private closeListeners: Array<() => void> = [];

  setHeader(name: string, value: string): void {
    this.headers[name] = value;
  }

  write(chunk: string): void {
    if (!this.writable) {
      throw new Error('Response not writable');
    }
    this.chunks.push(chunk);
  }

  end(): void {
    this.writable = false;
    this.ended = true;
  }

  on(event: 'close', listener: () => void): void {
    if (event === 'close') {
      this.closeListeners.push(listener);
    }
  }

  once(event: 'close', listener: () => void): void {
    this.on(event, listener);
  }

  removeListener(event: 'close', listener: () => void): void {
    if (event === 'close') {
      const index = this.closeListeners.indexOf(listener);
      if (index !== -1) {
        this.closeListeners.splice(index, 1);
      }
    }
  }

  simulateClose(): void {
    for (const listener of this.closeListeners) {
      listener();
    }
  }

  getEvents(): Array<{ kind: string; data: AnyEvent }> {
    const events: Array<{ kind: string; data: AnyEvent }> = [];
    let currentEvent: { kind?: string; data?: string } = {};

    for (const chunk of this.chunks) {
      if (chunk.startsWith('event: ')) {
        currentEvent.kind = chunk.slice(7, -1); // Remove "event: " and newline
      } else if (chunk.startsWith('data: ')) {
        currentEvent.data = chunk.slice(6, -2); // Remove "data: " and double newline
      }

      if (currentEvent.kind && currentEvent.data) {
        events.push({
          kind: currentEvent.kind,
          data: JSON.parse(currentEvent.data),
        });
        currentEvent = {};
      }
    }

    return events;
  }
}

describe('EventBuffer', () => {
  let buffer: EventBuffer;

  beforeEach(() => {
    buffer = new EventBuffer({ maxSize: 10, ttl: 1000, autoCleanup: false });
  });

  afterEach(() => {
    buffer.shutdown();
  });

  it('should add events with monotonic IDs', () => {
    const event1 = createTaskCreatedEvent({
      contextId: 'ctx-1',
      taskId: 'task-1',
      initiator: 'user',
    });
    const event2 = createTaskStatusEvent({
      contextId: 'ctx-1',
      taskId: 'task-1',
      status: 'working',
    });

    const id1 = buffer.add('ctx-1', event1);
    const id2 = buffer.add('ctx-1', event2);

    expect(id1).toBe('ctx-1-1');
    expect(id2).toBe('ctx-1-2');
  });

  it('should retrieve events since a given ID', () => {
    const event1 = createTaskCreatedEvent({
      contextId: 'ctx-1',
      taskId: 'task-1',
      initiator: 'user',
    });
    const event2 = createTaskStatusEvent({
      contextId: 'ctx-1',
      taskId: 'task-1',
      status: 'working',
    });
    const event3 = createTaskStatusEvent({
      contextId: 'ctx-1',
      taskId: 'task-1',
      status: 'completed',
    });

    const id1 = buffer.add('ctx-1', event1);
    buffer.add('ctx-1', event2);
    buffer.add('ctx-1', event3);

    const eventsSince = buffer.getEventsSince('ctx-1', id1);

    expect(eventsSince).toHaveLength(2);
    expect(eventsSince[0].event.kind).toBe('task-status');
    expect(eventsSince[1].event.kind).toBe('task-status');
  });

  it('should return empty array for unknown event ID', () => {
    const event1 = createTaskCreatedEvent({
      contextId: 'ctx-1',
      taskId: 'task-1',
      initiator: 'user',
    });
    buffer.add('ctx-1', event1);

    const eventsSince = buffer.getEventsSince('ctx-1', 'unknown-id');

    expect(eventsSince).toHaveLength(0);
  });

  it('should enforce max size (circular buffer)', () => {
    const ctx = 'ctx-1';

    // Add 15 events (max size is 10)
    for (let i = 0; i < 15; i++) {
      buffer.add(
        ctx,
        createTaskStatusEvent({ contextId: ctx, taskId: 'task-1', status: 'working' })
      );
    }

    const all = buffer.getAll(ctx);

    expect(all).toHaveLength(10); // Only last 10
    expect(all[0].id).toBe('ctx-1-6'); // First 5 dropped
  });

  it('should cleanup expired events', async () => {
    const shortTtlBuffer = new EventBuffer({ ttl: 50, autoCleanup: false });

    shortTtlBuffer.add(
      'ctx-1',
      createTaskCreatedEvent({ contextId: 'ctx-1', taskId: 'task-1', initiator: 'user' })
    );

    // Wait for expiry
    await new Promise((resolve) => setTimeout(resolve, 100));

    const removed = shortTtlBuffer.cleanup();

    expect(removed).toBe(1);
    expect(shortTtlBuffer.getAll('ctx-1')).toHaveLength(0);

    shortTtlBuffer.shutdown();
  });

  it('should clear context', () => {
    buffer.add(
      'ctx-1',
      createTaskCreatedEvent({ contextId: 'ctx-1', taskId: 'task-1', initiator: 'user' })
    );
    buffer.add(
      'ctx-1',
      createTaskStatusEvent({ contextId: 'ctx-1', taskId: 'task-1', status: 'working' })
    );

    buffer.clear('ctx-1');

    expect(buffer.getAll('ctx-1')).toHaveLength(0);
  });

  it('should provide stats', () => {
    buffer.add(
      'ctx-1',
      createTaskCreatedEvent({ contextId: 'ctx-1', taskId: 'task-1', initiator: 'user' })
    );
    buffer.add(
      'ctx-1',
      createTaskStatusEvent({ contextId: 'ctx-1', taskId: 'task-1', status: 'working' })
    );
    buffer.add(
      'ctx-2',
      createTaskCreatedEvent({ contextId: 'ctx-2', taskId: 'task-2', initiator: 'user' })
    );

    const stats = buffer.getStats();

    expect(stats.contexts).toBe(2);
    expect(stats.totalEvents).toBe(3);
    expect(stats.averageEventsPerContext).toBe(1.5);
  });
});

describe('EventRouter', () => {
  let router: EventRouter;
  let mockSubscriber: Subscriber;

  beforeEach(() => {
    router = new EventRouter();

    mockSubscriber = {
      id: 'sub-1',
      config: { contextId: 'ctx-1' },
      send: vi.fn(),
      close: vi.fn(),
    };
  });

  afterEach(() => {
    router.clear();
  });

  it('should subscribe and route events', () => {
    router.subscribe(mockSubscriber);

    const event = createTaskCreatedEvent({
      contextId: 'ctx-1',
      taskId: 'task-1',
      initiator: 'user',
    });
    const sent = router.route('ctx-1', event, 'evt-1');

    expect(sent).toBe(1);
    expect(mockSubscriber.send).toHaveBeenCalledWith(event, 'evt-1');
  });

  it('should not route to wrong context', () => {
    router.subscribe(mockSubscriber);

    const event = createTaskCreatedEvent({
      contextId: 'ctx-2',
      taskId: 'task-2',
      initiator: 'user',
    });
    const sent = router.route('ctx-2', event, 'evt-1');

    expect(sent).toBe(0);
    expect(mockSubscriber.send).not.toHaveBeenCalled();
  });

  it('should filter by task ID', () => {
    const taskFilterSubscriber: Subscriber = {
      id: 'sub-2',
      config: { contextId: 'ctx-1', taskId: 'task-1' },
      send: vi.fn(),
      close: vi.fn(),
    };

    router.subscribe(taskFilterSubscriber);

    const event1 = createTaskCreatedEvent({
      contextId: 'ctx-1',
      taskId: 'task-1',
      initiator: 'user',
    });
    const event2 = createTaskCreatedEvent({
      contextId: 'ctx-1',
      taskId: 'task-2',
      initiator: 'user',
    });

    router.route('ctx-1', event1, 'evt-1');
    router.route('ctx-1', event2, 'evt-2');

    expect(taskFilterSubscriber.send).toHaveBeenCalledTimes(1);
    expect(taskFilterSubscriber.send).toHaveBeenCalledWith(event1, 'evt-1');
  });

  it('should filter internal events by default', () => {
    router.subscribe(mockSubscriber);

    const internalEvent: AnyEvent = {
      kind: 'internal:llm-call',
      contextId: 'ctx-1',
      taskId: 'task-1',
      iteration: 1,
      model: 'gpt-4',
      messageCount: 2,
      toolCount: 5,
      timestamp: new Date().toISOString(),
    };

    const sent = router.route('ctx-1', internalEvent, 'evt-1');

    expect(sent).toBe(0);
    expect(mockSubscriber.send).not.toHaveBeenCalled();
  });

  it('should allow internal events if filter disabled', () => {
    const noFilterSubscriber: Subscriber = {
      id: 'sub-2',
      config: { contextId: 'ctx-1', filterInternal: false },
      send: vi.fn(),
      close: vi.fn(),
    };

    router.subscribe(noFilterSubscriber);

    const internalEvent: AnyEvent = {
      kind: 'internal:llm-call',
      contextId: 'ctx-1',
      taskId: 'task-1',
      iteration: 1,
      model: 'gpt-4',
      messageCount: 2,
      toolCount: 5,
      timestamp: new Date().toISOString(),
    };

    const sent = router.route('ctx-1', internalEvent, 'evt-1');

    expect(sent).toBe(1);
    expect(noFilterSubscriber.send).toHaveBeenCalledWith(internalEvent, 'evt-1');
  });

  it('should filter by included kinds', () => {
    const kindFilterSubscriber: Subscriber = {
      id: 'sub-2',
      config: { contextId: 'ctx-1', includeKinds: ['task-created'] },
      send: vi.fn(),
      close: vi.fn(),
    };

    router.subscribe(kindFilterSubscriber);

    const event1 = createTaskCreatedEvent({
      contextId: 'ctx-1',
      taskId: 'task-1',
      initiator: 'user',
    });
    const event2 = createTaskStatusEvent({
      contextId: 'ctx-1',
      taskId: 'task-1',
      status: 'working',
    });

    router.route('ctx-1', event1, 'evt-1');
    router.route('ctx-1', event2, 'evt-2');

    expect(kindFilterSubscriber.send).toHaveBeenCalledTimes(1);
    expect(kindFilterSubscriber.send).toHaveBeenCalledWith(event1, 'evt-1');
  });

  it('should filter by excluded kinds', () => {
    const excludeFilterSubscriber: Subscriber = {
      id: 'sub-2',
      config: { contextId: 'ctx-1', excludeKinds: ['task-status'] },
      send: vi.fn(),
      close: vi.fn(),
    };

    router.subscribe(excludeFilterSubscriber);

    const event1 = createTaskCreatedEvent({
      contextId: 'ctx-1',
      taskId: 'task-1',
      initiator: 'user',
    });
    const event2 = createTaskStatusEvent({
      contextId: 'ctx-1',
      taskId: 'task-1',
      status: 'working',
    });

    router.route('ctx-1', event1, 'evt-1');
    router.route('ctx-1', event2, 'evt-2');

    expect(excludeFilterSubscriber.send).toHaveBeenCalledTimes(1);
    expect(excludeFilterSubscriber.send).toHaveBeenCalledWith(event1, 'evt-1');
  });

  it('should unsubscribe', () => {
    router.subscribe(mockSubscriber);

    router.unsubscribe('sub-1', 'ctx-1');

    expect(router.getSubscriberCount('ctx-1')).toBe(0);
  });

  it('should handle subscriber errors gracefully', () => {
    const errorSubscriber: Subscriber = {
      id: 'sub-error',
      config: { contextId: 'ctx-1' },
      send: vi.fn(() => {
        throw new Error('Send failed');
      }),
      close: vi.fn(),
    };

    router.subscribe(errorSubscriber);
    router.subscribe(mockSubscriber);

    const event = createTaskCreatedEvent({
      contextId: 'ctx-1',
      taskId: 'task-1',
      initiator: 'user',
    });
    const sent = router.route('ctx-1', event, 'evt-1');

    // Error subscriber throws, but normal subscriber still receives
    expect(sent).toBe(1); // Only mockSubscriber succeeded
    expect(mockSubscriber.send).toHaveBeenCalled();
  });

  it('should provide stats', () => {
    router.subscribe(mockSubscriber);

    const subscriber2: Subscriber = {
      id: 'sub-2',
      config: { contextId: 'ctx-1' },
      send: vi.fn(),
      close: vi.fn(),
    };

    const subscriber3: Subscriber = {
      id: 'sub-3',
      config: { contextId: 'ctx-2' },
      send: vi.fn(),
      close: vi.fn(),
    };

    router.subscribe(subscriber2);
    router.subscribe(subscriber3);

    const stats = router.getStats();

    expect(stats.totalContexts).toBe(2);
    expect(stats.totalSubscribers).toBe(3);
    expect(stats.averageSubscribersPerContext).toBe(1.5);
  });
});

describe('SSEConnection', () => {
  let response: MockSSEResponse;

  beforeEach(() => {
    response = new MockSSEResponse();
  });

  it('should set SSE headers', () => {
    new SSEConnection('conn-1', {
      subscription: { contextId: 'ctx-1' },
      response,
    });

    expect(response.headers['Content-Type']).toBe('text/event-stream');
    expect(response.headers['Cache-Control']).toBe('no-cache');
    expect(response.headers.Connection).toBe('keep-alive');
  });

  it('should send events in SSE format', () => {
    const connection = new SSEConnection('conn-1', {
      subscription: { contextId: 'ctx-1' },
      response,
      heartbeatInterval: 0, // Disable heartbeat for test
    });

    const event = createTaskCreatedEvent({
      contextId: 'ctx-1',
      taskId: 'task-1',
      initiator: 'user',
    });
    connection.send(event, 'evt-123');

    expect(response.chunks).toContain('id: evt-123\n');
    expect(response.chunks).toContain('event: task-created\n');
    expect(response.chunks.some((c) => c.startsWith('data: '))).toBe(true);
  });

  it('should close connection', () => {
    const connection = new SSEConnection('conn-1', {
      subscription: { contextId: 'ctx-1' },
      response,
      heartbeatInterval: 0,
    });

    connection.close();

    expect(response.ended).toBe(true);
    expect(connection.isClosed()).toBe(true);
  });

  it('should handle client disconnect', () => {
    const connection = new SSEConnection('conn-1', {
      subscription: { contextId: 'ctx-1' },
      response,
      heartbeatInterval: 0,
    });

    response.simulateClose();

    expect(connection.isClosed()).toBe(true);
  });
});

describe('SSEServer', () => {
  let server: SSEServer;

  beforeEach(() => {
    server = new SSEServer({
      enableBuffering: true,
      enableHeartbeat: false, // Disable for tests
    });
  });

  afterEach(() => {
    server.shutdown();
  });

  it('should subscribe client and emit events', () => {
    const response = new MockSSEResponse();

    const connection = server.subscribe(response, { contextId: 'ctx-1' });

    const event = createTaskCreatedEvent({
      contextId: 'ctx-1',
      taskId: 'task-1',
      initiator: 'user',
    });
    const sent = server.emit('ctx-1', event);

    expect(sent).toBe(1);

    const events = response.getEvents();
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('task-created');

    connection.close();
  });

  it('should support multiple subscribers', () => {
    const response1 = new MockSSEResponse();
    const response2 = new MockSSEResponse();

    server.subscribe(response1, { contextId: 'ctx-1' });
    server.subscribe(response2, { contextId: 'ctx-1' });

    const event = createTaskCreatedEvent({
      contextId: 'ctx-1',
      taskId: 'task-1',
      initiator: 'user',
    });
    const sent = server.emit('ctx-1', event);

    expect(sent).toBe(2);
    expect(response1.getEvents()).toHaveLength(1);
    expect(response2.getEvents()).toHaveLength(1);
  });

  it('should isolate contexts', () => {
    const response1 = new MockSSEResponse();
    const response2 = new MockSSEResponse();

    server.subscribe(response1, { contextId: 'ctx-1' });
    server.subscribe(response2, { contextId: 'ctx-2' });

    server.emit(
      'ctx-1',
      createTaskCreatedEvent({ contextId: 'ctx-1', taskId: 'task-1', initiator: 'user' })
    );

    expect(response1.getEvents()).toHaveLength(1);
    expect(response2.getEvents()).toHaveLength(0);
  });

  it('should replay buffered events on reconnection', () => {
    const response1 = new MockSSEResponse();
    const connection1 = server.subscribe(response1, { contextId: 'ctx-1' });

    // Send 3 events
    server.emit(
      'ctx-1',
      createTaskCreatedEvent({ contextId: 'ctx-1', taskId: 'task-1', initiator: 'user' })
    );
    server.emit(
      'ctx-1',
      createTaskStatusEvent({ contextId: 'ctx-1', taskId: 'task-1', status: 'working' })
    );
    server.emit(
      'ctx-1',
      createTaskStatusEvent({ contextId: 'ctx-1', taskId: 'task-1', status: 'completed' })
    );

    const events1 = response1.getEvents();
    expect(events1).toHaveLength(3);

    // Get last event ID (should be ctx-1-1 for first event)
    connection1.close();

    // Reconnect with last event ID
    const response2 = new MockSSEResponse();
    server.subscribe(response2, { contextId: 'ctx-1' }, 'ctx-1-1');

    // Should receive events 2 and 3 on reconnection
    const events2 = response2.getEvents();
    expect(events2).toHaveLength(2);
    expect(events2[0].kind).toBe('task-status');
  });

  it('should filter internal events', () => {
    const response = new MockSSEResponse();
    server.subscribe(response, { contextId: 'ctx-1' });

    const externalEvent = createTaskCreatedEvent({
      contextId: 'ctx-1',
      taskId: 'task-1',
      initiator: 'user',
    });
    const internalEvent: AnyEvent = {
      kind: 'internal:llm-call',
      contextId: 'ctx-1',
      taskId: 'task-1',
      iteration: 1,
      model: 'gpt-4',
      messageCount: 2,
      toolCount: 5,
      timestamp: new Date().toISOString(),
    };

    server.emit('ctx-1', externalEvent);
    server.emit('ctx-1', internalEvent);

    const events = response.getEvents();
    expect(events).toHaveLength(1); // Only external event
    expect(events[0].kind).toBe('task-created');
  });

  it('should get subscriber count', () => {
    const response1 = new MockSSEResponse();
    const response2 = new MockSSEResponse();

    server.subscribe(response1, { contextId: 'ctx-1' });
    server.subscribe(response2, { contextId: 'ctx-1' });

    expect(server.getSubscriberCount('ctx-1')).toBe(2);
    expect(server.getSubscriberCount('ctx-2')).toBe(0);
  });

  it('should get active contexts', () => {
    server.subscribe(new MockSSEResponse(), { contextId: 'ctx-1' });
    server.subscribe(new MockSSEResponse(), { contextId: 'ctx-2' });

    const contexts = server.getActiveContexts();

    expect(contexts).toHaveLength(2);
    expect(contexts).toContain('ctx-1');
    expect(contexts).toContain('ctx-2');
  });

  it('should provide stats', () => {
    server.subscribe(new MockSSEResponse(), { contextId: 'ctx-1' });
    server.subscribe(new MockSSEResponse(), { contextId: 'ctx-1' });
    server.emit(
      'ctx-1',
      createTaskCreatedEvent({ contextId: 'ctx-1', taskId: 'task-1', initiator: 'user' })
    );

    const stats = server.getStats();

    expect(stats.router.totalContexts).toBe(1);
    expect(stats.router.totalSubscribers).toBe(2);
    expect(stats.buffer?.totalEvents).toBe(1);
  });
});
