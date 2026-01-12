import type { Conversation } from '../types';

export const reducePromptError = (
  state: Conversation,
  data: {
    promptId: string;
    error: string;
    timestamp: string;
  },
): Conversation => {
  const updatedTurns = new Map(state.turns);
  const turn = updatedTurns.get(data.promptId);

  if (!turn || turn.source !== 'client') {
    return state;
  }

  updatedTurns.set(data.promptId, {
    ...turn,
    error: data.error,
  });

  return {
    ...state,
    turns: updatedTurns,
  };
};
