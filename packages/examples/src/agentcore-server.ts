import * as fs from 'node:fs/promises';
import { type ServeConfig, serve } from '@looopy-ai/aws';
import {
  Agent,
  AgentToolProvider,
  FileSystemAgentStore,
  initializeTracing,
  LiteLLM,
  ShutdownManager,
  setDefaultLogger,
} from '@looopy-ai/core';
import * as dotenv from 'dotenv';
import pino from 'pino';
import {
  artifactToolProvider,
  localToolProvider,
  type MyContext,
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

const remoteAgent = AgentToolProvider.from<MyContext>(
  {
    name: 'RemoteAgent',
    description: 'Calls another agent as a tool',
    url: 'https://bedrock-agentcore.us-west-2.amazonaws.com/runtimes/arn%3Aaws%3Abedrock%2Dagentcore%3Aus%2Dwest%2D2%3A455014111722%3Aruntime%2Fdev%5Flooopy%5Fsample%2DtPpkM52leV',
    icon: 'lucide:headset',
  },
  async ({ authContext }) => {
    console.log('Auth context (getHeaders):', authContext);
    return {
      Authorization: authContext?.accessToken ? `Bearer ${authContext.accessToken}` : undefined,
    };
  },
);

const createAgent = async (contextId: string) => {
  const contextPath = `${agentPath}/context=${contextId}`;
  // Ensure directory exists for SSE log
  await fs.mkdir(contextPath, { recursive: true });

  const agentStore = new FileSystemAgentStore({
    basePath: BASE_PATH,
    agentId,
  });

  return new Agent<MyContext>({
    contextId,
    agentId,
    llmProvider,
    agentStore,
    messageStore: messageStore(agentId),
    plugins: [systemPrompt, localToolProvider, artifactToolProvider(agentId), remoteAgent],
    logger,
  });
};

const shutdown = new ShutdownManager();

export const decodeAuthorization = async (
  authorization: string,
): Promise<MyContext | undefined> => {
  if (!authorization.startsWith('Bearer ')) {
    return undefined;
  }

  return {
    accessToken: authorization.substring('Bearer '.length),
  };
};

serve<MyContext>({
  agent: createAgent,
  decodeAuthorization,
  logger,
  shutdown,
} as unknown as ServeConfig<MyContext>);

console.log('Server is running');
