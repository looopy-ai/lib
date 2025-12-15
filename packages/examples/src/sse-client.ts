/**
 * SSE Client Example
 *
 * Demonstrates how to consume SSE events from the Looopy agent using EventSource.
 *
 * This example shows:
 * - Basic EventSource usage
 * - Event filtering patterns
 * - Reconnection handling
 * - Error handling
 * - Progress tracking
 */

import type { ContextAnyEvent } from '@looopy-ai/core';
import { EventSource } from 'eventsource';

// Example 1: Basic SSE Client
// ============================
async function basicSSEClient() {
  console.log('=== Example 1: Basic SSE Client ===\n');

  const contextId = 'ctx-user-123';
  const url = `http://localhost:3000/sse/stream?contextId=${contextId}`;

  const eventSource = new EventSource(url);

  // Handle specific event types
  eventSource.addEventListener('task-created', (event: MessageEvent) => {
    const data = JSON.parse(event.data) as ContextAnyEvent;
    console.log('Task Created:', {
      taskId: data.taskId,
      contextId: data.contextId,
    });
  });

  eventSource.addEventListener('task-status', (event: MessageEvent) => {
    const data = JSON.parse(event.data) as ContextAnyEvent;
    console.log('Status Update:', {
      taskId: data.taskId,
      status: data.kind === 'task-status' ? data.status : 'unknown',
    });
  });

  eventSource.addEventListener('file-write', (event: MessageEvent) => {
    const data = JSON.parse(event.data) as ContextAnyEvent;
    console.log('File Write Event:', {
      taskId: data.taskId,
      artifactId: data.kind === 'file-write' ? data.artifactId : 'unknown',
    });
  });

  // Handle connection events
  eventSource.onopen = () => {
    console.log('✓ Connected to SSE stream');
  };

  eventSource.onerror = () => {
    console.error('✗ Connection error');
    // EventSource automatically reconnects
  };

  // Keep alive for 30 seconds
  await new Promise((resolve) => setTimeout(resolve, 30000));

  // Close connection
  eventSource.close();
  console.log('\n✓ Connection closed\n');
}

// Example 2: Filtered SSE Client (Task-Specific)
// ===============================================
async function filteredSSEClient() {
  console.log('=== Example 2: Filtered SSE Client (Task-Specific) ===\n');

  const contextId = 'ctx-user-123';
  const taskId = 'task-456';
  const url = `http://localhost:3000/sse/stream?contextId=${contextId}&taskId=${taskId}`;

  const eventSource = new EventSource(url);

  console.log(`Listening for events from task: ${taskId}`);

  // All events will be from the specified task
  eventSource.onmessage = (event: MessageEvent) => {
    const data = JSON.parse(event.data) as ContextAnyEvent;
    console.log(`Event (${data.kind}):`, data);
  };

  eventSource.onerror = () => {
    console.error('Connection lost, auto-reconnecting...');
  };

  await new Promise((resolve) => setTimeout(resolve, 30000));
  eventSource.close();
  console.log('\n✓ Connection closed\n');
}

// Example 3: Reconnection with Last-Event-ID
// ===========================================
async function reconnectionExample() {
  console.log('=== Example 3: Reconnection with Last-Event-ID ===\n');

  const contextId = 'ctx-user-123';
  let lastEventId: string | undefined;

  // First connection
  console.log('First connection...');
  const eventSource1 = new EventSource(`http://localhost:3000/sse/stream?contextId=${contextId}`);

  eventSource1.onmessage = (event: MessageEvent) => {
    lastEventId = event.lastEventId;
    const data = JSON.parse(event.data) as ContextAnyEvent;
    console.log(`Event ${event.lastEventId} (${data.kind})`);
  };

  await new Promise((resolve) => setTimeout(resolve, 5000));
  eventSource1.close();
  console.log(`\n✓ Disconnected (last event: ${lastEventId})\n`);

  // Wait to simulate network interruption
  await new Promise((resolve) => setTimeout(resolve, 2000));

  // Reconnect with Last-Event-ID
  console.log('Reconnecting with Last-Event-ID...');
  const eventSource2 = new EventSource(
    `http://localhost:3000/sse/stream?contextId=${contextId}&lastEventId=${lastEventId || ''}`,
  );

  console.log('Replaying missed events...\n');

  eventSource2.onmessage = (event: MessageEvent) => {
    const data = JSON.parse(event.data) as ContextAnyEvent;
    console.log(`Replayed event ${event.lastEventId} (${data.kind})`);
  };

  await new Promise((resolve) => setTimeout(resolve, 5000));
  eventSource2.close();
  console.log('\n✓ Connection closed\n');
}

// Example 4: Progress Tracking
// =============================
async function progressTrackingExample() {
  console.log('=== Example 4: Progress Tracking ===\n');

  const contextId = 'ctx-user-123';
  const url = `http://localhost:3000/sse/stream?contextId=${contextId}`;

  const eventSource = new EventSource(url);

  interface TaskProgress {
    taskId: string;
    status: string;
    toolCalls?: number;
    complete: boolean;
  }

  const tasks = new Map<string, TaskProgress>();

  eventSource.addEventListener('task-created', (event: MessageEvent) => {
    const data = JSON.parse(event.data) as ContextAnyEvent;
    if (data.kind === 'task-created') {
      tasks.set(data.taskId, {
        taskId: data.taskId,
        status: 'created',
        toolCalls: 0,
        complete: false,
      });
      console.log(`[${data.taskId}] Task created`);
    }
  });

  eventSource.addEventListener('task-status', (event: MessageEvent) => {
    const data = JSON.parse(event.data) as ContextAnyEvent;
    if (data.kind === 'task-status') {
      const progress = tasks.get(data.taskId);
      if (progress) {
        progress.status = data.status;
        progress.complete = data.status === 'completed' || data.status === 'failed';
        console.log(`[${data.taskId}] Status: ${data.status}${progress.complete ? ' ✓' : ''}`);
      }
    }
  });

  eventSource.addEventListener('tool-complete', (event: MessageEvent) => {
    const data = JSON.parse(event.data) as ContextAnyEvent;
    if (data.kind === 'tool-complete') {
      const progress = tasks.get(data.taskId);
      if (progress) {
        progress.toolCalls = (progress.toolCalls || 0) + 1;
        console.log(
          `[${data.taskId}] Tool call #${progress.toolCalls}${data.success ? ' ✓' : ' ✗'}`,
        );
      }
    }
  });

  eventSource.onerror = () => {
    console.error('Connection lost, auto-reconnecting...');
  };

  // Summary after 30 seconds
  setTimeout(() => {
    console.log('\n=== Summary ===');
    for (const [taskId, progress] of Array.from(tasks.entries())) {
      console.log(`Task ${taskId}: ${progress.status}, ${progress.toolCalls} tool calls`);
    }
    eventSource.close();
  }, 30000);
}

// Example 5: Multiple Event Types
// ================================
async function multipleEventTypesExample() {
  console.log('=== Example 5: Multiple Event Types ===\n');

  const contextId = 'ctx-user-123';
  const url = `http://localhost:3000/sse/stream?contextId=${contextId}`;

  const eventSource = new EventSource(url);

  // Task lifecycle events
  const taskEvents = ['task-created', 'task-status', 'task:input-required'];

  for (const eventType of taskEvents) {
    eventSource.addEventListener(eventType, (event: MessageEvent) => {
      const data = JSON.parse(event.data) as ContextAnyEvent;
      console.log(`[TASK] ${data.kind}:`, data);
    });
  }

  // Artifact events
  const artifactEvents = ['file-write', 'data-write', 'dataset-write'];

  for (const eventType of artifactEvents) {
    eventSource.addEventListener(eventType, (event: MessageEvent) => {
      const data = JSON.parse(event.data) as ContextAnyEvent;
      console.log(`[ARTIFACT] ${data.kind}:`, data);
    });
  }

  // Tool events
  const toolEvents = ['tool-start', 'tool-progress', 'tool-complete'];

  for (const eventType of toolEvents) {
    eventSource.addEventListener(eventType, (event: MessageEvent) => {
      const data = JSON.parse(event.data) as ContextAnyEvent;
      console.log(`[TOOL] ${data.kind}:`, data);
    });
  }

  // Internal events (debug)
  const internalEvents = ['internal:llm-call', 'internal:checkpoint', 'internal:thought-process'];

  for (const eventType of internalEvents) {
    eventSource.addEventListener(eventType, (event: MessageEvent) => {
      const data = JSON.parse(event.data) as ContextAnyEvent;
      console.log(`[INTERNAL] ${data.kind}:`, data);
    });
  }

  eventSource.onerror = () => {
    console.error('Connection lost, auto-reconnecting...');
  };

  await new Promise((resolve) => setTimeout(resolve, 30000));
  eventSource.close();
  console.log('\n✓ Connection closed\n');
}

// Example 6: Error Handling
// ==========================
async function errorHandlingExample() {
  console.log('=== Example 6: Error Handling ===\n');

  const contextId = 'ctx-user-123';
  const url = `http://localhost:3000/sse/stream?contextId=${contextId}`;

  let reconnectAttempts = 0;
  const maxReconnectAttempts = 5;

  const connect = () => {
    const eventSource = new EventSource(url);

    eventSource.onopen = () => {
      console.log('✓ Connected to SSE stream');
      reconnectAttempts = 0; // Reset on successful connection
    };

    eventSource.onmessage = (event: MessageEvent) => {
      const data = JSON.parse(event.data) as ContextAnyEvent;
      console.log(`Event: ${data.kind}`);
    };

    eventSource.onerror = (error) => {
      console.error('✗ Connection error:', error);

      if (reconnectAttempts >= maxReconnectAttempts) {
        console.error(`Max reconnection attempts (${maxReconnectAttempts}) reached. Giving up.`);
        eventSource.close();
        return;
      }

      reconnectAttempts++;
      console.log(`Reconnecting... (attempt ${reconnectAttempts}/${maxReconnectAttempts})`);

      // EventSource automatically reconnects, but we can force close and reconnect
      eventSource.close();
      setTimeout(connect, 5000); // Wait 5 seconds before reconnecting
    };

    return eventSource;
  };

  const eventSource = connect();

  // Keep alive for 30 seconds
  await new Promise((resolve) => setTimeout(resolve, 30000));

  eventSource.close();
  console.log('\n✓ Connection closed\n');
}

// Example 7: Filtering Internal Events (Client-Side)
// ===================================================
async function filterContextAnyEventsExample() {
  console.log('=== Example 7: Filtering Internal Events (Client-Side) ===\n');

  const contextId = 'ctx-user-123';
  const url = `http://localhost:3000/sse/stream?contextId=${contextId}&filterInternal=false`;

  const eventSource = new EventSource(url);

  console.log('Receiving ALL events (including internal debug events)...\n');

  eventSource.onmessage = (event: MessageEvent) => {
    const data = JSON.parse(event.data) as ContextAnyEvent;

    // Client-side filtering
    if (data.kind.startsWith('internal:')) {
      console.log(`[INTERNAL] ${data.kind}:`, data);
    } else {
      console.log(`[PUBLIC] ${data.kind}:`, data);
    }
  };

  eventSource.onerror = () => {
    console.error('Connection lost, auto-reconnecting...');
  };

  await new Promise((resolve) => setTimeout(resolve, 30000));
  eventSource.close();
  console.log('\n✓ Connection closed\n');
}

// Run examples
// ============

async function main() {
  console.log('Looopy SSE Client Examples\n');
  console.log('Make sure the SSE server is running on http://localhost:3000\n');
  console.log('='.repeat(60));
  console.log('\n');

  // HACK
  if (
    !basicSSEClient ||
    !filteredSSEClient ||
    !reconnectionExample ||
    !progressTrackingExample ||
    !multipleEventTypesExample ||
    !errorHandlingExample ||
    !filterContextAnyEventsExample
  ) {
    throw new Error('HACK to avoid unused function errors');
  }

  // Uncomment the example you want to run:

  await basicSSEClient();
  // await filteredSSEClient();
  // await reconnectionExample();
  // await progressTrackingExample();
  // await multipleEventTypesExample();
  // await errorHandlingExample();
  // await filterContextAnyEventsExample();

  console.log('\nDone! Uncomment an example in main() to run it.\n');
}

main().catch(console.error);
