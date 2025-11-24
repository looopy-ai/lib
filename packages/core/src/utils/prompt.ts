export type SystemPrompt = {
  prompt: string;
  name?: string;
  version?: number;
};

export type SystemPromptProp = string | SystemPrompt | (() => Promise<SystemPrompt> | SystemPrompt);

export const getSystemPrompt = async (
  systemPrompt?: SystemPromptProp,
): Promise<SystemPrompt | undefined> => {
  if (!systemPrompt) {
    return undefined;
  }
  if (typeof systemPrompt === 'string') {
    return { prompt: systemPrompt };
  }
  if (typeof systemPrompt === 'function') {
    return await systemPrompt();
  }
  return systemPrompt;
};
