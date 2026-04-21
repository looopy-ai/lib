/**
 * Secure Credential Handoff Utilities
 *
 * This module provides helpers for agents, tools, and clients to implement
 * the secure credential handoff protocol using JWE encryption and PKCE OAuth flows.
 *
 * **Dependencies:**
 * - jose: `pnpm add jose` (for JWE encryption/decryption)
 *
 * **Usage:**
 *
 * ### Agent-side (emitting auth-required):
 * ```typescript
 * import { generateECDHKeyPair, generatePKCEPair } from '@looopy-ai/core/auth';
 *
 * const { publicKey, privateKeyPem, keyId } = generateECDHKeyPair();
 * const { codeChallenge, codeVerifier } = generatePKCEPair();
 *
 * // Store verifier and privateKeyPem in memory (never emit)
 * // Include publicKey in auth-required event
 * ```
 *
 * ### Client-side (encrypting and submitting):
 * ```typescript
 * import { encryptCredential, createJWEClaims } from '@looopy-ai/core/auth';
 *
 * const claims = createJWEClaims({
 *   authId: event.authId,
 *   contextId: currentContext,
 *   expiresInSeconds: 300, // 5 minutes
 * });
 *
 * const jwe = await encryptCredential(userSecret, event.encryptionKey, claims);
 *
 * // Submit JWE to agent via startTurn()
 * ```
 *
 * ### Agent-side (decrypting on receipt):
 * ```typescript
 * import { decryptCredential } from '@looopy-ai/core/auth';
 *
 * const credential = await decryptCredential(
 *   jwe,
 *   privateKeyPem,
 *   { authId, contextId }
 * );
 * ```
 */

export * from './claims';
export * from './crypto';
export * from './jwe';
export * from './oauth';
export * from './pkce';
export * from './types';
