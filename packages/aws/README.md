# @looopy-ai/aws

AWS helpers for running Looopy AgentCore inside AWS runtimes. This package currently ships a DynamoDB-backed `AgentStore` plus the `agentcore-runtime-server` used to service Bedrock AgentCore Runtime events.

## DynamoDB Agent Store

`DynamoDBAgentStore` persists each AgentCore context in DynamoDB. A single table can host many agents by prefixing the keys:

- Partition key (`pk` by default): `agent#{agentId}`
- Sort key (`sk` by default): `context#{contextId}`
- Attributes: `entityType`, serialized `state`, and an ISO `updatedAt`

You can override the key attribute names and prefixes in the constructor to match an existing schema.

### Usage

```ts
import { Agent } from '@looopy-ai/core';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { DynamoDBAgentStore } from '@looopy-ai/aws/ts/stores';

const documentClient = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: process.env.AWS_REGION }),
);

const agentStore = new DynamoDBAgentStore({
  tableName: process.env.AGENT_STATE_TABLE!,
  agentId: 'agentcore-runtime',
  documentClient,
});

const agent = new Agent({
  agentId: 'agentcore-runtime',
  contextId: 'ctx-1234',
  agentStore,
  // supply llmProvider, plugins, and messageStore
});
```

### Creating the table with AWS CDK

The snippet below provisions a table that matches the defaults used by `DynamoDBAgentStore`.

```ts
import { Stack, StackProps, RemovalPolicy, CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { AttributeType, BillingMode, Table } from 'aws-cdk-lib/aws-dynamodb';

export class AgentStateStoreStack extends Stack {
  public readonly table: Table;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    this.table = new Table(this, 'AgentStateTable', {
      partitionKey: { name: 'pk', type: AttributeType.STRING },
      sortKey: { name: 'sk', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    new CfnOutput(this, 'AgentStateTableName', { value: this.table.tableName });
  }
}
```

1. Run `cdk init app --language typescript` in a new directory.
2. Add the stack above to `lib/agent-state-store-stack.ts` and synthesize with `cdk synth`.
3. Deploy with `cdk deploy` and capture the `AgentStateTableName` output.
4. Pass the table name to your runtime as `AGENT_STATE_TABLE` and grant the runtime IAM role `dynamodb:GetItem`, `PutItem`, and `DeleteItem` actions for that table.

> Optional: add `timeToLiveAttribute: 'ttl'` to the table props and write a UNIX timestamp to that attribute from your runtime if you want DynamoDB TTL based cleanup.

### Wiring into AgentCore Runtime Server

When running the provided `agentcore-runtime-server`, create the store once and reuse it for each invocation:

```ts
import { serve } from '@looopy-ai/aws';
import { Agent } from '@looopy-ai/core';
import { DynamoDBAgentStore } from '@looopy-ai/aws/ts/stores';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

const documentClient = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.AWS_REGION }));
const agentStore = new DynamoDBAgentStore({
  tableName: process.env.AGENT_STATE_TABLE!,
  agentId: 'agentcore-runtime',
  documentClient,
});

serve({
  agent: async (contextId) =>
    new Agent({
      agentId: 'agentcore-runtime',
      contextId,
      agentStore,
      // other dependencies here
    }),
});
```

This ensures each Bedrock AgentCore request can resume from the state stored in DynamoDB across separate Lambda or container invocations.

## AgentCore Memory Message Store

`AgentCoreMemoryMessageStore` streams conversation turns to the Bedrock AgentCore Memory APIs so short-term and long-term memories persist outside of your runtime container. The store wraps the runtime (`CreateEvent`, `ListEvents`, `DeleteEvent`) and memory retrieval APIs (`RetrieveMemoryRecords`) and implements the `MessageStore` contract used by `Agent`.

### Prerequisites

1. In the AWS Console open **Amazon Bedrock → Agentic Memory** (or use the `@aws-sdk/client-bedrock-agentcore` / AWS CLI equivalent) and create a Memory resource. Enable the strategies you want (summaries, user preferences, etc.).
2. Capture the `memoryId` that is returned.
3. Grant the runtime IAM role the following permissions scoped to that memory: `bedrock:CreateEvent`, `bedrock:ListEvents`, `bedrock:DeleteEvent`, and `bedrock:RetrieveMemoryRecords`.
4. Provide an `agentId` that serves as the actor identifier for all sessions. This typically represents the agent or assistant identity.

### Usage

```ts
import { Agent } from '@looopy-ai/core';
import { AgentCoreMemoryMessageStore } from '@looopy-ai/aws/ts/stores';

const messageStore = new AgentCoreMemoryMessageStore({
  memoryId: process.env.AGENT_MEMORY_ID!,
  agentId: 'agentcore-runtime',
  region: process.env.AWS_REGION,
  // Optional: enable long-term memory retrieval
  longTermMemoryNamespace: 'persistent-context',
});

const agent = new Agent({
  agentId: 'agentcore-runtime',
  contextId: 'ctx-1234',
  messageStore,
  // llmProvider, plugins, agentStore, etc.
});
```

### Features

- **Short-term memory:** Every call to `append` persists conversation turns via `CreateEventCommand`. Messages are stored per session (`contextId`).
- **Long-term memory (optional):** When `longTermMemoryNamespace` is configured, `getRecent` automatically retrieves and prepends relevant long-term memories to the conversation context.
- **Token budget support:** `getRecent` honors token limits using `trimToTokenBudget` to keep conversations within model constraints.
- **Memory search:** Use `searchMemories(query, options?)` to retrieve long-term memories semantically related to a query.
- **Session cleanup:** Call `clear(contextId)` to remove all short-term events for a specific session. Long-term memories persist per your memory resource configuration.

### Configuration Options

| Option | Required | Description |
|--------|----------|-------------|
| `memoryId` | Yes | Pre-provisioned AgentCore memory identifier |
| `agentId` | Yes | Static actor identifier used across all sessions |
| `region` | No | AWS region (defaults to `AWS_REGION` env var or `us-west-2`) |
| `client` | No | Custom `BedrockAgentCoreClient` instance (useful for testing) |
| `longTermMemoryNamespace` | No | Namespace for retrieving long-term memories. When set, enables automatic memory retrieval in `getRecent` |
