import type { Plugin } from '../types/core';

// biome-ignore lint/suspicious/noExplicitAny: type is not used here
export const literalPrompt = (content: string): Plugin<any> => {
  return {
    name: 'literal-prompt',
    generateSystemPrompts: async () => {
      return [{ content, position: 'before' }];
    },
  };
};
