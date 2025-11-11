/**
 * In-Memory Message Store Implementation
 *
 * Design: design/message-management.md#in-memory-message-store
 */

import { filter, firstValueFrom } from 'rxjs';
import type { LLMProvider, Message } from '../../core/types';
import type { ContentCompleteEvent, LLMEvent } from '../../events/types';
import type {
  CompactionOptions,
  CompactionResult,
  MessageStore,
  StoredMessage,
} from './interfaces';
import { estimateTokens, trimToTokenBudget } from './interfaces';

export interface InMemoryMessageStoreConfig {
  /**
   * Optional LLM provider for intelligent summarization
   * If not provided, uses simple rule-based summaries
   */
  llmProvider?: LLMProvider;

  /**
   * Default summarization prompt
   */
  defaultSummaryPrompt?: string;
}

/**
 * In-memory message storage for development and testing
 */
export class InMemoryMessageStore implements MessageStore {
  private messages: Map<string, StoredMessage[]> = new Map();
  private config: InMemoryMessageStoreConfig;

  constructor(config: InMemoryMessageStoreConfig = {}) {
    this.config = config;
  }

  async append(contextId: string, messages: Message[]): Promise<void> {
    const stored = this.messages.get(contextId) || [];
    const nextIndex = stored.length;

    const newMessages: StoredMessage[] = messages.map((msg, i) => ({
      ...msg,
      id: `msg_${contextId}_${nextIndex + i}`,
      contextId,
      index: nextIndex + i,
      timestamp: new Date().toISOString(),
      tokens: estimateTokens(msg.content),
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
    let messages: Message[] = all.slice(-maxMessages);

    // If token limit specified, trim further
    if (maxTokens) {
      messages = trimToTokenBudget(messages, maxTokens);
    }

    return messages;
  }

  async getAll(contextId: string): Promise<Message[]> {
    return this.messages.get(contextId) || [];
  }

  async getCount(contextId: string): Promise<number> {
    const messages = this.messages.get(contextId) || [];
    return messages.length;
  }

  async getRange(contextId: string, startIndex: number, endIndex: number): Promise<Message[]> {
    const all = this.messages.get(contextId) || [];
    return all.slice(startIndex, endIndex);
  }

  async compact(contextId: string, options?: CompactionOptions): Promise<CompactionResult> {
    const all = this.messages.get(contextId) || [];
    const keepRecent = options?.keepRecent || 50;

    if (all.length <= keepRecent) {
      return {
        summaryMessages: [],
        compactedRange: { start: 0, end: 0 },
        tokensSaved: 0,
      };
    }

    const strategy = options?.strategy || 'sliding-window';

    switch (strategy) {
      case 'sliding-window':
        return this.compactSlidingWindow(contextId, keepRecent);

      case 'summarization':
        return this.compactWithSummarization(contextId, keepRecent, options?.summaryPrompt);

      case 'hierarchical':
        return this.compactHierarchical(contextId, keepRecent);

      default:
        throw new Error(`Unknown compaction strategy: ${strategy}`);
    }
  }

  async clear(contextId: string): Promise<void> {
    this.messages.delete(contextId);
  }

  /**
   * Sliding window compaction: just drop old messages
   */
  private async compactSlidingWindow(
    contextId: string,
    keepRecent: number
  ): Promise<CompactionResult> {
    const all = this.messages.get(contextId) || [];
    const oldMessages = all.slice(0, -keepRecent);
    const recentMessages = all.slice(-keepRecent);

    const tokensSaved = oldMessages.reduce((sum, m) => sum + (m.tokens || 0), 0);

    this.messages.set(contextId, recentMessages);

    return {
      summaryMessages: [],
      compactedRange: { start: 0, end: oldMessages.length },
      tokensSaved,
    };
  }

  /**
   * Summarization compaction: create summary of old messages
   */
  private async compactWithSummarization(
    contextId: string,
    keepRecent: number,
    summaryPrompt?: string
  ): Promise<CompactionResult> {
    const all = this.messages.get(contextId) || [];
    const oldMessages = all.slice(0, -keepRecent);
    const recentMessages = all.slice(-keepRecent);

    // Create summary message
    const summaryContent = await this.createSummary(oldMessages, summaryPrompt);
    const summary: Message = {
      role: 'system',
      content: summaryContent,
    };

    const summaryStored: StoredMessage = {
      ...summary,
      id: `summary_${contextId}_${Date.now()}`,
      contextId,
      index: 0,
      timestamp: new Date().toISOString(),
      tokens: estimateTokens(summary.content),
      compacted: true,
      summarizedRange: { start: 0, end: oldMessages.length },
    };

    const tokensSaved =
      oldMessages.reduce((sum, m) => sum + (m.tokens || 0), 0) - (summaryStored.tokens || 0);

    // Replace old messages with summary + recent
    this.messages.set(contextId, [summaryStored, ...recentMessages]);

    return {
      summaryMessages: [summary],
      compactedRange: { start: 0, end: oldMessages.length },
      tokensSaved,
    };
  }

  /**
   * Hierarchical compaction: multi-level summaries
   */
  private async compactHierarchical(
    contextId: string,
    keepRecent: number
  ): Promise<CompactionResult> {
    // Simple implementation: create summary every 10 messages
    const all = this.messages.get(contextId) || [];
    const oldMessages = all.slice(0, -keepRecent);
    const recentMessages = all.slice(-keepRecent);

    const summaries: StoredMessage[] = [];
    let tokensSaved = 0;

    // Create summaries for chunks of 10
    for (let i = 0; i < oldMessages.length; i += 10) {
      const chunk = oldMessages.slice(i, Math.min(i + 10, oldMessages.length));
      const summaryContent = await this.createSummary(chunk);
      const summary: Message = {
        role: 'system',
        content: summaryContent,
      };

      const summaryStored: StoredMessage = {
        ...summary,
        id: `summary_${contextId}_${i}`,
        contextId,
        index: i,
        timestamp: new Date().toISOString(),
        tokens: estimateTokens(summary.content),
        compacted: true,
        summarizedRange: { start: i, end: i + chunk.length },
      };

      summaries.push(summaryStored);
      tokensSaved +=
        chunk.reduce((sum, m) => sum + (m.tokens || 0), 0) - (summaryStored.tokens || 0);
    }

    // Replace old messages with summaries + recent
    this.messages.set(contextId, [...summaries, ...recentMessages]);

    return {
      summaryMessages: summaries,
      compactedRange: { start: 0, end: oldMessages.length },
      tokensSaved,
    };
  }

  /**
   * Create a simple summary of messages
   * Uses LLM if available, otherwise falls back to rule-based summary
   */
  private async createSummary(messages: Message[], customPrompt?: string): Promise<string> {
    // If LLM provider is available, use it for intelligent summarization
    if (this.config.llmProvider) {
      try {
        return await this.createLLMSummary(messages, customPrompt);
      } catch (error) {
        console.warn('LLM summarization failed, falling back to rule-based:', error);
        // Fall through to rule-based summary
      }
    }

    // Rule-based summary fallback
    if (customPrompt) {
      return `${customPrompt}\n\nMessages:\n${messages.map((m) => `${m.role}: ${m.content}`).join('\n')}`;
    }

    const userMessages = messages.filter((m) => m.role === 'user');
    const assistantMessages = messages.filter((m) => m.role === 'assistant');

    return `Summary of ${messages.length} messages: ${userMessages.length} user messages, ${assistantMessages.length} assistant responses.`;
  }

  /**
   * Create LLM-based summary
   */
  private async createLLMSummary(messages: Message[], customPrompt?: string): Promise<string> {
    if (!this.config.llmProvider) {
      throw new Error('LLM Provider not configured for summarization');
    }

    const summaryPrompt =
      customPrompt ||
      this.config.defaultSummaryPrompt ||
      'Please provide a concise summary of the following conversation, capturing the key points and context:';

    const conversationText = messages
      .filter((m) => ['user', 'assistant'].includes(m.role))
      .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
      .join('\n');

    const summaryMessages: Message[] = [
      {
        role: 'user',
        content: `${summaryPrompt}\n\n${conversationText}`,
      },
    ];

    const response$ = this.config.llmProvider.call({
      messages: summaryMessages,
      stream: false,
    });

    // Filter for content-complete event and extract content
    const completeEvent = await firstValueFrom(
      response$.pipe(
        filter(
          (event): event is LLMEvent<ContentCompleteEvent> => event.kind === 'content-complete'
        )
      )
    );

    if (completeEvent.content) {
      return completeEvent.content;
    }

    throw new Error('Failed to get summary from LLM');
  }
}
