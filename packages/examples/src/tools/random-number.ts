/**
 * Random Number Tool
 *
 * Generate a random number between min and max.
 * Requests secure auth handoff when max is greater than 100.
 */

import { randomUUID } from 'node:crypto';
import { authRequired, decryptCredential, generateECDHKeyPair, tool } from '@looopy-ai/core';
import { z } from 'zod';

type PendingRandomAuth = {
  authId: string;
  privateKeyPem: string;
  expiresAt: Date;
  contextId: string;
};

const pendingRandomAuthByToolCall = new Map<string, PendingRandomAuth>();

const isExpired = (expiresAt: Date): boolean => expiresAt.getTime() <= Date.now();

export const randomNumberTool = tool({
  id: 'get_random_number',
  description: 'Generate a random number between min and max',
  schema: z
    .object({
      min: z.number().describe('Minimum value (inclusive)'),
      max: z.number().describe('Maximum value (inclusive)'),
    })
    .refine(({ min, max }) => max >= min, {
      message: 'max must be greater than or equal to min',
      path: ['max'],
    }),
  handler: async ({ min, max }, ctx) => {
    const requiresAuth = max > 100;

    if (requiresAuth) {
      const toolCallId = ctx.toolCallId;
      if (!toolCallId) {
        return {
          success: false,
          error: 'Tool call ID missing; cannot perform secure authentication handoff.',
          result: null,
        };
      }

      const encryptedCredential = ctx.resolvedInputs?.get(toolCallId);
      const pendingAuth = pendingRandomAuthByToolCall.get(toolCallId);

      if (
        pendingAuth &&
        pendingAuth.contextId === ctx.contextId &&
        !isExpired(pendingAuth.expiresAt) &&
        typeof encryptedCredential === 'string'
      ) {
        try {
          await decryptCredential(encryptedCredential, pendingAuth.privateKeyPem, {
            authId: pendingAuth.authId,
            contextId: ctx.contextId,
          });
          pendingRandomAuthByToolCall.delete(toolCallId);
        } catch {
          pendingRandomAuthByToolCall.delete(toolCallId);
          return {
            success: false,
            error: 'Failed to decrypt auth credential. Please authenticate again.',
            result: null,
          };
        }
      } else {
        const keyPair = generateECDHKeyPair();
        const authId = randomUUID();

        pendingRandomAuthByToolCall.set(toolCallId, {
          authId,
          privateKeyPem: keyPair.privateKeyPem,
          expiresAt: keyPair.expiresAt,
          contextId: ctx.contextId,
        });

        return authRequired({
          authId,
          authType: 'api-key',
          provider: 'random-number',
          prompt:
            'Authentication required to generate numbers over 100. Encrypt your credential with the provided key and submit it.',
          encryptionKey: keyPair.publicKey,
          metadata: {
            expiresIn: 900,
            reason: 'high-range-random-number',
          },
        });
      }
    }

    const result = Math.floor(Math.random() * (max - min + 1)) + min;
    return {
      success: true,
      result: {
        min,
        max,
        result,
      },
    };
  },
});
