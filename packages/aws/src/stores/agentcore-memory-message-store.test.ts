import type { BedrockAgentCoreClient } from '@aws-sdk/client-bedrock-agentcore';
import {
  CreateEventCommand,
  DeleteEventCommand,
  ListEventsCommand,
  RetrieveMemoryRecordsCommand,
} from '@aws-sdk/client-bedrock-agentcore';
import type { LLMMessage } from '@looopy-ai/core';
import { describe, expect, it, vi } from 'vitest';

import { AgentCoreMemoryMessageStore } from './agentcore-memory-message-store';

const createStore = (
  send?: ReturnType<typeof vi.fn>,
  options?: { enableLongTerm?: boolean; initialFetchLimit?: number },
) => {
  const sendMock = send ?? vi.fn().mockResolvedValue({});
  const client = { send: sendMock } as unknown as BedrockAgentCoreClient;

  const store = new AgentCoreMemoryMessageStore({
    memoryId: 'mem-123',
    client,
    agentId: 'actor-1',
    longTermMemoryNamespace: options?.enableLongTerm ? 'long-term' : undefined,
    initialFetchLimit: options?.initialFetchLimit,
  });

  return { store, sendMock };
};

describe('AgentCoreMemoryMessageStore', () => {
  it('creates events when appending messages', async () => {
    const { store, sendMock } = createStore();
    const messages: LLMMessage[] = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
    ];

    await store.append('ctx-1', messages);

    expect(sendMock).toHaveBeenCalledTimes(2);
    const [firstCall] = sendMock.mock.calls;
    expect(firstCall[0]).toBeInstanceOf(CreateEventCommand);
    expect(firstCall[0].input).toMatchObject({
      memoryId: 'mem-123',
      actorId: 'actor-1',
      sessionId: 'ctx-1',
    });
  });

  it('returns recent messages with long-term context', async () => {
    const sendMock = vi.fn(async (command) => {
      if (command instanceof ListEventsCommand) {
        return {
          events: [
            {
              payload: [
                {
                  conversational: {
                    role: 'ASSISTANT',
                    content: { text: 'response' },
                  },
                },
              ],
            },
          ],
        };
      }

      if (command instanceof RetrieveMemoryRecordsCommand) {
        return {
          memoryRecordSummaries: [{ content: 'remember to ask follow-ups' }],
        };
      }

      return {};
    });

    const { store } = createStore(sendMock, { enableLongTerm: true });

    const result = await store.getRecent('ctx-2');

    expect(sendMock).toHaveBeenCalledWith(expect.any(ListEventsCommand));
    expect(sendMock).toHaveBeenCalledWith(expect.any(RetrieveMemoryRecordsCommand));
    expect(result[0].role).toBe('system');
    expect(result[0].content).toContain('remember to ask');
    expect(result[1]).toMatchObject({ role: 'assistant', content: 'response' });
  });

  it('lazily loads messages once and serves from cache', async () => {
    const sendMock = vi.fn(async (command) => {
      if (command instanceof ListEventsCommand) {
        return {
          events: [
            {
              payload: [
                {
                  conversational: {
                    role: 'USER',
                    content: { text: 'hey' },
                  },
                },
              ],
            },
          ],
        };
      }
      return {};
    });

    const { store } = createStore(sendMock, { enableLongTerm: false, initialFetchLimit: 10 });

    const first = await store.getRecent('ctx-4', { maxMessages: 5 });
    const second = await store.getRecent('ctx-4', { maxMessages: 5 });

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    const listCalls = sendMock.mock.calls.filter(([cmd]) => cmd instanceof ListEventsCommand);
    expect(listCalls).toHaveLength(1);
  });

  it('appends write-through to cache and remote', async () => {
    const sendMock = vi.fn(async (command) => {
      if (command instanceof ListEventsCommand) {
        return { events: [] };
      }
      return {};
    });
    const { store } = createStore(sendMock, { enableLongTerm: false });

    await store.append('ctx-5', [{ role: 'user', content: 'cached' }]);

    const messages = await store.getAll('ctx-5');
    expect(messages).toEqual([{ role: 'user', content: 'cached' }]);

    const createCalls = sendMock.mock.calls.filter(([cmd]) => cmd instanceof CreateEventCommand);
    expect(createCalls).toHaveLength(1);
  });

  it('clears stored events', async () => {
    const sendMock = vi.fn(async (command) => {
      if (command instanceof ListEventsCommand) {
        return {
          events: [{ eventId: 'evt-1' }, { eventId: 'evt-2' }],
        };
      }
      return {};
    });

    const { store } = createStore(sendMock);

    await store.clear('ctx-3');

    const deleteCalls = sendMock.mock.calls.filter(([cmd]) => cmd instanceof DeleteEventCommand);
    expect(deleteCalls).toHaveLength(2);
  });
});
