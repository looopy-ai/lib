# Message Management Design

## Overview

As agent conversations grow, storing all messages in memory becomes inefficient. This design separates message storage from agent state, enabling:

- **Append-only message storage** for persistent conversation history
- **Context window management** with intelligent compaction
- **Historical message access** after removal from active context
- **Memory efficiency** by keeping only relevant messages in state

This mirrors the artifact store pattern, treating messages as first-class stored entities.

## Problem Statement

### Current Limitations

1. **Unbounded Growth**: Messages accumulate in `LoopState.messages` indefinitely
2. **Memory Pressure**: Long conversations consume increasing memory
3. **No History**: Once messages are dropped for context limits, they're lost
4. **No Compaction Strategy**: No intelligent summarization or pruning
5. **Coupling**: Message management is tightly coupled to execution state

### Requirements

1. **Persistent Storage**: Messages must survive beyond in-memory state
2. **Efficient Retrieval**: Fast access to recent and historical messages
3. **Context Windowing**: Maintain working set within LLM token limits
4. **Compaction**: Intelligently summarize or prune old messages
5. **Auditability**: Full conversation history for debugging/analysis
6. **Resumption**: Restore conversation state from storage

## Architecture

### Message Store Interface

```typescript
interface MessageStore {
  /**
   * Append new messages to conversation
   * Messages are immutable once stored
   */
  append(contextId: string, messages: Message[]): Promise<void>;

  /**
   * Get recent messages within token/count limit
   * Returns messages in chronological order
   */
  getRecent(
    contextId: string,
    options?: {
      maxMessages?: number;
      maxTokens?: number;
      includeSystem?: boolean;
    }
  ): Promise<Message[]>;

  /**
   * Get all messages for a conversation
   * For debugging, analysis, or full history export
   */
  getAll(contextId: string): Promise<Message[]>;

  /**
   * Get messages in a specific range
   */
  getRange(
    contextId: string,
    startIndex: number,
    endIndex: number
  ): Promise<Message[]>;

  /**
   * Get total message count for context
   */
  getCount(contextId: string): Promise<number>;

  /**
   * Compact old messages using summarization
   * Returns summary message to replace compacted messages
   */
  compact(
    contextId: string,
    options?: CompactionOptions
  ): Promise<CompactionResult>;

  /**
   * Clear all messages for a context
   */
  clear(contextId: string): Promise<void>;
}
```

### Message Metadata

```typescript
interface StoredMessage extends Message {
  /** Unique message ID */
  id: string;

  /** Context/conversation ID */
  contextId: string;

  /** Sequential index in conversation */
  index: number;

  /** Timestamp when message was created */
  timestamp: string;

  /** Estimated token count (for context management) */
  tokens?: number;

  /** Message tags for filtering/categorization */
  tags?: string[];

  /** Whether this message was compacted/summarized */
  compacted?: boolean;

  /** If compacted, reference to original messages */
  compactedRange?: { start: number; end: number };
}
```

### Compaction Strategy

```typescript
interface CompactionOptions {
  /** Keep this many recent messages untouched */
  keepRecent?: number;

  /** Target token budget for compacted history */
  targetTokens?: number;

  /** Compaction strategy */
  strategy?: 'summarize' | 'sliding-window' | 'hierarchical';

  /** LLM provider for summarization */
  llmProvider?: LLMProvider;
}

interface CompactionResult {
  /** Summary message(s) replacing compacted range */
  summaryMessages: Message[];

  /** Range of original messages compacted */
  compactedRange: { start: number; end: number };

  /** Tokens saved */
  tokensSaved: number;
}
```

## Data Flow

### Message Lifecycle

```
┌─────────────────────────────────────────────────────────────┐
│                      Agent Iteration                         │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │  New Messages   │
                    │  (user/assistant│
                    │   /tool)        │
                    └────────┬────────┘
                             │
                             ▼
                ┌────────────────────────┐
                │  Append to Store       │
                │  - Generate IDs        │
                │  - Add metadata        │
                │  - Estimate tokens     │
                └────────┬───────────────┘
                         │
                         ▼
                ┌────────────────────────┐
                │  Check Context Budget  │
                │  - Count recent tokens │
                │  - Compare to limit    │
                └────────┬───────────────┘
                         │
                 ┌───────┴────────┐
                 │                │
          Exceeds Budget?    Within Budget
                 │                │
                 ▼                ▼
        ┌─────────────────┐   ┌──────────────┐
        │  Compact Old    │   │  Continue    │
        │  Messages       │   │  Execution   │
        │  - Summarize    │   └──────────────┘
        │  - Update store │
        └─────────────────┘
                 │
                 ▼
        ┌─────────────────┐
        │  Get Recent     │
        │  Messages for   │
        │  LLM Context    │
        └─────────────────┘
```

### Integration with Agent Loop

```typescript
interface LoopState {
  // ... existing fields ...

  /** Message store reference */
  messageStore: MessageStore;

  /** Working set of messages (recent only) */
  workingMessages: Message[];

  /** System prompt (separate from message history) */
  systemPrompt: string;

  /** Context budget (tokens) */
  contextBudget?: number;
}
```

**Removed from LoopState:**
- `messages: Message[]` - Replaced by `workingMessages` + store

## Compaction Strategies

### 1. Sliding Window (Simple)

Keep only the N most recent messages:

```typescript
async function slidingWindow(
  store: MessageStore,
  contextId: string,
  windowSize: number
): Promise<void> {
  const count = await store.getCount(contextId);

  if (count > windowSize) {
    // Old messages naturally age out
    // No summarization needed
  }

  // getRecent() returns only window
}
```

**Pros**: Simple, predictable
**Cons**: Loses information, no summarization

### 2. Summarization (Intelligent)

Summarize old messages periodically:

```typescript
async function summarize(
  store: MessageStore,
  contextId: string,
  options: CompactionOptions
): Promise<void> {
  const messages = await store.getAll(contextId);
  const { keepRecent = 10 } = options;

  // Keep recent messages untouched
  const recentMessages = messages.slice(-keepRecent);
  const oldMessages = messages.slice(0, -keepRecent);

  if (oldMessages.length > 0) {
    // Use LLM to summarize old messages
    const summary = await llm.summarize(oldMessages);

    // Store summary as special message
    await store.compact(contextId, {
      summaryMessages: [{
        role: 'system',
        content: `Previous conversation summary: ${summary}`,
        compacted: true,
        compactedRange: { start: 0, end: oldMessages.length }
      }]
    });
  }
}
```

**Pros**: Retains semantic content
**Cons**: Requires LLM calls, lossy compression

### 3. Hierarchical Summarization

Multi-level summaries at different time scales:

```
Messages 1-100:   [Detailed Summary]
Messages 101-200: [Recent Messages] (kept in full)
Messages 201-210: [Current Window]  (in working memory)
```

**Pros**: Balances detail and efficiency
**Cons**: Complex implementation

## Storage Implementations

### In-Memory Message Store

For development and testing:

```typescript
class InMemoryMessageStore implements MessageStore {
  private messages: Map<string, StoredMessage[]> = new Map();

  async append(contextId: string, messages: Message[]): Promise<void> {
    const stored = this.messages.get(contextId) || [];
    const nextIndex = stored.length;

    const newMessages = messages.map((msg, i) => ({
      ...msg,
      id: `msg_${contextId}_${nextIndex + i}`,
      contextId,
      index: nextIndex + i,
      timestamp: new Date().toISOString(),
      tokens: estimateTokens(msg.content)
    }));

    this.messages.set(contextId, [...stored, ...newMessages]);
  }

  async getRecent(
    contextId: string,
    options?: { maxMessages?: number; maxTokens?: number }
  ): Promise<Message[]> {
    const all = this.messages.get(contextId) || [];
    const { maxMessages = 50, maxTokens } = options || {};

    // Take recent messages
    let messages = all.slice(-maxMessages);

    // If token limit specified, trim further
    if (maxTokens) {
      messages = trimToTokenBudget(messages, maxTokens);
    }

    return messages;
  }
}
```

### AWS Bedrock AgentCore Memory Store

Integrates with AWS Bedrock AgentCore Memory service, which provides fully managed memory with automatic extraction:

**Key Concepts**:
- **Memory Resource**: Pre-created with configured extraction strategies
- **Events**: Conversational turns (user/assistant messages)
- **Actors**: User/agent identifiers from authentication context
- **Sessions**: Conversation session identifiers
- **Short-term Memory**: Recent conversation turns
- **Long-term Memory**: Automatically extracted insights (summaries, preferences)
- **Strategies**: SummaryStrategy, UserPreferenceStrategy

```typescript
import type { BedrockAgentCoreClient } from '@aws-sdk/client-bedrock-agentcore';

interface BedrockMemoryConfig {
  /**
   * Memory resource ID (pre-created via Control Plane API)
   * The memory should be configured with strategies like:
   * - SummaryStrategy: Session summaries
   * - UserPreferenceStrategy: User preferences
   */
  memoryId: string;

  /**
   * Actor ID (user/agent identifier)
   * This should come from authentication context (e.g., user ID from JWT)
   *
   * If provided, this is used for all operations.
   * If not provided, must be passed per-operation.
   */
  actorId?: string;

  /** AWS region */
  region?: string;

  /** AWS SDK client (optional, will create if not provided) */
  client?: BedrockAgentCoreClient;

  /**
   * Include long-term memories in getRecent()
   * Default: true
   */
  includeLongTermMemories?: boolean;
}

class BedrockMemoryStore implements MessageStore {
  // Conceptual implementation - see packages/core/src/stores/messages/bedrock-memory-store.ts

  /**
   * Append messages as conversational events
   * Creates events in the AgentCore Memory for each message turn.
   * This populates short-term memory and triggers async long-term extraction.
   *
   * Note: actorId parameter is Bedrock-specific extension to base interface.
   * It allows overriding the configured actorId per-operation.
   */
  async append(
    contextId: string,
    messages: Message[],
    actorId?: string  // Bedrock-specific: override actor
  ): Promise<void> {
    // Uses CreateEventCommand for each message
    // eventType: 'CONVERSATIONAL'
    // eventData: { message: { role, content } }
  }

  /**
   * Get recent messages with optional long-term memory context
   * Returns short-term conversation history, optionally enhanced
   * with relevant long-term memories via semantic search.
   *
   * Note: actorId parameter is Bedrock-specific extension.
   */
  async getRecent(
    contextId: string,
    options?: { maxMessages?: number; maxTokens?: number },
    actorId?: string  // Bedrock-specific: override actor
  ): Promise<Message[]> {
    // Uses ListEventsCommand for short-term memory
    // Optionally uses RetrieveMemoryRecordsCommand for long-term context
  }

  /**
   * Search long-term memories using semantic search
   * Returns extracted insights matching the query
   *
   * Note: This method is Bedrock-specific, not in base MessageStore interface.
   */
  async searchMemories(
    contextId: string,
    query: string,
    options?: { maxResults?: number },
    actorId?: string  // Bedrock-specific: override actor
  ): Promise<unknown[]> {
    // Uses RetrieveMemoryRecordsCommand
  }

  /**
   * List all memory records for an actor
   * Useful for browsing all stored memories
   *
   * Note: This method is Bedrock-specific, not in base MessageStore interface.
   */
  async listMemoryRecords(
    contextId: string,
    options?: { maxResults?: number; namespacePrefix?: string },
    actorId?: string  // Bedrock-specific: override actor
  ): Promise<unknown[]> {
    // Uses ListMemoryRecordsCommand
  }

  /**
   * Compact old messages (automatic via Bedrock strategies)
   * No-op as Bedrock handles extraction in background
   */
  async compact(
    contextId: string,
    options?: CompactionOptions
  ): Promise<CompactionResult> {
    // Memory extraction happens automatically via configured strategies
    return {
      summaryMessages: [],
      compactedRange: { start: 0, end: 0 },
      tokensSaved: 0
    };
  }

  /**
   * Clear all events for a session
   *
   * Note: actorId parameter is Bedrock-specific extension.
   */
  async clear(contextId: string, actorId?: string): Promise<void> {
    // Uses ListEventsCommand + DeleteEventCommand
  }
}
```

**Architecture**:
```
Memory Resource (Pre-created with strategies)
  ├─ Actor: user-123 (from auth context)
  │   ├─ Session: session-001
  │   │   ├─ Events: [msg1, msg2, msg3, ...]
  │   │   └─ Short-term: Recent turns
  │   ├─ Session: session-002
  │   │   └─ Events: [...]
  │   └─ Long-term: Extracted insights
  │       ├─ Summary: "User prefers React"
  │       └─ Preference: "Favorite color: blue"
  └─ Actor: user-456
      └─ ...
```

**Implementation**: See `packages/core/src/stores/messages/bedrock-memory-store.ts`

**Key Features of Bedrock AgentCore Memory:**
- **Automatic Extraction**: Bedrock extracts insights asynchronously via strategies
- **Multi-Actor**: Per-user memory isolation using actorId from authentication
- **Semantic Search**: Query long-term memories by meaning, not keywords
- **Managed Service**: No infrastructure to maintain
- **Configurable Strategies**: SummaryStrategy, UserPreferenceStrategy
- **Event-Based**: Stores conversational turns as immutable events

**Usage Example:**
```typescript
// Configure with actorId from authentication
const store = new BedrockMemoryStore({
  memoryId: 'arn:aws:bedrock:us-west-2:123456:memory/my-memory',
  actorId: getUserIdFromJWT(), // From auth context
  region: 'us-west-2',
  includeLongTermMemories: true
});

// Append messages (creates events)
await store.append('session-123', [
  { role: 'user', content: 'I prefer React' },
  { role: 'assistant', content: 'Noted!' }
]);

// Get recent with long-term context (automatic)
const messages = await store.getRecent('session-123');

// Search long-term memories explicitly
const memories = await store.searchMemories(
  'session-123',
  'user preferences',
  { maxResults: 5 }
);

// Override actorId for multi-tenant scenarios
await store.getRecent('session-456', {}, 'user-bob');
```

**Limitations:**
- No access to full raw message history (only short-term events + long-term summaries)
- Extraction happens asynchronously in background
- May need hybrid approach (local + Bedrock) for complete audit trail

### Mem0 Memory Store

Integrates with Mem0's intelligent memory platform:

```typescript
import { MemoryClient } from 'mem0ai';

interface Mem0Config {
  apiKey: string;
  /**
   * Memory organization levels:
   * - user: Long-term user preferences (persistent)
   * - session: Short-term task context (expires)
   * - agent: Agent-specific knowledge
   * - org: Shared organizational knowledge
   */
  memoryLevel?: 'user' | 'session' | 'agent' | 'org';

  /** Enable graph-based memory connections */
  enableGraph?: boolean;

  /** Automatically infer structured memories from messages */
  inferMemories?: boolean;
}

class Mem0MessageStore implements MessageStore {
  private client: MemoryClient;
  private config: Required<Mem0Config>;

  // Cache for raw messages (Mem0 stores inferred memories, not raw messages)
  private messageCache: Map<string, StoredMessage[]> = new Map();

  constructor(config: Mem0Config) {
    this.client = new MemoryClient({ apiKey: config.apiKey });

    this.config = {
      apiKey: config.apiKey,
      memoryLevel: config.memoryLevel || 'user',
      enableGraph: config.enableGraph ?? true,
      inferMemories: config.inferMemories ?? true
    };
  }

  /**
   * Append messages and extract memories
   */
  async append(contextId: string, messages: Message[]): Promise<void> {
    // Store raw messages in cache
    const cached = this.messageCache.get(contextId) || [];
    const nextIndex = cached.length;

    const storedMessages = messages.map((msg, i) => ({
      ...msg,
      id: `msg_${contextId}_${nextIndex + i}`,
      contextId,
      index: nextIndex + i,
      timestamp: new Date().toISOString(),
      tokens: estimateTokens(msg.content)
    }));

    this.messageCache.set(contextId, [...cached, ...storedMessages]);

    // Add to Mem0 for memory extraction
    try {
      const mem0Messages = messages.map(msg => ({
        role: msg.role,
        content: msg.content
      }));

      const params: any = {
        messages: mem0Messages,
        infer: this.config.inferMemories,
        metadata: {
          contextId,
          timestamp: new Date().toISOString()
        }
      };

      // Set appropriate ID based on memory level
      switch (this.config.memoryLevel) {
        case 'user':
          params.user_id = this.extractUserId(contextId);
          break;
        case 'session':
          params.session_id = contextId;
          break;
        case 'agent':
          params.agent_id = 'looopy-agent';
          break;
        case 'org':
          params.org_id = this.extractOrgId(contextId);
          break;
      }

      // Enable graph if configured
      if (this.config.enableGraph) {
        params.enable_graph = true;
      }

      await this.client.add(params);
    } catch (error) {
      console.error('Failed to add memories to Mem0:', error);
      // Continue - messages are cached locally
    }
  }

  /**
   * Get recent messages with Mem0 memory context
   */
  async getRecent(
    contextId: string,
    options?: { maxMessages?: number; maxTokens?: number }
  ): Promise<Message[]> {
    // Get recent messages from cache
    const cached = this.messageCache.get(contextId) || [];
    const { maxMessages = 50, maxTokens } = options || {};

    let messages = cached.slice(-maxMessages);

    // Apply token budget
    if (maxTokens) {
      messages = trimToTokenBudget(messages, maxTokens);
    }

    // Optionally inject Mem0 memories as context
    const memories = await this.searchMemories(contextId);

    if (memories.length > 0) {
      // Prepend memory context as system message
      const memoryContext: Message = {
        role: 'system',
        content: this.formatMemoriesAsContext(memories)
      };

      messages = [memoryContext, ...messages];
    }

    return messages;
  }

  /**
   * Search relevant memories from Mem0
   */
  private async searchMemories(contextId: string, query?: string): Promise<any[]> {
    try {
      const params: any = {
        query: query || 'relevant context',
        limit: 10,
        filters: {
          contextId
        }
      };

      // Add appropriate ID filter
      switch (this.config.memoryLevel) {
        case 'user':
          params.user_id = this.extractUserId(contextId);
          break;
        case 'session':
          params.session_id = contextId;
          break;
        case 'agent':
          params.agent_id = 'looopy-agent';
          break;
        case 'org':
          params.org_id = this.extractOrgId(contextId);
          break;
      }

      const response = await this.client.search(params);
      return response.results || [];
    } catch (error) {
      console.error('Failed to search Mem0 memories:', error);
      return [];
    }
  }

  /**
   * Format Mem0 memories as context string
   */
  private formatMemoriesAsContext(memories: any[]): string {
    if (memories.length === 0) return '';

    const memoryLines = memories.map(m => `- ${m.memory}`);
    return `Relevant memories from previous conversations:\n${memoryLines.join('\n')}`;
  }

  async getAll(contextId: string): Promise<Message[]> {
    return this.messageCache.get(contextId) || [];
  }

  async getCount(contextId: string): Promise<number> {
    const messages = this.messageCache.get(contextId) || [];
    return messages.length;
  }

  async getRange(
    contextId: string,
    startIndex: number,
    endIndex: number
  ): Promise<Message[]> {
    const all = this.messageCache.get(contextId) || [];
    return all.slice(startIndex, endIndex);
  }

  /**
   * Compact messages (Mem0 handles memory extraction automatically)
   */
  async compact(
    contextId: string,
    options?: CompactionOptions
  ): Promise<CompactionResult> {
    // Mem0 automatically extracts and manages memories
    // We can trim old raw messages from cache

    const cached = this.messageCache.get(contextId) || [];
    const keepRecent = options?.keepRecent || 50;

    if (cached.length > keepRecent) {
      const oldMessages = cached.slice(0, -keepRecent);
      const recentMessages = cached.slice(-keepRecent);

      this.messageCache.set(contextId, recentMessages);

      return {
        summaryMessages: [],
        compactedRange: { start: 0, end: oldMessages.length },
        tokensSaved: oldMessages.reduce((sum, m) => sum + (m.tokens || 0), 0)
      };
    }

    return {
      summaryMessages: [],
      compactedRange: { start: 0, end: 0 },
      tokensSaved: 0
    };
  }

  /**
   * Clear all memories for context
   */
  async clear(contextId: string): Promise<void> {
    // Clear cache
    this.messageCache.delete(contextId);

    // Delete Mem0 memories
    try {
      const memories = await this.searchMemories(contextId);

      for (const memory of memories) {
        await this.client.delete(memory.id);
      }
    } catch (error) {
      console.error('Failed to clear Mem0 memories:', error);
    }
  }

  /**
   * Extract userId from contextId
   * Format: {userId}_{sessionId} or just userId
   */
  private extractUserId(contextId: string): string {
    const parts = contextId.split('_');
    return parts[0] || contextId;
  }

  /**
   * Extract orgId from contextId or config
   */
  private extractOrgId(contextId: string): string {
    // Could be passed in config or extracted from contextId
    return 'default-org';
  }
}
```

**Key Features of Mem0:**
- **Multi-Level Memory**: User, session, agent, and org-level memories
- **Automatic Extraction**: Infers structured memories from conversations
- **Graph Memory**: Connects related memories and entities
- **Semantic Search**: Vector-based retrieval of relevant memories
- **Conflict Resolution**: Automatically handles duplicate/contradictory info
- **26% Better Accuracy**: vs OpenAI memory (per Mem0 research)
- **91% Faster**: Than full-context approaches
- **90% Fewer Tokens**: Significant cost reduction

**Architecture:**
1. **Capture**: Messages added with context (user/session/agent ID)
2. **Extract**: LLM infers structured facts from conversations
3. **Store**: Memories saved in vector DB with metadata
4. **Retrieve**: Semantic search returns relevant memories
5. **Graph**: Optional knowledge graph for entity relationships

**Memory Layers:**
- **Conversation**: Single-turn context (tool calls, chain-of-thought)
- **Session**: Multi-step task context (hours to days)
- **User**: Long-term preferences (weeks to forever)
- **Org**: Shared knowledge across agents

### Hybrid Message Store

Combines raw message storage with intelligent memory:

```typescript
interface HybridConfig {
  /** Raw message storage (full history) */
  messageStore: MessageStore;

  /** Intelligent memory system (Mem0 or Bedrock) */
  memoryStore: MessageStore;

  /** When to sync to memory store */
  syncStrategy?: 'immediate' | 'batch' | 'end-of-session';
}

class HybridMessageStore implements MessageStore {
  constructor(private config: HybridConfig) {}

  async append(contextId: string, messages: Message[]): Promise<void> {
    // Store raw messages locally
    await this.config.messageStore.append(contextId, messages);

    // Sync to memory store based on strategy
    if (this.config.syncStrategy !== 'end-of-session') {
      await this.config.memoryStore.append(contextId, messages);
    }
  }

  async getRecent(
    contextId: string,
    options?: { maxMessages?: number; maxTokens?: number }
  ): Promise<Message[]> {
    // Get recent messages from local store
    const messages = await this.config.messageStore.getRecent(contextId, options);

    // Optionally enhance with memory context from memory store
    const memories = await this.config.memoryStore.getRecent(contextId, {
      maxMessages: 5
    });

    // Combine local messages with memory context
    return [...memories, ...messages];
  }

  async getAll(contextId: string): Promise<Message[]> {
    // Full history only available from local store
    return this.config.messageStore.getAll(contextId);
  }

  // Delegate other methods to primary store
  async getCount(contextId: string): Promise<number> {
    return this.config.messageStore.getCount(contextId);
  }

  async getRange(
    contextId: string,
    startIndex: number,
    endIndex: number
  ): Promise<Message[]> {
    return this.config.messageStore.getRange(contextId, startIndex, endIndex);
  }

  async compact(
    contextId: string,
    options?: CompactionOptions
  ): Promise<CompactionResult> {
    // Compact local store
    const result = await this.config.messageStore.compact(contextId, options);

    // Memory store handles its own compaction
    await this.config.memoryStore.compact(contextId, options);

    return result;
  }

  async clear(contextId: string): Promise<void> {
    await Promise.all([
      this.config.messageStore.clear(contextId),
      this.config.memoryStore.clear(contextId)
    ]);
  }
}
```

### Redis Message Store

For production with persistence:

```typescript
class RedisMessageStore implements MessageStore {
  constructor(
    private redis: RedisClient,
    private ttl: number = 7 * 24 * 60 * 60 // 7 days
  ) {}

  async append(contextId: string, messages: Message[]): Promise<void> {
    const key = `messages:${contextId}`;

    // Get current count for indexing
    const count = await this.redis.llen(key);

    // Prepare messages with metadata
    const storedMessages = messages.map((msg, i) => ({
      ...msg,
      id: `msg_${contextId}_${count + i}`,
      contextId,
      index: count + i,
      timestamp: new Date().toISOString(),
      tokens: estimateTokens(msg.content)
    }));

    // Append to list
    const serialized = storedMessages.map(m => JSON.stringify(m));
    await this.redis.rpush(key, ...serialized);

    // Set/update TTL
    await this.redis.expire(key, this.ttl);

    // Also maintain count in metadata
    await this.redis.hset(`messages:${contextId}:meta`, 'count', count + messages.length);
  }

  async getRecent(
    contextId: string,
    options?: { maxMessages?: number; maxTokens?: number }
  ): Promise<Message[]> {
    const key = `messages:${contextId}`;
    const { maxMessages = 50 } = options || {};

    // Get last N messages
    const serialized = await this.redis.lrange(key, -maxMessages, -1);
    const messages = serialized.map(s => JSON.parse(s));

    // Apply token budget if specified
    if (options?.maxTokens) {
      return trimToTokenBudget(messages, options.maxTokens);
    }

    return messages;
  }

  async compact(
    contextId: string,
    options?: CompactionOptions
  ): Promise<CompactionResult> {
    // Implementation: replace old messages with summary
    // This is complex - may want to use separate compacted history key
  }
}
```

### Database Message Store

For long-term persistence and querying:

```sql
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  context_id TEXT NOT NULL,
  index INTEGER NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  tool_call_id TEXT,
  tool_calls JSONB,
  timestamp TIMESTAMP NOT NULL,
  tokens INTEGER,
  compacted BOOLEAN DEFAULT FALSE,
  compacted_range JSONB,

  UNIQUE(context_id, index)
);

CREATE INDEX idx_messages_context ON messages(context_id, index);
CREATE INDEX idx_messages_timestamp ON messages(context_id, timestamp);
```

## Token Estimation

Utility for estimating message token counts:

```typescript
function estimateTokens(content: string): number {
  // Rough estimation: 1 token ≈ 4 characters
  // For production, use tiktoken or similar
  return Math.ceil(content.length / 4);
}

function countMessageTokens(message: Message): number {
  let tokens = estimateTokens(message.content);

  // Add tokens for role, formatting
  tokens += 4;

  // Add tokens for tool calls if present
  if (message.toolCalls) {
    tokens += message.toolCalls.reduce((sum, tc) => {
      return sum + estimateTokens(JSON.stringify(tc));
    }, 0);
  }

  return tokens;
}

function trimToTokenBudget(messages: Message[], budget: number): Message[] {
  const result: Message[] = [];
  let tokenCount = 0;

  // Work backwards from most recent
  for (let i = messages.length - 1; i >= 0; i--) {
    const tokens = countMessageTokens(messages[i]);

    if (tokenCount + tokens <= budget) {
      result.unshift(messages[i]);
      tokenCount += tokens;
    } else {
      break;
    }
  }

  return result;
}
```

## Agent Loop Integration

### Modified Execution Flow

```typescript
class AgentLoop {
  private async prepareExecution(
    prompt: string,
    context: Partial<Context>
  ): Promise<LoopState> {
    // ... existing setup ...

    // Initialize message store
    const messageStore = context.messageStore || this.config.messageStore;

    // Append initial user message
    const userMessage: Message = { role: 'user', content: prompt };
    await messageStore.append(contextId, [userMessage]);

    // Get working set of messages
    const workingMessages = await messageStore.getRecent(contextId, {
      maxMessages: this.config.maxContextMessages || 50,
      maxTokens: this.config.maxContextTokens || 4000
    });

    return {
      // ... other fields ...
      messageStore,
      workingMessages,
      contextBudget: this.config.maxContextTokens || 4000
    };
  }

  private async afterLLMResponse(
    state: LoopState,
    response: LLMResponse
  ): Promise<LoopState> {
    // Append assistant message
    await state.messageStore.append(state.contextId, [response.message]);

    // If tool calls, append tool results
    if (response.toolCalls) {
      const toolResults = await this.executeTools(response.toolCalls, state);
      const toolMessages = toolResults.map(r => ({
        role: 'tool' as const,
        content: JSON.stringify(r.result),
        toolCallId: r.toolCallId,
        name: r.toolName
      }));

      await state.messageStore.append(state.contextId, toolMessages);
    }

    // Refresh working messages
    const workingMessages = await state.messageStore.getRecent(state.contextId, {
      maxTokens: state.contextBudget
    });

    return {
      ...state,
      workingMessages
    };
  }
}
```

### Compaction Trigger

```typescript
private async checkAndCompact(state: LoopState): Promise<LoopState> {
  const count = await state.messageStore.getCount(state.contextId);
  const compactionThreshold = this.config.compactionThreshold || 100;

  if (count > compactionThreshold) {
    // Compact old messages
    const result = await state.messageStore.compact(state.contextId, {
      keepRecent: 20,
      targetTokens: state.contextBudget / 2,
      strategy: 'summarize',
      llmProvider: this.config.llmProvider
    });

    this.config.logger.info(
      {
        contextId: state.contextId,
        tokensSaved: result.tokensSaved,
        compactedRange: result.compactedRange
      },
      'Compacted message history'
    );
  }

  return state;
}
```

## Configuration

```typescript
interface AgentLoopConfig {
  // ... existing fields ...

  /** Message store for conversation history */
  messageStore: MessageStore;

  /** Maximum messages in working context */
  maxContextMessages?: number;

  /** Maximum tokens in working context */
  maxContextTokens?: number;

  /** Trigger compaction after this many messages */
  compactionThreshold?: number;

  /** Compaction strategy */
  compactionStrategy?: 'summarize' | 'sliding-window' | 'hierarchical';
}
```

## Benefits

### Memory Efficiency
- Working context stays bounded
- Old messages stored externally
- Compaction reduces storage over time

### Scalability
- Supports long-running conversations
- No in-memory message accumulation
- Efficient retrieval of recent context

### Auditability
- Full conversation history preserved
- Historical message access for debugging
- Compaction maintains summaries

### Flexibility
- Pluggable storage backends (memory, Redis, DB)
- Configurable compaction strategies
- Per-conversation token budgets

## Migration Path

### Phase 1: Add Message Store (Backward Compatible)
- Add `messageStore` to config (optional)
- Keep existing `messages` array in `LoopState`
- If store provided, sync messages to it
- No breaking changes

### Phase 2: Dual Mode
- Support both `messages` (deprecated) and `workingMessages`
- Log deprecation warnings
- Implement compaction (opt-in)

### Phase 3: Full Migration
- Remove `messages` from `LoopState`
- Make `messageStore` required
- Enable compaction by default

## Open Questions

1. **Summarization Quality**: How to ensure summaries preserve important context?
2. **Compaction Timing**: When to compact - during iteration or background job?
3. **Cross-Context Search**: Should we support searching across conversations?
4. **Message Editing**: Should messages be truly immutable or allow corrections?
5. **Branching Conversations**: How to handle conversation forks/branches?
6. **Cost Management**: Summarization uses LLM calls - how to budget?

## Future Enhancements

- **Semantic Search**: Vector embeddings for message retrieval
- **Importance Scoring**: Keep important messages, compress filler
- **Multi-Modal Messages**: Image, audio message storage
- **Collaborative Context**: Shared message stores across agents
- **Replay/Undo**: Ability to replay from specific message
- **Export/Import**: Conversation backup and restoration

## References

- Artifact Management: `design/artifact-management.md`
- State Persistence: `design/agent-loop.md#state-persistence-strategy`
- Token Counting: [tiktoken](https://github.com/openai/tiktoken)
- Context Windows: [Anthropic - Long Context Windows](https://www.anthropic.com/index/100k-context-windows)
