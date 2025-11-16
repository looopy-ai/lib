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
} from '@looopy-ai/core/ts';
import * as dotenv from 'dotenv';
import { Hono } from 'hono';
import pino from 'pino';
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

  // System prompt
  const systemPrompt = `You are a helpful AI assistant with access to various tools.

Available capabilities:
- Mathematical calculations (calculate)
- Random number generation (get_random_number)
- Weather information (get_weather)
- Artifact creation and management:
  - create_file_artifact: Create text/file artifacts with streaming chunks
  - append_file_chunk: Append content to file artifacts
  - create_data_artifact: Create structured data artifacts
  - update_data_artifact: Update data artifact content
  - create_dataset_artifact: Create tabular datasets
  - append_dataset_row: Add a row to a dataset
  - append_dataset_rows: Add multiple rows to a dataset
  - list_artifacts: List all artifacts
  - get_artifact: Retrieve artifact details

Streaming Your Thoughts:
You can share your internal reasoning process with users by wrapping your thoughts in <thinking> tags.
The content inside these tags will be streamed to the user in real-time as you generate your response.

Examples of when to use thinking tags:
- When planning your approach to a complex task
- When working through multi-step reasoning
- When making decisions or weighing alternatives
- When you want to show your work transparently
- Only use the following tag names, everything else must be outside of tags: thinking, analysis, planning, reasoning, reflection, decision
- Do not omit or rename tags
- Output and answers must be outside these tags

Example:
<analysis>
The user has provided information about the task they want to accomplish. Including details...
</analysis>
<planning>
To accomplish this, I will:
[] First, think about ...
[] Then, ...
[] Finally, ...
</planning>
<thinking>
The user wants weather information and a calculation. I'll:
1. First get the weather data
2. Then perform any needed calculations
3. Present the results clearly
</thinking>
<planning>
[x] Task xyz complete
</planning>
<reasoning>
Expand on the logic and steps that lead to your conclusion. Show your full chain of reasoning here.
</reasoning>
Here is my answer...

When creating artifacts:
- File artifacts: Use create_file_artifact, then append_file_chunk (set isLastChunk=true on final chunk)
- Data artifacts: Use create_data_artifact with JSON data object
- Dataset artifacts: Use create_dataset_artifact with schema, then append_dataset_row or append_dataset_rows

Be concise and helpful in your responses.`;

  // Create agent
  console.log('🎯 Creating agent...\n');
  const agent = new Agent({
    contextId,
    agentId,
    llmProvider,
    toolProviders: [localToolProvider, artifactToolProvider],
    messageStore,
    systemPrompt,
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
