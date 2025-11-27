import type { ConversationState } from '../types';

export const reduceContentComplete = (
  state: ConversationState,
  data: {
    taskId: string;
    content: string;
    timestamp: string;
  },
): ConversationState => {
  const updatedTasks = new Map(state.tasks);
  const task = updatedTasks.get(data.taskId);

  if (task) {
    updatedTasks.set(data.taskId, {
      ...task,
      content: [...task.content, data.content],
      stream: '',
    });
  }

  return {
    ...state,
    tasks: updatedTasks,
  };
};
