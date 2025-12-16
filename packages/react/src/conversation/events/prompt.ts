import type { Conversation } from '../types';

export const reducePrompt = (
  state: Conversation,
  data: {
    promptId: string;
    content: string;
    timestamp: string;
    metadata: { historyLength: number };
  },
): Conversation => {
  const turns = new Map(state.turns).set(data.promptId, {
    source: 'client',
    id: data.promptId,
    prompt: data.content,
  });

  const turnOrder = [...state.turnOrder, data.promptId];

  return {
    ...state,
    turns,
    turnOrder,
  };
};
