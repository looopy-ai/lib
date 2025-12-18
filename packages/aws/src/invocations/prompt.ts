import { type Agent, SSEServer } from '@looopy-ai/core';
import type pino from 'pino';
import { z } from 'zod';

const promptValidator = z.looseObject({
  prompt: z.string().min(1),
});

export const handlePrompt = async <AuthContext>(
  agent: Agent<AuthContext>,
  body: unknown,
  authContext: AuthContext | undefined,
  res: Response,
  logger: pino.Logger,
  onComplete: () => void,
  onError: () => void,
): Promise<Response> => {
  const promptValidation = promptValidator.safeParse(body);
  if (!promptValidation.success) {
    onError();
    return Response.json(
      { error: 'Invalid prompt', details: promptValidation.error.issues },
      { status: 400 },
    );
  }
  const { prompt, ...metadata } = promptValidation.data;

  const sseServer = new SSEServer();
  const turn = await agent.startTurn(prompt, { authContext, metadata });

  turn.subscribe({
    next: (evt) => {
      sseServer.emit(agent.contextId, evt);
    },
    complete: async () => {
      sseServer.shutdown();
      onComplete();
    },
  });

  logger.info('SSE connection established');

  const stream = new ReadableStream({
    start(controller) {
      sseServer.subscribe(
        {
          setHeader: (name: string, value: string): void => {
            res.headers.set(name, value);
          },
          write: (chunk: string): void => {
            controller.enqueue(new TextEncoder().encode(chunk));
          },
          end: function (): void {
            logger.info('SSE stream finished');
            this.writable = false;
            controller.close();
          },
        },
        { contextId: agent.contextId },
        undefined,
      );
    },
    cancel: (): void => {
      logger.info('Stream canceled');
      sseServer.shutdown();
      onComplete();
    },
  });

  return new Response(stream, res);
};
