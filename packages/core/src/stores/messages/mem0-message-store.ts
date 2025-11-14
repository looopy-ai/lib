/**
 * Mem0 Memory Store Implementation
 *
 * Design: design/message-management.md#mem0-memory-store
 *
 * Integrates with Mem0's intelligent memory platform featuring:
 * - Multi-level memory (conversation/session/user/org)
 * - Automatic fact extraction
 * - Semantic search and retrieval
 * - Graph-based knowledge connections
 * - Conflict resolution
 */

import type { Message } from '../../types/message';
import type {
  CompactionOptions,
  CompactionResult,
  MessageStore,
  StoredMessage,
} from './interfaces';
import { estimateTokens, trimToTokenBudget } from './interfaces';

/**
 * Mem0 SDK types (optional dependency)
 */
// biome-ignore lint/suspicious/noExplicitAny: External SDK type
type MemoryClient = any;

export type Mem0MemoryLevel = 'conversation' | 'session' | 'user' | 'org';

export interface Mem0Config {
  /** Mem0 API key (for Platform mode) */
  apiKey?: string;

  /**
   * Memory organization level:
   * - conversation: Single turn, short-term (tool calls, CoT)
   * - session: Multi-step tasks, minutes to hours
   * - user: Long-term preferences, weeks to forever
   * - org: Shared organizational knowledge
   */
  memoryLevel?: Mem0MemoryLevel;

  /** Enable graph-based memory connections */
  enableGraph?: boolean;

  /** Automatically infer structured memories from messages */
  inferMemories?: boolean;

  /** Custom Mem0 client (optional) */
  client?: MemoryClient;

  /** Organization ID (for org-level memory) */
  orgId?: string;
}

/**
 * Mem0 memory store
 *
 * Features:
 * - Multi-level memory hierarchy
 * - 26% better accuracy than OpenAI Memory
 * - 91% faster than full-context
 * - 90% lower token usage
 * - Automatic fact extraction
 * - Semantic search
 * - Conflict resolution
 * - Graph knowledge connections
 */
export class Mem0MessageStore implements MessageStore {
  private client: MemoryClient;
  private config: Required<Mem0Config>;

  // Cache for raw messages (Mem0 stores inferred memories, not raw messages)
  private messageCache: Map<string, StoredMessage[]> = new Map();

  constructor(config: Mem0Config) {
    this.config = {
      apiKey: config.apiKey || '',
      memoryLevel: config.memoryLevel || 'user',
      enableGraph: config.enableGraph ?? true,
      inferMemories: config.inferMemories ?? true,
      client: config.client,
      orgId: config.orgId || 'default-org',
    };

    if (config.client) {
      this.client = config.client;
    } else {
      // Lazy load Mem0 SDK
      try {
        const { MemoryClient } = require('mem0ai');
        this.client = new MemoryClient({ apiKey: this.config.apiKey });
      } catch {
        throw new Error('Mem0 SDK not found. Install mem0ai package');
      }
    }
  }

  /**
   * Append messages and extract memories
   */
  async append(contextId: string, messages: Message[]): Promise<void> {
    // Store raw messages in cache
    const cached = this.messageCache.get(contextId) || [];
    const nextIndex = cached.length;

    const storedMessages: StoredMessage[] = messages.map((msg, i) => ({
      ...msg,
      id: `msg_${contextId}_${nextIndex + i}`,
      contextId,
      index: nextIndex + i,
      timestamp: new Date().toISOString(),
      tokens: estimateTokens(msg.content),
    }));

    this.messageCache.set(contextId, [...cached, ...storedMessages]);

    // Add to Mem0 for memory extraction
    try {
      const mem0Messages = messages.map((msg) => ({
        role: msg.role,
        content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
      }));

      // biome-ignore lint/suspicious/noExplicitAny: External SDK params
      const params: any = {
        messages: mem0Messages,
        infer: this.config.inferMemories,
        metadata: {
          contextId,
          timestamp: new Date().toISOString(),
        },
      };

      // Set appropriate ID based on memory level
      switch (this.config.memoryLevel) {
        case 'conversation':
          // Conversation-level: short-term, single turn
          params.session_id = `conv_${contextId}`;
          break;

        case 'session':
          // Session-level: multi-turn, hours
          params.session_id = contextId;
          break;

        case 'user':
          // User-level: long-term, persistent
          params.user_id = this.extractUserId(contextId);
          break;

        case 'org':
          // Org-level: shared knowledge
          params.org_id = this.config.orgId;
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
    options?: { maxMessages?: number; maxTokens?: number },
  ): Promise<Message[]> {
    // Get recent messages from cache
    const cached = this.messageCache.get(contextId) || [];
    const { maxMessages = 50, maxTokens } = options || {};

    let messages: Message[] = cached.slice(-maxMessages);

    // Apply token budget
    if (maxTokens) {
      messages = trimToTokenBudget(messages, maxTokens);
    }

    // Enhance with Mem0 memories as context
    try {
      const memories = await this.searchMemories(contextId);

      if (memories.length > 0) {
        // Prepend memory context as system message
        const memoryContext: Message = {
          role: 'system',
          content: this.formatMemoriesAsContext(memories),
        };

        messages = [memoryContext, ...messages] as Message[];
      }
    } catch (error) {
      console.error('Failed to search Mem0 memories:', error);
      // Continue with cached messages only
    }

    return messages;
  }

  /**
   * Search relevant memories from Mem0
   */
  private async searchMemories(contextId: string, query?: string): Promise<unknown[]> {
    try {
      // biome-ignore lint/suspicious/noExplicitAny: External SDK params
      const params: any = {
        query: query || 'relevant context',
        limit: 10,
        filters: {
          contextId,
        },
      };

      // Add appropriate ID filter
      switch (this.config.memoryLevel) {
        case 'conversation':
          params.session_id = `conv_${contextId}`;
          break;

        case 'session':
          params.session_id = contextId;
          break;

        case 'user':
          params.user_id = this.extractUserId(contextId);
          break;

        case 'org':
          params.org_id = this.config.orgId;
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
  private formatMemoriesAsContext(memories: unknown[]): string {
    if (memories.length === 0) return '';

    const memoryLines = memories.map((m) => {
      const record = m as Record<string, unknown>;
      return `- ${String(record.memory || m)}`;
    });
    return `Relevant memories from previous conversations:\n${memoryLines.join('\n')}`;
  }

  async getAll(contextId: string): Promise<Message[]> {
    return this.messageCache.get(contextId) || [];
  }

  async getCount(contextId: string): Promise<number> {
    const messages = this.messageCache.get(contextId) || [];
    return messages.length;
  }

  async getRange(contextId: string, startIndex: number, endIndex: number): Promise<Message[]> {
    const all = this.messageCache.get(contextId) || [];
    return all.slice(startIndex, endIndex);
  }

  /**
   * Compact messages (Mem0 handles memory extraction automatically)
   */
  async compact(contextId: string, options?: CompactionOptions): Promise<CompactionResult> {
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
        tokensSaved: oldMessages.reduce((sum, m) => sum + (m.tokens || 0), 0),
      };
    }

    return {
      summaryMessages: [],
      compactedRange: { start: 0, end: 0 },
      tokensSaved: 0,
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
        const record = memory as Record<string, unknown>;
        if (record.id) {
          await this.client.delete(record.id);
        }
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
   * Update memories with new information
   */
  async updateMemory(memoryId: string, data: string): Promise<void> {
    try {
      await this.client.update(memoryId, { data });
    } catch (error) {
      console.error('Failed to update Mem0 memory:', error);
      throw error;
    }
  }

  /**
   * Get all memories for a context
   */
  async getAllMemories(contextId: string): Promise<unknown[]> {
    try {
      const params: Record<string, string> = {};

      switch (this.config.memoryLevel) {
        case 'user':
          params.user_id = this.extractUserId(contextId);
          break;
        case 'session':
          params.session_id = contextId;
          break;
        case 'org':
          params.org_id = this.config.orgId;
          break;
      }

      const response = await this.client.get_all(params);
      return response.results || [];
    } catch (error) {
      console.error('Failed to get all Mem0 memories:', error);
      return [];
    }
  }
}
