import type { LoopContext } from '../core/types';

export type SystemPrompt = {
  prompt: string;
  name?: string;
  version?: number;
  metadata?: Record<string, unknown>;
};

export type SystemPromptProp<AuthContext> =
  | string
  | SystemPrompt
  | ((loopContext: LoopContext<AuthContext>) => Promise<SystemPrompt> | SystemPrompt);

export const getSystemPrompt = async <AuthContext>(
  systemPrompt: SystemPromptProp<AuthContext> | undefined,
  loopContext: LoopContext<AuthContext>,
): Promise<SystemPrompt | undefined> => {
  if (!systemPrompt) {
    return undefined;
  }
  if (typeof systemPrompt === 'string') {
    return { prompt: systemPrompt };
  }
  if (typeof systemPrompt === 'function') {
    return await systemPrompt(loopContext);
  }
  return systemPrompt;
};
