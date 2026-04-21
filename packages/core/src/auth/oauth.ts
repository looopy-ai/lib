/**
 * OAuth 2.0 utilities for PKCE flows
 */

import { randomUUID } from 'node:crypto';
import { generatePKCEPair } from './pkce';

interface OAuth2AuthUrlOptionsBase {
  clientId: string;
  redirectUri: string;
  scopes?: string[];
  state?: string;
  codeChallenge: string;
  authorizationEndpoint: string;
  prompt?: string; // e.g., 'consent', 'login'
}

export type OAuth2AuthUrlOptions = OAuth2AuthUrlOptionsBase;

/**
 * Build an OAuth 2.0 authorization URL with PKCE
 */
export const buildOAuth2AuthUrl = (options: OAuth2AuthUrlOptions): string => {
  const params = new URLSearchParams({
    client_id: options.clientId,
    redirect_uri: options.redirectUri,
    response_type: 'code',
    code_challenge: options.codeChallenge,
    code_challenge_method: 'S256',
    state: options.state || randomUUID(),
  });

  if (options.scopes?.length) {
    params.set('scope', options.scopes.join(' '));
  }

  if (options.prompt) {
    params.set('prompt', options.prompt);
  }

  return `${options.authorizationEndpoint}?${params.toString()}`;
};

/**
 * Generate an OAuth 2.0 authorization request with PKCE
 */
export const generateOAuth2Request = (options: Omit<OAuth2AuthUrlOptions, 'codeChallenge'>) => {
  const pkce = generatePKCEPair();
  const authUrl = buildOAuth2AuthUrl({
    ...options,
    codeChallenge: pkce.codeChallenge,
  });

  return {
    pkce,
    authUrl,
  };
};

/**
 * Extract authorization code from OAuth callback URL
 */
export const extractAuthorizationCode = (
  callbackUrl: string,
): { code: string; state: string } | null => {
  try {
    const url = new URL(callbackUrl);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');

    if (!code || !state) {
      return null;
    }

    return { code, state };
  } catch {
    return null;
  }
};

/**
 * Build a token exchange request for OAuth 2.0 code
 */
export const buildTokenExchangeRequest = (options: {
  code: string;
  codeVerifier: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): Record<string, string> => {
  return {
    grant_type: 'authorization_code',
    code: options.code,
    client_id: options.clientId,
    client_secret: options.clientSecret,
    code_verifier: options.codeVerifier,
    redirect_uri: options.redirectUri,
  };
};
