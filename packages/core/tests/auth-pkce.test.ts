import { describe, expect, it } from 'vitest';
import {
  generateCodeChallenge,
  generateCodeVerifier,
  generatePKCEPair,
  validateCodeChallenge,
} from '../src/auth/pkce';

describe('PKCE utilities', () => {
  describe('generateCodeVerifier', () => {
    it('should generate a valid code verifier', () => {
      const verifier = generateCodeVerifier();
      expect(verifier).toBeDefined();
      expect(typeof verifier).toBe('string');
      // Base64url encoded 32 bytes = 43 characters
      expect(verifier.length).toBeGreaterThanOrEqual(43);
      expect(verifier.length).toBeLessThanOrEqual(128);
    });

    it('should generate different verifiers on each call', () => {
      const verifier1 = generateCodeVerifier();
      const verifier2 = generateCodeVerifier();
      expect(verifier1).not.toBe(verifier2);
    });

    it('should only contain unreserved characters', () => {
      const verifier = generateCodeVerifier();
      // Base64url: A-Z, a-z, 0-9, -, _
      expect(/^[A-Za-z0-9_-]+$/.test(verifier)).toBe(true);
    });
  });

  describe('generateCodeChallenge', () => {
    it('should generate a code challenge from a verifier', () => {
      const verifier = generateCodeVerifier();
      const challenge = generateCodeChallenge(verifier);
      expect(challenge).toBeDefined();
      expect(typeof challenge).toBe('string');
      expect(challenge.length).toBeGreaterThan(0);
    });

    it('should generate consistent challenge for same verifier', () => {
      const verifier = generateCodeVerifier();
      const challenge1 = generateCodeChallenge(verifier);
      const challenge2 = generateCodeChallenge(verifier);
      expect(challenge1).toBe(challenge2);
    });

    it('should generate different challenges for different verifiers', () => {
      const verifier1 = generateCodeVerifier();
      const verifier2 = generateCodeVerifier();
      const challenge1 = generateCodeChallenge(verifier1);
      const challenge2 = generateCodeChallenge(verifier2);
      expect(challenge1).not.toBe(challenge2);
    });

    it('should use base64url encoding', () => {
      const verifier = generateCodeVerifier();
      const challenge = generateCodeChallenge(verifier);
      // Base64url: A-Z, a-z, 0-9, -, _ (no padding)
      expect(/^[A-Za-z0-9_-]+$/.test(challenge)).toBe(true);
    });
  });

  describe('generatePKCEPair', () => {
    it('should generate a valid PKCE pair', () => {
      const pair = generatePKCEPair();
      expect(pair).toHaveProperty('codeVerifier');
      expect(pair).toHaveProperty('codeChallenge');
      expect(pair).toHaveProperty('algorithm', 'S256');
    });

    it('should generate valid challenge from included verifier', () => {
      const pair = generatePKCEPair();
      const expectedChallenge = generateCodeChallenge(pair.codeVerifier);
      expect(pair.codeChallenge).toBe(expectedChallenge);
    });

    it('should generate different pairs on each call', () => {
      const pair1 = generatePKCEPair();
      const pair2 = generatePKCEPair();
      expect(pair1.codeVerifier).not.toBe(pair2.codeVerifier);
      expect(pair1.codeChallenge).not.toBe(pair2.codeChallenge);
    });
  });

  describe('validateCodeChallenge', () => {
    it('should validate a correct challenge', () => {
      const verifier = generateCodeVerifier();
      const challenge = generateCodeChallenge(verifier);
      expect(validateCodeChallenge(verifier, challenge)).toBe(true);
    });

    it('should reject an invalid challenge', () => {
      const verifier = generateCodeVerifier();
      const wrongChallenge = generateCodeVerifier(); // Use a different verifier as challenge
      expect(validateCodeChallenge(verifier, wrongChallenge)).toBe(false);
    });

    it('should reject modified challenge', () => {
      const verifier = generateCodeVerifier();
      const challenge = generateCodeChallenge(verifier);
      const modifiedChallenge = `${challenge.slice(0, -1)}X`; // Change last char
      expect(validateCodeChallenge(verifier, modifiedChallenge)).toBe(false);
    });

    it('should work with PKCE pair', () => {
      const pair = generatePKCEPair();
      expect(validateCodeChallenge(pair.codeVerifier, pair.codeChallenge)).toBe(true);
    });
  });
});
