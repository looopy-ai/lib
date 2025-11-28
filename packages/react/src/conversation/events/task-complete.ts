import type { Tasks } from '../types';

export const reduceTaskComplete = (
  state: Tasks,
  data: {
    taskId: string;
    timestamp: string;
  },
): Tasks => {
  const updatedTasks = new Map(state.tasks);
  const task = updatedTasks.get(data.taskId);

  if (task) {
    updatedTasks.set(data.taskId, {
      ...task,
      status: 'completed',
    });
  }

  return {
    ...state,
    tasks: updatedTasks,
  };
};
