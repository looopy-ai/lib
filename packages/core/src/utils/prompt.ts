import type { LoopContext } from '../core/types';

export type SystemPrompt = {
  prompt: string;
  name?: string;
  version?: number;
};

export type SystemPromptProp =
  | string
  | SystemPrompt
  | (<AuthContext>(loopContext: LoopContext<AuthContext>) => Promise<SystemPrompt> | SystemPrompt);

export const getSystemPrompt = async <AuthContext>(
  systemPrompt: SystemPromptProp | undefined,
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
