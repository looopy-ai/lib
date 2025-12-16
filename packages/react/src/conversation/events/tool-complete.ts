import type { Conversation, ToolCall } from '../types';

export const reduceToolComplete = (
  state: Conversation,
  data: {
    taskId: string;
    toolCallId: string;
    toolName: string;
    success: boolean;
    result: Record<string, unknown>;
    timestamp: string;
  },
): Conversation => {
  const updatedTurns = new Map(state.turns);
  const turn = updatedTurns.get(data.taskId);

  if (!turn || turn.source !== 'agent') {
    return state;
  }

  const existingEventIndex = turn.events.findIndex(
    (e) => e.type === 'tool-call' && e.id === data.toolCallId,
  );
  if (existingEventIndex !== -1) {
    const toolCall = turn.events[existingEventIndex] as ToolCall;
    if (toolCall) {
      const updatedEvents = [...turn.events];
      updatedEvents[existingEventIndex] = {
        ...toolCall,
        status: 'completed',
        result: data.result,
      };
      updatedTurns.set(data.taskId, { ...turn, events: updatedEvents });
    }
  }

  return {
    ...state,
    turns: updatedTurns,
  };
};
