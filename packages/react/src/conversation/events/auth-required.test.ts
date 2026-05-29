import { describe, expect, it } from 'vitest';
import { reduceAuthCompleted } from '../../conversation/events/auth-completed';
import { reduceAuthRequired } from '../../conversation/events/auth-required';
import type { AuthEncryptionKey, Conversation } from '../../conversation/types';

const emptyState: Conversation = { turns: new Map(), turnOrder: [] };

const mockEncryptionKey: AuthEncryptionKey = {
  kty: 'EC',
  crv: 'P-256',
  x: 'dGVzdA',
  y: 'dGVzdA',
  kid: 'key-1',
};

const baseAuthRequiredData = {
  authId: 'auth-1',
  authType: 'api-key' as const,
  prompt: 'Please provide your API key.',
  encryptionKey: mockEncryptionKey,
  timestamp: '2025-01-01T00:00:00.000Z',
};

describe('reduceAuthRequired', () => {
  it('adds a new auth-required turn to an empty state', () => {
    const result = reduceAuthRequired(emptyState, baseAuthRequiredData);

    expect(result.turnOrder).toEqual(['auth-1']);
    expect(result.turns.size).toBe(1);

    const turn = result.turns.get('auth-1');
    expect(turn).toBeDefined();
    expect(turn?.source).toBe('auth-required');
    if (turn?.source !== 'auth-required') return;
    expect(turn.authId).toBe('auth-1');
    expect(turn.authType).toBe('api-key');
    expect(turn.prompt).toBe('Please provide your API key.');
    expect(turn.status).toBe('pending');
    expect(turn.encryptionKey).toEqual(mockEncryptionKey);
  });

  it('sets status to pending', () => {
    const result = reduceAuthRequired(emptyState, baseAuthRequiredData);
    const turn = result.turns.get('auth-1');
    if (turn?.source !== 'auth-required') return;
    expect(turn.status).toBe('pending');
  });

  it('includes optional provider and scopes', () => {
    const result = reduceAuthRequired(emptyState, {
      ...baseAuthRequiredData,
      provider: 'github',
      scopes: ['repo', 'read:user'],
    });
    const turn = result.turns.get('auth-1');
    if (turn?.source !== 'auth-required') return;
    expect(turn.provider).toBe('github');
    expect(turn.scopes).toEqual(['repo', 'read:user']);
  });

  it('includes oauth2-specific fields', () => {
    const result = reduceAuthRequired(emptyState, {
      ...baseAuthRequiredData,
      authType: 'oauth2',
      authorizationEndpoint: 'https://example.com/auth',
      clientId: 'client-1',
      codeChallenge: 'challenge-abc',
      codeChallengeMethod: 'S256',
    });
    const turn = result.turns.get('auth-1');
    if (turn?.source !== 'auth-required') return;
    expect(turn.authorizationEndpoint).toBe('https://example.com/auth');
    expect(turn.clientId).toBe('client-1');
    expect(turn.codeChallenge).toBe('challenge-abc');
    expect(turn.codeChallengeMethod).toBe('S256');
  });

  it('preserves existing turns', () => {
    const stateWithTurn = reduceAuthRequired(emptyState, baseAuthRequiredData);
    const result = reduceAuthRequired(stateWithTurn, {
      ...baseAuthRequiredData,
      authId: 'auth-2',
    });
    expect(result.turnOrder).toEqual(['auth-1', 'auth-2']);
    expect(result.turns.size).toBe(2);
  });
});

describe('reduceAuthCompleted', () => {
  const stateWithPendingTurn = reduceAuthRequired(emptyState, baseAuthRequiredData);

  it('updates turn status to completed', () => {
    const result = reduceAuthCompleted(stateWithPendingTurn, {
      authId: 'auth-1',
      userId: 'user-1',
      timestamp: '2025-01-01T00:01:00.000Z',
    });

    const turn = result.turns.get('auth-1');
    if (turn?.source !== 'auth-required') return;
    expect(turn.status).toBe('completed');
  });

  it('returns unchanged state when authId not found', () => {
    const result = reduceAuthCompleted(stateWithPendingTurn, {
      authId: 'unknown-id',
      userId: 'user-1',
      timestamp: '2025-01-01T00:01:00.000Z',
    });

    expect(result).toBe(stateWithPendingTurn);
  });

  it('returns unchanged state when turn is not auth-required source', () => {
    const stateWithAgentTurn: Conversation = {
      turns: new Map([
        [
          'task-1',
          { source: 'agent', id: 'task-1', status: 'created', content: [], stream: '', events: [] },
        ],
      ]),
      turnOrder: ['task-1'],
    };

    const result = reduceAuthCompleted(stateWithAgentTurn, {
      authId: 'task-1',
      userId: 'user-1',
      timestamp: '2025-01-01T00:01:00.000Z',
    });

    expect(result).toBe(stateWithAgentTurn);
  });
});
