/**
 * JSON Web Encryption (JWE) for credential encryption
 *
 * Uses ECDH-ES direct key agreement with A256GCM content encryption.
 * Requires jose library: pnpm add jose
 */

import type { EncryptionKey, JWEClaims } from './types';

/**
 * Encrypt a credential (plaintext secret) to a public key using ECDH-ES + A256GCM
 *
 * @param credential - The plaintext credential (API key, password, etc.)
 * @param publicKey - The recipient's public key (JWK format)
 * @param claims - Binding claims (authId, contextId, etc.) to prevent replay attacks
 * @returns JWE compact serialization
 */
export const encryptCredential = async (
  credential: string,
  publicKey: EncryptionKey,
  claims: JWEClaims,
): Promise<string> => {
  const { importJWK, CompactEncrypt } = await import('jose');

  // Import public key from JWK
  const keyLike = await importJWK(publicKey, publicKey.alg);

  // Build protected header with binding claims
  const encoder = new TextEncoder();
  const protectedHeader = {
    alg: 'ECDH-ES',
    enc: 'A256GCM',
    kid: publicKey.kid,
    ...claims, // Include claims in protected header for integrity
  };

  // Create JWE
  const jwe = new CompactEncrypt(encoder.encode(credential))
    .setProtectedHeader(protectedHeader)
    .encrypt(keyLike);

  return (await jwe).toString();
};

/**
 * Decrypt a JWE credential using a private key
 *
 * @param jwe - JWE compact serialization
 * @param privateKeyPem - Private key in PKCS8 PEM format
 * @param expectedClaims - Expected claims (authId, contextId, etc.) to validate
 * @returns Decrypted credential plaintext
 */
export const decryptCredential = async (
  jwe: string,
  privateKeyPem: string,
  expectedClaims: Partial<JWEClaims>,
): Promise<string> => {
  const { importPKCS8, compactDecrypt } = await import('jose');

  // Import private key from PEM
  const keyLike = await importPKCS8(privateKeyPem, 'ECDH-ES');

  // Decrypt JWE
  const { plaintext, protectedHeader } = await compactDecrypt(jwe, keyLike);

  // Validate claims in protected header
  validateJWEClaims(protectedHeader as unknown as JWEClaims, expectedClaims);

  const decoder = new TextDecoder();
  return decoder.decode(plaintext);
};

/**
 * Validate JWE claims to prevent replay attacks
 *
 * @param claims - Claims from the JWE protected header
 * @param expected - Expected claim values to match
 */
export const validateJWEClaims = (claims: JWEClaims, expected: Partial<JWEClaims>): void => {
  const now = Math.floor(Date.now() / 1000);

  // Check expiration
  if (claims.exp && claims.exp <= now) {
    throw new Error('JWE credential has expired');
  }

  // Check issued-at time (not too far in future)
  if (claims.iat && claims.iat > now + 60) {
    throw new Error('JWE credential issued in the future (clock skew?)');
  }

  // Validate expected claims match
  if (expected.authId && claims.authId !== expected.authId) {
    throw new Error(`Auth ID mismatch: expected ${expected.authId}, got ${claims.authId}`);
  }

  if (expected.contextId && claims.contextId !== expected.contextId) {
    throw new Error(`Context ID mismatch: expected ${expected.contextId}, got ${claims.contextId}`);
  }

  if (expected.agentId && claims.agentId && claims.agentId !== expected.agentId) {
    throw new Error(`Agent ID mismatch: expected ${expected.agentId}, got ${claims.agentId}`);
  }
};
