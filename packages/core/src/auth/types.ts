/**
 * Secure credential handoff types
 */

export interface EncryptionKey {
  kty: string; // 'EC'
  crv: string; // 'P-256'
  x: string; // Base64url-encoded X coordinate
  y: string; // Base64url-encoded Y coordinate
  kid: string; // Key ID for rotation tracking
  alg?: string; // 'ECDH-ES'
}

export interface PKCEPair {
  codeVerifier: string;
  codeChallenge: string;
  algorithm: 'S256';
}

export interface ECDHKeyPair {
  keyId: string;
  publicKey: EncryptionKey;
  privateKeyPem: string; // PKCS8 PEM format, never emit
  expiresAt: Date;
}

export interface JWEClaims {
  authId: string;
  contextId: string;
  agentId?: string;
  iat: number; // Issued at
  exp: number; // Expires at
  [key: string]: unknown;
}

export interface CredentialSubmission {
  authId: string;
  credential: string; // JWE compact serialization
  submittedAt: string; // ISO 8601
}

export interface OAuthCodeExchange {
  code: string;
  codeVerifier: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  provider: string;
}
