# Debugging Improvements

## Summary

Added comprehensive logging to the agent loop using Pino and fixed the double-LLM-call issue.

## Changes Made

### 1. Added Pino Logging (`src/core/logger.ts`)

- Created logger utility with `createLogger()`, `getLogger()`, and `setDefaultLogger()`
- Supports both pretty (development) and JSON (production) output
- Configurable log levels: trace, debug, info, warn, error, fatal
- Respects `LOG_LEVEL` and `NODE_ENV` environment variables

### 2. Updated AgentLoop with Logging

Added detailed logging throughout the agent loop:

```typescript
- Execution start/completion
- Iteration tracking (start/complete)
- LLM calls with context (message count, tool count, session ID)
- LLM responses (finish reason, tool calls)
- Tool execution (start, completion, errors)
- Tool results added to conversation
- State checkpointing
- Error handling with stack traces
```

### 3. Fixed Double LLM Call Issue

**Problem**: The `expand` operator was being fed the `initialState` with `of(initialState).pipe(expand(...))`, causing it to emit the initial value AND then apply the expansion function to it, resulting in the first iteration running twice.

**Solution**: Changed to start expansion with the first iteration result:

```typescript
// Before: of(initialState).pipe(expand(...))
// After: this.executeIteration(initialState).pipe(expand(...))
```

Now the flow is:
1. Execute first iteration → State with iteration=1
2. expand checks if completed
3. If not, execute next iteration → State with iteration=2
4. Repeat until done

### 4. Updated Configuration

- Added `logger?: pino.Logger` to `AgentLoopConfig`
- AgentLoop creates default logger if none provided
- Logger passed to static `resume()` method

### 5. Documentation

Created comprehensive logging documentation in `docs/LOGGING.md`:
- Quick start guide
- Log level configuration
- Development vs production modes
- Child loggers
- Structured logging examples
- Best practices
- Integration with observability tools

## Usage

### Basic Example

```typescript
import { AgentLoop, createLogger } from 'looopy';

const logger = createLogger({
  level: 'debug',
  pretty: true,
});

const agent = new AgentLoop({
  agentId: 'my-agent',
  llmProvider,
  toolProviders,
  taskStateStore,
  artifactStore,
  logger, // Pass logger
});
```

### Run with Debug Logging

```bash
LOG_LEVEL=debug pnpm example:litellm
```

### Sample Output

```
[01:49:38.508] INFO: Starting agent execution
    prompt: "Calculate 15 * 23 + 47"
    context: {}
[01:49:38.509] DEBUG: Starting iteration
    taskId: "task_1761788978508_in6rb691h"
    iteration: 1
    messageCount: 2
    toolResultCount: 0
[01:49:38.509] DEBUG: Calling LLM
    taskId: "task_1761788978508_in6rb691h"
    messageCount: 2
    toolCount: 2
    sessionId: "task_1761788978508_in6rb691h"
[01:49:38.510] DEBUG: LLM response received
    taskId: "task_1761788978508_in6rb691h"
    finishReason: "tool_calls"
    hasToolCalls: true
    toolCallCount: 1
[01:49:38.511] INFO: Executing tool calls
    taskId: "task_1761788978508_in6rb691h"
    toolCallCount: 1
    tools: ["calculate"]
[01:49:38.512] DEBUG: Executing tool
    taskId: "task_1761788978508_in6rb691h"
    toolName: "calculate"
    toolCallId: "call_abc123"
    args: { "expression": "15 * 23 + 47" }
[01:49:38.513] DEBUG: Tool execution complete
    taskId: "task_1761788978508_in6rb691h"
    toolName: "calculate"
    success: true
[01:49:38.514] DEBUG: Tool results added to conversation, continuing loop
    taskId: "task_1761788978508_in6rb691h"
```

## Benefits

1. **Visibility**: See exactly what the agent loop is doing at each step
2. **Debugging**: Quickly identify where issues occur
3. **Performance**: Track iteration counts, message counts, tool execution times
4. **Production Ready**: JSON logging integrates with ELK, Datadog, CloudWatch, etc.
5. **Contextual**: Every log includes taskId and relevant context

## Files Modified

- `package.json` - Added pino and pino-pretty dependencies
- `src/core/logger.ts` - New logger utility
- `src/core/config.ts` - Added logger to AgentLoopConfig
- `src/core/agent-loop.ts` - Added logging throughout + fixed expand issue
- `src/core/index.ts` - Exported logger utilities
- `examples/litellm-agent.ts` - Added logger to example
- `docs/LOGGING.md` - Comprehensive logging documentation

## Testing

The double-call issue is now fixed. You can verify by:

1. Running with debug logging: `LOG_LEVEL=debug pnpm example:litellm`
2. Checking that each iteration only calls the LLM once
3. Verifying tool execution happens between LLM calls, not after multiple calls

## Next Steps

- Add more granular logging to tool providers
- Add performance metrics (duration tracking)
- Add correlation IDs for distributed tracing
- Consider adding OpenTelemetry integration for traces/metrics
