import { type ContextAnyEvent, SSEServer } from '@looopy-ai/core';
import type pino from 'pino';
import type { Observable } from 'rxjs';

/**
 * Pipe an agent turn Observable into a streaming SSE response.
 *
 * Handles subscribe error so callers (onError / onComplete) always receive
 * exactly one lifecycle callback, preventing the busy-flag from getting stuck.
 */
export const streamTurn = (
  events$: Observable<ContextAnyEvent>,
  contextId: string,
  res: Response,
  logger: pino.Logger,
  onComplete: () => void,
  onError: () => void,
): Response => {
  const sseServer = new SSEServer();

  events$.subscribe({
    next: (evt) => {
      sseServer.emit(contextId, evt);
    },
    error: (err: Error) => {
      logger.error({ error: err.message }, 'Turn stream error');
      sseServer.shutdown();
      onError();
    },
    complete: () => {
      sseServer.shutdown();
      onComplete();
    },
  });

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
        { contextId },
        undefined,
      );
    },
    cancel: (): void => {
      logger.info('Stream canceled');
      sseServer.shutdown();
      onComplete();
    },
  });

  logger.info('SSE connection established');
  return new Response(stream, res);
};
