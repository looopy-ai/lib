import type { AuthEncryptionKey, AuthRequiredTurn, AuthType, Conversation } from '../types';

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

  return undefined;
};

const getInitialAuthStatus = (
  completedAt: string | undefined,
  toolResolution: { status: 'completed' | 'cancelled'; timestamp: string } | undefined,
): AuthRequiredTurn['status'] => {
  if (!completedAt && !toolResolution) {
    return 'pending';
  }

  if (!toolResolution) {
    return 'completed';
  }

  if (!completedAt) {
    return toolResolution.status;
  }

  return completedAt >= toolResolution.timestamp ? 'completed' : toolResolution.status;
};

export const reduceAuthRequired = (
  state: Conversation,
  data: {
    authId: string;
    toolCallId?: string;
    authType: AuthType;
    provider?: string;
    scopes?: string[];
    prompt: string;
    encryptionKey: AuthEncryptionKey;
    authorizationEndpoint?: string;
    clientId?: string;
    codeChallenge?: string;
    codeChallengeMethod?: 'S256';
    infoUrl?: string;
    metadata?: Record<string, unknown>;
    timestamp: string;
  },
): Conversation => {
  const linkedToolCallId = getLinkedToolCallId(data.toolCallId, data.metadata);
  const initialStatus = getInitialAuthStatus(
    state.authCompletedAtById?.get(data.authId),
    linkedToolCallId ? state.toolCallResolutionById?.get(linkedToolCallId) : undefined,
  );

  const turn: AuthRequiredTurn = {
    source: 'auth-required',
    id: data.authId,
    authId: data.authId,
    linkedToolCallId,
    authType: data.authType,
    provider: data.provider,
    scopes: data.scopes,
    prompt: data.prompt,
    encryptionKey: data.encryptionKey,
    authorizationEndpoint: data.authorizationEndpoint,
    clientId: data.clientId,
    codeChallenge: data.codeChallenge,
    codeChallengeMethod: data.codeChallengeMethod,
    infoUrl: data.infoUrl,
    status: initialStatus,
    timestamp: data.timestamp,
  };

  const turns = new Map(state.turns).set(data.authId, turn);
  const turnOrder = [...state.turnOrder, data.authId];

  return { ...state, turns, turnOrder };
};
