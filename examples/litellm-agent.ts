/**
 * LiteLLM Agent Example
 *
 * Demonstrates using the agent loop with a real LiteLLM provider.
 *
 * Prerequisites:
 * 1. Start LiteLLM proxy: `litellm --model gpt-3.5-turbo`
 * 2. Or use docker: `docker run -p 4000:4000 ghcr.io/berriai/litellm:main-latest`
 *
 * To run: tsx examples/litellm-agent.ts
 */

import dotenv from 'dotenv';
import { AgentLoop } from '../src/core/agent-loop';
import { createLogger } from '../src/core/logger';
import { initializeTracing, shutdownTracing } from '../src/observability/tracing';
import { LiteLLM } from '../src/providers/litellm-provider';
import { InMemoryArtifactStore } from '../src/stores/artifacts';
import { InMemoryStateStore } from '../src/stores/memory/memory-state-store';
import { localTools } from '../src/tools/local-tools';
import { calculateTool, randomNumberTool } from './tools';

dotenv.config({ path: '/custom/path/to/.env' });

// Initialize OpenTelemetry tracing (optional - only if OTEL_ENABLED=true)
if (process.env.OTEL_ENABLED === 'true') {
  initializeTracing({
    serviceName: 'litellm-agent-example',
    serviceVersion: '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    enabled: true,
  });
  console.log('✅ OpenTelemetry tracing enabled');
}

// Create logger for the example
const logger = createLogger({
  level: 'debug',
  pretty: true,
});

// Create tool provider with reusable tools
const toolProvider = localTools([calculateTool, randomNumberTool]);

async function main() {
  console.log('🚀 LiteLLM Agent Example\n');
  console.log('='.repeat(70));

  // Configuration
  const LITELLM_URL = process.env.LITELLM_URL || 'http://localhost:4000';
  const LITELLM_API_KEY = process.env.LITELLM_API_KEY;

  console.log(`\n📡 LiteLLM URL: ${LITELLM_URL}`);
  console.log(`🔑 API Key: ${LITELLM_API_KEY ? '***' : 'none'}\n`);
  console.log('='.repeat(70));

  // Create LLM provider using factory
  const llmProvider = LiteLLM.novaMicro(LITELLM_URL, LITELLM_API_KEY);

  // Or create custom provider:
  // const llmProvider = new LiteLLMProvider({
  //   baseUrl: LITELLM_URL,
  //   model: 'gpt-4',
  //   apiKey: LITELLM_API_KEY,
  //   temperature: 0.7,
  //   maxTokens: 2000,
  // });

  // Create agent loop
  const agentLoop = new AgentLoop({
    agentId: 'math-assistant',
    llmProvider,
    toolProviders: [toolProvider],
    stateStore: new InMemoryStateStore(),
    artifactStore: new InMemoryArtifactStore(),
    maxIterations: 10,
    systemPrompt:
      'You are a helpful math assistant. Use the available tools to help users with calculations.',
    logger, // Pass logger to agent loop
  });

  // Example prompts to try
  const prompts = [
    'Calculate 15 * 23 + 47',
    'Generate a random number between 1 and 100',
    'What is (123 + 456) * 2?',
  ];

  const selectedPrompt = prompts[Math.floor(Math.random() * prompts.length)];

  console.log(`\n💬 User: ${selectedPrompt}`);
  console.log('='.repeat(70));

  // Execute
  const events$ = agentLoop.execute(selectedPrompt);

  // Track events
  let eventCount = 0;

  events$.subscribe({
    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: for the sake of the example
    next: (event) => {
      eventCount++;
      console.log(`\n[${eventCount}] 📡 Event: ${event.kind}`);

      switch (event.kind) {
        case 'task':
          console.log(`    Task ID: ${event.id}`);
          console.log(`    Status: ${event.status.state}`);
          break;

        case 'status-update':
          console.log(`    Status: ${event.status.state}`);
          if (event.status.message) {
            console.log(`    Message: ${event.status.message.content}`);
          }
          if (event.final) {
            console.log(`    ✅ FINAL EVENT`);
          }
          break;

        case 'artifact-update':
          console.log(`    Artifact: ${event.artifact.artifactId}`);
          if (event.artifact.parts.length > 0) {
            const part = event.artifact.parts[0];
            if (part.kind === 'text') {
              console.log(`    Content: ${part.text}`);
            }
          }
          break;

        default:
          if (event.kind.startsWith('internal:')) {
            console.log(`    [Internal - not sent over A2A]`);
          }
      }
    },

    error: (error) => {
      console.error('\n❌ Error:', error.message);
      console.error('\nTroubleshooting:');
      console.error('1. Is LiteLLM proxy running on', LITELLM_URL, '?');
      console.error('2. Start it with: litellm --model gpt-3.5-turbo');
      console.error('3. Or check your API key configuration');
    },

    complete: () => {
      console.log(`\n${'='.repeat(70)}`);
      console.log(`✅ Completed! Total events: ${eventCount}`);
      console.log('='.repeat(70));

      // Shutdown tracing if enabled
      if (process.env.OTEL_ENABLED === 'true') {
        shutdownTracing()
          .then(() => console.log('✅ Tracing shutdown complete'))
          .catch((err) => console.error('Error shutting down tracing:', err));
      }
    },
  });
}

// Run the example
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
