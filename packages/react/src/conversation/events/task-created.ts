import type { Conversation } from '../types';

export const reduceTaskCreated = (
  state: Conversation,
  data: {
    taskId: string;
    parentTaskId?: string;
    initiator: string;
    timestamp: string;
    metadata: { historyLength: number };
  },
): Conversation => {
  const turns = new Map(state.turns).set(data.taskId, {
    source: 'agent',
    id: data.taskId,
    status: 'created',
    content: [],
    stream: '',
    events: [],
  });

  const turnOrder = !data.parentTaskId ? [...state.turnOrder, data.taskId] : state.turnOrder;

  if (data.parentTaskId) {
    const parentTurn = turns.get(data.parentTaskId);

    if (!parentTurn || parentTurn.source !== 'agent') {
      return {
        ...state,
        turns,
        turnOrder,
      };
    }

    if (parentTurn) {
      turns.set(data.parentTaskId, {
        ...parentTurn,
        events: [
          ...parentTurn.events,
          {
            type: 'sub-task',
            id: data.taskId,
            timestamp: data.timestamp,
          },
        ],
      });
    }
  }

  return {
    ...state,
    turns,
    turnOrder,
  };
};
