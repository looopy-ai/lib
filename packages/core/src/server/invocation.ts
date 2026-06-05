import { z } from 'zod';

const invocationMetadataSchema = z.record(z.string(), z.unknown());

export const credentialSubmissionSchema = z.object({
  authId: z.string().min(1).max(256),
  credential: z.string().min(1).max(65_536),
});

export const resolvedInputSubmissionSchema = z.object({
  inputId: z.string().min(1).max(256),
  value: z.unknown(),
});

export const promptInvocationBodySchema = z
  .object({
    type: z.literal('prompt').optional(),
    prompt: z.string().min(1).max(100_000),
    metadata: invocationMetadataSchema.optional(),
  })
  .transform(({ type: _type, ...body }) => body);

export const resumeInvocationBodySchema = z
  .object({
    type: z.literal('resume').optional(),
    credentials: z.array(credentialSubmissionSchema).max(20).optional(),
    inputs: z.array(resolvedInputSubmissionSchema).max(20).optional(),
    metadata: invocationMetadataSchema.optional(),
  })
  .refine((d) => (d.credentials?.length ?? 0) + (d.inputs?.length ?? 0) > 0, {
    message: 'At least one credential or input must be provided for resume',
  })
  .transform(({ type: _type, ...body }) => body);

export type InvocationCredentialSubmission = z.infer<typeof credentialSubmissionSchema>;
export type InvocationInputSubmission = z.infer<typeof resolvedInputSubmissionSchema>;
export type PromptInvocationBody = z.infer<typeof promptInvocationBodySchema>;
export type ResumeInvocationBody = z.infer<typeof resumeInvocationBodySchema>;
export type InvocationBodyType = 'prompt' | 'resume' | 'unknown';

export const parsePromptInvocationBody = (body: unknown) =>
  promptInvocationBodySchema.safeParse(body);

export const parseResumeInvocationBody = (body: unknown) =>
  resumeInvocationBodySchema.safeParse(body);

export const detectInvocationBodyType = (body: unknown): InvocationBodyType => {
  if (!body || typeof body !== 'object') {
    return 'unknown';
  }

  if ('type' in body) {
    return body.type === 'prompt' || body.type === 'resume' ? body.type : 'unknown';
  }

  if ('prompt' in body) {
    return 'prompt';
  }

  if ('credentials' in body || 'inputs' in body) {
    return 'resume';
  }

  return 'unknown';
};
