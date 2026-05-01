import { describe, expect, it } from 'vitest';
import { AuthRequiredEventSchema } from '../src/types/event-schemas';

describe('AuthRequiredEventSchema', () => {
  it('accepts oauth2 events with discrete URL construction fields', () => {
    const result = AuthRequiredEventSchema.safeParse({
      kind: 'auth-required',
      authId: 'auth-123',
      authType: 'oauth2',
      prompt: 'Authorize access',
      encryptionKey: {
        kty: 'EC',
        crv: 'P-256',
        x: 'base64url-x',
        y: 'base64url-y',
        kid: 'key-123',
      },
      authorizationEndpoint: 'https://provider.example.com/auth',
      clientId: 'client-123',
      codeChallenge: 'challenge-123',
      codeChallengeMethod: 'S256',
      timestamp: new Date().toISOString(),
    });

    expect(result.success).toBe(true);
  });

  it('rejects oauth2 events missing required URL construction fields', () => {
    const result = AuthRequiredEventSchema.safeParse({
      kind: 'auth-required',
      authId: 'auth-123',
      authType: 'oauth2',
      prompt: 'Authorize access',
      timestamp: new Date().toISOString(),
    });

    expect(result.success).toBe(false);
  });
});
