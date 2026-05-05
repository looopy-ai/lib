# DynamoDB Agent Store Table Setup

This document describes the AWS CLI commands required to create the DynamoDB table used by `DynamoDBAgentStore`.

## Table Schema

The `DynamoDBAgentStore` uses a single DynamoDB table to persist agent state with the following structure:

| Attribute | Type | Key | Purpose |
|-----------|------|-----|---------|
| `pk` | String | Partition Key | Agent identifier (`agent#{agentId}`) |
| `sk` | String | Sort Key | Context identifier (`context#{contextId}`) |
| `entityType` | String | — | Entity type marker (default: `agent-state`) |
| `state` | Map | — | Serialized AgentState object |
| `updatedAt` | Number | — | Unix timestamp (seconds) of last update |
| `expires` | Number (TTL) | — | Optional: Unix timestamp for TTL expiration |

## Create Table Command

### Basic Setup (No TTL)

```bash
aws dynamodb create-table \
  --table-name agent-state \
  --attribute-definitions \
    AttributeName=pk,AttributeType=S \
    AttributeName=sk,AttributeType=S \
  --key-schema \
    AttributeName=pk,KeyType=HASH \
    AttributeName=sk,KeyType=RANGE \
  --billing-mode PAY_PER_REQUEST \
  --region us-west-2
```

### With TTL Support

If you plan to use automatic expiration with `ttlSeconds` configuration:

```bash
aws dynamodb create-table \
  --table-name agent-state \
  --attribute-definitions \
    AttributeName=pk,AttributeType=S \
    AttributeName=sk,AttributeType=S \
  --key-schema \
    AttributeName=pk,KeyType=HASH \
    AttributeName=sk,KeyType=RANGE \
  --billing-mode PAY_PER_REQUEST \
  --region us-west-2

# Enable TTL on the expires attribute
aws dynamodb update-time-to-live \
  --table-name agent-state \
  --time-to-live-specification AttributeName=expires,Enabled=true \
  --region us-west-2
```

### With Provisioned Capacity

If you prefer provisioned throughput instead of on-demand billing:

```bash
aws dynamodb create-table \
  --table-name agent-state \
  --attribute-definitions \
    AttributeName=pk,AttributeType=S \
    AttributeName=sk,AttributeType=S \
  --key-schema \
    AttributeName=pk,KeyType=HASH \
    AttributeName=sk,KeyType=RANGE \
  --provisioned-throughput ReadCapacityUnits=10,WriteCapacityUnits=10 \
  --region us-west-2
```

## Configuration Parameters

When instantiating `DynamoDBAgentStore`, you can customize key names:

```typescript
const store = new DynamoDBAgentStore({
  tableName: 'agent-state',           // Required
  agentId: 'my-agent',                // Required
  partitionKeyName: 'pk',             // Optional, defaults to 'pk'
  sortKeyName: 'sk',                  // Optional, defaults to 'sk'
  agentKeyPrefix: 'agent#',           // Optional, defaults to 'agent#'
  contextKeyPrefix: 'context#',       // Optional, defaults to 'context#'
  consistentRead: true,               // Optional, enables strongly consistent reads
  entityType: 'agent-state',          // Optional, stored with each item
  ttlSeconds: 86400,                  // Optional, 24 hours TTL if set
});
```

If you customize key names, adjust the AWS CLI command accordingly:

```bash
aws dynamodb create-table \
  --table-name agent-state \
  --attribute-definitions \
    AttributeName=custom_pk,AttributeType=S \
    AttributeName=custom_sk,AttributeType=S \
  --key-schema \
    AttributeName=custom_pk,KeyType=HASH \
    AttributeName=custom_sk,KeyType=RANGE \
  --billing-mode PAY_PER_REQUEST \
  --region us-west-2
```

## Key Formats

The store automatically builds keys using configurable prefixes:

- **Partition Key (pk)**: `{agentKeyPrefix}{agentId}`
  - Example: `agent#my-agent`

- **Sort Key (sk)**: `{contextKeyPrefix}{contextId}`
  - Example: `context#session-123`

## Item Structure

Each persisted item has this structure:

```json
{
  "pk": "agent#my-agent",
  "sk": "context#session-123",
  "entityType": "agent-state",
  "state": {
    "contextId": "session-123",
    "taskId": "task-456",
    "iteration": 1,
    "conversationId": "conv-789",
    "messages": [...],
    "toolResults": {...},
    "createdAt": "2026-05-05T10:30:00.000Z",
    "lastActivity": "2026-05-05T10:35:00.000Z"
  },
  "updatedAt": 1715000100,
  "expires": 1715086500
}
```

## Verify Table Creation

```bash
aws dynamodb describe-table \
  --table-name agent-state \
  --region us-west-2
```

## Delete Table (If Needed)

```bash
aws dynamodb delete-table \
  --table-name agent-state \
  --region us-west-2
```
