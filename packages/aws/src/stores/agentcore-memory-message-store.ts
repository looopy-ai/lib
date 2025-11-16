import {
  BedrockAgentCoreClient,
  CreateEventCommand,
  DeleteEventCommand,
  type Event,
  ListEventsCommand,
  RetrieveMemoryRecordsCommand,
} from '@aws-sdk/client-bedrock-agentcore';
import type { CompactionOptions, CompactionResult, Message, MessageStore } from '@looopy-ai/core';
import { trimToTokenBudget } from '@looopy-ai/core';
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
}

export class AgentCoreMemoryMessageStore implements MessageStore {
  private readonly memoryId: string;
  private readonly actorId: string;
  private readonly includeLongTermMemories: boolean;
  private readonly longTermMemoryNamespace?: string;
  private readonly client: BedrockAgentCoreClient;

  constructor(config: AgentCoreMemoryMessageStoreConfig) {
    this.memoryId = config.memoryId;
    this.actorId = config.agentId;
    this.includeLongTermMemories = !!config.longTermMemoryNamespace;
    this.longTermMemoryNamespace = config.longTermMemoryNamespace;
    this.client =
      config.client ||
      new BedrockAgentCoreClient({
        region: config.region ?? process.env.AWS_REGION ?? 'us-west-2',
      });
  }

  async append(contextId: string, messages: Message[]): Promise<void> {
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
          {
            blob: {
              toolCallId: message.toolCallId,
              toolCalls: message.toolCalls as unknown,
            } as DocumentType,
          },
        ],
      });

      await this.client.send(command);
    }
  }

  async getRecent(
    contextId: string,
    options?: { maxMessages?: number; maxTokens?: number },
  ): Promise<Message[]> {
    const command = new ListEventsCommand({
      memoryId: this.memoryId,
      actorId: this.actorId,
      sessionId: contextId,
      maxResults: options?.maxMessages ?? 50,
    });

    const response = await this.client.send(command);
    const messages = this.convertEventsToMessages(response.events ?? []);

    if (this.includeLongTermMemories && messages.length > 0) {
      const longTerm = await this.retrieveLongTermMemories(this.actorId, 'relevant context');
      if (longTerm.length > 0) {
        messages.unshift({
          role: 'system',
          content: this.formatLongTermMemories(longTerm),
        });
      }
    }

    if (options?.maxTokens) {
      return trimToTokenBudget(messages, options.maxTokens);
    }

    return messages;
  }

  async getAll(contextId: string): Promise<Message[]> {
    return this.getRecent(contextId, { maxMessages: 1000 });
  }

  async getCount(contextId: string): Promise<number> {
    const messages = await this.getRecent(contextId);
    return messages.length;
  }

  async getRange(contextId: string, startIndex: number, endIndex: number): Promise<Message[]> {
    const all = await this.getAll(contextId);
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

  async searchMemories(query: string, options?: { maxResults?: number }): Promise<unknown[]> {
    return this.retrieveLongTermMemories(this.actorId, query, options?.maxResults ?? 10);
  }

  private convertEventsToMessages(events: Event[]): Message[] {
    const messages: Message[] = [];

    events.sort((a, b) => {
      const dateA = a.eventTimestamp?.getTime() ?? 0;
      const dateB = b.eventTimestamp?.getTime() ?? 0;
      return dateA - dateB;
    });

    for (const event of events) {
      const message: Message = { role: 'assistant', content: '' };
      for (const payload of event.payload ?? []) {
        if (payload.conversational) {
          message.role = this.fromAgentCoreRole(payload.conversational.role);
          message.content = payload.conversational.content?.text ?? '';
        }
        const blob = payload.blob as { toolCallId?: string; toolCalls?: unknown[] } | undefined;
        if (blob?.toolCallId) {
          message.toolCallId = blob.toolCallId;
        }
        if (blob?.toolCalls) {
          message.toolCalls = blob.toolCalls as unknown as Message['toolCalls'];
        }
      }
      messages.push(message);
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

  private formatLongTermMemories(memories: unknown[]): string {
    if (memories.length === 0) {
      return '';
    }

    const lines = memories.map((record) => {
      const data = record as Record<string, unknown>;
      return `- ${String(data.content || data.memory || JSON.stringify(record))}`;
    });

    return `Relevant context from previous sessions:\n${lines.join('\n')}`;
  }

  private toAgentCoreRole(role: Message['role']): 'USER' | 'ASSISTANT' | 'TOOL' | 'OTHER' {
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

  private fromAgentCoreRole(role?: string): Message['role'] {
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
