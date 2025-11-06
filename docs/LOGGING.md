# Logging in Looopy

The Looopy framework uses [Pino](https://getpino.io/) for structured, high-performance logging.

## Features

- **Structured Logging**: All logs are JSON objects with contextual information
- **Log Levels**: `trace`, `debug`, `info`, `warn`, `error`, `fatal`
- **Pretty Output**: Human-readable logs in development with `pino-pretty`
- **Contextual**: Automatic task, iteration, and component tracking
- **Performance**: Pino is one of the fastest JSON loggers for Node.js

## Quick Start

### Basic Usage

```typescript
import { createLogger } from 'looopy';

// Create a logger
const logger = createLogger({
  level: 'debug',
  pretty: true, // Enable pretty printing for development
});

logger.info('Application started');
logger.debug({ userId: '123' }, 'User logged in');
logger.error({ error: err.message }, 'Request failed');
```

### With AgentLoop

Pass a logger to the `AgentLoop` constructor:

```typescript
import { AgentLoop, createLogger } from 'looopy';

const logger = createLogger({
  level: 'debug',
  pretty: true,
});

const agent = new AgentLoop({
  agentId: 'my-agent',
  llmProvider,
  toolProviders: [toolProvider],
  taskStateStore,
  artifactStore,
  logger, // Pass logger here
});
```

The agent loop will automatically log:
- Execution start/completion
- Each iteration
- LLM calls and responses
- Tool executions
- Errors and warnings
- State checkpoints

## Log Levels

Set the log level via configuration or environment variable:

```typescript
// Via config
const logger = createLogger({ level: 'info' });

// Via environment variable
// LOG_LEVEL=debug node app.js
```

Available levels (from most to least verbose):
- `trace` - Very detailed debugging
- `debug` - Debugging information
- `info` - General information (default)
- `warn` - Warning messages
- `error` - Error messages
- `fatal` - Fatal errors

## Development vs Production

### Development (Pretty Mode)

```typescript
const logger = createLogger({
  level: 'debug',
  pretty: true, // Human-readable output
});
```

Output:
```
[14:48:23.456] INFO: Starting agent execution
    taskId: "task_1730304503456_abc123"
    prompt: "Calculate 42 * 58"
```

### Production (JSON Mode)

```typescript
const logger = createLogger({
  level: 'info',
  pretty: false, // JSON output for log aggregation
});
```

Output:
```json
{"level":30,"time":1730304503456,"msg":"Starting agent execution","taskId":"task_1730304503456_abc123","prompt":"Calculate 42 * 58"}
```

## Child Loggers

Create child loggers with additional context:

```typescript
import { getLogger } from 'looopy';

// Get a child logger with context
const requestLogger = getLogger({
  requestId: 'req-123',
  userId: 'user-456',
});

requestLogger.info('Processing request');
// Automatically includes requestId and userId in every log
```

## Default Logger

The framework uses a default logger that respects:
- `LOG_LEVEL` environment variable
- `NODE_ENV` environment variable (pretty mode when not "production")

Override the default logger:

```typescript
import { setDefaultLogger, createLogger } from 'looopy';

const customLogger = createLogger({
  level: 'trace',
  context: { application: 'my-app' },
});

setDefaultLogger(customLogger);
```

## Structured Logging Examples

### LLM Call Logging

The agent loop automatically logs:

```json
{
  "level": 20,
  "time": 1730304503456,
  "msg": "Calling LLM",
  "taskId": "task_123",
  "messageCount": 3,
  "toolCount": 2,
  "sessionId": "task_123"
}
```

### Tool Execution Logging

```json
{
  "level": 30,
  "time": 1730304504123,
  "msg": "Executing tool calls",
  "taskId": "task_123",
  "toolCallCount": 1,
  "tools": ["calculate"]
}
```

### Error Logging

```json
{
  "level": 50,
  "time": 1730304505789,
  "msg": "Tool execution failed",
  "taskId": "task_123",
  "toolName": "calculate",
  "error": "Invalid expression",
  "stack": "Error: Invalid expression\n    at ..."
}
```

## Integration with Observability

Pino integrates well with:
- **Elasticsearch**: Send JSON logs to ELK stack
- **CloudWatch**: AWS CloudWatch Logs
- **Datadog**: Datadog Log Management
- **Grafana Loki**: Log aggregation
- **Splunk**: Enterprise log analysis

Example with transport:

```typescript
import pino from 'pino';

const logger = pino({
  level: 'info',
}, pino.transport({
  target: 'pino-elasticsearch',
  options: {
    node: 'http://localhost:9200',
    index: 'looopy-logs',
  },
}));
```

## Best Practices

1. **Use structured data**: Add context objects instead of string interpolation
   ```typescript
   // ✅ Good
   logger.info({ userId, taskId }, 'Task completed');

   // ❌ Avoid
   logger.info(`Task ${taskId} completed for user ${userId}`);
   ```

2. **Log levels appropriately**:
   - `debug`: Detailed flow information
   - `info`: Significant events (task start/complete)
   - `warn`: Recoverable issues
   - `error`: Errors that need attention
   - `fatal`: Critical failures

3. **Include context**: taskId, userId, requestId, etc.

4. **Avoid logging sensitive data**: API keys, passwords, tokens

5. **Use child loggers**: For scoped context

## Environment Variables

- `LOG_LEVEL`: Set log level (`trace`, `debug`, `info`, `warn`, `error`, `fatal`)
- `NODE_ENV`: Set to `production` to disable pretty printing

Example:
```bash
LOG_LEVEL=debug NODE_ENV=development pnpm example:litellm
```

## References

- [Pino Documentation](https://getpino.io/)
- [Pino Best Practices](https://github.com/pinojs/pino/blob/master/docs/best-practices.md)
- [Pino Transports](https://github.com/pinojs/pino/blob/master/docs/transports.md)
