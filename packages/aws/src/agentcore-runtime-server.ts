import { type Agent, getLogger, type ShutdownManager } from '@looopy-ai/core';
import { Hono as BaseHono, type Context } from 'hono';
import { requestId } from 'hono/request-id';
import type { BlankInput } from 'hono/types';
import type pino from 'pino';
import { handlePrompt } from './invocations/prompt';

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

export type Hono = BaseHono<{ Variables: HonoVariables }>;

type HonoContext<P extends string> = Context<{ Variables: HonoVariables }, P, BlankInput>;

export const hono = <AuthContext>(config: ServeConfig<AuthContext>): Hono => {
  const app = new BaseHono<{ Variables: HonoVariables }>();

  app.use(requestId());
  app.use('*', async (c, next) => {
    const requestId = c.var.requestId;
    const contextId = c.req.header('X-Amzn-Bedrock-AgentCore-Runtime-Session-Id') || undefined;
    const requestContext = {
      requestId,
      method: c.req.method,
      path: c.req.path,
      contextId,
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

  const processRequest = async <P extends string>(
    c: HonoContext<P>,
    handleRequest: (
      agent: Agent<AuthContext>,
      authContext: AuthContext | undefined,
      logger: pino.Logger,
    ) => Promise<Response>,
  ) => {
    const contextId = c.req.header('X-Amzn-Bedrock-AgentCore-Runtime-Session-Id') || undefined;
    if (!contextId) {
      // state.busy = false;
      return c.json({ error: 'Missing X-Amzn-Bedrock-AgentCore-Runtime-Session-Id header' }, 400);
    }

    const authorization = c.req.header('Authorization') || undefined;
    if (!authorization && config.decodeAuthorization) {
      // state.busy = false;
      return c.json({ error: 'Missing Authorization header' }, 401);
    }
    const authContext = await getAuthContext(authorization, config.decodeAuthorization);
    if (config.decodeAuthorization && !authContext) {
      // state.busy = false;
      return c.json({ error: 'Forbidden' }, 403);
    }

    const logger = c.var.logger;
    if (!state.agent) {
      state.agent = await config.agent(contextId);
      logger.info('Created new agent instance');
      config.shutdown?.registerWatcher(async () => {
        logger.info('Shutting down agent');
        state.agent = undefined;
      });
    }
    const agent = state.agent;

    if (agent.contextId !== contextId) {
      // state.busy = false;
      return c.json({ error: 'Another session is active' }, 409);
    }

    return await handleRequest(agent, authContext, logger);
  };

  app.get('/ping', async (c) => {
    return c.text(
      JSON.stringify({
        status: state.busy ? 'HealthyBusy' : 'Healthy',
        time_of_last_update: Date.now(),
      }),
    );
  });

  app.get('/invocations', async (c) => {
    return processRequest(c, async (agent) => {
      return c.json(agent.state);
    });
  });

  // body e.g. {"prompt": "Tell me about AWS"}
  app.post('/invocations', async (c) => {
    if (state.busy) {
      return c.json({ error: 'Agent is currently busy' }, 503);
    }

    return processRequest(c, async (agent, authContext, logger) => {
      state.busy = true;

      const body = await c.req.json();
      if (!body || typeof body !== 'object') {
        state.busy = false;
        return c.json({ error: 'Invalid request body' }, 400);
      }

      switch (body.type) {
        case 'prompt':
          return handlePrompt(
            agent,
            body,
            authContext,
            c.res,
            logger,
            () => {
              state.busy = false;
            },
            () => {
              state.busy = false;
            },
          );
        default:
          return c.json({ error: 'Unsupported invocation type' }, 400);
      }
    });
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
