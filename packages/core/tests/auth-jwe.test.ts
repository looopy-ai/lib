import { describe, expect, it } from 'vitest';
import { createJWEClaims } from '../src/auth/claims';
import { generateECDHKeyPair } from '../src/auth/crypto';
import { decryptCredential, encryptCredential, validateJWEClaims } from '../src/auth/jwe';

describe('JWE encryption', () => {
  describe('encryptCredential', () => {
    it('should encrypt a credential to a public key', async () => {
      const keyPair = generateECDHKeyPair();
      const claims = createJWEClaims({
        authId: 'auth-123',
        contextId: 'ctx-456',
      });

      const jwe = await encryptCredential('my-secret-api-key', keyPair.publicKey, claims);

      expect(jwe).toBeDefined();
      expect(typeof jwe).toBe('string');
      // JWE compact format: header.encrypted_key.iv.ciphertext.tag
      expect(jwe.split('.')).toHaveLength(5);
    });

    it('should produce different JWE for same credential (due to random IV)', async () => {
      const keyPair = generateECDHKeyPair();
      const claims = createJWEClaims({
        authId: 'auth-123',
        contextId: 'ctx-456',
      });

      const jwe1 = await encryptCredential('same-secret', keyPair.publicKey, claims);
      const jwe2 = await encryptCredential('same-secret', keyPair.publicKey, claims);

      expect(jwe1).not.toBe(jwe2);
    });

    it('should include claims in JWE header', async () => {
      const keyPair = generateECDHKeyPair();
      const claims = createJWEClaims({
        authId: 'auth-123',
        contextId: 'ctx-456',
        agentId: 'agent-789',
      });

      const jwe = await encryptCredential('secret', keyPair.publicKey, claims);

      // Decode header (first part before first dot)
      const header = jwe.split('.')[0];
      const decoded = Buffer.from(header, 'base64url').toString('utf-8');
      const headerObj = JSON.parse(decoded) as {
        authId?: string;
        contextId?: string;
        agentId?: string;
      };

      expect(headerObj.authId).toBe('auth-123');
      expect(headerObj.contextId).toBe('ctx-456');
      expect(headerObj.agentId).toBe('agent-789');
    });
  });

  describe('decryptCredential', () => {
    it('should decrypt a JWE credential with valid claims', async () => {
      const keyPair = generateECDHKeyPair();
      const credentials = 'my-api-key-12345';
      const claims = createJWEClaims({
        authId: 'auth-123',
        contextId: 'ctx-456',
      });

      const jwe = await encryptCredential(credentials, keyPair.publicKey, claims);
      const decrypted = await decryptCredential(jwe, keyPair.privateKeyPem, claims);

      expect(decrypted).toBe(credentials);
    });

    it('should reject JWE with wrong authId', async () => {
      const keyPair = generateECDHKeyPair();
      const credentials = 'secret';
      const claims = createJWEClaims({
        authId: 'auth-123',
        contextId: 'ctx-456',
      });

      const jwe = await encryptCredential(credentials, keyPair.publicKey, claims);

      const wrongClaims = {
        authId: 'wrong-id',
        contextId: 'ctx-456',
      };

      await expect(decryptCredential(jwe, keyPair.privateKeyPem, wrongClaims)).rejects.toThrow(
        'Auth ID mismatch',
      );
    });

    it('should reject JWE with wrong contextId', async () => {
      const keyPair = generateECDHKeyPair();
      const credentials = 'secret';
      const claims = createJWEClaims({
        authId: 'auth-123',
        contextId: 'ctx-456',
      });

      const jwe = await encryptCredential(credentials, keyPair.publicKey, claims);

      const wrongClaims = {
        authId: 'auth-123',
        contextId: 'wrong-context',
      };

      await expect(decryptCredential(jwe, keyPair.privateKeyPem, wrongClaims)).rejects.toThrow(
        'Context ID mismatch',
      );
    });

    it('should handle expired JWE claims', async () => {
      const keyPair = generateECDHKeyPair();
      const credentials = 'secret';
      const now = Math.floor(Date.now() / 1000);
      const expiredClaims = {
        authId: 'auth-123',
        contextId: 'ctx-456',
        iat: now - 3600, // 1 hour ago
        exp: now - 600, // Expired 10 minutes ago
      };

      const jwe = await encryptCredential(credentials, keyPair.publicKey, expiredClaims);

      await expect(decryptCredential(jwe, keyPair.privateKeyPem, expiredClaims)).rejects.toThrow(
        'JWE credential has expired',
      );
    });

    it('should handle partial claim validation', async () => {
      const keyPair = generateECDHKeyPair();
      const credentials = 'secret';
      const claims = createJWEClaims({
        authId: 'auth-123',
        contextId: 'ctx-456',
        agentId: 'agent-789',
      });

      const jwe = await encryptCredential(credentials, keyPair.publicKey, claims);

      // Only validate authId and contextId, not agentId
      const decrypted = await decryptCredential(jwe, keyPair.privateKeyPem, {
        authId: 'auth-123',
        contextId: 'ctx-456',
      });

      expect(decrypted).toBe(credentials);
    });
  });

  describe('validateJWEClaims', () => {
    it('should validate correct claims', () => {
      const now = Math.floor(Date.now() / 1000);
      const claims = {
        authId: 'auth-123',
        contextId: 'ctx-456',
        iat: now,
        exp: now + 3600,
      };

      // Should not throw
      expect(() =>
        validateJWEClaims(claims, {
          authId: 'auth-123',
          contextId: 'ctx-456',
        }),
      ).not.toThrow();
    });

    it('should reject expired claims', () => {
      const now = Math.floor(Date.now() / 1000);
      const expiredClaims = {
        authId: 'auth-123',
        contextId: 'ctx-456',
        iat: now - 7200,
        exp: now - 600, // Expired
      };

      expect(() =>
        validateJWEClaims(expiredClaims, {
          authId: 'auth-123',
          contextId: 'ctx-456',
        }),
      ).toThrow('JWE credential has expired');
    });

    it('should reject future iat with significant clock skew', () => {
      const now = Math.floor(Date.now() / 1000);
      const futureClaims = {
        authId: 'auth-123',
        contextId: 'ctx-456',
        iat: now + 120, // 2 minutes in future (beyond 60s tolerance)
        exp: now + 3600,
      };

      expect(() =>
        validateJWEClaims(futureClaims, {
          authId: 'auth-123',
          contextId: 'ctx-456',
        }),
      ).toThrow('JWE credential issued in the future');
    });

    it('should allow future iat within clock skew tolerance', () => {
      const now = Math.floor(Date.now() / 1000);
      const slightlyFutureClaims = {
        authId: 'auth-123',
        contextId: 'ctx-456',
        iat: now + 30, // 30 seconds in future (within 60s tolerance)
        exp: now + 3600,
      };

      // Should not throw
      expect(() =>
        validateJWEClaims(slightlyFutureClaims, {
          authId: 'auth-123',
          contextId: 'ctx-456',
        }),
      ).not.toThrow();
    });

    it('should reject mismatched authId', () => {
      const now = Math.floor(Date.now() / 1000);
      const claims = {
        authId: 'auth-123',
        contextId: 'ctx-456',
        iat: now,
        exp: now + 3600,
      };

      expect(() =>
        validateJWEClaims(claims, {
          authId: 'wrong-id',
          contextId: 'ctx-456',
        }),
      ).toThrow('Auth ID mismatch');
    });

    it('should reject mismatched contextId', () => {
      const now = Math.floor(Date.now() / 1000);
      const claims = {
        authId: 'auth-123',
        contextId: 'ctx-456',
        iat: now,
        exp: now + 3600,
      };

      expect(() =>
        validateJWEClaims(claims, {
          authId: 'auth-123',
          contextId: 'wrong-ctx',
        }),
      ).toThrow('Context ID mismatch');
    });
  });
});
