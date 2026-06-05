import type { Conversation, ToolCall } from '../types';

const isCancellationError = (error: unknown): boolean => {
  if (typeof error !== 'string') {
    return false;
  }

  return /\bcancel(?:led|ed)?\b/i.test(error);
};

export const reduceToolComplete = (
  state: Conversation,
  data: {
    taskId: string;
    toolCallId: string;
    toolName: string;
    success: boolean;
    result?: unknown;
    error?: string;
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
        success: data.success,
        result: data.result,
      };
      updatedTurns.set(data.taskId, { ...turn, events: updatedEvents });
    }
  }

  const resolvedStatus = isCancellationError(data.error)
    ? ('cancelled' as const)
    : ('completed' as const);

  const inputAndAuthTurns = Array.from(updatedTurns.entries()).filter(([, currentTurn]) => {
    if (currentTurn.source === 'input-required') {
      return currentTurn.linkedToolCallId === data.toolCallId && currentTurn.status === 'pending';
    }

    if (currentTurn.source === 'auth-required') {
      return (
        currentTurn.linkedToolCallId === data.toolCallId &&
        (currentTurn.status === 'pending' || currentTurn.status === 'completed')
      );
    }

    return false;
  });

  for (const [turnId, currentTurn] of inputAndAuthTurns) {
    updatedTurns.set(turnId, { ...currentTurn, status: resolvedStatus });
  }

  return {
    ...state,
    turns: updatedTurns,
  };
};
