/**
 * Cryptographic utilities for ECDH key generation and management
 */

import { createPublicKey, generateKeyPairSync, randomUUID } from 'node:crypto';
import type { ECDHKeyPair, EncryptionKey } from './types';

/**
 * Generate an ephemeral ECDH P-256 key pair
 * Private key is in PKCS8 PEM format and should never be emitted in events
 * Public key is exported as JWK for inclusion in auth events
 */
export const generateECDHKeyPair = (): ECDHKeyPair => {
  const keyId = randomUUID();

  const { publicKey, privateKey } = generateKeyPairSync('ec', {
    namedCurve: 'prime256v1', // P-256
    publicKeyEncoding: {
      type: 'spki',
      format: 'der',
    },
    privateKeyEncoding: {
      type: 'pkcs8',
      format: 'pem',
    },
  });

  // Export the generated SPKI public key as JWK for clients.
  const publicKeyJwk = derToJwk(publicKey as Buffer);

  const expiresAt = new Date();
  expiresAt.setMinutes(expiresAt.getMinutes() + 15); // 15-minute ephemeral key lifetime

  return {
    keyId,
    publicKey: {
      ...publicKeyJwk,
      kid: keyId,
      alg: 'ECDH-ES',
    },
    privateKeyPem: privateKey,
    expiresAt,
  };
};

/**
 * Convert DER-encoded SPKI public key to JWK format.
 */
const derToJwk = (publicKeyDer: Buffer): Omit<EncryptionKey, 'kid' | 'alg'> => {
  const publicKey = createPublicKey({
    key: publicKeyDer,
    format: 'der',
    type: 'spki',
  });
  const jwk = publicKey.export({ format: 'jwk' });

  if (jwk.kty !== 'EC' || jwk.crv !== 'P-256' || !jwk.x || !jwk.y) {
    throw new Error('Invalid P-256 public key format');
  }

  return {
    kty: jwk.kty,
    crv: jwk.crv,
    x: jwk.x,
    y: jwk.y,
  };
};

/**
 * Check if a key pair has expired
 */
export const isKeyExpired = (keyPair: ECDHKeyPair): boolean => {
  return new Date() >= keyPair.expiresAt;
};
