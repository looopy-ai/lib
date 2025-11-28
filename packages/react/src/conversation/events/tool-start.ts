import type { Tasks } from '../types';

export const reduceToolStart = (
  state: Tasks,
  data: {
    taskId: string;
    toolCallId: string;
    toolName: string;
    icon?: string;
    arguments: Record<string, unknown>;
    timestamp: string;
  },
): Tasks => {
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
          icon: data.icon,
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
