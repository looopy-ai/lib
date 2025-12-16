import type { Conversation } from '../types';

export const reduceTaskStatus = (
  state: Conversation,
  data: {
    taskId: string;
    status: string;
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
    status: data.status,
  });

  return {
    ...state,
    turns: updatedTurns,
  };
};
