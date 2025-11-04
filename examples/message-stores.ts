/**
 * Message Store Examples
 *
 * Demonstrates usage of different message store implementations:
 * - In-Memory (development/testing)
 * - AWS Bedrock Agents Memory (managed, auto-summarization)
 * - Mem0 (multi-level intelligent memory)
 * - Hybrid (combines raw messages + intelligent memory)
 */

import type { Message } from '../src/core/types';
import { LiteLLM } from '../src/providers';
import { BedrockMemoryStore } from '../src/stores/messages/bedrock-memory-store';
import { HybridMessageStore } from '../src/stores/messages/hybrid-message-store';
import { type Mem0MemoryLevel, Mem0MessageStore } from '../src/stores/messages/mem0-message-store';
import { InMemoryMessageStore } from '../src/stores/messages/memory-message-store';

// Configuration
const LITELLM_URL = process.env.LITELLM_URL || 'http://localhost:4000';
const LITELLM_API_KEY = process.env.LITELLM_API_KEY;

// ============================================================================
// Example 1: In-Memory Message Store (Development/Testing)
// ============================================================================

async function exampleInMemory() {
  console.log('\n=== In-Memory Message Store ===\n');

  const store = new InMemoryMessageStore();
  const contextId = 'user_123_session_456';

  // Append messages
  await store.append(contextId, [
    { role: 'user', content: 'Hello! Can you help me with TypeScript?' },
    {
      role: 'assistant',
      content: 'Of course! I can help you with TypeScript. What do you need?',
    },
    {
      role: 'user',
      content: 'How do I define a generic function?',
    },
    {
      role: 'assistant',
      content: 'Here is how: function identity<T>(arg: T): T { return arg; }',
    },
  ]);

  // Get recent messages
  const recent = await store.getRecent(contextId, { maxMessages: 2 });
  console.log('Recent 2 messages:', recent);

  // Get all messages
  const all = await store.getAll(contextId);
  console.log('Total messages:', all.length);

  // Compact with sliding window (keep 2 most recent)
  const result = await store.compact(contextId, {
    strategy: 'sliding-window',
    keepRecent: 2,
  });
  console.log('Compaction result:', result);

  const afterCompact = await store.getAll(contextId);
  console.log('Messages after compaction:', afterCompact.length);
}

// ============================================================================
// Example 1b: In-Memory with LLM-based Intelligent Summarization
// ============================================================================

async function exampleInMemoryWithLLM() {
  console.log('\n=== In-Memory with LLM Summarization ===\n');

  // Assuming you have an LLMProvider instance (e.g., LiteLLMProvider)
  // import { LiteLLMProvider } from '../src/providers/litellm-provider';
  // const llmProvider = new LiteLLMProvider({ model: 'gpt-4' });

  const store = new InMemoryMessageStore({
    llmProvider: LiteLLM.novaMicro(LITELLM_URL, LITELLM_API_KEY),
    defaultSummaryPrompt: 'Create a concise summary focusing on key decisions and action items.',
  });

  const contextId = 'user_123_session_789';

  // Add a longer conversation
  await store.append(contextId, [
    { role: 'user', content: 'I need to implement a chat system with message history.' },
    {
      role: 'assistant',
      content: 'I can help with that. What are your requirements for storage and retention?',
    },
    { role: 'user', content: 'We need to store messages for 30 days and support conversation summarization.' },
    {
      role: 'assistant',
      content:
        'For that, I recommend using a MessageStore. You can choose between in-memory for development or AWS Bedrock for production.',
    },
    { role: 'user', content: 'What about summarization? How does that work?' },
    {
      role: 'assistant',
      content:
        'With an LLM provider, summaries are created intelligently. Without one, it uses rule-based extraction of key sentences.',
    },
  ]);

  // Compact with summarization
  // If llmProvider is set, this will use LLM for intelligent summarization
  // Otherwise, it falls back to rule-based summarization
  const result = await store.compact(contextId, {
    strategy: 'summarization',
    keepRecent: 2, // Keep most recent 2 messages, summarize older ones
  });

  console.log('Compaction result:', result);
  console.log('Summary messages created:', result.summaryMessages.length);
  console.log('Tokens saved:', result.tokensSaved);

  const afterCompact = await store.getAll(contextId);
  console.log('Messages after summarization:', afterCompact);
  console.log('First message (summary):', afterCompact[0]);
}

// ============================================================================
// Example 2: AWS Bedrock AgentCore Memory Store
// ============================================================================

async function exampleBedrock() {
  console.log('\n=== AWS Bedrock AgentCore Memory Store ===\n');

  // Note: Requires pre-created Memory resource and AWS credentials
  // actorId should come from authentication context (JWT, OAuth, etc.)
  const store = new BedrockMemoryStore({
    memoryId: 'your-memory-id', // Created via Control Plane API
    actorId: 'user-alice', // From getUserIdFromAuth()
    region: 'us-west-2',
  });

  const contextId = 'session-001'; // Just the session ID

  // Append messages as conversational events
  await store.append(contextId, [
    { role: 'user', content: 'I prefer React for frontend development' },
    { role: 'assistant', content: 'Noted! I will remember that.' },
    { role: 'user', content: 'My favorite color is blue' },
    { role: 'assistant', content: 'Got it, blue is your favorite color.' },
  ]);

  // Get recent messages (includes long-term memory context automatically)
  const messages = await store.getRecent(contextId, { maxMessages: 10 });
  console.log('Messages with memory context:', messages);

  // Search long-term memories explicitly
  const memories = await store.searchMemories(contextId, 'user preferences', { maxResults: 5 });
  console.log('Long-term memories:', memories);

  // List all memory records for user
  const allMemories = await store.listMemoryRecords(contextId, {
    maxResults: 100,
    namespacePrefix: '/users/',
  });
  console.log('All user memories:', allMemories);

  // Or override actorId per-operation for multi-tenant scenarios
  const otherUserMessages = await store.getRecent(
    'session-002',
    { maxMessages: 10 },
    'user-bob' // Different actor
  );
  console.log('Other user messages:', otherUserMessages.length);

  // Clear session
  // await store.clear(contextId);
}

// ============================================================================
// Example 3: Mem0 Memory Store (Multi-Level Memory)
// ============================================================================

async function exampleMem0() {
  console.log('\n=== Mem0 Memory Store ===\n');

  // User-level memory (long-term, persistent across sessions)
  const userStore = new Mem0MessageStore({
    apiKey: process.env.MEM0_API_KEY || 'your-api-key',
    memoryLevel: 'user' as Mem0MemoryLevel,
    enableGraph: true,
    inferMemories: true,
  });

  const contextId = 'user_bob_session_002';

  // Append messages - Mem0 will extract facts automatically
  await userStore.append(contextId, [
    { role: 'user', content: 'I live in San Francisco' },
    { role: 'assistant', content: 'Great! San Francisco is a beautiful city.' },
    {
      role: 'user',
      content: 'I work as a software engineer at a startup',
    },
    {
      role: 'assistant',
      content: 'Interesting! What technologies do you use?',
    },
    { role: 'user', content: 'Mainly TypeScript, React, and Node.js' },
  ]);

  // Get recent messages with memory context
  const messagesWithContext = await userStore.getRecent(contextId, {
    maxMessages: 5,
  });
  console.log('Messages with Mem0 context:', messagesWithContext);

  // Get all extracted memories
  const memories = await userStore.getAllMemories(contextId);
  console.log('Extracted memories:', memories);

  // Session-level memory (short-term, expires after session)
  const sessionStore = new Mem0MessageStore({
    apiKey: process.env.MEM0_API_KEY || 'your-api-key',
    memoryLevel: 'session' as Mem0MemoryLevel,
    inferMemories: true,
  });

  await sessionStore.append(contextId, [
    { role: 'user', content: 'Let me debug this React component issue' },
    { role: 'assistant', content: 'Sure! What is the issue?' },
  ]);

  // Organizational memory (shared across users)
  const orgStore = new Mem0MessageStore({
    apiKey: process.env.MEM0_API_KEY || 'your-api-key',
    memoryLevel: 'org' as Mem0MemoryLevel,
    orgId: 'acme-corp',
    inferMemories: true,
  });

  await orgStore.append('shared-context', [
    {
      role: 'system',
      content: 'Company policy: All code must have 80% test coverage',
    },
  ]);
}

// ============================================================================
// Example 4: Hybrid Message Store (Best of Both Worlds)
// ============================================================================

async function exampleHybrid() {
  console.log('\n=== Hybrid Message Store ===\n');

  // Create hybrid store: raw messages + intelligent memory
  const hybridStore = new HybridMessageStore({
    // Local store for full history
    messageStore: new InMemoryMessageStore(),

    // Mem0 for intelligent memory
    memoryStore: new Mem0MessageStore({
      apiKey: process.env.MEM0_API_KEY || 'your-api-key',
      memoryLevel: 'user' as Mem0MemoryLevel,
      inferMemories: true,
    }),

    // Sync strategy
    syncStrategy: 'immediate', // or 'batch', 'end-of-session'

    // Include memory context in getRecent()
    includeMemoryContext: true,
  });

  const contextId = 'user_charlie_session_003';

  // Append messages
  await hybridStore.append(contextId, [
    { role: 'user', content: 'I am building an AI agent framework' },
    {
      role: 'assistant',
      content: 'Exciting! What features are you implementing?',
    },
    { role: 'user', content: 'RxJS-based execution, A2A protocol, and MCP' },
  ]);

  // Get recent messages (includes memory context from Mem0)
  const messagesWithMemory = await hybridStore.getRecent(contextId, {
    maxMessages: 10,
  });
  console.log('Messages with memory context:', messagesWithMemory);

  // Get raw messages only (no memory context)
  const rawMessages = await hybridStore.getRawMessages(contextId, {
    maxMessages: 10,
  });
  console.log('Raw messages:', rawMessages);

  // Get memory context only
  const memoryContext = await hybridStore.getMemoryContext(contextId);
  console.log('Memory context:', memoryContext);

  // Get full history (from local store)
  const fullHistory = await hybridStore.getAll(contextId);
  console.log('Full history:', fullHistory.length, 'messages');

  // Manually sync to memory (if using 'batch' or 'end-of-session' strategy)
  // await hybridStore.syncToMemory(contextId);
}

// ============================================================================
// Example 5: Compaction Strategies
// ============================================================================

async function exampleCompaction() {
  console.log('\n=== Compaction Strategies ===\n');

  const store = new InMemoryMessageStore();
  const contextId = 'user_dave_session_004';

  // Generate many messages
  const messages: Message[] = [];
  for (let i = 0; i < 100; i++) {
    messages.push(
      { role: 'user', content: `User message ${i}` },
      { role: 'assistant', content: `Assistant response ${i}` }
    );
  }
  await store.append(contextId, messages);

  console.log('Before compaction:', await store.getCount(contextId));

  // Strategy 1: Sliding window (just drop old messages)
  const slidingResult = await store.compact(contextId, {
    strategy: 'sliding-window',
    keepRecent: 20,
  });
  console.log('Sliding window result:', slidingResult);

  // Strategy 2: Summarization (create summary of old messages)
  await store.append(contextId, messages); // Re-add for demonstration
  const summaryResult = await store.compact(contextId, {
    strategy: 'summarization',
    keepRecent: 20,
    summaryPrompt: 'Summarize the following conversation:',
  });
  console.log('Summarization result:', summaryResult);

  // Strategy 3: Hierarchical (multi-level summaries)
  await store.append(contextId, messages);
  const hierarchicalResult = await store.compact(contextId, {
    strategy: 'hierarchical',
    keepRecent: 20,
  });
  console.log('Hierarchical result:', hierarchicalResult);

  console.log('After compaction:', await store.getCount(contextId));
}

// ============================================================================
// Run examples
// ============================================================================

async function main() {
  try {
    // await exampleInMemory();
    await exampleInMemoryWithLLM();
    // await exampleBedrock(); // Requires AWS setup
    // await exampleMem0(); // Requires Mem0 API key
    // await exampleHybrid(); // Requires Mem0 API key
    // await exampleCompaction();

    console.log('\n✅ All examples completed!\n');
  } catch (error) {
    console.error('Error running examples:', error);
  }
}

// Run the example
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

export { exampleBedrock, exampleCompaction, exampleHybrid, exampleInMemory, exampleInMemoryWithLLM, exampleMem0 };

