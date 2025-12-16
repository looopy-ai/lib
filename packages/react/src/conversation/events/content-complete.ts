import type { Conversation } from '../types';

export const reduceContentComplete = (
  state: Conversation,
  data: {
    taskId: string;
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
    content: [...turn.content, data.content],
    events: [
      ...turn.events,
      {
        type: 'content',
        id: `${data.taskId}-content-${turn.events.length + 1}`,
        content: data.content,
        timestamp: data.timestamp,
      },
    ],
    stream: '',
  });

  return {
    ...state,
    turns: updatedTurns,
  };
};
