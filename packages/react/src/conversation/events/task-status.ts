import type { ConversationState } from '../types';

export const reduceTaskStatus = (
  state: ConversationState,
  data: {
    taskId: string;
    status: string;
    content: string;
    timestamp: string;
  },
): ConversationState => {
  const updatedTasks = new Map(state.tasks);
  const task = updatedTasks.get(data.taskId);

  if (task) {
    updatedTasks.set(data.taskId, {
      ...task,
      status: data.status,
      content: data.content || task.content,
    });
  }

  return {
    ...state,
    tasks: updatedTasks,
  };
};
