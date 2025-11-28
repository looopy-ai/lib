import type { Tasks } from '../types';

export const reduceTaskStatus = (
  state: Tasks,
  data: {
    taskId: string;
    status: string;
    timestamp: string;
  },
): Tasks => {
  const updatedTasks = new Map(state.tasks);
  const task = updatedTasks.get(data.taskId);

  if (task) {
    updatedTasks.set(data.taskId, {
      ...task,
      status: data.status,
    });
  }

  return {
    ...state,
    tasks: updatedTasks,
  };
};
