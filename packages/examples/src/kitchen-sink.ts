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

import * as fsPromises from 'node:fs/promises';
import * as path from 'node:path';
import * as readline from 'node:readline';
import { LangfuseClient } from '@langfuse/client';
import type { ContextAnyEvent, StoredArtifact } from '@looopy-ai/core/ts';
import {
  Agent,
  AgentToolProvider,
  createArtifactTools,
  FileSystemArtifactStore,
  FileSystemContextStore,
  FileSystemMessageStore,
  FileSystemStateStore,
  getLogger,
  initializeTracing,
  LiteLLM,
  localTools,
  ShutdownManager,
  SkillRegistry,
  setDefaultLogger,
  shutdownTracing,
} from '@looopy-ai/core/ts';
import chalk from 'chalk';
import * as dotenv from 'dotenv';
import pino from 'pino';
import { diagrammerSkill } from './skills/diagrammer';
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

// Create skill registry
const skillRegistry = new SkillRegistry([diagrammerSkill]);

const langfuse = new LangfuseClient();

const getSystemPrompt = async () => {
  const prompt = await langfuse.prompt.get(
    process.env.LANGFUSE_PROMPT_NAME || 'looopy-kitchen-sink',
  );
  getLogger({ component: 'kitchen-sink' }).debug(
    { name: prompt.name, version: prompt.version },
    'Fetched system prompt from Langfuse',
  );
  const compiledPrompt = prompt.compile({});
  return { prompt: compiledPrompt, name: prompt.name, version: prompt.version };
};

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

const { agentId, contextId: providedContextId } = parseArgs();
const contextId = providedContextId || generateContextId();

const storagePath = `${BASE_PATH}/agent=${agentId}/context=${contextId}`;

// Main CLI interface
async function main() {
  // Ensure directory exists for SSE log
  await fsPromises.mkdir(storagePath, { recursive: true });

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

  console.log('🚀 Looopy Kitchen Sink Example - Interactive CLI Agent\n');

  console.log(`Agent ID: ${agentId}`);
  console.log(`Context ID: ${contextId}`);
  console.log(`Storage Path: ${storagePath}/`);
  console.log('');

  // Initialize stores
  console.log('📁 Initializing filesystem stores...');
  const taskStateStore = new FileSystemStateStore({ basePath: BASE_PATH });
  const messageStore = new FileSystemMessageStore({ basePath: BASE_PATH, agentId });
  const artifactStore = new FileSystemArtifactStore({ basePath: BASE_PATH, agentId });
  const contextStore = new FileSystemContextStore({ basePath: BASE_PATH });

  // Initialize LLM provider
  console.log('🤖 Connecting to LiteLLM...');
  const llmProvider = LiteLLM.novaLite(
    LITELLM_URL,
    LITELLM_API_KEY,
    `${storagePath}/llm-debug.log`,
  );

  // Initialize tools
  console.log('🔧 Setting up tools...');

  // Local tools provider
  const localToolProvider = localTools([
    calculateTool,
    randomNumberTool,
    weatherTool,
    skillRegistry.tool(),
  ]);

  // Artifact tools provider
  const artifactToolProvider = createArtifactTools(artifactStore, taskStateStore);

  const remoteAgent = AgentToolProvider.from({
    name: 'RemoteAgent',
    description: 'Calls another agent as a tool',
    url: process.env.REMOTE_AGENT_TOOL_PROVIDER_URL || 'http://localhost:5000',
    icon: 'lucide:cloud-upload',
  });

  // Create agent
  console.log('🎯 Creating agent...\n');
  const agent = new Agent({
    contextId,
    agentId,
    llmProvider,
    toolProviders: [localToolProvider, artifactToolProvider, remoteAgent],
    messageStore,
    systemPrompt: getSystemPrompt,
    skillRegistry,
    logger,
  });

  const shutdown = new ShutdownManager();
  shutdown.registerWatcher(async () => {
    console.log('\n👋 Shutting down agent...');
    await agent.shutdown();
  });

  console.log('');
  console.log('✅ Agent ready! Type your messages below.');
  console.log('   Commands: /quit, /exit, /history, /artifacts, /clear');
  console.log('            /contexts, /title <title>, /tag <tag>, /info');
  console.log('            /sse-debug [lines], /clear-sse-debug\n');

  console.log('');

  // SSE Log File Path
  const sseLogPath = path.join(storagePath, 'sse-debug.log');

  // Helper to log events in SSE format
  async function logSSEEvent(event: ContextAnyEvent): Promise<void> {
    try {
      if (event.kind === 'content-delta') return; // Skip content deltas

      const timestamp = new Date().toISOString();

      // Create a safe JSON string using the replacer function
      const seen = new WeakSet();

      const {
        kind,
        contextId: _contextId,
        taskId,
        ...data
      } = Object.fromEntries(Object.entries(event).filter(([key]) => !key.startsWith('_')));

      const safeJSON = JSON.stringify(data, (_key: string, value: unknown): unknown => {
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
        `event: ${kind}`,
        `task_id: ${taskId}`,
        `data: ${safeJSON}`,
        `when: ${timestamp}`,
        '',
        '',
      ];

      await fsPromises.appendFile(sseLogPath, lines.join('\n'), 'utf-8');
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

    async '/q'(input: string, rl: readline.Interface): Promise<boolean> {
      return commandHandlers['/quit'](input, rl);
    },

    async q(input: string, rl: readline.Interface): Promise<boolean> {
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
      const artifactIds = await artifactStore.listArtifacts(contextId);
      if (artifactIds.length === 0) {
        console.log('  No artifacts found.');
      } else {
        for (const artifactId of artifactIds) {
          const artifact = await artifactStore.getArtifact(contextId, artifactId);
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
            `  ${ctx.contextId}${current}${title}\n    Status: ${ctx.status}, Turns: ${ctx.turnCount}, Last: ${lastActivity}`,
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

    async '/clear-sse-debug'(): Promise<boolean> {
      console.log('\n🗑️  Clearing SSE log...');
      try {
        await fsPromises.writeFile(sseLogPath, '', 'utf-8');
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

    if (input.startsWith('/sse-debug')) {
      const args = input.split(' ');
      const lineCount = args[1] ? Number.parseInt(args[1], 10) : 50;

      console.log(`\n📡 SSE Event Log (last ${lineCount} lines):`);
      try {
        const content = await fsPromises.readFile(sseLogPath, 'utf-8');
        const lines = content.split('\n').filter((l) => l.trim());
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
  async function handleAgentEvent(event: ContextAnyEvent) {
    // Log all events to SSE log file
    await logSSEEvent(event);

    // Handle specific events for console output
    switch (event.kind) {
      case 'task-status':
        handleTaskStatus(event);
        break;
      case 'content-delta':
        await fsPromises.writeFile('/dev/stdout', chalk.dim(event.delta));
        // console.log(chalk.dim(event.delta));
        break;
      case 'content-complete':
        console.log(`\n\n📦 Content completed:\n${event.content}`);
        break;
      case 'thought-stream':
        handleThoughtEvent(event);
        break;
    }
  }

  function handleThoughtEvent(event: {
    kind: 'thought-stream';
    thoughtType: string;
    verbosity: string;
    content: string;
  }) {
    // Display thoughts with different icons based on type
    const icons: Record<string, string> = {
      planning: '📋',
      reasoning: '🧠',
      reflection: '🤔',
      decision: '⚖️',
      observation: '👁️',
      strategy: '♟️',
    };

    const icon = icons[event.thoughtType] || '💭';
    const verbosityLabel = event.verbosity === 'detailed' ? ' [detailed]' : '';

    console.log(chalk.italic(`\n${icon} ${event.thoughtType}${verbosityLabel}: ${event.content}`));
  }

  function handleTaskStatus(event: { kind: 'task-status'; status: string; message?: string }) {
    const { status } = event;

    if (status === 'working') {
      console.log('⏳ Working...');
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
}

// Run
main().catch((error) => {
  console.error('💣 Fatal error:', error);
  process.exit(1);
});
