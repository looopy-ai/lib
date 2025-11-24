import type { ConversationState } from '../types';

export const reduceToolStart = (
  state: ConversationState,
  data: {
    taskId: string;
    toolCallId: string;
    toolName: string;
    arguments: Record<string, unknown>;
    timestamp: string;
  },
): ConversationState => {
  const updatedTasks = new Map(state.tasks);
  const task = updatedTasks.get(data.taskId);
  if (task) {
    updatedTasks.set(data.taskId, {
      ...task,
      events: [
        ...task.events,
        {
          type: 'tool-call',
          id: data.toolCallId,
          status: 'started',
          toolName: data.toolName,
          arguments: data.arguments,
          timestamp: data.timestamp,
        },
      ],
    });
  }
  return {
    ...state,
    tasks: updatedTasks,
  };
};
