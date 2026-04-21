/**
 * Zod Schemas for Event Types
 *
 * Runtime validation schemas for events received over the wire (e.g., SSE, WebSocket).
 * Mirrors the TypeScript interfaces in event.ts.
 */

import { z } from 'zod';

export const AuthEncryptionKeySchema = z.object({
  kty: z.string(),
  crv: z.string(),
  x: z.string(),
  y: z.string(),
  kid: z.string(),
  alg: z.string().optional(),
});

const authRequiredEventBaseSchema = z.object({
  kind: z.literal('auth-required'),
  authId: z.string(),
  provider: z.string().optional(),
  scopes: z.array(z.string()).optional(),
  prompt: z.string(),
  encryptionKey: AuthEncryptionKeySchema.optional(),
  timestamp: z.string(),
  metadata: z.object({ expiresIn: z.number().optional() }).catchall(z.unknown()).optional(),
});

export const OAuth2AuthRequiredEventSchema = authRequiredEventBaseSchema.extend({
  authType: z.literal('oauth2'),
  authUrl: z.url(),
});

export const ApiKeyAuthRequiredEventSchema = authRequiredEventBaseSchema.extend({
  authType: z.literal('api-key'),
  infoUrl: z.url().optional(),
});

export const PatAuthRequiredEventSchema = authRequiredEventBaseSchema.extend({
  authType: z.literal('pat'),
  infoUrl: z.url().optional(),
});

export const PasswordAuthRequiredEventSchema = authRequiredEventBaseSchema.extend({
  authType: z.literal('password'),
});

export const CustomAuthRequiredEventSchema = authRequiredEventBaseSchema.extend({
  authType: z.literal('custom'),
});

export const AuthRequiredEventSchema = z.discriminatedUnion('authType', [
  OAuth2AuthRequiredEventSchema,
  ApiKeyAuthRequiredEventSchema,
  PatAuthRequiredEventSchema,
  PasswordAuthRequiredEventSchema,
  CustomAuthRequiredEventSchema,
]);
