import type { Conversation, InputRequiredTurn, InputType } from '../types';

const toRecord = (value: unknown): Record<string, unknown> | undefined => {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }

  return value as Record<string, unknown>;
};

const getLinkedToolCallId = (
  toolCallId: string | undefined,
  metadata: Record<string, unknown> | undefined,
): string | undefined => {
  if (toolCallId) {
    return toolCallId;
  }

  const metadataToolCallId = metadata?.toolCallId;
  if (typeof metadataToolCallId === 'string') {
    return metadataToolCallId;
  }

  const metadataToolCall = toRecord(metadata?.toolCall);
  const nestedToolCallId = metadataToolCall?.id;
  if (typeof nestedToolCallId === 'string') {
    return nestedToolCallId;
  }

  return undefined;
};

const getInitialInputStatus = (
  receivedAt: string | undefined,
  toolResolution: { status: 'completed' | 'cancelled'; timestamp: string } | undefined,
): InputRequiredTurn['status'] => {
  if (!receivedAt && !toolResolution) {
    return 'pending';
  }

  if (!toolResolution) {
    return 'answered';
  }

  if (!receivedAt) {
    return toolResolution.status;
  }

  return receivedAt >= toolResolution.timestamp ? 'answered' : toolResolution.status;
};

export const reduceInputRequired = (
  state: Conversation,
  data: {
    inputId: string;
    toolCallId?: string;
    requireUser?: boolean;
    inputType: InputType;
    prompt: string;
    options?: unknown[];
    schema?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
    timestamp: string;
  },
): Conversation => {
  const linkedToolCallId = getLinkedToolCallId(data.toolCallId, data.metadata);
  const initialStatus = getInitialInputStatus(
    state.inputReceivedAtById?.get(data.inputId),
    linkedToolCallId ? state.toolCallResolutionById?.get(linkedToolCallId) : undefined,
  );

  const turn: InputRequiredTurn = {
    source: 'input-required',
    id: data.inputId,
    inputId: data.inputId,
    linkedToolCallId,
    requireUser: data.requireUser,
    inputType: data.inputType,
    prompt: data.prompt,
    options: data.options,
    schema: data.schema,
    status: initialStatus,
    timestamp: data.timestamp,
  };

  const turns = new Map(state.turns).set(data.inputId, turn);
  const turnOrder = [...state.turnOrder, data.inputId];

  return { ...state, turns, turnOrder };
};
