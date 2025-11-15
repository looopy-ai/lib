import { type HttpBindings, serve as serveNodeJs } from '@hono/node-server';
import { type Agent, type AuthContext, getLogger } from '@looopy-ai/core';
import { SSEServer } from '@looopy-ai/core/ts';
import { Hono } from 'hono';
import { requestId } from 'hono/request-id';
import type pino from 'pino';
import { pinoHttp } from 'pino-http';
import { z } from 'zod';

type ServeConfig = {
  agent: (contextId: string) => Promise<Agent>;
  decodeAuthorization?: (authorization: string) => Promise<AuthContext | null>;
  port?: number;
};

declare module 'hono' {
  interface ContextVariableMap {
    logger: pino.Logger;
  }
}

const promptValidator = z.object({
  prompt: z.string().min(1),
});

export const serve = (config: ServeConfig) => {
  const app = new Hono<{ Bindings: HttpBindings }>();
  app.use(requestId());
  app.use(async (c, next) => {
    // pass hono's request-id to pino-http
    c.env.incoming.id = c.var.requestId;

    // map express style middleware to hono
    await new Promise((resolve) =>
      pinoHttp({ logger: getLogger({}) })(c.env.incoming, c.env.outgoing, () => resolve(undefined)),
    );

    c.set('logger', c.env.incoming.log);

    await next();
  });

  const state = { busy: false, agent: undefined as Agent | undefined };

  app.get('/ping', async (c) => {
    return c.text(
      JSON.stringify({
        status: state.busy ? 'HealthyBusy' : 'Healthy',
        time_of_last_update: Date.now(),
      }),
    );
  });

  // body e.g. {"prompt": "Tell me about AWS"}
  app.post('/invocation', async (c) => {
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
    const { prompt } = promptValidation.data;

    const sseServer = new SSEServer();
    const turn = await agent.startTurn(prompt);
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

  serveNodeJs({
    fetch: app.fetch,
    port: config.port || 8080,
  });
};

const getAuthContext = async (
  authorization?: string,
  decoder?: (authorization: string) => Promise<AuthContext | null>,
): Promise<AuthContext | null> => {
  if (!authorization || !decoder) {
    return null;
  }

  return await decoder(authorization);
};
