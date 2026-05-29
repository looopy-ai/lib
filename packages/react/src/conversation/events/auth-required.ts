import type { AuthEncryptionKey, AuthRequiredTurn, AuthType, Conversation } from '../types';

export const reduceAuthRequired = (
  state: Conversation,
  data: {
    authId: string;
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
    timestamp: string;
  },
): Conversation => {
  const turn: AuthRequiredTurn = {
    source: 'auth-required',
    id: data.authId,
    authId: data.authId,
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
    status: 'pending',
    timestamp: data.timestamp,
  };

  const turns = new Map(state.turns).set(data.authId, turn);
  const turnOrder = [...state.turnOrder, data.authId];

  return { ...state, turns, turnOrder };
};
