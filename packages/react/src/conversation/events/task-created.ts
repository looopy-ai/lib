import type { ConversationState } from '../types';

export const reduceTaskCreated = (
  state: ConversationState,
  data: {
    taskId: string;
    initiator: string;
    timestamp: string;
    metadata: { historyLength: number };
  },
): ConversationState => {
  return {
    ...state,
    tasks: new Map(state.tasks).set(data.taskId, {
      id: data.taskId,
      status: 'created',
      content: [],
      stream: '',
      events: [],
    }),
    taskOrder: [...state.taskOrder, data.taskId],
    count: state.count + 1,
  };
};
