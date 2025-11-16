import { DynamoDBClient, type DynamoDBClientConfig } from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
} from '@aws-sdk/lib-dynamodb';
import type { AgentState, AgentStore } from '@looopy-ai/core';

type SerializableAgentState = Omit<AgentState, 'createdAt' | 'lastActivity'> & {
  createdAt: string;
  lastActivity: string;
};

type PersistedItem = Record<string, unknown> & {
  entityType: string;
  state: SerializableAgentState;
  updatedAt: string;
};

export interface DynamoDBAgentStoreConfig {
  /** DynamoDB table where agent state is stored */
  tableName: string;
  /** Agent identifier used to namespace records within the table */
  agentId: string;
  /** Optional custom name for the partition key attribute (defaults to pk) */
  partitionKeyName?: string;
  /** Optional custom name for the sort key attribute (defaults to sk) */
  sortKeyName?: string;
  /** Prefix used to build the partition key value (defaults to agent#) */
  agentKeyPrefix?: string;
  /** Prefix used to build the sort key value (defaults to context#) */
  contextKeyPrefix?: string;
  /** Enables strongly consistent reads when loading state */
  consistentRead?: boolean;
  /** Custom entity type marker stored with each item (defaults to agent-state) */
  entityType?: string;
  /** Pre-configured DocumentClient instance */
  documentClient?: DynamoDBDocumentClient;
  /** Configuration passed to the fallback DynamoDBClient constructor */
  dynamoDbClientConfig?: DynamoDBClientConfig;
}

export class DynamoDBAgentStore implements AgentStore {
  private readonly tableName: string;
  private readonly agentId: string;
  private readonly partitionKeyName: string;
  private readonly sortKeyName: string;
  private readonly agentKeyPrefix: string;
  private readonly contextKeyPrefix: string;
  private readonly consistentRead: boolean;
  private readonly entityType: string;
  private readonly documentClient: DynamoDBDocumentClient;

  constructor(config: DynamoDBAgentStoreConfig) {
    if (!config.tableName) {
      throw new Error('DynamoDBAgentStore requires a tableName');
    }
    if (!config.agentId) {
      throw new Error('DynamoDBAgentStore requires an agentId');
    }

    this.tableName = config.tableName;
    this.agentId = config.agentId;
    this.partitionKeyName = config.partitionKeyName || 'pk';
    this.sortKeyName = config.sortKeyName || 'sk';
    this.agentKeyPrefix = config.agentKeyPrefix || 'agent#';
    this.contextKeyPrefix = config.contextKeyPrefix || 'context#';
    this.consistentRead = config.consistentRead ?? true;
    this.entityType = config.entityType || 'agent-state';
    this.documentClient =
      config.documentClient ||
      DynamoDBDocumentClient.from(new DynamoDBClient(config.dynamoDbClientConfig));
  }

  async load(contextId: string): Promise<AgentState | null> {
    const command = new GetCommand({
      TableName: this.tableName,
      Key: this.buildKey(contextId),
      ConsistentRead: this.consistentRead,
    });
    const response = await this.documentClient.send(command);
    if (!response.Item) {
      return null;
    }
    const item = response.Item as PersistedItem;
    if (!item.state) {
      return null;
    }
    return this.deserializeState(item.state);
  }

  async save(contextId: string, state: AgentState): Promise<void> {
    const serializable = this.serializeState(state);
    const command = new PutCommand({
      TableName: this.tableName,
      Item: {
        ...this.buildKey(contextId),
        entityType: this.entityType,
        state: serializable,
        updatedAt: new Date().toISOString(),
      },
    });
    await this.documentClient.send(command);
  }

  async delete(contextId: string): Promise<void> {
    const command = new DeleteCommand({
      TableName: this.tableName,
      Key: this.buildKey(contextId),
    });
    await this.documentClient.send(command);
  }

  private buildKey(contextId: string): Record<string, string> {
    return {
      [this.partitionKeyName]: `${this.agentKeyPrefix}${this.agentId}`,
      [this.sortKeyName]: `${this.contextKeyPrefix}${contextId}`,
    };
  }

  private serializeState(state: AgentState): SerializableAgentState {
    return {
      ...state,
      createdAt: state.createdAt.toISOString(),
      lastActivity: state.lastActivity.toISOString(),
    };
  }

  private deserializeState(state: SerializableAgentState): AgentState {
    return {
      ...state,
      createdAt: new Date(state.createdAt),
      lastActivity: new Date(state.lastActivity),
    };
  }
}
