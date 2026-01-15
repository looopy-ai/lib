import {
  BedrockAgentCoreClient,
  CreateEventCommand,
  DeleteEventCommand,
  type Event,
  ListEventsCommand,
  type PayloadType,
  RetrieveMemoryRecordsCommand,
} from '@aws-sdk/client-bedrock-agentcore';
import {
  type AssistantLLMMessage,
  type CompactionOptions,
  type CompactionResult,
  estimateTokens,
  type LLMMessage,
  type MessageStore,
  type StoredMessage,
  trimToTokenBudget,
} from '@looopy-ai/core';
import type { DocumentType } from '@smithy/types';

export interface AgentCoreMemoryMessageStoreConfig {
  /** Pre-provisioned AgentCore memory identifier */
  memoryId: string;
  /** Optional static actor identifier. Fallback will be derived from contextId */
  agentId: string;
  /** AWS region where the memory lives */
  region?: string;
  /** Provide a custom AgentCore client (useful for tests) */
  client?: BedrockAgentCoreClient;
  /** Extract an actor id from the context id when one is not provided */
  extractActorId?: (contextId: string) => string;
  /** Optional namespace for long-term memories */
  longTermMemoryNamespace?: string;
  /** Maximum number of messages to fetch on first load */
  initialFetchLimit?: number;
}

export class AgentCoreMemoryMessageStore implements MessageStore {
  private readonly memoryId: string;
  private readonly actorId: string;
  private readonly longTermMemoryNamespace?: string;
  private readonly client: BedrockAgentCoreClient;
  private readonly initialFetchLimit: number;
  private readonly messages: Map<string, StoredMessage[]> = new Map();

  constructor(config: AgentCoreMemoryMessageStoreConfig) {
    this.memoryId = config.memoryId;
    this.actorId = config.agentId;
    this.longTermMemoryNamespace = config.longTermMemoryNamespace;
    this.initialFetchLimit = config.initialFetchLimit ?? 50;
    this.client =
      config.client ||
      new BedrockAgentCoreClient({
        region: config.region ?? process.env.AWS_REGION ?? 'us-west-2',
      });
  }

  async append(contextId: string, messages: LLMMessage[]): Promise<void> {
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

    for (const message of messages) {
      const command = new CreateEventCommand({
        memoryId: this.memoryId,
        actorId: this.actorId,
        sessionId: contextId,
        eventTimestamp: new Date(),
        payload: [
          {
            conversational: {
              role: this.toAgentCoreRole(message.role),
              content: { text: message.content },
            },
          },
          message.role === 'assistant'
            ? {
                blob: {
                  toolCalls: message.toolCalls as unknown,
                } as DocumentType,
              }
            : message.role === 'tool'
              ? {
                  blob: {
                    toolCallId: message.toolCallId,
                  } as DocumentType,
                }
              : ({} as PayloadType),
        ],
      });

      await this.client.send(command);
    }
  }

  async getRecent(
    contextId: string,
    options?: { maxMessages?: number; maxTokens?: number },
  ): Promise<LLMMessage[]> {
    await this.loadCacheIfNeeded(contextId, options?.maxMessages);
    // const messages = options?.maxMessages ? cache.slice(-options.maxMessages) : cache.slice();

    // if (this.includeLongTermMemories && messages.length > 0) {
    //   const longTerm = await this.retrieveLongTermMemories(this.actorId, 'relevant context');
    //   if (longTerm.length > 0) {
    //     messages.unshift({
    //       role: 'system',
    //       content: this.formatLongTermMemories(longTerm),
    //     });
    //   }
    // }

    // TODO
    // if (options?.maxTokens) {
    //   return trimToTokenBudget(messages, options.maxTokens);
    // }

    const all = this.messages.get(contextId) || [];
    const { maxMessages = 50, maxTokens } = options || {};

    // Take recent messages
    let messages: LLMMessage[] = all.slice(-maxMessages);

    // If token limit specified, trim further
    if (maxTokens) {
      messages = trimToTokenBudget(messages, maxTokens);
    }

    return messages.slice();
  }

  async getAll(contextId: string): Promise<LLMMessage[]> {
    await this.loadCacheIfNeeded(contextId);
    return (this.messages.get(contextId) || []).slice();
  }

  async getCount(contextId: string): Promise<number> {
    await this.loadCacheIfNeeded(contextId);

    const messages = this.messages.get(contextId) || [];
    return messages.length;
  }

  async getRange(contextId: string, startIndex: number, endIndex: number): Promise<LLMMessage[]> {
    await this.loadCacheIfNeeded(contextId, endIndex);

    const all = this.messages.get(contextId) || [];
    return all.slice(startIndex, endIndex);
  }

  async compact(_contextId: string, _options?: CompactionOptions): Promise<CompactionResult> {
    return {
      summaryMessages: [],
      compactedRange: { start: 0, end: 0 },
      tokensSaved: 0,
    };
  }

  async clear(contextId: string): Promise<void> {
    this.messages.delete(contextId);

    const list = await this.client.send(
      new ListEventsCommand({
        memoryId: this.memoryId,
        actorId: this.actorId,
        sessionId: contextId,
        maxResults: 1000,
      }),
    );

    for (const event of list.events ?? []) {
      if (!event.eventId) continue;
      await this.client.send(
        new DeleteEventCommand({
          memoryId: this.memoryId,
          actorId: this.actorId,
          sessionId: contextId,
          eventId: event.eventId,
        }),
      );
    }
  }

  private async loadCacheIfNeeded(contextId: string, requested?: number): Promise<LLMMessage[]> {
    const existing = this.messages.get(contextId);
    if (existing) {
      return existing;
    }

    const maxResults = requested ?? this.initialFetchLimit;
    const command = new ListEventsCommand({
      memoryId: this.memoryId,
      actorId: this.actorId,
      sessionId: contextId,
      maxResults,
    });

    const response = await this.client.send(command);
    const messages = this.convertEventsToMessages(response.events ?? []);
    this.messages.set(contextId, messages);

    return messages;
  }

  async searchMemories(query: string, options?: { maxResults?: number }): Promise<unknown[]> {
    return this.retrieveLongTermMemories(this.actorId, query, options?.maxResults ?? 10);
  }

  private convertEventsToMessages(events: Event[]): StoredMessage[] {
    const messages: StoredMessage[] = [];

    events.sort((a, b) => {
      const dateA = a.eventTimestamp?.getTime() ?? 0;
      const dateB = b.eventTimestamp?.getTime() ?? 0;
      return dateA - dateB;
    });

    for (let i = 0; i < events.length; i++) {
      const event = events[i];
      const message = { role: 'assistant', content: '' } as LLMMessage;
      for (const payload of event.payload ?? []) {
        if (payload.conversational) {
          message.role = this.fromAgentCoreRole(payload.conversational.role) as LLMMessage['role'];
          message.content = payload.conversational.content?.text ?? '';
        }
        const blob = payload.blob as { toolCallId?: string; toolCalls?: unknown[] } | undefined;
        if (blob?.toolCallId && message.role === 'tool') {
          message.toolCallId = blob.toolCallId;
        }
        if (blob?.toolCalls && message.role === 'assistant') {
          message.toolCalls = blob.toolCalls as unknown as AssistantLLMMessage['toolCalls'];
        }
      }
      const storedMessage: StoredMessage = {
        ...message,
        id: event.eventId ?? `event_${i}`,
        contextId: event.sessionId ?? '',
        index: i,
        timestamp: event.eventTimestamp?.toISOString() ?? new Date().toISOString(),
        tokens: estimateTokens(message.content),
      };
      messages.push(storedMessage);
    }

    return messages;
  }

  private async retrieveLongTermMemories(
    _actorId: string,
    query: string,
    maxResults = 5,
  ): Promise<unknown[]> {
    const command = new RetrieveMemoryRecordsCommand({
      memoryId: this.memoryId,
      namespace: this.longTermMemoryNamespace,
      searchCriteria: {
        searchQuery: query,
        topK: maxResults,
      },
    });

    const response = await this.client.send(command);
    return response.memoryRecordSummaries ?? [];
  }

  // private formatLongTermMemories(memories: unknown[]): string {
  //   if (memories.length === 0) {
  //     return '';
  //   }

  //   const lines = memories.map((record) => {
  //     const data = record as Record<string, unknown>;
  //     return `- ${String(data.content || data.memory || JSON.stringify(record))}`;
  //   });

  //   return `Relevant context from previous sessions:\n${lines.join('\n')}`;
  // }

  private toAgentCoreRole(role: LLMMessage['role']): 'USER' | 'ASSISTANT' | 'TOOL' | 'OTHER' {
    switch (role) {
      case 'user':
        return 'USER';
      case 'assistant':
        return 'ASSISTANT';
      case 'tool':
        return 'TOOL';
      default:
        return 'OTHER';
    }
  }

  private fromAgentCoreRole(role?: string): LLMMessage['role'] {
    switch (role) {
      case 'USER':
        return 'user';
      case 'ASSISTANT':
        return 'assistant';
      case 'TOOL':
        return 'tool';
      default:
        return 'system';
    }
  }
}
