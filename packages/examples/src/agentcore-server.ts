import * as fs from 'node:fs/promises';
import { serve } from '@looopy-ai/aws/ts';
import {
  Agent,
  FileSystemAgentStore,
  initializeTracing,
  LiteLLM,
  ShutdownManager,
  setDefaultLogger,
} from '@looopy-ai/core/ts';
import * as dotenv from 'dotenv';
import pino from 'pino';
import {
  artifactToolProvider,
  localToolProvider,
  messageStore,
  systemPrompt,
} from './configs/basic';

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

const agentId = 'agentcore-runtime-example';
const agentPath = `${BASE_PATH}/agent=${agentId}`;
await fs.mkdir(agentPath, { recursive: true });

// Create logger
const logger = pino(
  {
    level: 'debug',
    base: undefined, // Omit pid and hostname
    timestamp: false, // Omit time
    // formatters: {
    //   log(object) {
    //     // Filter out taskId from log objects
    //     const { time: _time, taskId: _taskId, contextId: _contextId, ...rest } = object;
    //     return rest;
    //   },
    // },
  },
  pino.destination({
    dest: `${agentPath}/logger.jsonl`,
    sync: false,
  }),
);
setDefaultLogger(logger);

const llmProvider = LiteLLM.novaLite(LITELLM_URL, LITELLM_API_KEY);

const createAgent = async (contextId: string) => {
  const contextPath = `${agentPath}/context=${contextId}`;
  // Ensure directory exists for SSE log
  await fs.mkdir(contextPath, { recursive: true });

  const agentStore = new FileSystemAgentStore({
    basePath: BASE_PATH,
    agentId,
  });

  return new Agent({
    contextId,
    agentId,
    llmProvider,
    agentStore,
    toolProviders: [localToolProvider, artifactToolProvider(agentId)],
    messageStore: messageStore(agentId),
    systemPrompt,
    logger,
  });
};

const shutdown = new ShutdownManager();

serve({
  agent: createAgent,
  logger,
  shutdown,
});

console.log('Server is running');
