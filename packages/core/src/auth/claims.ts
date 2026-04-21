/**
 * Utilities for binding and validating JWE claims
 */

import type { JWEClaims } from './types';

/**
 * Create JWE binding claims for a credential request
 */
export const createJWEClaims = (options: {
  authId: string;
  contextId: string;
  agentId?: string;
  expiresInSeconds?: number;
}): JWEClaims => {
  const now = Math.floor(Date.now() / 1000);
  const expiresInSeconds = options.expiresInSeconds ?? 3600; // 1 hour default

  return {
    authId: options.authId,
    contextId: options.contextId,
    agentId: options.agentId,
    iat: now,
    exp: now + expiresInSeconds,
  };
};

/**
 * Check if JWE claims have expired
 */
export const hasExpired = (claims: JWEClaims): boolean => {
  const now = Math.floor(Date.now() / 1000);
  return claims.exp <= now;
};

/**
 * Get time remaining until JWE claims expire (in seconds)
 */
export const getTimeRemaining = (claims: JWEClaims): number => {
  const now = Math.floor(Date.now() / 1000);
  return Math.max(0, claims.exp - now);
};

/**
 * Validate JWE claims are not expired and match expected values
 */
export const validateClaims = (claims: JWEClaims, expected: Partial<JWEClaims>): void => {
  const now = Math.floor(Date.now() / 1000);

  // Check expiration with 5-second skew tolerance
  if (claims.exp < now - 5) {
    throw new Error(`JWE claims expired at ${new Date(claims.exp * 1000).toISOString()}`);
  }

  // Check issued-at time (not too far in future)
  if (claims.iat > now + 60) {
    throw new Error('JWE claims issued in the future');
  }

  // Validate expected claims match
  if (expected.authId && claims.authId !== expected.authId) {
    throw new Error(`Auth ID mismatch: expected ${expected.authId}, got ${claims.authId}`);
  }

  if (expected.contextId && claims.contextId !== expected.contextId) {
    throw new Error(`Context ID mismatch: expected ${expected.contextId}, got ${claims.contextId}`);
  }

  if (expected.agentId && claims.agentId !== expected.agentId) {
    throw new Error(`Agent ID mismatch: expected ${expected.agentId}, got ${claims.agentId}`);
  }
};
