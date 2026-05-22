import type { Agent, ResumeInvocationBody } from '@looopy-ai/core';
import type pino from 'pino';
import { streamTurn } from './stream';

export const handleResume = async <AuthContext>(
  agent: Agent<AuthContext>,
  body: ResumeInvocationBody,
  authContext: AuthContext | undefined,
  res: Response,
  logger: pino.Logger,
  onComplete: () => void,
  onError: () => void,
): Promise<Response> => {
  const agentStatus = agent.state.status;
  if (agentStatus !== 'waiting-auth' && agentStatus !== 'waiting-input') {
    onError();
    return Response.json(
      { error: 'Agent is not in a resumable state', status: agentStatus },
      { status: 409 },
    );
  }

  const events$ = await agent.startTurn(null, {
    authContext,
    metadata: body.metadata,
    credentials: body.credentials,
    inputs: body.inputs,
  });

  return streamTurn(events$, agent.contextId, res, logger, onComplete, onError);
};
