import type { ConversationState, ToolCall } from '../types';

export const reduceToolComplete = (
  state: ConversationState,
  data: {
    taskId: string;
    toolId: string;
    toolName: string;
    success: boolean;
    result: Record<string, unknown>;
    timestamp: string;
  },
): ConversationState => {
  const updatedTasks = new Map(state.tasks);
  const task = updatedTasks.get(data.taskId);
  if (task) {
    const existingEventIndex = task.events.findIndex(
      (e) => e.type === 'tool-call' && e.id === data.toolId,
    );
    if (existingEventIndex !== -1) {
      const toolCall = task.events[existingEventIndex] as ToolCall;
      if (toolCall) {
        const updatedEvents = [...task.events];
        updatedEvents[existingEventIndex] = {
          ...toolCall,
          status: 'completed',
          result: data.result,
        };
        updatedTasks.set(data.taskId, { ...task, events: updatedEvents });
      }
    }
  }
  return {
    ...state,
    tasks: updatedTasks,
  };
};
