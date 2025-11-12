/**
 * Basic Agent Example
 *
 * Demonstrates the stateful Agent API for multi-turn conversations
 * with automatic message and artifact persistence.
 *
 * Key features:
 * - Auto-initialization on first turn (no explicit start() needed)
 * - Per-turn authentication context for fresh tokens
 * - Automatic state persistence with autoSave
 * - Manual save() for explicit checkpoints
 * - Resume from same contextId
 *
 * Design: design/agent-lifecycle.md
 */

import dotenv from 'dotenv';
import { Agent } from '../src/core';
import { initializeTracing, shutdownTracing } from '../src/observability/tracing';
import { LiteLLM } from '../src/providers/litellm-provider';
import { InMemoryArtifactStore } from '../src/stores/artifacts/memory-artifact-store';
import { InMemoryMessageStore } from '../src/stores/messages/memory-message-store';
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

const contextId = `ctx-${Date.now()}`;

async function main() {
  console.log('=== Basic Agent Example ===\n');

  // Configuration
  const LITELLM_URL = process.env.LITELLM_URL || 'http://localhost:4000';
  const LITELLM_API_KEY = process.env.LITELLM_API_KEY;

  // Create tool provider with local tools
  const toolProvider = localTools([calculateTool, randomNumberTool, weatherTool]);

  // Create shared stores (in real app, these would be Redis/database-backed)
  const messageStore = new InMemoryMessageStore();
  const artifactStore = new InMemoryArtifactStore();

  // Create an agent with persistent state
  const agent = new Agent({
    agentId: 'lifecycle-example',
    contextId,
    llmProvider: LiteLLM.novaMicro(LITELLM_URL, LITELLM_API_KEY),
    toolProviders: [toolProvider],
    messageStore,
    artifactStore,
    systemPrompt: 'You are a helpful assistant.',
    autoSave: true, // Automatically save messages after each turn
  });

  // Note: No agent.start() needed! Agent auto-initializes on first startTurn()
  console.log(`Agent created. Initial state: ${agent.state.status}\n`);

  // Simulate getting auth context (e.g., from JWT token)
  // In a real app, this would be refreshed from the request/session
  const getAuthContext = () => ({
    actorId: 'user-alice',
    credentials: { token: `fresh-jwt-token-${Date.now()}` },
  });

  // Turn 1: Initial query (auto-initializes agent)
  console.log('--- Turn 1 ---');
  const turn1$ = await agent.startTurn('What is 25 * 17?', {
    authContext: getAuthContext(),
  });

  turn1$.subscribe({
    next: (event) => {
      if (event.kind === 'task-complete') {
        console.log('Assistant:', event.content);
      }
    },
    error: (err) => console.error('Error:', err),
    complete: async () => {
      console.log(`Turn 1 complete. Total turns: ${agent.state.turnCount}`);
      console.log(`Agent state: ${agent.state.status}\n`);

      // Turn 2: Follow-up question (has context from turn 1)
      // Note: Fresh auth context for this turn (token may have been refreshed)
      console.log('--- Turn 2 ---');
      const turn2$ = await agent.startTurn('Now divide that result by 5', {
        authContext: getAuthContext(),
      });

      turn2$.subscribe({
        next: (event) => {
          if (event.kind === 'task-complete') {
            console.log('Assistant:', event.content);
          }
        },
        error: (err) => console.error('Error:', err),
        complete: async () => {
          console.log(`Turn 2 complete. Total turns: ${agent.state.turnCount}\n`);

          // View conversation history
          console.log('--- Conversation History ---');
          const messages = await agent.getMessages();
          console.log(`Total messages: ${messages.length}`);
          messages.forEach((msg, i) => {
            console.log(`${i + 1}. [${msg.role}]: ${msg.content.substring(0, 60)}...`);
          });

          // Demonstrate manual save (useful when autoSave=false)
          console.log('\n--- Manual Save ---');
          await agent.save();
          console.log('State saved explicitly');

          // Shutdown the first agent instance
          console.log('\n--- Shutting Down Agent ---');
          await agent.shutdown();
          console.log(`Agent shutdown. State: ${agent.state.status}`);

          // Simulate resuming in a new process/session
          console.log('\n--- Resuming in New Session ---');
          const agent2 = new Agent({
            contextId, // Same context ID loads previous state
            llmProvider: LiteLLM.novaMicro(LITELLM_URL, LITELLM_API_KEY),
            toolProviders: [toolProvider],
            messageStore, // Same store instance (in real app, same Redis/DB connection)
            artifactStore,
          });

          // No start() needed - auto-initializes on first turn
          console.log(`New agent created. State: ${agent2.state.status}`);

          // Continue conversation with context from previous session
          console.log('\n--- Turn 3 (after resume) ---');
          const turn3$ = await agent2.startTurn('What was the original number I asked about?', {
            authContext: getAuthContext(), // Fresh auth context after resume
          });

          turn3$.subscribe({
            next: (event) => {
              if (event.kind === 'task-complete') {
                console.log('Assistant:', event.content);
              }
            },
            error: (err) => console.error('Error:', err),
            complete: async () => {
              console.log(`Turn 3 complete. Total turns: ${agent2.state.turnCount}`);
              console.log(`\nAgent remembered context across sessions!`);

              // Shutdown
              await agent2.shutdown();
              console.log('Agent shutdown complete');

              console.log('\n--- TaskId Feature ---');
              console.log('Each turn auto-generates a unique taskId:');
              console.log('  Format: {contextId}-turn-{turnNumber}-{timestamp}');
              console.log(`  Example: ${contextId}-turn-1-${Date.now()}`);
              console.log('\nYou can also provide a custom taskId:');
              console.log('  await agent.startTurn(message, {');
              console.log('    authContext: auth,');
              console.log('    taskId: "custom-task-abc-123"');
              console.log('  });');

              // Shutdown tracing if enabled
              if (process.env.OTEL_ENABLED === 'true') {
                setTimeout(() => {
                  shutdownTracing()
                    .then(() => console.log('✅ Tracing shutdown complete'))
                    .catch((err) => console.error('Error shutting down tracing:', err));
                }, 2000);
              }
            },
          });
        },
      });
    },
  });
}

// Run example
main().catch(console.error);
