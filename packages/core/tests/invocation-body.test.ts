import { describe, expect, it } from 'vitest';
import {
  detectInvocationBodyType,
  parsePromptInvocationBody,
  parseResumeInvocationBody,
} from '../src/server/invocation';

describe('invocation body parsing', () => {
  it('detects legacy prompt payloads without an explicit type', () => {
    expect(detectInvocationBodyType({ prompt: 'hello' })).toBe('prompt');
  });

  it('parses prompt payloads and strips transport-only fields', () => {
    const parsed = parsePromptInvocationBody({
      type: 'prompt',
      prompt: 'hello',
      metadata: { source: 'test' },
    });

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data).toEqual({
      prompt: 'hello',
      metadata: { source: 'test' },
    });
  });

  it('rejects prompt payloads with the wrong explicit type', () => {
    const parsed = parsePromptInvocationBody({
      type: 'resume',
      prompt: 'hello',
    });

    expect(parsed.success).toBe(false);
  });

  it('parses resume payloads with encrypted credentials and resolved inputs', () => {
    const parsed = parseResumeInvocationBody({
      type: 'resume',
      credentials: [{ authId: 'auth-1', credential: 'jwe-token' }],
      inputs: [{ inputId: 'input-1', value: { answer: 42 } }],
    });

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.credentials).toEqual([{ authId: 'auth-1', credential: 'jwe-token' }]);
    expect(parsed.data.inputs).toEqual([{ inputId: 'input-1', value: { answer: 42 } }]);
  });

  it('rejects resume payloads without credentials or inputs', () => {
    const parsed = parseResumeInvocationBody({ type: 'resume', metadata: { source: 'test' } });

    expect(parsed.success).toBe(false);
  });

  it('rejects resume payloads with the wrong explicit type', () => {
    const parsed = parseResumeInvocationBody({
      type: 'prompt',
      credentials: [{ authId: 'auth-1', credential: 'jwe-token' }],
    });

    expect(parsed.success).toBe(false);
  });

  it('rejects oversized credential batches', () => {
    const parsed = parseResumeInvocationBody({
      type: 'resume',
      credentials: Array.from({ length: 21 }, (_, index) => ({
        authId: `auth-${index}`,
        credential: 'jwe-token',
      })),
    });

    expect(parsed.success).toBe(false);
  });
});
