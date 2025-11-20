import type { ConversationState } from '../types';

export const reduceTaskComplete = (
  state: ConversationState,
  data: {
    taskId: string;
    timestamp: string;
  },
): ConversationState => {
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
