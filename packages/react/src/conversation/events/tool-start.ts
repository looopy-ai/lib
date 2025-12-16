import type { Conversation } from '../types';

export const reduceToolStart = (
  state: Conversation,
  data: {
    taskId: string;
    toolCallId: string;
    toolName: string;
    icon?: string;
    arguments: Record<string, unknown>;
    timestamp: string;
  },
): Conversation => {
  const updatedTurns = new Map(state.turns);
  const turn = updatedTurns.get(data.taskId);

  if (!turn || turn.source !== 'agent') {
    return state;
  }

  updatedTurns.set(data.taskId, {
    ...turn,
    events: [
      ...turn.events,
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

  return {
    ...state,
    turns: updatedTurns,
  };
};
