import type { IterationContext, Plugin, SystemPrompt } from '../types/core';

export type SystemPrompts = {
  before: readonly SystemPrompt[];
  after: readonly SystemPrompt[];
};

export const getSystemPrompts = async <AuthContext>(
  plugins: readonly Plugin<AuthContext>[] | undefined,
  loopContext: IterationContext<AuthContext>,
): Promise<SystemPrompts> => {
  if (!plugins?.length) {
    return { before: [], after: [] };
  }
  const prompts = await Promise.all(plugins.map((p) => p.generateSystemPrompts(loopContext)));
  const flattened = prompts.flat();
  const before = Object.freeze(
    flattened
      .filter((p) => p.position === 'before')
      .sort((a, b) => (a.positionSequence ?? 0) - (b.positionSequence ?? 0)),
  );
  const after = Object.freeze(
    flattened
      .filter((p) => p.position === 'after')
      .sort((a, b) => (a.positionSequence ?? 0) - (b.positionSequence ?? 0)),
  );
  return { before, after };
};
