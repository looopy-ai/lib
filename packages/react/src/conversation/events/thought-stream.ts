import type { Conversation } from '../types';

export const reduceThoughtStream = (
  state: Conversation,
  data: {
    taskId: string;
    thoughtId: string;
    thoughtType: string;
    content: string;
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
    events: [
      ...turn.events,
      {
        type: 'thought',
        id: data.thoughtId,
        thoughtType: data.thoughtType,
        content: data.content,
        timestamp: data.timestamp,
      },
    ],
  });

  return {
    ...state,
    turns: updatedTurns,
  };
};
