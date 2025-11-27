import { serve as serveNodeJs } from '@hono/node-server';
import { hono, type ServeConfig } from './agentcore-runtime-server';

export const serve = <AuthContext>(config: ServeConfig<AuthContext>): void => {
  const app = hono(config);
  const server = serveNodeJs({
    fetch: app.fetch,
    port: config.port || 8080,
  });

  config.shutdown?.registerWatcher(async () => {
    server.close();
    config.logger?.info('Server has been shut down');
  }, 1000);
};
