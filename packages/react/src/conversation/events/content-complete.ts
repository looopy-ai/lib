import type { Tasks } from '../types';

export const reduceContentComplete = (
  state: Tasks,
  data: {
    taskId: string;
    content: string;
    timestamp: string;
  },
): Tasks => {
  const updatedTasks = new Map(state.tasks);
  const task = updatedTasks.get(data.taskId);

  if (task) {
    updatedTasks.set(data.taskId, {
      ...task,
      content: [...task.content, data.content],
      events: [
        ...task.events,
        {
          type: 'content',
          id: `${data.taskId}-content-${task.events.length + 1}`,
          content: data.content,
          timestamp: data.timestamp,
        },
      ],
      stream: '',
    });
  }

  return {
    ...state,
    tasks: updatedTasks,
  };
};
