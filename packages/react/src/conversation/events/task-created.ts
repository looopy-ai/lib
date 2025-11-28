import type { Tasks } from '../types';

export const reduceTaskCreated = (
  state: Tasks,
  data: {
    taskId: string;
    parentTaskId?: string;
    initiator: string;
    timestamp: string;
    metadata: { historyLength: number };
  },
): Tasks => {
  const tasks = new Map(state.tasks).set(data.taskId, {
    id: data.taskId,
    status: 'created',
    content: [],
    stream: '',
    events: [],
  });

  const taskOrder = !data.parentTaskId ? [...state.taskOrder, data.taskId] : state.taskOrder;

  if (data.parentTaskId) {
    const parentTask = tasks.get(data.parentTaskId);
    if (parentTask) {
      tasks.set(data.parentTaskId, {
        ...parentTask,
        events: [
          ...parentTask.events,
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
    tasks,
    taskOrder,
  };
};
