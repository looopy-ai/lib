import { type Agent, getLogger, type ShutdownManager, SSEServer } from '@looopy-ai/core';
import { Hono as BaseHono } from 'hono';
import { requestId } from 'hono/request-id';
import type pino from 'pino';
import { z } from 'zod';

export type ServeConfig<AuthContext> = {
  agent: (contextId: string) => Promise<Agent<AuthContext>>;
  decodeAuthorization?: (authorization: string) => Promise<AuthContext | undefined>;
  shutdown?: ShutdownManager;
  logger?: pino.Logger;
  port?: number;
};

export type HonoVariables = {
  logger: pino.Logger;
};

const promptValidator = z.looseObject({
  prompt: z.string().min(1),
});

export type Hono = BaseHono<{ Variables: HonoVariables }>;

export const hono = <AuthContext>(config: ServeConfig<AuthContext>): Hono => {
  const app = new BaseHono<{ Variables: HonoVariables }>();

  app.use(requestId());
  app.use('*', async (c, next) => {
    const requestId = c.var.requestId;
    const requestContext = {
      requestId,
      method: c.req.method,
      path: c.req.path,
    };
    const child = config.logger?.child(requestContext) ?? getLogger(requestContext);

    const start = performance.now();
    c.set('logger', child);

    try {
      await next();
    } finally {
      if (c.req.path !== '/ping') {
        const ms = performance.now() - start;
        child.info({ status: c.res.status, ms }, 'request completed');
      }
    }
  });

  const state = { busy: false, agent: undefined as Agent<AuthContext> | undefined };

  app.get('/ping', async (c) => {
    return c.text(
      JSON.stringify({
        status: state.busy ? 'HealthyBusy' : 'Healthy',
        time_of_last_update: Date.now(),
      }),
    );
  });

  // body e.g. {"prompt": "Tell me about AWS"}
  app.post('/invocations', async (c) => {
    const logger = c.var.logger;

    if (state.busy) {
      return c.json({ error: 'Agent is currently busy' }, 503);
    }
    state.busy = true;
    const contextId = c.req.header('X-Amzn-Bedrock-AgentCore-Runtime-Session-Id') || undefined;
    if (!contextId) {
      state.busy = false;
      return c.json({ error: 'Missing X-Amzn-Bedrock-AgentCore-Runtime-Session-Id header' }, 400);
    }

    const authorization = c.req.header('Authorization') || undefined;
    if (!authorization && config.decodeAuthorization) {
      state.busy = false;
      return c.json({ error: 'Missing Authorization header' }, 401);
    }
    const authContext = await getAuthContext(authorization, config.decodeAuthorization);
    if (config.decodeAuthorization && !authContext) {
      state.busy = false;
      return c.json({ error: 'Forbidden' }, 403);
    }

    if (!state.agent) {
      state.agent = await config.agent(contextId);
      logger.info({ contextId }, 'Created new agent instance');
      config.shutdown?.registerWatcher(async () => {
        logger.info({ contextId }, 'Shutting down agent');
        state.agent = undefined;
      });
    }
    const agent = state.agent;

    if (agent.contextId !== contextId) {
      state.busy = false;
      return c.json({ error: 'Another session is active' }, 409);
    }

    const body = await c.req.json();
    const promptValidation = promptValidator.safeParse(body);
    if (!promptValidation.success) {
      state.busy = false;
      return c.json({ error: 'Invalid prompt', details: promptValidation.error.issues }, 400);
    }
    const { prompt, ...metadata } = promptValidation.data;

    const sseServer = new SSEServer();
    const turn = await agent.startTurn(prompt, { authContext, metadata });
    turn.subscribe({
      next: (evt) => {
        sseServer.emit(contextId, evt);
      },
      complete: async () => {
        // await agent.shutdown();
        sseServer.shutdown();
        state.busy = false;
      },
    });

    const res = c.res;
    logger.info({ contextId }, 'SSE connection established');
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
              logger.info({ contextId }, 'SSE stream finished');
              this.writable = false;
              controller.close();
            },
          },
          {
            contextId,
          },
          undefined,
        );
      },
      cancel: (): void => {
        logger.info({ contextId }, 'Stream canceled');
        sseServer.shutdown();
        state.busy = false;
      },
    });

    return new Response(stream, res);
  });

  return app;
};

const getAuthContext = async <AuthContext>(
  authorization?: string,
  decoder?: (authorization: string) => Promise<AuthContext | undefined>,
): Promise<AuthContext | undefined> => {
  if (!authorization || !decoder) {
    return undefined;
  }

  return await decoder(authorization);
};
