import type { ConversationState } from '../types';

export const reduceContentDelta = (
  state: ConversationState,
  data: {
    taskId: string;
    contentDelta: string;
    timestamp: string;
  },
): ConversationState => {
  const updatedTasks = new Map(state.tasks);
  const task = updatedTasks.get(data.taskId);

  if (task) {
    updatedTasks.set(data.taskId, {
      ...task,
      content: task.content + data.contentDelta,
    });
  }

  return {
    ...state,
    tasks: updatedTasks,
  };
};
