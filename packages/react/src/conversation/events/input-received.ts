import type { Conversation } from '../types';

export const reduceInputReceived = (
  state: Conversation,
  data: {
    inputId: string;
    providedBy: string;
    timestamp: string;
  },
): Conversation => {
  const updatedTurns = new Map(state.turns);
  const turn = updatedTurns.get(data.inputId);
  const inputReceivedAtById = new Map(state.inputReceivedAtById);
  inputReceivedAtById.set(data.inputId, data.timestamp);

  if (!turn || turn.source !== 'input-required') {
    return {
      ...state,
      inputReceivedAtById,
    };
  }

  updatedTurns.set(data.inputId, { ...turn, status: 'answered' });

  return {
    ...state,
    turns: updatedTurns,
    inputReceivedAtById,
  };
};
