import { describe, expect, it } from 'vitest';
import { reduceInputReceived } from '../../conversation/events/input-received';
import { reduceInputRequired } from '../../conversation/events/input-required';
import type { Conversation } from '../../conversation/types';

const emptyState: Conversation = { turns: new Map(), turnOrder: [] };

const baseInputRequiredData = {
  inputId: 'input-1',
  inputType: 'confirmation' as const,
  prompt: 'Are you sure?',
  timestamp: '2025-01-01T00:00:00.000Z',
};

describe('reduceInputRequired', () => {
  it('adds a new input-required turn to an empty state', () => {
    const result = reduceInputRequired(emptyState, baseInputRequiredData);

    expect(result.turnOrder).toEqual(['input-1']);
    expect(result.turns.size).toBe(1);

    const turn = result.turns.get('input-1');
    expect(turn).toBeDefined();
    expect(turn?.source).toBe('input-required');
    if (turn?.source !== 'input-required') return;
    expect(turn.inputId).toBe('input-1');
    expect(turn.inputType).toBe('confirmation');
    expect(turn.prompt).toBe('Are you sure?');
    expect(turn.status).toBe('pending');
  });

  it('preserves existing turns when adding', () => {
    const stateWithTurn = reduceInputRequired(emptyState, baseInputRequiredData);
    const result = reduceInputRequired(stateWithTurn, {
      inputId: 'input-2',
      inputType: 'clarification',
      prompt: 'Please clarify.',
      timestamp: '2025-01-01T00:01:00.000Z',
    });

    expect(result.turnOrder).toEqual(['input-1', 'input-2']);
    expect(result.turns.size).toBe(2);
  });

  it('sets status to pending', () => {
    const result = reduceInputRequired(emptyState, baseInputRequiredData);
    const turn = result.turns.get('input-1');
    if (turn?.source !== 'input-required') return;
    expect(turn.status).toBe('pending');
  });

  it('includes optional fields when provided', () => {
    const result = reduceInputRequired(emptyState, {
      ...baseInputRequiredData,
      inputType: 'selection',
      options: ['a', 'b', 'c'],
      requireUser: true,
    });
    const turn = result.turns.get('input-1');
    if (turn?.source !== 'input-required') return;
    expect(turn.options).toEqual(['a', 'b', 'c']);
    expect(turn.requireUser).toBe(true);
  });
});

describe('reduceInputReceived', () => {
  const stateWithPendingTurn = reduceInputRequired(emptyState, baseInputRequiredData);

  it('updates turn status to answered', () => {
    const result = reduceInputReceived(stateWithPendingTurn, {
      inputId: 'input-1',
      providedBy: 'user',
      timestamp: '2025-01-01T00:01:00.000Z',
    });

    const turn = result.turns.get('input-1');
    if (turn?.source !== 'input-required') return;
    expect(turn.status).toBe('answered');
  });

  it('returns unchanged state when inputId not found', () => {
    const result = reduceInputReceived(stateWithPendingTurn, {
      inputId: 'unknown-id',
      providedBy: 'user',
      timestamp: '2025-01-01T00:01:00.000Z',
    });

    expect(result).toBe(stateWithPendingTurn);
  });

  it('returns unchanged state when turn is not input-required source', () => {
    const stateWithAgentTurn: Conversation = {
      turns: new Map([
        [
          'task-1',
          { source: 'agent', id: 'task-1', status: 'created', content: [], stream: '', events: [] },
        ],
      ]),
      turnOrder: ['task-1'],
    };

    const result = reduceInputReceived(stateWithAgentTurn, {
      inputId: 'task-1',
      providedBy: 'user',
      timestamp: '2025-01-01T00:01:00.000Z',
    });

    expect(result).toBe(stateWithAgentTurn);
  });
});
