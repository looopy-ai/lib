import type { ConversationState } from '../types';

export const reduceTaskStatus = (
  state: ConversationState,
  data: {
    taskId: string;
    status: string;
    timestamp: string;
  },
): ConversationState => {
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
