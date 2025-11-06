# Observability Fixes - Empty LLM Completions and Agent Output

## Issues Identified

### 1. Empty `GEN_AI_COMPLETION` Attributes on LLM Spans
**Problem**: When LLMs make tool calls, the response has empty `content` (because the response is tool calls, not text). The `setLLMResponseAttributes` function was setting `GEN_AI_COMPLETION` to an empty string with `response.message.content || ''`.

This caused spans in observability platforms to show:
```
llm.call span:
  gen_ai.prompt: [...]
  gen_ai.completion: ""  ← EMPTY STRING (should be omitted)
  llm.finish_reason: "tool_calls"
```

**Root Cause**: Line 52 in `src/observability/spans/llm-call.ts` always set the completion attribute, even when content was empty.

### 2. Missing Output on `agent[...]` Root Spans
**Problem**: The `agent[agentId]` span was not getting the final assistant message as output, even though the code was attempting to set it.

**Root Cause**: The `assistantMessages` array was never populated. There was a comment saying "Message collection is handled by AgentLoop, not extracted from events" but then the array remained empty when we tried to use it to set the span output.

## Fixes Applied

### Fix 1: Only Set GEN_AI_COMPLETION When Content Exists

**File**: `src/observability/spans/llm-call.ts`

**Change**:
```typescript
// Before
span.setAttribute(SpanAttributes.GEN_AI_COMPLETION, response.message.content || '');

// After
// Only set completion if there's actual content (don't set empty string for tool calls)
const hasContent = response.message.content && response.message.content.trim().length > 0;
if (hasContent) {
  span.setAttribute(SpanAttributes.GEN_AI_COMPLETION, response.message.content);
}
```

**Effect**:
- Tool call responses: No `gen_ai.completion` attribute (clean)
- Text responses: `gen_ai.completion` set with actual content
- Aligns with observability best practices (don't set empty attributes)

### Fix 2: Load Assistant Messages from Store After Turn

**File**: `src/core/agent.ts`

**Changes**:

1. **Removed incorrect message collection from events** (lines 459-465):
   - Deleted code trying to extract messages from `task-complete` event
   - `TaskCompleteEvent` doesn't have a `messages` field

2. **Added message loading after turn completes** (lines 472-495):
```typescript
complete: async () => {
  try {
    // 4. Get the latest messages from store to find assistant responses
    const latestMessages = await this.config.messageStore.getRecent(
      this.config.contextId,
      {
        maxMessages: 20, // Get recent messages to find the assistant response
      }
    );

    // Find assistant and tool messages from this turn
    const turnMessages = latestMessages.filter(
      (m: Message) => m.role === 'assistant' || m.role === 'tool'
    );
    assistantMessages.push(...turnMessages);

    // ... rest of completion handler
```

3. **Updated log message** (line 507):
   - Changed from `agent.turn[${agentId}]` to `agent[${agentId}]` to match actual span name

**Effect**:
- Agent span now has `output` attribute with final assistant message
- Proper attribution of responses to agent execution
- Observability platforms can display agent output correctly

## Testing

All 130 tests passing:

```
✓ tests/internal-event-artifact-store.test.ts (6 tests)
✓ tests/artifact-store.test.ts (27 tests)
✓ tests/local-tools.test.ts (20 tests)
✓ tests/client-tool-provider.test.ts (24 tests)
✓ tests/sse-server.test.ts (29 tests)
✓ tests/sanitize.test.ts (12 tests)
✓ tests/agent-loop.test.ts (12 tests)

Test Files  7 passed (7)
     Tests  130 passed (130)
```

## Impact on Observability Platforms

### Before Fixes

**Langfuse/Other Platforms**:
```
agent[my-agent] span:
  input: "What's the weather?"
  output: (missing) ❌

  └─ llm.call span:
      gen_ai.prompt: [...]
      gen_ai.completion: "" ❌ (empty string for tool calls)
      llm.finish_reason: "tool_calls"
```

### After Fixes

**Langfuse/Other Platforms**:
```
agent[my-agent] span:
  input: "What's the weather?"
  output: "The weather in San Francisco is 72°F and sunny." ✅

  └─ llm.call span:
      gen_ai.prompt: [...]
      (no gen_ai.completion attribute for tool calls) ✅
      llm.finish_reason: "tool_calls"

  └─ llm.call span (second call with tool results):
      gen_ai.prompt: [...]
      gen_ai.completion: "The weather in San Francisco is 72°F and sunny." ✅
      llm.finish_reason: "stop"
```

## Files Modified

1. **src/observability/spans/llm-call.ts**
   - Added content check before setting `GEN_AI_COMPLETION`
   - Prevents empty string attributes on tool call responses

2. **src/core/agent.ts**
   - Removed incorrect message collection from events
   - Added message loading from store after turn completion
   - Fixed log message to match actual span name

## Design Notes

### Why Not Extract Messages from Events?

The `task-complete` event intentionally doesn't include full messages because:
- Messages can be large (especially with tool results)
- Messages are already persisted in MessageStore
- Events should be lightweight for streaming
- The store is the source of truth for messages

The Agent retrieves messages from the store after turn completion to:
- Get the actual persisted messages
- Ensure consistency with what was saved
- Avoid duplicating large data in events

### Sanitization Still Works

The LLM response sanitization in `src/core/sanitize.ts` still properly:
- Sets `content: ''` for tool call responses
- Cleans up whitespace
- Validates tool calls

The span logic now respects this by checking if content is empty before setting the attribute.

## Related Design Docs

- `design/observability.md` - OpenTelemetry integration patterns
- `design/internal-event-protocol.md` - Event types and their fields
- `design/agent-lifecycle.md` - Agent turn execution flow
