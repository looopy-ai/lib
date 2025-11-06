# SSE Event Logging in Kitchen Sink Example

## Overview

Added comprehensive event logging to the kitchen-sink example that captures all agent events in SSE (Server-Sent Events) format for debugging, monitoring, and analysis.

## Implementation

### Log File Location

Events are logged to:
```
_agent_store/agent={agent-id}/context={context-id}/sse-log.txt
```

This keeps logs organized by agent and context, alongside messages, artifacts, and other session data.

### Log Format

Each event is logged in SSE format with timestamp:
```
[2025-11-06T08:51:57.123Z] data: {"kind":"task-created","taskId":"task_123",...}

[2025-11-06T08:51:57.456Z] data: {"kind":"task-status","status":"working",...}

```

The format matches SSE protocol:
- `[timestamp]` prefix for log analysis
- `data: ` prefix for SSE format
- JSON stringified event object
- Double newline separator

### Changes Made

**File**: `examples/kitchen-sink.ts`

1. **Imports**: Added `fs` and `path` modules for file operations

2. **Log Path Setup**:
   ```typescript
   const sseLogPath = path.join(
     BASE_PATH,
     `agent=${agentId}`,
     `context=${contextId}`,
     'sse-log.txt'
   );
   await fs.mkdir(path.dirname(sseLogPath), { recursive: true });
   ```

3. **Logging Function**:
   ```typescript
   async function logSSEEvent(event: AgentEvent): Promise<void> {
     const timestamp = new Date().toISOString();

     // Create a safe JSON string using a replacer to handle circular refs
     const seen = new WeakSet();
     const safeJSON = JSON.stringify(event, (_key: string, value: any): any => {
       if (value === null || value === undefined || typeof value !== 'object') {
         return value;
       }

       // Detect circular references
       if (seen.has(value)) {
         return '[Circular]';
       }

       // Skip OpenTelemetry objects (spans, tracers, processors)
       const constructorName = value.constructor?.name;
       if (constructorName?.includes('Span') ||
           constructorName?.includes('Tracer') ||
           constructorName?.includes('Processor')) {
         return '[OpenTelemetry Object]';
       }

       seen.add(value);
       return value;
     });

     const sseData = `data: ${safeJSON}\n\n`;
     const logEntry = `[${timestamp}] ${sseData}`;
     await fs.appendFile(sseLogPath, logEntry, 'utf-8');
   }
   ```

4. **Event Handler Update**:
   ```typescript
   async function handleAgentEvent(event: AgentEvent) {
     // Log all events to SSE log file
     await logSSEEvent(event);

     // Handle specific events for console output
     if (event.kind === 'task-status') {
       handleTaskStatus(event);
     } else if (event.kind === 'content-complete') {
       console.log(`📦 Content completed`);
     }
   }
   ```

5. **New Commands**:
   - `/sse-log [lines]` - View last N lines of SSE log (default: 50)
   - `/clear-sse-log` - Clear the SSE log file

## Usage

### Viewing the Log

```bash
# Inside the kitchen-sink CLI
> /sse-log           # View last 50 lines
> /sse-log 100       # View last 100 lines
```

Output:
```
📡 SSE Event Log (last 50 lines):
  [2025-11-06T08:51:57.123Z] data: {"kind":"task-created","taskId":"task_123",...}
  [2025-11-06T08:51:57.456Z] data: {"kind":"task-status","status":"working",...}
  [2025-11-06T08:51:58.789Z] data: {"kind":"tool-start","toolName":"calculate",...}
  ...
```

### Clearing the Log

```bash
> /clear-sse-log
🗑️  Clearing SSE log...
✅ SSE log cleared!
```

### Direct File Access

The log file can also be accessed directly for external analysis:

```bash
# View the log file
cat _agent_store/agent=kitchen-sink-agent/context=session-2025-11-06/sse-log.txt

# Monitor in real-time
tail -f _agent_store/agent=kitchen-sink-agent/context=session-2025-11-06/sse-log.txt

# Extract specific event types
grep '"kind":"tool-start"' sse-log.txt

# Count events by type
grep -o '"kind":"[^"]*"' sse-log.txt | sort | uniq -c
```

## Events Logged

All internal events from the agent execution are logged, including:

### Task Lifecycle
- `task-created` - Task initialized
- `task-status` - Status changes (working, completed, failed)
- `task-complete` - Task finished

### Tool Execution
- `tool-start` - Tool execution started
- `tool-progress` - Tool execution progress updates
- `tool-complete` - Tool execution finished

### Content Streaming
- `content-delta` - Streaming content chunk
- `content-complete` - Content streaming finished

### Artifacts
- `file-write` - File artifact write operation
- `data-write` - Data artifact write operation
- `dataset-write` - Dataset artifact write operation

### Thought Streaming
- `thought-stream` - LLM thought process events

### Debug Events
- `internal-llm-call` - LLM invocation
- `internal-checkpoint` - State checkpoint
- `internal-thought-process` - Internal reasoning

### Input Requests
- `input-required` - Agent needs user input
- `input-received` - User input received

### Authentication
- `auth-required` - Authentication needed
- `auth-completed` - Authentication successful

## Benefits

1. **Debugging**: Complete event history for troubleshooting agent behavior
2. **Monitoring**: Track agent performance and tool usage
3. **Analysis**: Post-execution analysis of agent decision-making
4. **Replay**: Events can be replayed to understand execution flow
5. **Integration**: SSE format ready for streaming to external systems
6. **Persistence**: Events preserved across sessions for audit trail

## Implementation Details

### Circular Reference Handling

Events may contain OpenTelemetry span objects which have circular references. The logging function uses a custom JSON.stringify replacer to:

1. **Detect circular references**: Using a `WeakSet` to track seen objects
2. **Skip OpenTelemetry objects**: Replace spans, tracers, and processors with `"[OpenTelemetry Object]"`
3. **Preserve event data**: All other event properties are serialized normally

This ensures that:
- Logs never fail due to circular references
- Event data remains complete and useful
- OpenTelemetry instrumentation doesn't pollute logs
- File size remains manageable

### Error Handling

The `logSSEEvent` function wraps all operations in try-catch to ensure:
- Logging failures don't crash the agent
- Errors are reported to console for debugging
- Agent execution continues even if logging fails

## Example Log Analysis

### Count Events by Type
```bash
grep -o '"kind":"[^"]*"' sse-log.txt | cut -d'"' -f4 | sort | uniq -c
```

Output:
```
  45 content-delta
   3 content-complete
  12 internal-llm-call
   8 task-status
   5 tool-complete
   5 tool-start
   2 thought-stream
```

### Extract Tool Usage
```bash
grep '"kind":"tool-start"' sse-log.txt | jq '.toolName'
```

Output:
```
"calculate"
"get_weather"
"calculate"
"get_random_number"
```

### Timeline of Status Changes
```bash
grep '"kind":"task-status"' sse-log.txt | jq '{timestamp: .[0], status: .status}'
```

## Related Files

- `examples/kitchen-sink.ts` - Main implementation
- `src/events/types.ts` - Event type definitions
- `design/internal-event-protocol.md` - Event protocol design
- `ai-journal/OBSERVABILITY_FIXES.md` - Related observability improvements

## Future Enhancements

Potential improvements:
- Structured log rotation (daily/size-based)
- Event filtering by type
- Log compression for old sessions
- Export to structured formats (JSONL, Parquet)
- Integration with observability platforms (Langfuse, etc.)
- Real-time log streaming via WebSocket
