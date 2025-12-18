import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { DeleteCommand, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import type { AgentState } from '@looopy-ai/core';
import { describe, expect, it, vi } from 'vitest';

import { DynamoDBAgentStore } from './dynamodb-agent-store';

const baseState: AgentState = {
  status: 'idle',
  turnCount: 3,
  createdAt: new Date('2024-05-01T00:00:00.000Z'),
  lastActivity: new Date('2024-05-02T10:00:00.000Z'),
  metadata: { env: 'test' },
};

const createStore = (sendMock?: ReturnType<typeof vi.fn>) => {
  const send = sendMock ?? vi.fn().mockResolvedValue({});
  const documentClient = { send } as unknown as DynamoDBDocumentClient;
  const store = new DynamoDBAgentStore({
    tableName: 'AgentTable',
    agentId: 'agent-123',
    documentClient,
  });

  return { store, sendMock: send };
};

describe('DynamoDBAgentStore', () => {
  it('serializes and saves agent state', async () => {
    const { store, sendMock } = createStore();

    await store.save('ctx-1', baseState);

    expect(sendMock).toHaveBeenCalledTimes(1);
    const command = sendMock.mock.calls[0][0];
    expect(command).toBeInstanceOf(PutCommand);
    expect(command.input).toMatchObject({
      TableName: 'AgentTable',
      Item: {
        pk: 'agent#agent-123',
        sk: 'context#ctx-1',
        entityType: 'agent-state',
        state: {
          status: 'idle',
          turnCount: 3,
          createdAt: baseState.createdAt.toISOString(),
          lastActivity: baseState.lastActivity.toISOString(),
          metadata: { env: 'test' },
        },
      },
    });
    expect(command.input.Item.updatedAt).toEqual(expect.any(Number));
  });

  it('loads agent state and rehydrates dates', async () => {
    const sendMock = vi.fn().mockImplementation(async (command) => {
      if (command instanceof GetCommand) {
        return {
          Item: {
            pk: 'agent#agent-123',
            sk: 'context#ctx-1',
            entityType: 'agent-state',
            state: {
              status: 'ready',
              turnCount: 5,
              createdAt: '2024-05-01T00:00:00.000Z',
              lastActivity: '2024-05-02T10:00:00.000Z',
            },
          },
        };
      }
      throw new Error('Unexpected command');
    });
    const { store } = createStore(sendMock);

    const result = await store.load('ctx-1');

    expect(result).toBeDefined();
    expect(result?.turnCount).toBe(5);
    expect(result?.createdAt.toISOString()).toBe('2024-05-01T00:00:00.000Z');
    expect(result?.lastActivity.toISOString()).toBe('2024-05-02T10:00:00.000Z');
  });

  it('returns null when no item exists', async () => {
    const sendMock = vi.fn().mockImplementation(async (command) => {
      if (command instanceof GetCommand) {
        return {};
      }
      throw new Error('Unexpected command');
    });
    const { store } = createStore(sendMock);

    const result = await store.load('missing');

    expect(result).toBeNull();
  });

  it('deletes stored state', async () => {
    const { store, sendMock } = createStore();

    await store.delete('ctx-1');

    expect(sendMock).toHaveBeenCalledTimes(1);
    const command = sendMock.mock.calls[0][0];
    expect(command).toBeInstanceOf(DeleteCommand);
    expect(command.input).toEqual({
      TableName: 'AgentTable',
      Key: {
        pk: 'agent#agent-123',
        sk: 'context#ctx-1',
      },
    });
  });
});
