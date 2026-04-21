import { describe, expect, it } from 'vitest';
import { createJWEClaims, getTimeRemaining, hasExpired, validateClaims } from '../src/auth/claims';

describe('JWE claims utilities', () => {
  describe('createJWEClaims', () => {
    it('should create valid JWE claims with defaults', () => {
      const claims = createJWEClaims({
        authId: 'auth-123',
        contextId: 'ctx-456',
      });

      expect(claims).toHaveProperty('authId', 'auth-123');
      expect(claims).toHaveProperty('contextId', 'ctx-456');
      expect(claims).toHaveProperty('iat');
      expect(claims).toHaveProperty('exp');
      expect(claims.agentId).toBeUndefined();
    });

    it('should include agentId when provided', () => {
      const claims = createJWEClaims({
        authId: 'auth-123',
        contextId: 'ctx-456',
        agentId: 'agent-789',
      });

      expect(claims.agentId).toBe('agent-789');
    });

    it('should set issued-at time to now', () => {
      const before = Math.floor(Date.now() / 1000);
      const claims = createJWEClaims({
        authId: 'auth-123',
        contextId: 'ctx-456',
      });
      const after = Math.floor(Date.now() / 1000);

      expect(claims.iat).toBeGreaterThanOrEqual(before);
      expect(claims.iat).toBeLessThanOrEqual(after);
    });

    it('should set expiration to 1 hour by default', () => {
      const before = Math.floor(Date.now() / 1000);
      const claims = createJWEClaims({
        authId: 'auth-123',
        contextId: 'ctx-456',
      });
      const after = Math.floor(Date.now() / 1000);

      const expectedExpMin = before + 3600;
      const expectedExpMax = after + 3600;

      expect(claims.exp).toBeGreaterThanOrEqual(expectedExpMin);
      expect(claims.exp).toBeLessThanOrEqual(expectedExpMax);
    });

    it('should use custom expiration time when provided', () => {
      const before = Math.floor(Date.now() / 1000);
      const claims = createJWEClaims({
        authId: 'auth-123',
        contextId: 'ctx-456',
        expiresInSeconds: 300, // 5 minutes
      });
      const after = Math.floor(Date.now() / 1000);

      const expectedExpMin = before + 300;
      const expectedExpMax = after + 300;

      expect(claims.exp).toBeGreaterThanOrEqual(expectedExpMin);
      expect(claims.exp).toBeLessThanOrEqual(expectedExpMax);
    });

    it('should allow custom properties via spread', () => {
      const claims = createJWEClaims({
        authId: 'auth-123',
        contextId: 'ctx-456',
      });
      // Add custom property
      (claims as Record<string, unknown>).custom = 'value';

      expect((claims as Record<string, unknown>).custom).toBe('value');
    });
  });

  describe('hasExpired', () => {
    it('should return false for claims that have not expired', () => {
      const now = Math.floor(Date.now() / 1000);
      const claims = {
        authId: 'auth-123',
        contextId: 'ctx-456',
        iat: now,
        exp: now + 3600, // 1 hour in future
      };

      expect(hasExpired(claims)).toBe(false);
    });

    it('should return true for claims that have expired', () => {
      const now = Math.floor(Date.now() / 1000);
      const claims = {
        authId: 'auth-123',
        contextId: 'ctx-456',
        iat: now - 7200,
        exp: now - 600, // 10 minutes in past
      };

      expect(hasExpired(claims)).toBe(true);
    });

    it('should handle edge case of exact expiration time', () => {
      const now = Math.floor(Date.now() / 1000);
      const claims = {
        authId: 'auth-123',
        contextId: 'ctx-456',
        iat: now,
        exp: now, // Exactly now
      };

      expect(hasExpired(claims)).toBe(true);
    });

    it('should handle large expiration times', () => {
      const now = Math.floor(Date.now() / 1000);
      const claims = {
        authId: 'auth-123',
        contextId: 'ctx-456',
        iat: now,
        exp: now + 365 * 24 * 60 * 60, // 1 year in future
      };

      expect(hasExpired(claims)).toBe(false);
    });
  });

  describe('getTimeRemaining', () => {
    it('should return positive time for valid claims', () => {
      const now = Math.floor(Date.now() / 1000);
      const claims = {
        authId: 'auth-123',
        contextId: 'ctx-456',
        iat: now,
        exp: now + 3600, // 1 hour in future
      };

      const timeRemaining = getTimeRemaining(claims);
      expect(timeRemaining).toBeGreaterThan(3595);
      expect(timeRemaining).toBeLessThanOrEqual(3600);
    });

    it('should return 0 for expired claims', () => {
      const now = Math.floor(Date.now() / 1000);
      const claims = {
        authId: 'auth-123',
        contextId: 'ctx-456',
        iat: now - 7200,
        exp: now - 600, // Expired
      };

      expect(getTimeRemaining(claims)).toBe(0);
    });

    it('should return exact expiration remaining', () => {
      const now = Math.floor(Date.now() / 1000);
      const expiresIn = 1234;
      const claims = {
        authId: 'auth-123',
        contextId: 'ctx-456',
        iat: now,
        exp: now + expiresIn,
      };

      const timeRemaining = getTimeRemaining(claims);
      expect(timeRemaining).toBeGreaterThanOrEqual(expiresIn - 1);
      expect(timeRemaining).toBeLessThanOrEqual(expiresIn);
    });
  });

  describe('validateClaims', () => {
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
        validateClaims(claims, {
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
        validateClaims(expiredClaims, {
          authId: 'auth-123',
          contextId: 'ctx-456',
        }),
      ).toThrow('JWE claims expired');
    });

    it('should allow small clock skew for iat', () => {
      const now = Math.floor(Date.now() / 1000);
      const slightlyFutureClaims = {
        authId: 'auth-123',
        contextId: 'ctx-456',
        iat: now + 30, // 30 seconds in future (within tolerance)
        exp: now + 3600,
      };

      // Should not throw
      expect(() =>
        validateClaims(slightlyFutureClaims, {
          authId: 'auth-123',
          contextId: 'ctx-456',
        }),
      ).not.toThrow();
    });

    it('should reject excessive clock skew for iat', () => {
      const now = Math.floor(Date.now() / 1000);
      const significantlyFutureClaims = {
        authId: 'auth-123',
        contextId: 'ctx-456',
        iat: now + 120, // 2 minutes in future (beyond tolerance)
        exp: now + 3600,
      };

      expect(() =>
        validateClaims(significantlyFutureClaims, {
          authId: 'auth-123',
          contextId: 'ctx-456',
        }),
      ).toThrow('JWE claims issued in the future');
    });

    it('should validate authId match', () => {
      const now = Math.floor(Date.now() / 1000);
      const claims = {
        authId: 'auth-123',
        contextId: 'ctx-456',
        iat: now,
        exp: now + 3600,
      };

      expect(() =>
        validateClaims(claims, {
          authId: 'wrong-id',
          contextId: 'ctx-456',
        }),
      ).toThrow('Auth ID mismatch');
    });

    it('should validate contextId match', () => {
      const now = Math.floor(Date.now() / 1000);
      const claims = {
        authId: 'auth-123',
        contextId: 'ctx-456',
        iat: now,
        exp: now + 3600,
      };

      expect(() =>
        validateClaims(claims, {
          authId: 'auth-123',
          contextId: 'wrong-ctx',
        }),
      ).toThrow('Context ID mismatch');
    });

    it('should validate agentId match when both present', () => {
      const now = Math.floor(Date.now() / 1000);
      const claims = {
        authId: 'auth-123',
        contextId: 'ctx-456',
        agentId: 'agent-789',
        iat: now,
        exp: now + 3600,
      };

      expect(() =>
        validateClaims(claims, {
          authId: 'auth-123',
          contextId: 'ctx-456',
          agentId: 'wrong-agent',
        }),
      ).toThrow('Agent ID mismatch');
    });

    it('should allow optional agentId validation', () => {
      const now = Math.floor(Date.now() / 1000);
      const claims = {
        authId: 'auth-123',
        contextId: 'ctx-456',
        agentId: 'agent-789',
        iat: now,
        exp: now + 3600,
      };

      // Should not throw when agentId not checked
      expect(() =>
        validateClaims(claims, {
          authId: 'auth-123',
          contextId: 'ctx-456',
        }),
      ).not.toThrow();
    });

    it('should validate partial expected claims', () => {
      const now = Math.floor(Date.now() / 1000);
      const claims = {
        authId: 'auth-123',
        contextId: 'ctx-456',
        iat: now,
        exp: now + 3600,
      };

      // Should not throw when only checking authId
      expect(() =>
        validateClaims(claims, {
          authId: 'auth-123',
        }),
      ).not.toThrow();
    });
  });
});
