import * as fs from 'node:fs/promises';
import { serve } from '@hono/node-server';
import {
  Agent,
  createArtifactTools,
  FileSystemArtifactStore,
  FileSystemMessageStore,
  FileSystemStateStore,
  initializeTracing,
  LiteLLM,
  localTools,
  SSEServer,
  setDefaultLogger,
} from '@looopy-ai/core';
import * as dotenv from 'dotenv';
import { Hono } from 'hono';
import pino from 'pino';
import { type MyContext, systemPrompt } from './configs/basic';
import { calculateTool, randomNumberTool, weatherTool } from './tools';

const agentId = 'sse-server';

dotenv.config();

// Initialize OpenTelemetry tracing (optional - only if OTEL_ENABLED=true)
if (process.env.OTEL_ENABLED === 'true') {
  initializeTracing({
    serviceName: 'kitchen-sink-agent',
    serviceVersion: '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    enabled: true,
  });
  console.log('✅ OpenTelemetry tracing enabled');
}

// Configuration
const LITELLM_URL = process.env.LITELLM_URL || 'http://localhost:4000';
const LITELLM_API_KEY = process.env.LITELLM_API_KEY;
const BASE_PATH = process.env.AGENT_STORE_PATH || './_agent_store';

const app = new Hono();
const sseServer = new SSEServer();

// Emit events
app.post('/sse/:contextId', async (c) => {
  const contextId = c.req.param('contextId');
  const storagePath = `${BASE_PATH}/agent=${agentId}/context=${contextId}`;

  await fs.mkdir(storagePath, { recursive: true });

  // Create logger
  const logger = pino(
    {
      level: 'debug',
      base: undefined, // Omit pid and hostname
      timestamp: false, // Omit time
      formatters: {
        log(object) {
          // Filter out taskId from log objects
          const { time: _time, taskId: _taskId, contextId: _contextId, ...rest } = object;
          return rest;
        },
      },
    },
    pino.destination({
      dest: `${storagePath}/logger.jsonl`,
      sync: false,
    }),
  );
  setDefaultLogger(logger);

  const taskStateStore = new FileSystemStateStore({ basePath: BASE_PATH });
  const messageStore = new FileSystemMessageStore({ basePath: BASE_PATH, agentId });
  const artifactStore = new FileSystemArtifactStore({ basePath: BASE_PATH, agentId });
  // const contextStore = new FileSystemContextStore({ basePath: BASE_PATH });

  const llmProvider = LiteLLM.novaLite(
    LITELLM_URL,
    LITELLM_API_KEY,
    `${storagePath}/llm-debug.log`,
  );

  // Local tools provider
  const localToolProvider = localTools([calculateTool, randomNumberTool, weatherTool]);

  // Artifact tools provider
  const artifactToolProvider = createArtifactTools(artifactStore, taskStateStore);

  // Create agent
  console.log('🎯 Creating agent...\n');
  const agent = new Agent<MyContext>({
    contextId,
    agentId,
    llmProvider,
    toolProviders: [localToolProvider, artifactToolProvider],
    messageStore,
    plugins: [systemPrompt],
    logger,
  });

  const event = await c.req.json();
  const turn = await agent.startTurn(event.message);

  turn.subscribe({
    next: (evt) => {
      sseServer.emit(contextId, evt);
    },
    complete: async () => {
      await agent.shutdown();
      sseServer.shutdown();
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
            logger.info({ contextId }, 'SSE connection ended by client');
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
      // subscription.unsubscribe();
    },
  });

  return new Response(stream, res);
});

console.log('SSE Server running on http://localhost:3000');
serve({
  fetch: app.fetch,
  port: 3000,
});
