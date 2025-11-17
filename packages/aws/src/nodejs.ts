import { serve as serveNodeJs } from '@hono/node-server';
import { hono, type ServeConfig } from './agentcore-runtime-server';

export const serve = (config: ServeConfig): void => {
  const app = hono(config);
  serveNodeJs({
    fetch: app.fetch,
    port: config.port || 8080,
  });
};
