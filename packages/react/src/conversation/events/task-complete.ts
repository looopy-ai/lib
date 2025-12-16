import type { Conversation } from '../types';

export const reduceTaskComplete = (
  state: Conversation,
  data: {
    taskId: string;
    timestamp: string;
  },
): Conversation => {
  const updatedTurns = new Map(state.turns);
  const turn = updatedTurns.get(data.taskId);

  if (!turn || turn.source !== 'agent') {
    return state;
  }

  updatedTurns.set(data.taskId, {
    ...turn,
    status: 'completed',
  });

  return {
    ...state,
    turns: updatedTurns,
  };
};
