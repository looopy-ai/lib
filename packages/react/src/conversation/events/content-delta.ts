import type { ConversationState } from '../types';

export const reduceContentDelta = (
  state: ConversationState,
  data: {
    taskId: string;
    delta: string;
    timestamp: string;
  },
): ConversationState => {
  const updatedTasks = new Map(state.tasks);
  const task = updatedTasks.get(data.taskId);

  if (task) {
    updatedTasks.set(data.taskId, {
      ...task,
      content: task.content + (data.delta || ''),
    });
  }

  return {
    ...state,
    tasks: updatedTasks,
  };
};
