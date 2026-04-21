import { describe, expect, it } from 'vitest';
import {
  buildOAuth2AuthUrl,
  buildTokenExchangeRequest,
  extractAuthorizationCode,
  generateOAuth2Request,
} from '../src/auth/oauth';

describe('OAuth utilities', () => {
  describe('buildOAuth2AuthUrl', () => {
    it('should build URL using a custom authorization endpoint', () => {
      const url = buildOAuth2AuthUrl({
        clientId: 'test-client-id',
        redirectUri: 'https://example.com/callback',
        codeChallenge: 'test-challenge-123',
        authorizationEndpoint: 'https://auth.example.com/oauth2/authorize',
      });

      expect(url).toContain('https://auth.example.com/oauth2/authorize?');
      expect(url).toContain('client_id=test-client-id');
      expect(url).toContain('code_challenge=test-challenge-123');
    });

    it('should build a valid OAuth2 authorization URL with PKCE', () => {
      const url = buildOAuth2AuthUrl({
        clientId: 'test-client-id',
        redirectUri: 'https://example.com/callback',
        codeChallenge: 'test-challenge-123',
        authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
      });

      expect(url).toContain('https://accounts.google.com/o/oauth2/v2/auth?');
      expect(url).toContain('client_id=test-client-id');
      expect(url).toContain('redirect_uri=https%3A%2F%2Fexample.com%2Fcallback');
      expect(url).toContain('response_type=code');
      expect(url).toContain('code_challenge=test-challenge-123');
      expect(url).toContain('code_challenge_method=S256');
      expect(url).toContain('state=');
    });

    it('should include scopes when provided', () => {
      const url = buildOAuth2AuthUrl({
        clientId: 'test-client-id',
        redirectUri: 'https://example.com/callback',
        codeChallenge: 'test-challenge',
        authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
        scopes: ['openid', 'profile', 'email'],
      });

      expect(url).toContain('scope=openid+profile+email');
    });

    it('should include custom state when provided', () => {
      const customState = 'custom-state-value-123';
      const url = buildOAuth2AuthUrl({
        clientId: 'test-client-id',
        redirectUri: 'https://example.com/callback',
        codeChallenge: 'test-challenge',
        authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
        state: customState,
      });

      expect(url).toContain(`state=${customState}`);
    });

    it('should generate random state when not provided', () => {
      const url1 = buildOAuth2AuthUrl({
        clientId: 'test-client-id',
        redirectUri: 'https://example.com/callback',
        codeChallenge: 'test-challenge',
        authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
      });

      const url2 = buildOAuth2AuthUrl({
        clientId: 'test-client-id',
        redirectUri: 'https://example.com/callback',
        codeChallenge: 'test-challenge',
        authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
      });

      const state1 = new URL(url1).searchParams.get('state');
      const state2 = new URL(url2).searchParams.get('state');

      expect(state1).not.toBe(state2);
    });

    it('should include prompt parameter when provided', () => {
      const url = buildOAuth2AuthUrl({
        clientId: 'test-client-id',
        redirectUri: 'https://example.com/callback',
        codeChallenge: 'test-challenge',
        authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
        prompt: 'consent',
      });

      expect(url).toContain('prompt=consent');
    });
  });

  describe('generateOAuth2Request', () => {
    it('should generate complete OAuth2 request with PKCE', () => {
      const request = generateOAuth2Request({
        clientId: 'test-client-id',
        redirectUri: 'https://example.com/callback',
        authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
      });

      expect(request).toHaveProperty('pkce');
      expect(request).toHaveProperty('authUrl');
      expect(request.pkce).toHaveProperty('codeVerifier');
      expect(request.pkce).toHaveProperty('codeChallenge');
      expect(request.pkce).toHaveProperty('algorithm', 'S256');
    });

    it('should include PKCE challenge in auth URL', () => {
      const request = generateOAuth2Request({
        clientId: 'test-client-id',
        redirectUri: 'https://example.com/callback',
        authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
      });

      expect(request.authUrl).toContain(`code_challenge=${request.pkce.codeChallenge}`);
      expect(request.authUrl).toContain('code_challenge_method=S256');
    });

    it('should support scopes in OAuth2 request', () => {
      const request = generateOAuth2Request({
        clientId: 'test-client-id',
        redirectUri: 'https://example.com/callback',
        authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
        scopes: ['openid', 'profile'],
      });

      expect(request.authUrl).toContain('scope=openid+profile');
    });

    it('should generate request with custom authorization endpoint', () => {
      const request = generateOAuth2Request({
        clientId: 'test-client-id',
        redirectUri: 'https://example.com/callback',
        authorizationEndpoint: 'https://auth.example.com/oauth2/authorize',
      });

      expect(request.authUrl).toContain('https://auth.example.com/oauth2/authorize?');
      expect(request.authUrl).toContain(`code_challenge=${request.pkce.codeChallenge}`);
    });
  });

  describe('extractAuthorizationCode', () => {
    it('should extract code and state from callback URL', () => {
      const callbackUrl = 'https://example.com/callback?code=auth-code-123&state=state-456';
      const result = extractAuthorizationCode(callbackUrl);

      expect(result).toEqual({
        code: 'auth-code-123',
        state: 'state-456',
      });
    });

    it('should return null if code is missing', () => {
      const callbackUrl = 'https://example.com/callback?state=state-456';
      const result = extractAuthorizationCode(callbackUrl);

      expect(result).toBeNull();
    });

    it('should return null if state is missing', () => {
      const callbackUrl = 'https://example.com/callback?code=auth-code-123';
      const result = extractAuthorizationCode(callbackUrl);

      expect(result).toBeNull();
    });

    it('should handle URL-encoded parameters', () => {
      const callbackUrl = 'https://example.com/callback?code=auth%2Bcode%2F123&state=state%20456';
      const result = extractAuthorizationCode(callbackUrl);

      expect(result).toEqual({
        code: 'auth+code/123',
        state: 'state 456',
      });
    });

    it('should return null for invalid URL', () => {
      const result = extractAuthorizationCode('not-a-valid-url');

      expect(result).toBeNull();
    });

    it('should ignore extra query parameters', () => {
      const callbackUrl =
        'https://example.com/callback?code=auth-code&state=state-123&session_state=xyz&extra=param';
      const result = extractAuthorizationCode(callbackUrl);

      expect(result).toEqual({
        code: 'auth-code',
        state: 'state-123',
      });
    });
  });

  describe('buildTokenExchangeRequest', () => {
    it('should build a valid token exchange request', () => {
      const request = buildTokenExchangeRequest({
        code: 'auth-code-123',
        codeVerifier: 'verifier-456',
        clientId: 'client-id',
        clientSecret: 'client-secret',
        redirectUri: 'https://example.com/callback',
      });

      expect(request).toEqual({
        grant_type: 'authorization_code',
        code: 'auth-code-123',
        client_id: 'client-id',
        client_secret: 'client-secret',
        code_verifier: 'verifier-456',
        redirect_uri: 'https://example.com/callback',
      });
    });

    it('should include all required OAuth2 fields', () => {
      const request = buildTokenExchangeRequest({
        code: 'code',
        codeVerifier: 'verifier',
        clientId: 'id',
        clientSecret: 'secret',
        redirectUri: 'uri',
      });

      expect(request).toHaveProperty('grant_type', 'authorization_code');
      expect(request).toHaveProperty('code');
      expect(request).toHaveProperty('client_id');
      expect(request).toHaveProperty('client_secret');
      expect(request).toHaveProperty('code_verifier');
      expect(request).toHaveProperty('redirect_uri');
    });

    it('should work with values containing special characters', () => {
      const request = buildTokenExchangeRequest({
        code: 'auth/code+special',
        codeVerifier: 'verifier-with-_chars',
        clientId: 'client@domain.com',
        clientSecret: 'secret#with$special',
        redirectUri: 'https://example.com/path?query=1',
      });

      expect(request.code).toBe('auth/code+special');
      expect(request.code_verifier).toBe('verifier-with-_chars');
      expect(request.client_secret).toBe('secret#with$special');
    });
  });
});
