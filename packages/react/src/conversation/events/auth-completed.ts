import type { Conversation } from '../types';

export const reduceAuthCompleted = (
  state: Conversation,
  data: {
    authId: string;
    userId: string;
    timestamp: string;
  },
): Conversation => {
  const updatedTurns = new Map(state.turns);
  const turn = updatedTurns.get(data.authId);

  if (!turn || turn.source !== 'auth-required') {
    return state;
  }

  updatedTurns.set(data.authId, { ...turn, status: 'completed' });

  return { ...state, turns: updatedTurns };
};
