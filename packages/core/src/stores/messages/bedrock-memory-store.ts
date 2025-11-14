/**
 * AWS Bedrock AgentCore Memory Store Implementation
 *
 * Design: design/message-management.md#aws-bedrock-agentcore-memory-store
 *
 * Integrates with AWS Bedrock AgentCore Memory service which provides:
 * - Short-term memory: Turn-by-turn conversation history within a session
 * - Long-term memory: Extracted insights via strategies (summaries, user preferences)
 * - Automatic memory extraction with configurable strategies
 * - Semantic search across long-term memories
 *
 * Key concepts:
 * - Memory: Resource with configured extraction strategies
 * - Session: Conversation session with actor_id + session_id
 * - Events: Conversational turns stored as payload items
 * - Payload: Contains conversational data with role and content
 * - Short-term: Recent event history via ListEventsCommand
 * - Long-term: Extracted memories via RetrieveMemoryRecordsCommand
 */

import type { Message } from '../../types/message';
import type { CompactionOptions, CompactionResult, MessageStore } from './interfaces';
import { trimToTokenBudget } from './interfaces';

/**
 * AWS SDK imports (optional dependencies)
 */
// biome-ignore lint/suspicious/noExplicitAny: External SDK type
type BedrockAgentCoreClient = any;

export interface BedrockMemoryConfig {
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
   * If not provided, must be passed per-operation or extracted from contextId.
   */
  actorId?: string;

  /** AWS region */
  region?: string;

  /** AWS SDK client (optional, will create if not provided) */
  client?: BedrockAgentCoreClient;

  /**
   * Extract actor ID from context ID (fallback if actorId not configured)
   * Default: splits on '_' and takes first part (e.g., "user123_session456" -> "user123")
   *
   * @deprecated Prefer passing actorId from authentication context
   */
  extractActorId?: (contextId: string) => string;

  /**
   * Include long-term memories in getRecent()
   * Default: true
   */
  includeLongTermMemories?: boolean;
}

/**
 * AWS Bedrock AgentCore Memory store
 *
 * Features:
 * - Short-term memory: Recent conversation turns
 * - Long-term memory: Automatic extraction of summaries and preferences
 * - Semantic search: Query-based memory retrieval
 * - Fully managed: No infrastructure to maintain
 * - Multi-session: Memories persist across sessions per actor
 *
 * Prerequisites:
 * - Memory resource created via Control Plane API
 * - Configured with extraction strategies
 * - IAM permissions for bedrock-agentcore:* actions
 *
 * Note: This store assumes the Memory resource is already created.
 * Use the Control Plane API or AWS Console to create and configure the Memory.
 */
export class BedrockMemoryStore implements MessageStore {
  private client: BedrockAgentCoreClient;
  private config: Omit<Required<BedrockMemoryConfig>, 'actorId'> & { actorId?: string };

  constructor(config: BedrockMemoryConfig) {
    this.config = {
      memoryId: config.memoryId,
      actorId: config.actorId,
      region: config.region || 'us-west-2',
      client: config.client,
      extractActorId:
        config.extractActorId || ((contextId: string) => contextId.split('_')[0] || contextId),
      includeLongTermMemories: config.includeLongTermMemories ?? true,
    };

    if (config.client) {
      this.client = config.client;
    } else {
      // Lazy load AWS SDK
      try {
        const { BedrockAgentCoreClient } = require('@aws-sdk/client-bedrock-agentcore');
        this.client = new BedrockAgentCoreClient({
          region: this.config.region,
        });
      } catch {
        throw new Error('AWS SDK not found. Install @aws-sdk/client-bedrock-agentcore');
      }
    }
  }

  /**
   * Append messages as conversational events
   *
   * Creates events in the AgentCore Memory for each message turn.
   * This populates short-term memory and triggers async long-term extraction.
   *
   * @param contextId - Session/conversation identifier
   * @param messages - Messages to append
   * @param actorId - Optional actor ID override (otherwise uses config.actorId)
   */
  async append(contextId: string, messages: Message[], actorId?: string): Promise<void> {
    const actor = actorId || this.config.actorId || this.config.extractActorId(contextId);
    const sessionId = contextId;

    try {
      const { CreateEventCommand } = require('@aws-sdk/client-bedrock-agentcore');

      // Create events for each message turn
      for (const msg of messages) {
        const command = new CreateEventCommand({
          memoryId: this.config.memoryId,
          actorId: actor,
          sessionId,
          eventTimestamp: new Date(),
          payload: [
            {
              conversational: {
                role: msg.role.toUpperCase() as 'USER' | 'ASSISTANT' | 'TOOL' | 'OTHER',
                content: {
                  text: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
                },
              },
            },
          ],
        });

        await this.client.send(command);
      }
    } catch (error) {
      console.error('Failed to append messages to Bedrock Memory:', error);
      throw error;
    }
  }

  /**
   * Get recent messages with optional long-term memory context
   *
   * Returns short-term conversation history, optionally enhanced
   * with relevant long-term memories via semantic search.
   *
   * @param contextId - Session/conversation identifier
   * @param options - Retrieval options
   * @param actorId - Optional actor ID override
   */
  async getRecent(
    contextId: string,
    options?: { maxMessages?: number; maxTokens?: number },
    actorId?: string,
  ): Promise<Message[]> {
    const actor = actorId || this.config.actorId || this.config.extractActorId(contextId);
    const sessionId = contextId;
    const maxTurns = options?.maxMessages || 50;

    const messages: Message[] = [];

    try {
      const { ListEventsCommand } = require('@aws-sdk/client-bedrock-agentcore');

      // Get recent conversation turns from short-term memory
      const command = new ListEventsCommand({
        memoryId: this.config.memoryId,
        actorId: actor,
        sessionId,
        maxResults: maxTurns,
      });

      const response = await this.client.send(command);

      // Convert events to messages
      for (const event of response.events || []) {
        // Each event has a payload array with conversational items
        if (event.payload) {
          for (const payloadItem of event.payload) {
            if (payloadItem.conversational) {
              const conv = payloadItem.conversational;
              messages.push({
                role: conv.role.toLowerCase() as 'user' | 'assistant' | 'tool',
                content: conv.content?.text || '',
              });
            }
          }
        }
      }

      // Optionally include long-term memories as context
      if (this.config.includeLongTermMemories && messages.length > 0) {
        const longTermMemories = await this.searchLongTermMemories(
          actor,
          sessionId,
          'relevant context',
        );

        if (longTermMemories.length > 0) {
          // Prepend as system message
          const memoryContext: Message = {
            role: 'system',
            content: this.formatLongTermMemories(longTermMemories),
          };
          messages.unshift(memoryContext);
        }
      }

      // Apply token budget if specified
      if (options?.maxTokens) {
        return trimToTokenBudget(messages, options.maxTokens);
      }

      return messages;
    } catch (error) {
      console.error('Failed to retrieve messages from Bedrock Memory:', error);
      return [];
    }
  }

  /**
   * Search long-term memories using semantic search
   */
  private async searchLongTermMemories(
    actorId: string,
    _sessionId: string,
    query: string,
  ): Promise<unknown[]> {
    try {
      const { RetrieveMemoryRecordsCommand } = require('@aws-sdk/client-bedrock-agentcore');

      const command = new RetrieveMemoryRecordsCommand({
        memoryId: this.config.memoryId,
        actorId,
        query,
        maxResults: 5,
      });

      const response = await this.client.send(command);
      return response.memoryRecords || [];
    } catch (error) {
      console.error('Failed to search long-term memories:', error);
      return [];
    }
  }

  /**
   * Format long-term memories as context string
   */
  private formatLongTermMemories(memories: unknown[]): string {
    if (memories.length === 0) return '';

    const lines = memories.map((m) => {
      const record = m as Record<string, unknown>;
      return `- ${String(record.content || record.memory || m)}`;
    });

    return `Relevant insights from past conversations:\n${lines.join('\n')}`;
  }

  /**
   * Get all messages for a context
   *
   * Note: Returns short-term memory only. Long-term memories
   * are summaries/insights, not full message history.
   *
   * @param contextId - Session/conversation identifier
   * @param actorId - Optional actor ID override
   */
  async getAll(contextId: string, actorId?: string): Promise<Message[]> {
    return this.getRecent(contextId, { maxMessages: 1000 }, actorId);
  }

  async getCount(contextId: string, actorId?: string): Promise<number> {
    const messages = await this.getRecent(contextId, undefined, actorId);
    return messages.length;
  }

  async getRange(
    contextId: string,
    startIndex: number,
    endIndex: number,
    actorId?: string,
  ): Promise<Message[]> {
    const all = await this.getAll(contextId, actorId);
    return all.slice(startIndex, endIndex);
  }

  /**
   * Compact messages
   *
   * Note: Bedrock AgentCore Memory handles extraction automatically
   * via configured strategies. This is a no-op.
   */
  async compact(_contextId: string, _options?: CompactionOptions): Promise<CompactionResult> {
    // Memory extraction happens automatically in background
    return {
      summaryMessages: [],
      compactedRange: { start: 0, end: 0 },
      tokensSaved: 0,
    };
  }

  /**
   * Clear all events for a session
   *
   * @param contextId - Session/conversation identifier
   * @param actorId - Optional actor ID override
   */
  async clear(contextId: string, actorId?: string): Promise<void> {
    const actor = actorId || this.config.actorId || this.config.extractActorId(contextId);
    const sessionId = contextId;

    try {
      const {
        ListEventsCommand,
        DeleteEventCommand,
      } = require('@aws-sdk/client-bedrock-agentcore');

      // List all events
      const listCommand = new ListEventsCommand({
        memoryId: this.config.memoryId,
        actorId: actor,
        sessionId,
        maxResults: 1000,
      });

      const response = await this.client.send(listCommand);

      // Delete each event
      for (const event of response.events || []) {
        const deleteCommand = new DeleteEventCommand({
          memoryId: this.config.memoryId,
          actorId: actor,
          sessionId,
          eventId: event.eventId,
        });

        await this.client.send(deleteCommand);
      }
    } catch (error) {
      console.error('Failed to clear Bedrock Memory:', error);
      throw error;
    }
  }

  /**
   * Get memory ID for external use
   */
  getMemoryId(): string {
    return this.config.memoryId;
  }

  /**
   * Get actor ID for a context
   *
   * @param contextId - Session/conversation identifier
   * @param actorId - Optional actor ID override
   */
  getActorId(contextId: string, actorId?: string): string {
    return actorId || this.config.actorId || this.config.extractActorId(contextId);
  }

  /**
   * Get session ID for a context
   */
  getSessionId(contextId: string): string {
    return contextId;
  }

  /**
   * Search long-term memories publicly
   * Useful for custom memory retrieval
   *
   * @param contextId - Session/conversation identifier
   * @param query - Semantic search query
   * @param options - Search options
   * @param actorId - Optional actor ID override
   */
  async searchMemories(
    contextId: string,
    query: string,
    options?: { maxResults?: number },
    actorId?: string,
  ): Promise<unknown[]> {
    const actor = actorId || this.config.actorId || this.config.extractActorId(contextId);

    try {
      const { RetrieveMemoryRecordsCommand } = require('@aws-sdk/client-bedrock-agentcore');

      const command = new RetrieveMemoryRecordsCommand({
        memoryId: this.config.memoryId,
        actorId: actor,
        query,
        maxResults: options?.maxResults || 10,
      });

      const response = await this.client.send(command);
      return response.memoryRecords || [];
    } catch (error) {
      console.error('Failed to search memories:', error);
      return [];
    }
  }

  /**
   * List all memory records for an actor
   *
   * @param contextId - Session/conversation identifier
   * @param options - List options
   * @param actorId - Optional actor ID override
   */
  async listMemoryRecords(
    contextId: string,
    options?: { maxResults?: number; namespacePrefix?: string },
    actorId?: string,
  ): Promise<unknown[]> {
    const actor = actorId || this.config.actorId || this.config.extractActorId(contextId);

    try {
      const { ListMemoryRecordsCommand } = require('@aws-sdk/client-bedrock-agentcore');

      const command = new ListMemoryRecordsCommand({
        memoryId: this.config.memoryId,
        actorId: actor,
        maxResults: options?.maxResults || 100,
        namespacePrefix: options?.namespacePrefix,
      });

      const response = await this.client.send(command);
      return response.memoryRecords || [];
    } catch (error) {
      console.error('Failed to list memory records:', error);
      return [];
    }
  }
}
