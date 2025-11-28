import type { Tasks } from '../types';

export const reduceThoughtStream = (
  state: Tasks,
  data: {
    taskId: string;
    thoughtId: string;
    thoughtType: string;
    content: string;
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
          type: 'thought',
          id: data.thoughtId,
          thoughtType: data.thoughtType,
          content: data.content,
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
