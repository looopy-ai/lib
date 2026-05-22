import type { Agent, PromptInvocationBody } from '@looopy-ai/core';
import type pino from 'pino';
import { streamTurn } from './stream';

export const handlePrompt = async <AuthContext>(
  agent: Agent<AuthContext>,
  body: PromptInvocationBody,
  authContext: AuthContext | undefined,
  res: Response,
  logger: pino.Logger,
  onComplete: () => void,
  onError: () => void,
): Promise<Response> => {
  const events$ = await agent.startTurn(body.prompt, {
    authContext,
    metadata: body.metadata,
  });

  return streamTurn(events$, agent.contextId, res, logger, onComplete, onError);
};
