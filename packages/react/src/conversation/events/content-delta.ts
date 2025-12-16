import type { Conversation } from '../types';

export const reduceContentDelta = (
  state: Conversation,
  data: {
    taskId: string;
    delta: string;
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
    stream: turn.stream + (data.delta || ''),
  });

  return {
    ...state,
    turns: updatedTurns,
  };
};
