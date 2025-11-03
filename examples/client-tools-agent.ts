/**
 * Client Tools Agent Example
 *
 * Demonstrates using both local tools and client-provided tools together.
 * This simulates an A2A scenario where:
 * 1. Local tools (server-side): calculator, weather lookup
 * 2. Client tools (client-side): database search, user info
 *
 * Prerequisites:
 * 1. Start LiteLLM proxy: `litellm --model gpt-3.5-turbo`
 * 2. Set LITELLM_URL and optionally LITELLM_API_KEY
 *
 * To run: tsx examples/client-tools-agent.ts
 */

import dotenv from 'dotenv';
import { AgentLoop } from '../src/core/agent-loop';
import { createLogger } from '../src/core/logger';
import type { AgentEvent, ToolCall, ToolResult } from '../src/core/types';
import { initializeTracing, shutdownTracing } from '../src/observability/tracing';
import { LiteLLM } from '../src/providers/litellm-provider';
import { InMemoryArtifactStore } from '../src/stores/artifacts';
import { InMemoryStateStore } from '../src/stores/memory/memory-state-store';
import { ClientToolProvider } from '../src/tools/client-tool-provider';
import type { ExecutionContext } from '../src/tools/interfaces';
import { localTools } from '../src/tools/local-tools';
import { calculateTool, weatherTool } from './tools';

dotenv.config();

// Initialize OpenTelemetry tracing (optional)
if (process.env.OTEL_ENABLED === 'true') {
  initializeTracing({
    serviceName: 'client-tools-agent-example',
    serviceVersion: '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    enabled: true,
  });
  console.log('✅ OpenTelemetry tracing enabled');
}

const logger = createLogger({ level: 'info', pretty: true });

// ============================================================================
// LOCAL TOOLS (Server-side execution)
// ============================================================================

/**
 * Local tool provider using reusable tool definitions
 */
const localToolsProvider = localTools([calculateTool, weatherTool]);

// ============================================================================
// CLIENT TOOLS (Client-side execution simulation)
// ============================================================================

/**
 * Simulated client database
 */
const clientDatabase = {
  users: [
    { id: 1, name: 'Alice Johnson', email: 'alice@example.com', role: 'admin' },
    { id: 2, name: 'Bob Smith', email: 'bob@example.com', role: 'user' },
    { id: 3, name: 'Carol Davis', email: 'carol@example.com', role: 'user' },
    { id: 4, name: 'David Wilson', email: 'david@example.com', role: 'manager' },
  ],
  orders: [
    { id: 101, userId: 1, product: 'Widget A', quantity: 5, total: 50.0 },
    { id: 102, userId: 2, product: 'Widget B', quantity: 3, total: 45.0 },
    { id: 103, userId: 1, product: 'Widget C', quantity: 2, total: 30.0 },
  ],
};

/**
 * Client tool definitions that would come from A2A request
 */
const clientToolDefinitions = [
  {
    name: 'search_users',
    description: 'Search for users in the client database by name or email',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query (matches name or email)',
        },
        limit: {
          type: 'integer',
          description: 'Maximum number of results to return',
          minimum: 1,
          maximum: 100,
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_user_orders',
    description: 'Get all orders for a specific user by user ID',
    parameters: {
      type: 'object',
      properties: {
        userId: {
          type: 'integer',
          description: 'The user ID to look up orders for',
        },
      },
      required: ['userId'],
    },
  },
  {
    name: 'get_user_profile',
    description: 'Get detailed profile information for a user',
    parameters: {
      type: 'object',
      properties: {
        userId: {
          type: 'integer',
          description: 'The user ID',
        },
      },
      required: ['userId'],
    },
  },
];

/**
 * Simulate client-side tool execution
 * In a real A2A scenario, this would trigger input-required state
 * and wait for the client to execute and return results
 */
async function simulateClientToolExecution(
  toolCall: ToolCall,
  _context: ExecutionContext
): Promise<ToolResult> {
  const args = toolCall.function.arguments as Record<string, any>;

  console.log(`\n🌐 [CLIENT] Executing: ${toolCall.function.name}`);
  console.log(`   Arguments:`, args);
  console.log(`   ⏳ Waiting for client response...`);

  // Simulate network delay for client execution
  await new Promise((resolve) => setTimeout(resolve, 800));

  try {
    if (toolCall.function.name === 'search_users') {
      const query = args.query.toLowerCase();
      const limit = args.limit || 10;

      const results = clientDatabase.users
        .filter(
          (user) =>
            user.name.toLowerCase().includes(query) || user.email.toLowerCase().includes(query)
        )
        .slice(0, limit);

      console.log(`   ✓ Found ${results.length} users`);

      return {
        toolCallId: toolCall.id,
        toolName: toolCall.function.name,
        success: true,
        result: {
          query: args.query,
          count: results.length,
          users: results,
        },
      };
    }

    if (toolCall.function.name === 'get_user_orders') {
      const orders = clientDatabase.orders.filter((order) => order.userId === args.userId);

      const user = clientDatabase.users.find((u) => u.id === args.userId);

      console.log(`   ✓ Found ${orders.length} orders for user ${args.userId}`);

      return {
        toolCallId: toolCall.id,
        toolName: toolCall.function.name,
        success: true,
        result: {
          userId: args.userId,
          userName: user?.name,
          orderCount: orders.length,
          orders: orders,
          totalAmount: orders.reduce((sum, o) => sum + o.total, 0),
        },
      };
    }

    if (toolCall.function.name === 'get_user_profile') {
      const user = clientDatabase.users.find((u) => u.id === args.userId);

      if (!user) {
        return {
          toolCallId: toolCall.id,
          toolName: toolCall.function.name,
          success: false,
          result: null,
          error: `User ${args.userId} not found`,
        };
      }

      const orders = clientDatabase.orders.filter((order) => order.userId === args.userId);

      console.log(`   ✓ Retrieved profile for ${user.name}`);

      return {
        toolCallId: toolCall.id,
        toolName: toolCall.function.name,
        success: true,
        result: {
          ...user,
          orderCount: orders.length,
          totalSpent: orders.reduce((sum, o) => sum + o.total, 0),
          memberSince: '2024-01-15',
        },
      };
    }

    throw new Error(`Unknown client tool: ${toolCall.function.name}`);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error(`   ✗ Client error: ${err.message}`);

    return {
      toolCallId: toolCall.id,
      toolName: toolCall.function.name,
      success: false,
      result: null,
      error: err.message,
    };
  }
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log('🚀 Client Tools Agent Example\n');
  console.log('='.repeat(80));
  console.log('\n📋 This example demonstrates:');
  console.log('   • Local tools (server-side): calculate, get_weather');
  console.log('   • Client tools (client-side): search_users, get_user_orders, get_user_profile');
  console.log('   • Combined tool execution in a single agent');
  console.log(`\n${'='.repeat(80)}`);

  // Configuration
  const LITELLM_URL = process.env.LITELLM_URL || 'http://localhost:4000';
  const LITELLM_API_KEY = process.env.LITELLM_API_KEY;

  console.log(`\n📡 LiteLLM URL: ${LITELLM_URL}`);
  console.log(`🔑 API Key: ${LITELLM_API_KEY ? '***' : 'none'}\n`);
  console.log('='.repeat(80));

  // Create LLM provider
  const llmProvider = LiteLLM.novaMicro(LITELLM_URL, LITELLM_API_KEY);

  // Create client tools provider with validation
  console.log('\n🔍 Validating client tool definitions...');
  const clientTools = new ClientToolProvider({
    tools: clientToolDefinitions,
    onInputRequired: simulateClientToolExecution,
  });
  console.log('✅ Client tools validated successfully\n');

  // Create agent loop with both providers
  const agentLoop = new AgentLoop({
    agentId: 'hybrid-assistant',
    llmProvider,
    toolProviders: [
      localToolsProvider, // Server-side tools
      clientTools, // Client-side tools
    ],
    stateStore: new InMemoryStateStore(),
    artifactStore: new InMemoryArtifactStore(),
    maxIterations: 10,
    logger,
  });

  // Test scenarios
  const scenarios = [
    {
      name: '1. Mixed Tools - Math and User Data',
      prompt:
        'Calculate 15 * 8, then search for users with "alice" in their name or email, and show me the total of their orders.',
    },
    {
      name: '2. Client Tools Only - User Search and Profile',
      prompt:
        'Search for users with "smith" in their information, then get the detailed profile for the first result.',
    },
    {
      name: '3. Local Tools Only - Math and Weather',
      prompt: 'Calculate (100 + 50) / 2, then get the weather for Paris in celsius.',
    },
    {
      name: '4. Complex Mixed Workflow',
      prompt:
        'First, calculate how many users we should search for: 2 + 1. Then search for that many users with "example.com" in their email. Finally, get the weather for London.',
    },
  ];

  // Run each scenario
  for (const scenario of scenarios) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`\n📝 SCENARIO: ${scenario.name}`);
    console.log(`💬 Prompt: "${scenario.prompt}"\n`);
    console.log('-'.repeat(80));

    try {
      const events$ = agentLoop.execute(scenario.prompt);

      // Collect all events
      const events: AgentEvent[] = [];

      await new Promise<void>((resolve, reject) => {
        events$.subscribe({
          next: (event) => {
            events.push(event);

            // Log significant events
            if (event.kind === 'status-update') {
              if (event.status.state === 'working') {
                console.log('\n⚙️  Agent is working...');
              } else if (event.status.state === 'completed') {
                console.log('\n✅ Task completed!');
                if (event.status.message?.content) {
                  console.log('\n📤 Final Response:');
                  console.log('-'.repeat(80));
                  console.log(event.status.message.content);
                  console.log('-'.repeat(80));
                }
              } else if (event.status.state === 'failed') {
                console.log('\n❌ Task failed');
              }
            }
          },
          error: (err) => {
            console.error('\n❌ Error:', err.message);
            reject(err);
          },
          complete: () => {
            resolve();
          },
        });
      });

      console.log(`\n📊 Total events: ${events.length}`);
    } catch (error) {
      console.error('\n❌ Scenario failed:', error);
    }

    // Wait between scenarios
    if (scenario !== scenarios[scenarios.length - 1]) {
      console.log('\n⏸️  Waiting before next scenario...\n');
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  console.log(`\n${'='.repeat(80)}`);
  console.log('\n✨ All scenarios completed!\n');

  // Cleanup
  if (process.env.OTEL_ENABLED === 'true') {
    console.log('🧹 Shutting down tracing...');
    await shutdownTracing();
  }
}

// Run the example
main().catch((error) => {
  console.error('\n💥 Fatal error:', error);
  process.exit(1);
});
