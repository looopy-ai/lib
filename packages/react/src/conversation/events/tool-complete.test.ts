import { describe, expect, it } from 'vitest';
import { reduceInputRequired } from '../../conversation/events/input-required';
import { reduceToolComplete } from '../../conversation/events/tool-complete';
import type { Conversation } from '../../conversation/types';

const emptyState: Conversation = { turns: new Map(), turnOrder: [] };

const baseState: Conversation = {
  turns: new Map([
    [
      'task-1',
      {
        source: 'agent',
        id: 'task-1',
        status: 'working',
        content: [],
        stream: '',
        events: [
          {
            type: 'tool-call',
            id: 'tool-call-1',
            toolName: 'lookup',
            status: 'started',
            arguments: {},
            timestamp: '2025-01-01T00:00:00.000Z',
          },
        ],
      },
    ],
    [
      'input-1',
      {
        source: 'input-required',
        id: 'input-1',
        inputId: 'input-1',
        linkedToolCallId: 'tool-call-1',
        inputType: 'confirmation',
        prompt: 'Proceed?',
        status: 'pending',
        timestamp: '2025-01-01T00:00:00.000Z',
      },
    ],
    [
      'auth-1',
      {
        source: 'auth-required',
        id: 'auth-1',
        authId: 'auth-1',
        linkedToolCallId: 'tool-call-2',
        authType: 'api-key',
        prompt: 'Provide API key',
        encryptionKey: {
          kty: 'EC',
          crv: 'P-256',
          x: 'x',
          y: 'y',
          kid: 'kid',
        },
        status: 'pending',
        timestamp: '2025-01-01T00:00:00.000Z',
      },
    ],
  ]),
  turnOrder: ['task-1', 'input-1', 'auth-1'],
};

describe('reduceToolComplete', () => {
  it('updates matching tool-call event with completed result', () => {
    const result = reduceToolComplete(baseState, {
      taskId: 'task-1',
      toolCallId: 'tool-call-1',
      toolName: 'lookup',
      success: true,
      result: { ok: true },
      timestamp: '2025-01-01T00:01:00.000Z',
    });

    const taskTurn = result.turns.get('task-1');
    if (!taskTurn || taskTurn.source !== 'agent') return;
    const toolEvent = taskTurn.events[0];
    if (!toolEvent || toolEvent.type !== 'tool-call') return;

    expect(toolEvent.status).toBe('completed');
    expect(toolEvent.success).toBe(true);
    expect(toolEvent.result).toEqual({ ok: true });
  });

  it('marks linked input-required turn as completed when tool completes', () => {
    const result = reduceToolComplete(baseState, {
      taskId: 'task-1',
      toolCallId: 'tool-call-1',
      toolName: 'lookup',
      success: true,
      result: { ok: true },
      timestamp: '2025-01-01T00:01:00.000Z',
    });

    const inputTurn = result.turns.get('input-1');
    if (!inputTurn || inputTurn.source !== 'input-required') return;
    expect(inputTurn.status).toBe('completed');
  });

  it('marks linked auth-required turn as cancelled when tool is cancelled', () => {
    const stateWithCompletedAuth: Conversation = {
      ...baseState,
      turns: new Map(baseState.turns).set('auth-1', {
        ...(baseState.turns.get('auth-1') as Extract<
          Conversation['turns'] extends Map<string, infer T> ? T : never,
          { source: 'auth-required' }
        >),
        status: 'completed',
      }),
    };

    const result = reduceToolComplete(stateWithCompletedAuth, {
      taskId: 'task-1',
      toolCallId: 'tool-call-2',
      toolName: 'lookup-auth',
      success: false,
      error: 'Cancelled: user provided new input',
      timestamp: '2025-01-01T00:01:00.000Z',
    });

    const authTurn = result.turns.get('auth-1');
    if (!authTurn || authTurn.source !== 'auth-required') return;
    expect(authTurn.status).toBe('cancelled');
  });

  it('does not change unrelated turns', () => {
    const result = reduceToolComplete(baseState, {
      taskId: 'task-1',
      toolCallId: 'unknown-call',
      toolName: 'lookup',
      success: true,
      result: { ok: true },
      timestamp: '2025-01-01T00:01:00.000Z',
    });

    const inputTurn = result.turns.get('input-1');
    if (!inputTurn || inputTurn.source !== 'input-required') return;
    expect(inputTurn.status).toBe('pending');
  });

  it('cancels linked auth-required turn when tool-complete arrives before task turn exists', () => {
    const stateWithoutAgentTurn: Conversation = {
      turns: new Map([
        [
          'auth-1',
          {
            source: 'auth-required',
            id: 'auth-1',
            authId: 'auth-1',
            linkedToolCallId: 'tool-call-2',
            authType: 'api-key',
            prompt: 'Provide API key',
            encryptionKey: {
              kty: 'EC',
              crv: 'P-256',
              x: 'x',
              y: 'y',
              kid: 'kid',
            },
            status: 'completed',
            timestamp: '2025-01-01T00:00:00.000Z',
          },
        ],
      ]),
      turnOrder: ['auth-1'],
    };

    const result = reduceToolComplete(stateWithoutAgentTurn, {
      taskId: 'missing-task',
      toolCallId: 'tool-call-2',
      toolName: 'lookup-auth',
      success: false,
      error: 'Cancelled: user provided new input',
      timestamp: '2025-01-01T00:01:00.000Z',
    });

    const authTurn = result.turns.get('auth-1');
    if (!authTurn || authTurn.source !== 'auth-required') return;
    expect(authTurn.status).toBe('cancelled');
  });

  it('applies earlier tool completion when input-required arrives later', () => {
    const stateAfterToolComplete = reduceToolComplete(emptyState, {
      taskId: 'missing-task',
      toolCallId: 'tool-call-input-late',
      toolName: 'lookup',
      success: true,
      result: { ok: true },
      timestamp: '2025-01-01T00:00:30.000Z',
    });

    const result = reduceInputRequired(stateAfterToolComplete, {
      inputId: 'input-late-from-tool',
      toolCallId: 'tool-call-input-late',
      inputType: 'confirmation',
      prompt: 'Proceed?',
      timestamp: '2025-01-01T00:01:00.000Z',
    });

    const inputTurn = result.turns.get('input-late-from-tool');
    if (!inputTurn || inputTurn.source !== 'input-required') return;
    expect(inputTurn.status).toBe('completed');
  });
});
