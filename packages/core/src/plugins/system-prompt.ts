import type { IterationContext, Plugin } from '../types/core';

// biome-ignore lint/suspicious/noExplicitAny: type is not used here
export const literalPrompt = (content: string): Plugin<any> => {
  return {
    name: 'literal-prompt',
    generateSystemPrompts: async () => {
      return [{ content, position: 'before' }];
    },
  };
};

/**
 * Plugin to generate system prompts asynchronously. Can be used to load prompts from external sources.
 */
export const asyncPrompt = <AuthContext>(
  content: (context: IterationContext<AuthContext>) => Promise<string>,
): Plugin<AuthContext> => {
  return {
    name: 'async-prompt',
    generateSystemPrompts: async (context) => {
      return [{ content: await content(context), position: 'before' }];
    },
  };
};
