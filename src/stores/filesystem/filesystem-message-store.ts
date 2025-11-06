/**
 * Filesystem Message Store Implementation
 *
 * Stores messages as individual JSON files with ISO timestamp filenames.
 *
 * Directory structure:
 * ./_agent_store/agent={agentId}/context={contextId}/messages/{timestamp}-{index}.json
 *
 * Design: design/message-management.md
 */

import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Message } from '../../core/types';
import type {
  CompactionOptions,
  CompactionResult,
  MessageStore,
  StoredMessage,
} from '../messages/interfaces';

export interface FileSystemMessageStoreConfig {
  /** Base path for storage (default: ./_agent_store) */
  basePath?: string;

  /** Agent ID for path construction */
  agentId: string;
}

export class FileSystemMessageStore implements MessageStore {
  private basePath: string;
  private agentId: string;

  constructor(config: FileSystemMessageStoreConfig) {
    this.basePath = config.basePath || './_agent_store';
    this.agentId = config.agentId;
  }

  async append(contextId: string, messages: Message[]): Promise<void> {
    const messagesDir = this.getMessagesDir(contextId);
    await mkdir(messagesDir, { recursive: true });

    // Get current message count to determine indices
    const currentCount = await this.getCount(contextId);

    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];
      const index = currentCount + i;
      const timestamp = new Date().toISOString();

      const storedMessage: StoredMessage = {
        ...message,
        id: `${contextId}-${index}`,
        contextId,
        index,
        timestamp,
      };

      const filename = this.getMessageFilename(timestamp, index);
      const filePath = join(messagesDir, filename);

      await writeFile(filePath, JSON.stringify(storedMessage, null, 2), 'utf-8');
    }
  }

  async getRecent(
    contextId: string,
    options?: {
      maxMessages?: number;
      maxTokens?: number;
    }
  ): Promise<Message[]> {
    const allMessages = await this.loadMessages(contextId);

    if (!options?.maxMessages && !options?.maxTokens) {
      return allMessages.map(this.toMessage);
    }

    // Apply maxMessages
    let messages = allMessages;
    if (options.maxMessages !== undefined) {
      messages = messages.slice(-options.maxMessages);
    }

    // Apply maxTokens (simple estimation: ~4 chars per token)
    if (options.maxTokens !== undefined) {
      let totalTokens = 0;
      const result: StoredMessage[] = [];

      for (let i = messages.length - 1; i >= 0; i--) {
        const message = messages[i];
        const estimatedTokens = message.tokens || this.estimateTokens(message);

        if (totalTokens + estimatedTokens > options.maxTokens && result.length > 0) {
          break;
        }

        result.unshift(message);
        totalTokens += estimatedTokens;
      }

      messages = result;
    }

    return messages.map(this.toMessage);
  }

  async getAll(contextId: string): Promise<Message[]> {
    const messages = await this.loadMessages(contextId);
    return messages.map(this.toMessage);
  }

  async getCount(contextId: string): Promise<number> {
    try {
      const messagesDir = this.getMessagesDir(contextId);
      const files = await readdir(messagesDir);
      return files.filter((f) => f.endsWith('.json')).length;
    } catch {
      return 0;
    }
  }

  async getRange(contextId: string, startIndex: number, endIndex: number): Promise<Message[]> {
    const allMessages = await this.loadMessages(contextId);
    const messages = allMessages.filter((m) => m.index >= startIndex && m.index <= endIndex);
    return messages.map(this.toMessage);
  }

  async compact(contextId: string, options?: CompactionOptions): Promise<CompactionResult> {
    // For filesystem implementation, we'll use sliding-window strategy
    // This is a simple implementation - production would need summarization
    const allMessages = await this.loadMessages(contextId);
    const keepRecent = options?.keepRecent || 20;

    if (allMessages.length <= keepRecent) {
      return {
        summaryMessages: [],
        compactedRange: { start: 0, end: 0 },
        tokensSaved: 0,
      };
    }

    // Delete old messages
    const toDelete = allMessages.slice(0, -keepRecent);
    const messagesDir = this.getMessagesDir(contextId);

    for (const message of toDelete) {
      const filename = this.getMessageFilename(message.timestamp, message.index);
      const filePath = join(messagesDir, filename);
      await rm(filePath, { force: true });
    }

    const tokensFreed = toDelete.reduce((sum, m) => sum + (m.tokens || this.estimateTokens(m)), 0);

    return {
      summaryMessages: [],
      compactedRange: {
        start: toDelete[0]?.index || 0,
        end: toDelete[toDelete.length - 1]?.index || 0,
      },
      tokensSaved: tokensFreed,
    };
  }

  async clear(contextId: string): Promise<void> {
    try {
      const messagesDir = this.getMessagesDir(contextId);
      await rm(messagesDir, { recursive: true, force: true });
    } catch {
      // Directory doesn't exist, nothing to clear
    }
  }

  // Helper methods

  private getMessagesDir(contextId: string): string {
    const safeAgentId = this.sanitizeName(this.agentId);
    const safeContextId = this.sanitizeName(contextId);
    return join(this.basePath, `agent=${safeAgentId}`, `context=${safeContextId}`, 'messages');
  }

  private getMessageFilename(timestamp: string, index: number): string {
    // Use safe ISO timestamp format for filename
    const safeTimestamp = timestamp.replace(/:/g, '-').replace(/\./g, '_');
    return `${safeTimestamp}-${String(index).padStart(6, '0')}.json`;
  }

  private async loadMessages(contextId: string): Promise<StoredMessage[]> {
    try {
      const messagesDir = this.getMessagesDir(contextId);
      const files = await readdir(messagesDir);

      const messages: StoredMessage[] = [];

      for (const file of files) {
        if (!file.endsWith('.json')) continue;

        const filePath = join(messagesDir, file);
        const content = await readFile(filePath, 'utf-8');
        const message = JSON.parse(content) as StoredMessage;
        messages.push(message);
      }

      // Sort by index
      return messages.sort((a, b) => a.index - b.index);
    } catch {
      return [];
    }
  }

  private toMessage(stored: StoredMessage): Message {
    // Remove storage-specific fields
    // biome-ignore lint/correctness/noUnusedVariables: Destructuring to remove fields
    const {
      id,
      contextId,
      index,
      timestamp,
      tokens,
      tags,
      compacted,
      summarizedRange,
      ...message
    } = stored;
    return message;
  }

  private estimateTokens(message: StoredMessage): number {
    const content =
      typeof message.content === 'string' ? message.content : JSON.stringify(message.content);
    return Math.ceil(content.length / 4);
  }

  private sanitizeName(name: string): string {
    return name.replace(/[^a-zA-Z0-9_-]/g, '_');
  }
}
