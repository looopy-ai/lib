import type { IterationContext, Plugin, SystemPrompt } from '../types/core';

export const literalPrompt = <AuthContext>(
  content: string,
  position: SystemPrompt['position'] = 'before',
): Plugin<AuthContext> => {
  return {
    name: 'literal-prompt',
    generateSystemPrompts: async () => {
      return [{ content, position }];
    },
  };
};

/**
 * Plugin to generate system prompts asynchronously. Can be used to load prompts from external sources.
 */
export const asyncPrompt = <AuthContext>(
  content: (context: IterationContext<AuthContext>) => Promise<string | SystemPrompt>,
): Plugin<AuthContext> => {
  return {
    name: 'async-prompt',
    generateSystemPrompts: async (context) => {
      const prompt = await content(context);
      if (typeof prompt === 'string') {
        return [{ content: prompt, position: 'before' }];
      }
      return [prompt];
    },
  };
};
