#!/usr/bin/env node

/**
 * Kitchen Sink Example - Complete Interactive CLI Agent
 *
 * This example brings together all components of the Looopy framework:
 * - Agent lifecycle management (multi-turn conversations)
 * - Filesystem-based persistence (state, messages, artifacts)
 * - LiteLLM provider (real LLM integration)
 * - Local tools (calculator, weather, random numbers)
 * - Artifact creation and management (NEW: discriminated union types)
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
 *           └── {artifactId}/
 *               ├── metadata.json  # FileArtifact | DataArtifact | DatasetArtifact
 *               ├── content.txt    # File content (chunks appended)
 *               ├── data.json      # Data content
 *               └── rows.jsonl     # Dataset rows
 *
 * Usage:
 *   pnpm tsx examples/kitchen-sink.ts
 *   pnpm tsx examples/kitchen-sink.ts --context-id my-session
 *   pnpm tsx examples/kitchen-sink.ts --agent-id my-agent --context-id my-session
 *
 * To run: tsx examples/kitchen-sink.ts
 */

import dotenv from 'dotenv';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as readline from 'node:readline';
import * as pino from 'pino';
import { Agent } from '../src/core/agent';
import type { StoredArtifact } from '../src/core/types';
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
  const taskStateStore = new FileSystemStateStore({ basePath: BASE_PATH });
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

  // Artifact tools provider (NEW: uses discriminated union types)
  const artifactToolProvider = createArtifactTools(artifactStore, taskStateStore);

  // System prompt
  const systemPrompt = `You are a helpful AI assistant with access to various tools.

Available capabilities:
- Mathematical calculations (calculate)
- Random number generation (get_random_number)
- Weather information (get_weather)
- Thought streaming (think_aloud): Share your reasoning process with users
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

Thinking Out Loud:
Use the think_aloud tool to share your reasoning process, especially when:
- Planning your approach to a complex task (thought_type: "planning")
- Working through a multi-step problem (thought_type: "reasoning")
- Making decisions between alternatives (thought_type: "decision", include alternatives array)
- Reflecting on what you've done (thought_type: "reflection")
- Noticing important details in the user's request (thought_type: "observation")

Important: Provide a thought_id (like "initial_plan", "step1", "weather_check") so you can reference
thoughts later using related_to. This helps create chains of reasoning.

Example: Before calling multiple tools, use think_aloud to explain your plan:
  think_aloud({
    thought_id: "initial_plan",
    thought: "I'll first get the weather, then calculate if temperature conversion is needed",
    thought_type: "planning",
    confidence: 0.9
  })

Then later you can reference it:
  think_aloud({
    thought_id: "weather_retrieved",
    thought: "Got the weather data, now I see it's in Celsius",
    thought_type: "observation",
    related_to: "initial_plan"
  })

When creating artifacts:
- File artifacts: Use create_file_artifact, then append_file_chunk (set isLastChunk=true on final chunk)
- Data artifacts: Use create_data_artifact with JSON data object
- Dataset artifacts: Use create_dataset_artifact with schema, then append_dataset_row or append_dataset_rows

Be concise and helpful in your responses.`;

  // Create logger (pino.default for CommonJS modules)
  const logger = OTEL_ENABLED ? undefined : pino.default({ level: 'error' });

  // Create agent
  console.log('🎯 Creating agent...\n');
  const agent = new Agent({
    contextId,
    agentId,
    llmProvider,
    toolProviders: [localToolProvider], // HACK: artifact tool calls have been removed
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
  console.log('            /contexts, /title <title>, /tag <tag>, /info');
  console.log('            /sse-log [lines], /clear-sse-log\n');

    console.log('');

  // SSE Log File Path
  const sseLogPath = path.join(
    BASE_PATH,
    `agent=${agentId}`,
    `context=${contextId}`,
    'sse-log.txt'
  );

  // Ensure directory exists for SSE log
  await fs.mkdir(path.dirname(sseLogPath), { recursive: true });

  // Helper to log events in SSE format
  async function logSSEEvent(event: import('../src/core/types').AgentEvent): Promise<void> {
    try {
      const timestamp = new Date().toISOString();

      // Create a safe JSON string using the replacer function
      const seen = new WeakSet();

      const {kind, contextId, taskId, ...data} = Object.fromEntries(Object.entries(event).filter(([key]) => !key.startsWith('_')));

      const safeJSON = JSON.stringify(data, (_key: string, value: any): any => {
        // Handle null/undefined
        if (value === null || value === undefined) {
          return value;
        }

        // Handle primitives
        if (typeof value !== 'object') {
          return value;
        }

        // Detect circular references
        if (seen.has(value)) {
          return '[Circular]';
        }

        // Skip known non-serializable objects by checking constructor names
        const constructorName = value.constructor?.name;
        if (
          constructorName === 'SpanImpl' ||
          constructorName === 'Span' ||
          constructorName === 'MultiSpanProcessor' ||
          constructorName === 'BatchSpanProcessor' ||
          constructorName === 'SimpleSpanProcessor' ||
          constructorName?.includes('SpanProcessor') ||
          constructorName?.includes('Tracer')
        ) {
          return '[OpenTelemetry Object]';
        }

        // Mark object as seen
        seen.add(value);

        return value;
      });

      const lines = [
        'event: ' + kind,
        'task_id: ' + taskId,
        'data: ' + safeJSON,
        'when: ' + timestamp,
        '',
        ''
      ];

      await fs.appendFile(sseLogPath, lines.join('\n'), 'utf-8');
    } catch (error) {
      console.error('Failed to log SSE event:', error);
    }
  }

  // Helper to display artifact info
  function getArtifactTypeInfo(artifact: StoredArtifact): string {
    if (artifact.type === 'file') {
      return `File (${artifact.mimeType}) - ${artifact.totalSize} bytes`;
    }
    if (artifact.type === 'data') {
      return 'Data';
    }
    return `Dataset - ${artifact.totalSize} rows`;
  }

  // Command handlers
  const commandHandlers: Record<
    string,
    (input: string, rl: readline.Interface) => Promise<boolean>
  > = {
    async '/quit'(_input: string, rl: readline.Interface): Promise<boolean> {
      console.log('\n👋 Shutting down agent...');
      await agent.shutdown();

      if (process.env.OTEL_ENABLED === 'true') {
        console.log('Purging trace data...');
        await shutdownTracing();
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }

      console.log('✅ Goodbye!');
      rl.close();
      return true;
    },

    async '/exit'(input: string, rl: readline.Interface): Promise<boolean> {
      return commandHandlers['/quit'](input, rl);
    },

    async '/history'(): Promise<boolean> {
      console.log('\n📜 Conversation History:');
      const messages = await messageStore.getAll(contextId);
      for (const msg of messages) {
        const preview = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
        console.log(`  [${msg.role}]: ${preview.slice(0, 100)}...`);
      }
      console.log('');
      return false;
    },

    async '/artifacts'(): Promise<boolean> {
      console.log('\n📦 Artifacts:');
      const artifactIds = await artifactStore.queryArtifacts({ contextId });
      if (artifactIds.length === 0) {
        console.log('  No artifacts found.');
      } else {
        for (const artifactId of artifactIds) {
          const artifact = await artifactStore.getArtifact(artifactId);
          if (!artifact) continue;

          console.log(`  ${artifact.artifactId} - ${artifact.name || '(unnamed)'}`);
          console.log(`    Type: ${getArtifactTypeInfo(artifact)}`);
          console.log(`    Created: ${new Date(artifact.createdAt).toLocaleString()}`);
        }
      }
      console.log('');
      return false;
    },

    async '/clear'(): Promise<boolean> {
      console.log('\n🗑️  Clearing conversation...');
      await messageStore.clear(contextId);
      console.log('✅ Conversation cleared!');
      console.log('');
      return false;
    },

    async '/contexts'(): Promise<boolean> {
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
      return false;
    },

    async '/info'(): Promise<boolean> {
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
      return false;
    },

    async '/clear-sse-log'(): Promise<boolean> {
      console.log('\n🗑️  Clearing SSE log...');
      try {
        await fs.writeFile(sseLogPath, '', 'utf-8');
        console.log('✅ SSE log cleared!');
      } catch (error) {
        console.error('❌ Failed to clear SSE log:', (error as Error).message);
      }
      console.log('');
      return false;
    },
  };

  // Handle commands
  async function handleCommand(input: string, rl: readline.Interface): Promise<boolean> {
    // Check exact command match
    if (commandHandlers[input]) {
      const shouldExit = await commandHandlers[input](input, rl);
      if (!shouldExit) {
        rl.prompt();
      }
      return true;
    }

    // Check prefixed commands
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

    if (input.startsWith('/sse-log')) {
      const args = input.split(' ');
      const lineCount = args[1] ? Number.parseInt(args[1], 10) : 50;

      console.log(`\n📡 SSE Event Log (last ${lineCount} lines):`);
      try {
        const content = await fs.readFile(sseLogPath, 'utf-8');
        const lines = content.split('\n').filter(l => l.trim());
        const lastLines = lines.slice(-lineCount);

        if (lastLines.length === 0) {
          console.log('  (empty)');
        } else {
          for (const line of lastLines) {
            console.log(`  ${line}`);
          }
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          console.log('  (no log file yet)');
        } else {
          console.error('❌ Failed to read SSE log:', (error as Error).message);
        }
      }
      console.log('');
      rl.prompt();
      return true;
    }

    return false;
  }

  // Handle agent events
  async function handleAgentEvent(event: import('../src/core/types').AgentEvent) {
    // Log all events to SSE log file
    await logSSEEvent(event);

    // Handle specific events for console output
    if (event.kind === 'task-status') {
      handleTaskStatus(event);
    } else if (event.kind === 'content-complete') {
      console.log(`📦 Content completed`);
    }
  }

  function handleTaskStatus(event: { kind: 'task-status'; status: string; message?: string }) {
    const { status } = event;

    if (status === 'working') {
      process.stdout.write('🤔 ');
    } else if (status === 'completed' && event.message) {
      console.log(`🤖 ${event.message}`);
    } else if (status === 'failed') {
      console.error('❌ Error:', event.message || 'Unknown error');
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
          const updates: {
            turnCount: number;
            lastActivityAt: string;
            title?: string;
          } = {
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
