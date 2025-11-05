#!/usr/bin/env node
/**
 * Kitchen Sink Example - Complete Interactive CLI Agent
 *
 * This example brings together all components of the Looopy framework:
 * - Agent lifecycle management (multi-turn conversations)
 * - Filesystem-based persistence (state, messages, artifacts)
 * - LiteLLM provider (real LLM integration)
 * - Local tools (calculator, weather, random numbers)
 * - Artifact creation and management
 * - Interactive CLI interface
 * - OpenTelemetry tracing (optional)
 *
 * Directory Structure:
 * ./_agent_store/agent={agentId}/
 *   └── context={contextId}/
 *       ├── context.json  # Context/session metadata
 *       ├── context.lock  # Context lock file
 *       ├── task/         # Per-task checkpoint state (JSON)
 *       ├── messages/     # Conversation history (timestamped JSON files)
 *       └── artifacts/    # Created artifacts (organized by ID)
 *
 * Usage:
 *   pnpm tsx examples/kitchen-sink.ts
 *   pnpm tsx examples/kitchen-sink.ts --context-id my-session
 *   pnpm tsx examples/kitchen-sink.ts --agent-id my-agent --context-id my-session
 *
 * To run: tsx examples/kitchen-sink.ts
 */

import dotenv from 'dotenv';
import * as readline from 'node:readline';
import * as pino from 'pino';
import { Agent } from '../src/core/agent';
import { initializeTracing, shutdownTracing } from '../src/observability/tracing';
import { LiteLLM } from '../src/providers/litellm-provider';
import { FileSystemArtifactStore } from '../src/stores/filesystem/filesystem-artifact-store';
import { FileSystemContextStore } from '../src/stores/filesystem/filesystem-context-store';
import { FileSystemMessageStore } from '../src/stores/filesystem/filesystem-message-store';
import { FileSystemStateStore } from '../src/stores/filesystem/filesystem-task-state-store';
import { createArtifactTools } from '../src/tools/artifact-tools';
import { localTools } from '../src/tools/local-tools';
import { calculateTool, randomNumberTool, weatherTool } from './tools';

dotenv.config();

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

// Configuration
const LITELLM_URL = process.env.LITELLM_URL || 'http://localhost:4000';
const LITELLM_API_KEY = process.env.LITELLM_API_KEY;
const BASE_PATH = process.env.AGENT_STORE_PATH || './_agent_store';
const OTEL_ENABLED = process.env.OTEL_ENABLED === 'true';

// Parse command line arguments
function parseArgs(): { agentId: string; contextId: string | null } {
  const args = process.argv.slice(2);
  let agentId = 'kitchen-sink-agent';
  let contextId: string | null = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--agent-id' && args[i + 1]) {
      agentId = args[i + 1];
      i++;
    } else if (args[i] === '--context-id' && args[i + 1]) {
      contextId = args[i + 1];
      i++;
    }
  }

  return { agentId, contextId };
}

// Generate a simple context ID if not provided
function generateContextId(): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  return `session-${timestamp}`;
}

// Main CLI interface
async function main() {
  console.log('🚀 Looopy Kitchen Sink Example - Interactive CLI Agent\n');

  const { agentId, contextId: providedContextId } = parseArgs();
  const contextId = providedContextId || generateContextId();

  console.log(`Agent ID: ${agentId}`);
  console.log(`Context ID: ${contextId}`);
  console.log(`Storage Path: ${BASE_PATH}/agent=${agentId}/context=${contextId}/`);
  console.log('');

  // Initialize stores
  console.log('📁 Initializing filesystem stores...');
  const stateStore = new FileSystemStateStore({ basePath: BASE_PATH });
  const messageStore = new FileSystemMessageStore({ basePath: BASE_PATH, agentId });
  const artifactStore = new FileSystemArtifactStore({ basePath: BASE_PATH, agentId });
  const contextStore = new FileSystemContextStore({ basePath: BASE_PATH });

  // Initialize LLM provider
  console.log('🤖 Connecting to LiteLLM...');
  const llmProvider = LiteLLM.novaLite(LITELLM_URL, LITELLM_API_KEY);

  // Initialize tools
  console.log('🔧 Setting up tools...');

  // Local tools provider
  const localToolProvider = localTools([calculateTool, randomNumberTool, weatherTool]);

  // Artifact tools provider (needs stateStore)
  const artifactToolProvider = createArtifactTools(artifactStore, stateStore);

  // System prompt
  const systemPrompt = `You are a helpful AI assistant with access to various tools.

Available capabilities:
- Mathematical calculations (calculate)
- Random number generation (get_random_number)
- Weather information (get_weather)
- Artifact creation and management (artifact_update, list_artifacts, get_artifact)

When creating artifacts:
- Use artifact_update with the same artifactId for all updates to the same artifact
- Set append=true to add content, append=false to replace content
- Set lastChunk=true on the final update to mark the artifact as complete
- Artifacts can contain text, data, or structured information

Be concise and helpful in your responses.`;

  // Create logger (pino.default for CommonJS modules)
  const logger = OTEL_ENABLED ? undefined : pino.default({ level: 'error' });

  // Create agent
  console.log('🎯 Creating agent...\n');
  const agent = new Agent({
    contextId,
    agentId,
    llmProvider,
    toolProviders: [localToolProvider, artifactToolProvider],
    messageStore,
    artifactStore,
    systemPrompt,
    autoSave: true,
    logger,
  });

  // Initialize or load context state
  let contextState = await contextStore.load(contextId);
  if (!contextState) {
    // Create new context
    contextState = {
      contextId,
      agentId,
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
      turnCount: 0,
      systemPrompt,
    };
    await contextStore.save(contextState);
    console.log('✨ Created new context session');
  } else {
    console.log(`📂 Loaded existing context (${contextState.turnCount} turns)`);
    if (contextState.title) {
      console.log(`   Title: ${contextState.title}`);
    }
    if (contextState.tags?.length) {
      console.log(`   Tags: ${contextState.tags.join(', ')}`);
    }
  }
  console.log('');

  console.log('✅ Agent ready! Type your messages below.');
  console.log('   Commands: /quit, /exit, /history, /artifacts, /clear');
  console.log('            /contexts, /title <title>, /tag <tag>, /info\n');

  // Handle commands
  async function handleCommand(input: string, rl: readline.Interface): Promise<boolean> {
    if (input === '/quit' || input === '/exit') {
      console.log('\n👋 Shutting down agent...');
      await agent.shutdown();

      // Shutdown tracing if enabled
      if (process.env.OTEL_ENABLED === 'true') {
        console.log('Purging trace data...');
        await shutdownTracing();
        // sleep for 2 seconds
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }

      console.log('✅ Goodbye!');
      rl.close();
      return true;
    }

    if (input === '/history') {
      console.log('\n📜 Conversation History:');
      const messages = await messageStore.getAll(contextId);
      for (const msg of messages) {
        const preview = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
        console.log(`  [${msg.role}]: ${preview.slice(0, 100)}...`);
      }
      console.log('');
      rl.prompt();
      return true;
    }

    if (input === '/artifacts') {
      console.log('\n📦 Artifacts:');
      console.log('  (Artifact listing would be shown here)');
      console.log('');
      rl.prompt();
      return true;
    }

    if (input === '/clear') {
      console.log('\n🗑️  Clearing conversation...');
      await messageStore.clear(contextId);
      console.log('✅ Conversation cleared!');
      console.log('');
      rl.prompt();
      return true;
    }

    if (input === '/contexts') {
      console.log('\n📂 Available Contexts:');
      const contexts = await contextStore.list({ agentId });
      if (contexts.length === 0) {
        console.log('  No contexts found.');
      } else {
        for (const ctx of contexts) {
          const current = ctx.contextId === contextId ? ' (current)' : '';
          const title = ctx.title ? ` - ${ctx.title}` : '';
          const lastActivity = new Date(ctx.lastActivityAt).toLocaleString();
          console.log(
            `  ${ctx.contextId}${current}${title}\n    Status: ${ctx.status}, Turns: ${ctx.turnCount}, Last: ${lastActivity}`
          );
        }
      }
      console.log('');
      rl.prompt();
      return true;
    }

    if (input.startsWith('/title ')) {
      const title = input.slice(7).trim();
      await contextStore.update(contextId, { title });
      console.log(`✅ Title set to: ${title}\n`);
      rl.prompt();
      return true;
    }

    if (input.startsWith('/tag ')) {
      const tag = input.slice(5).trim();
      const current = await contextStore.load(contextId);
      const tags = [...(current?.tags || []), tag];
      await contextStore.update(contextId, { tags });
      console.log(`✅ Added tag: ${tag}\n`);
      rl.prompt();
      return true;
    }

    if (input === '/info') {
      const current = await contextStore.load(contextId);
      if (current) {
        console.log('\n📊 Context Information:');
        console.log(`  Context ID: ${current.contextId}`);
        console.log(`  Agent ID: ${current.agentId}`);
        console.log(`  Status: ${current.status}`);
        console.log(`  Title: ${current.title || '(none)'}`);
        console.log(`  Tags: ${current.tags?.join(', ') || '(none)'}`);
        console.log(`  Turns: ${current.turnCount}`);
        console.log(`  Created: ${new Date(current.createdAt).toLocaleString()}`);
        console.log(`  Last Activity: ${new Date(current.lastActivityAt).toLocaleString()}`);
        if (current.messageCount) {
          console.log(`  Messages: ${current.messageCount}`);
        }
        if (current.artifactCount) {
          console.log(`  Artifacts: ${current.artifactCount}`);
        }
        if (current.totalTokensUsed) {
          console.log(`  Tokens Used: ${current.totalTokensUsed}`);
        }
      }
      console.log('');
      rl.prompt();
      return true;
    }

    return false;
  }

  // Handle agent events
  function handleAgentEvent(event: import('../src/core/types').AgentEvent) {
    if (event.kind === 'status-update') {
      handleStatusUpdate(event);
    } else if (event.kind === 'artifact-update' && event.lastChunk) {
      console.log(`📦 Artifact created: ${event.artifact.artifactId}`);
    }
  }

  function handleStatusUpdate(event: import('../src/core/types').StatusUpdateEvent) {
    const { state } = event.status;

    if (state === 'working') {
      process.stdout.write('🤔 ');
    } else if (state === 'completed' && event.final && event.status.message?.content) {
      console.log(`🤖 ${event.status.message.content}`);
    } else if (state === 'failed') {
      console.error('❌ Error:', event.metadata?.error || 'Unknown error');
    }
  }

  // Create readline interface
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '> ',
  });

  // Handle user input
  rl.prompt();

  rl.on('line', async (line) => {
    const input = line.trim();

    if (!input) {
      rl.prompt();
      return;
    }

    // Handle commands
    const handled = await handleCommand(input, rl);
    if (handled) {
      return;
    }

    // Process user message
    try {
      console.log('');
      const events$ = await agent.startTurn(input);

      // Subscribe to events
      events$.subscribe({
        next: (event) => handleAgentEvent(event),
        error: async (err) => {
          console.error('\n❌ Error:', err.message);
          console.log('');
          rl.prompt();
        },
        complete: async () => {
          // Update context state after turn
          const updates: any = {
            turnCount: (contextState?.turnCount || 0) + 1,
            lastActivityAt: new Date().toISOString(),
          };

          // Auto-generate title from first user message if not set
          if (!contextState?.title && contextState?.turnCount === 0) {
            const truncated = input.slice(0, 50);
            updates.title = truncated.length < input.length ? `${truncated}...` : truncated;
          }

          await contextStore.update(contextId, updates);

          // Reload context state for next turn
          contextState = await contextStore.load(contextId);

          console.log('');
          rl.prompt();
        },
      });
    } catch (error) {
      console.error('❌ Error:', (error as Error).message);
      console.log('');
      rl.prompt();
    }
  });

  rl.on('close', () => {
    process.exit(0);
  });

  // Handle process termination
  process.on('SIGINT', async () => {
    console.log('\n\n👋 Shutting down agent...');
    await agent.shutdown();
    console.log('✅ Goodbye!');
    process.exit(0);
  });
}

// Run
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
