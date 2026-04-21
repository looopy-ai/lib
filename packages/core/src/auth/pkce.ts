/**
 * OAuth 2.0 Proof Key for Code Exchange (RFC 7636)
 */

import { createHash, randomBytes } from 'node:crypto';
import type { PKCEPair } from './types';

/**
 * Generate a PKCE code verifier (43-128 characters, unreserved characters only)
 */
export const generateCodeVerifier = (): string => {
  return randomBytes(32).toString('base64url');
};

/**
 * Generate PKCE code challenge from verifier using SHA256
 */
export const generateCodeChallenge = (verifier: string): string => {
  return createHash('sha256').update(verifier).digest('base64url');
};

/**
 * Generate both code verifier and challenge
 */
export const generatePKCEPair = (): PKCEPair => {
  const codeVerifier = generateCodeVerifier();
  return {
    codeVerifier,
    codeChallenge: generateCodeChallenge(codeVerifier),
    algorithm: 'S256',
  };
};

/**
 * Validate that a challenge matches a verifier
 */
export const validateCodeChallenge = (verifier: string, challenge: string): boolean => {
  return generateCodeChallenge(verifier) === challenge;
};
