import type { Conversation, InputRequiredTurn, InputType } from '../types';

export const reduceInputRequired = (
  state: Conversation,
  data: {
    inputId: string;
    requireUser?: boolean;
    inputType: InputType;
    prompt: string;
    options?: unknown[];
    schema?: Record<string, unknown>;
    timestamp: string;
  },
): Conversation => {
  const turn: InputRequiredTurn = {
    source: 'input-required',
    id: data.inputId,
    inputId: data.inputId,
    requireUser: data.requireUser,
    inputType: data.inputType,
    prompt: data.prompt,
    options: data.options,
    schema: data.schema,
    status: 'pending',
    timestamp: data.timestamp,
  };

  const turns = new Map(state.turns).set(data.inputId, turn);
  const turnOrder = [...state.turnOrder, data.inputId];

  return { ...state, turns, turnOrder };
};
