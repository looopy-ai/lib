import { consumeSSEStream } from '@geee-be/sse-stream-parser';
import { context } from '@opentelemetry/api';
import { lastValueFrom, toArray } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isChildTaskEvent } from '../events/utils';
import type { AnyEvent, ChildTaskEvent } from '../types';
import type { ExecutionContext } from '../types/context';
import type { ToolCall } from '../types/tools';
import { AgentToolProvider } from './agent-tool-provider';

vi.mock('pino');
vi.mock('@geee-be/sse-stream-parser', () => ({
  consumeSSEStream: vi.fn(),
}));

const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

describe('AgentToolProvider', () => {
  const card = {
    name: 'Sample Agent',
    description: 'Demo agent for testing',
    url: 'https://example.com',
  };

  let provider: AgentToolProvider<unknown>;
  let invokeToolCall: ToolCall;
  let executionContext: ExecutionContext<unknown>;

  beforeEach(async () => {
    provider = AgentToolProvider.from(card);
    const [invokeTool] = await provider.listTools();

    executionContext = {
      agentId: 'parent-agent',
      contextId: 'ctx-123',
      taskId: 'parent-task',
      authContext: undefined,
      parentContext: context.active(),
    };

    invokeToolCall = {
      id: 'call-1',
      type: 'function',
      function: {
        name: invokeTool.id,
        arguments: { prompt: 'Hello' },
      },
    };

    mockFetch.mockReset();
    vi.mocked(consumeSSEStream).mockReset();
  });

  it('propagates parentTaskId to streamed agent events', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response('ignored', { status: 200, headers: { 'Content-Type': 'text/event-stream' } }),
    );

    vi.mocked(consumeSSEStream).mockImplementation(async (_body, onMessage) => {
      onMessage({
        event: 'content-complete',
        data: JSON.stringify({
          taskId: 'child-task-1',
          content: 'agent reply',
          finishReason: 'stop',
        }),
      });
      onMessage({
        event: 'task-complete',
        data: JSON.stringify({ taskId: 'child-task-1', content: 'agent reply' }),
      });
    });

    const events = await lastValueFrom(
      provider.executeTool(invokeToolCall, executionContext).pipe(toArray()),
    );

    const streamedEvents = events.filter((event) => event.kind !== 'tool-complete');
    expect(streamedEvents).not.toHaveLength(0);
    streamedEvents.forEach((event) => {
      expect((event as ChildTaskEvent<AnyEvent>).parentTaskId).toBe(executionContext.taskId);
    });

    const finalEvent = events.at(-1);
    expect(finalEvent?.kind).toBe('tool-complete');
    if (finalEvent?.kind === 'tool-complete') {
      expect(finalEvent.result).toBe('agent reply');
    }
  });

  it('does not write child agent content events to the message store', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response('ignored', { status: 200, headers: { 'Content-Type': 'text/event-stream' } }),
    );

    vi.mocked(consumeSSEStream).mockImplementation(async (_body, onMessage) => {
      onMessage({
        event: 'content-complete',
        data: JSON.stringify({ taskId: 'child-task-2', content: 'child agent content' }),
      });
      onMessage({
        event: 'task-complete',
        data: JSON.stringify({ taskId: 'child-task-2', content: 'child agent content' }),
      });
    });

    const events = await lastValueFrom(
      provider.executeTool(invokeToolCall, executionContext).pipe(toArray()),
    );

    const append = vi.fn();
    events.forEach((event) => {
      if (isChildTaskEvent(event)) return;
      if (event.kind === 'content-complete') {
        append(event);
      }
    });

    expect(append).not.toHaveBeenCalled();
  });
});
