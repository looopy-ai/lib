import { describe, expect, it } from 'vitest';
import { generateECDHKeyPair, isKeyExpired } from '../src/auth/crypto';

describe('ECDH key generation', () => {
  describe('generateECDHKeyPair', () => {
    it('should generate a valid ECDH key pair', () => {
      const keyPair = generateECDHKeyPair();
      expect(keyPair).toHaveProperty('keyId');
      expect(keyPair).toHaveProperty('publicKey');
      expect(keyPair).toHaveProperty('privateKeyPem');
      expect(keyPair).toHaveProperty('expiresAt');
    });

    it('should generate unique key IDs', () => {
      const keyPair1 = generateECDHKeyPair();
      const keyPair2 = generateECDHKeyPair();
      expect(keyPair1.keyId).not.toBe(keyPair2.keyId);
    });

    it('should generate valid P-256 public keys', () => {
      const keyPair = generateECDHKeyPair();
      const publicKey = keyPair.publicKey;
      expect(publicKey.kty).toBe('EC');
      expect(publicKey.crv).toBe('P-256');
      expect(publicKey.kid).toBe(keyPair.keyId);
      expect(publicKey.alg).toBe('ECDH-ES');
    });

    it('should have base64url-encoded coordinates', () => {
      const keyPair = generateECDHKeyPair();
      const publicKey = keyPair.publicKey;
      // Base64url should not contain padding or special chars
      expect(/^[A-Za-z0-9_-]+$/.test(publicKey.x)).toBe(true);
      expect(/^[A-Za-z0-9_-]+$/.test(publicKey.y)).toBe(true);
    });

    it('should generate P-256 coordinates of correct length', () => {
      const keyPair = generateECDHKeyPair();
      const publicKey = keyPair.publicKey;
      // P-256 has 256-bit coordinates = 32 bytes = 43 base64url chars (with padding)
      // Without padding can be 42-43 chars
      expect(publicKey.x.length).toBeGreaterThanOrEqual(40);
      expect(publicKey.y.length).toBeGreaterThanOrEqual(40);
    });

    it('should return private key in PEM format', () => {
      const keyPair = generateECDHKeyPair();
      expect(keyPair.privateKeyPem).toContain('-----BEGIN PRIVATE KEY-----');
      expect(keyPair.privateKeyPem).toContain('-----END PRIVATE KEY-----');
    });

    it('should set expiration to 15 minutes in the future', () => {
      const before = new Date();
      const keyPair = generateECDHKeyPair();
      const after = new Date();

      const expectedMin = new Date(before.getTime() + 14 * 60 * 1000); // 14 min
      const expectedMax = new Date(after.getTime() + 16 * 60 * 1000); // 16 min

      expect(keyPair.expiresAt.getTime()).toBeGreaterThanOrEqual(expectedMin.getTime());
      expect(keyPair.expiresAt.getTime()).toBeLessThanOrEqual(expectedMax.getTime());
    });

    it('should generate different key pairs on each call', () => {
      const keyPair1 = generateECDHKeyPair();
      const keyPair2 = generateECDHKeyPair();
      expect(keyPair1.privateKeyPem).not.toBe(keyPair2.privateKeyPem);
      expect(keyPair1.publicKey.x).not.toBe(keyPair2.publicKey.x);
      expect(keyPair1.publicKey.y).not.toBe(keyPair2.publicKey.y);
    });
  });

  describe('isKeyExpired', () => {
    it('should return false for fresh key pair', () => {
      const keyPair = generateECDHKeyPair();
      expect(isKeyExpired(keyPair)).toBe(false);
    });

    it('should return true for expired key pair', () => {
      const keyPair = generateECDHKeyPair();
      // Set expiration to past
      keyPair.expiresAt = new Date(Date.now() - 1000);
      expect(isKeyExpired(keyPair)).toBe(true);
    });

    it('should handle edge case of exact expiration time', () => {
      const keyPair = generateECDHKeyPair();
      // Set to now (should be expired since comparison is >)
      keyPair.expiresAt = new Date();
      expect(isKeyExpired(keyPair)).toBe(true);
    });

    it('should return false for key expiring in future', () => {
      const keyPair = generateECDHKeyPair();
      // Set to future
      keyPair.expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
      expect(isKeyExpired(keyPair)).toBe(false);
    });
  });
});
