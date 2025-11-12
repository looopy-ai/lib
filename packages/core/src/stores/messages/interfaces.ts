/**
 * Message Management Interfaces
 *
 * Design: design/message-management.md
 */

import type { Message } from '../../core/types';

/**
 * Stored message with metadata
 */
export interface StoredMessage extends Message {
  /** Unique message ID */
  id: string;

  /** Context/session this message belongs to */
  contextId: string;

  /** Sequential index in conversation */
  index: number;

  /** Timestamp when message was added */
  timestamp: string;

  /** Estimated token count */
  tokens?: number;

  /** Optional metadata tags */
  tags?: string[];

  /** Whether this message was created via compaction */
  compacted?: boolean;

  /** Original message indices if this is a summary */
  summarizedRange?: { start: number; end: number };
}

/**
 * Message store interface
 */
export interface MessageStore {
  /**
   * Append messages to a conversation
   */
  append(contextId: string, messages: Message[]): Promise<void>;

  /**
   * Get recent messages within constraints
   */
  getRecent(
    contextId: string,
    options?: {
      maxMessages?: number;
      maxTokens?: number;
    },
  ): Promise<Message[]>;

  /**
   * Get all messages for a context
   */
  getAll(contextId: string): Promise<Message[]>;

  /**
   * Get total message count
   */
  getCount(contextId: string): Promise<number>;

  /**
   * Get messages in a specific range
   */
  getRange(contextId: string, startIndex: number, endIndex: number): Promise<Message[]>;

  /**
   * Compact old messages to reduce storage
   */
  compact(contextId: string, options?: CompactionOptions): Promise<CompactionResult>;

  /**
   * Clear all messages for a context
   */
  clear(contextId: string): Promise<void>;
}

/**
 * Compaction strategy options
 */
export interface CompactionOptions {
  /** Keep this many recent messages uncompacted */
  keepRecent?: number;

  /** Target token budget for compacted history */
  targetTokens?: number;

  /** Compaction strategy */
  strategy?: 'sliding-window' | 'summarization' | 'hierarchical';

  /** Custom summarization prompt (for summarization strategy) */
  summaryPrompt?: string;
}

/**
 * Result of compaction operation
 */
export interface CompactionResult {
  /** Summary messages created */
  summaryMessages: Message[];

  /** Range of messages that were compacted */
  compactedRange: { start: number; end: number };

  /** Estimated tokens saved */
  tokensSaved: number;
}

/**
 * Estimate tokens in message content
 * (Rough approximation: 1 token ≈ 4 characters)
 */
export function estimateTokens(content: string | unknown): number {
  const text = typeof content === 'string' ? content : JSON.stringify(content);
  return Math.ceil(text.length / 4);
}

/**
 * Trim messages to fit within token budget
 * Returns up to maxTokens worth of messages from the end
 */
export function trimToTokenBudget<T extends Message>(messages: T[], maxTokens: number): T[] {
  let total = 0;
  const result: T[] = [];

  // Take from end (most recent)
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    const tokens = estimateTokens(msg.content);

    if (total + tokens > maxTokens) {
      break;
    }

    result.unshift(msg);
    total += tokens;
  }

  return result;
}
