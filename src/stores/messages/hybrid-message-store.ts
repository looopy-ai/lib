/**
 * Hybrid Message Store Implementation
 *
 * Design: design/message-management.md#hybrid-message-store
 *
 * Combines raw message storage with intelligent memory for:
 * - Full message history (local store)
 * - Intelligent memory/summarization (memory store)
 * - Best of both worlds
 */

import type { Message } from '../../core/types';
import type { CompactionOptions, CompactionResult, MessageStore } from './interfaces';

export type SyncStrategy = 'immediate' | 'batch' | 'end-of-session';

export interface HybridConfig {
  /** Raw message storage (full history) */
  messageStore: MessageStore;

  /** Intelligent memory system (Mem0, Bedrock, etc.) */
  memoryStore: MessageStore;

  /** When to sync to memory store */
  syncStrategy?: SyncStrategy;

  /** Include memory context in getRecent() */
  includeMemoryContext?: boolean;
}

/**
 * Hybrid message store
 *
 * Provides:
 * - Full raw message history (from messageStore)
 * - Intelligent memory context (from memoryStore)
 * - Flexible sync strategies
 * - Optimal balance of history and intelligence
 */
export class HybridMessageStore implements MessageStore {
  private config: Required<HybridConfig>;

  constructor(config: HybridConfig) {
    this.config = {
      messageStore: config.messageStore,
      memoryStore: config.memoryStore,
      syncStrategy: config.syncStrategy || 'immediate',
      includeMemoryContext: config.includeMemoryContext ?? true,
    };
  }

  /**
   * Append messages to both stores
   */
  async append(contextId: string, messages: Message[]): Promise<void> {
    // Always store raw messages locally
    await this.config.messageStore.append(contextId, messages);

    // Sync to memory store based on strategy
    if (this.config.syncStrategy === 'immediate') {
      await this.config.memoryStore.append(contextId, messages);
    }

    // For 'batch' and 'end-of-session', caller must trigger sync explicitly
  }

  /**
   * Get recent messages with optional memory context
   */
  async getRecent(
    contextId: string,
    options?: { maxMessages?: number; maxTokens?: number },
  ): Promise<Message[]> {
    // Get recent messages from local store
    const messages = await this.config.messageStore.getRecent(contextId, options);

    if (!this.config.includeMemoryContext) {
      return messages;
    }

    // Enhance with memory context from memory store
    try {
      const memories = await this.config.memoryStore.getRecent(contextId, {
        maxMessages: 5,
      });

      // Combine: memory context + recent messages
      return [...memories, ...messages];
    } catch (error) {
      console.error('Failed to get memory context:', error);
      // Fall back to messages only
      return messages;
    }
  }

  /**
   * Get all messages (from local store only)
   */
  async getAll(contextId: string): Promise<Message[]> {
    // Full history only available from local store
    return this.config.messageStore.getAll(contextId);
  }

  async getCount(contextId: string): Promise<number> {
    return this.config.messageStore.getCount(contextId);
  }

  async getRange(contextId: string, startIndex: number, endIndex: number): Promise<Message[]> {
    return this.config.messageStore.getRange(contextId, startIndex, endIndex);
  }

  /**
   * Compact both stores
   */
  async compact(contextId: string, options?: CompactionOptions): Promise<CompactionResult> {
    // Compact local store
    const localResult = await this.config.messageStore.compact(contextId, options);

    // Compact memory store
    try {
      await this.config.memoryStore.compact(contextId, options);
    } catch (error) {
      console.error('Failed to compact memory store:', error);
    }

    return localResult;
  }

  /**
   * Clear both stores
   */
  async clear(contextId: string): Promise<void> {
    await Promise.all([
      this.config.messageStore.clear(contextId),
      this.config.memoryStore.clear(contextId),
    ]);
  }

  /**
   * Manually sync pending messages to memory store
   * (For 'batch' and 'end-of-session' strategies)
   */
  async syncToMemory(contextId: string): Promise<void> {
    // Get all messages from local store
    const messages = await this.config.messageStore.getAll(contextId);

    // Get current count in memory store
    const memoryCount = await this.config.memoryStore.getCount(contextId);

    // Sync only new messages
    if (messages.length > memoryCount) {
      const newMessages = messages.slice(memoryCount);
      await this.config.memoryStore.append(contextId, newMessages);
    }
  }

  /**
   * Get memory context only (from memory store)
   */
  async getMemoryContext(contextId: string): Promise<Message[]> {
    return this.config.memoryStore.getRecent(contextId, { maxMessages: 10 });
  }

  /**
   * Get raw messages only (from local store)
   */
  async getRawMessages(
    contextId: string,
    options?: { maxMessages?: number; maxTokens?: number },
  ): Promise<Message[]> {
    return this.config.messageStore.getRecent(contextId, options);
  }
}
