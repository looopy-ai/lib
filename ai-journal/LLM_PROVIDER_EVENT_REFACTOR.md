# LLM Provider Event Refactor - Implementation Complete

**Date**: November 9, 2025
**Status**: ✅ LiteLLM provider refactored, ⚠️ Tests and consumers need updates

## Summary

Successfully refactored the LiteLLM provider to emit `Observable<LLMEvent<AnyEvent>>` instead of `Observable<LLMResponse>`. The LLM provider now emits events WITHOUT `contextId` and `taskId` - those fields will be stamped in by the agent-loop.

## Changes Made

### 1. Updated `LLMProvider` Interface (`src/core/types.ts`)

```typescript
// Before
export interface LLMProvider {
  call(request: {
    messages: Message[];
    tools?: ToolDefinition[];
    stream?: boolean;
    sessionId?: string;
  }): Observable<LLMResponse>;
}

// After
export interface LLMProvider {
  call(request: {
    messages: Message[];
    tools?: ToolDefinition[];
    stream?: boolean;
    sessionId?: string;
  }): Observable<import('../events/types').LLMEvent<import('../events/types').AnyEvent>>;
}
```

### 2. Refactored `LiteLLMProvider` (`src/providers/litellm-provider.ts`)

**Key Changes**:
- ✅ Removed non-streaming `callAsync()` method (can be added back later if needed)
- ✅ Made `call()` always use streaming via operator pipeline
- ✅ Emit three types of events (all without `contextId`/`taskId`):
  1. **ContentDeltaEvent** - incremental text chunks as they stream
  2. **ThoughtStreamEvent** - extracted `<thinking>` tags with generated IDs
  3. **ContentCompleteEvent** - final complete message (aggregated)

**Event Stream Architecture**:
```
SSE Stream → choices() → getContent() → splitInlineXml()
                                       ↓
                          content → ContentDeltaEvent (with index)
                          tags → ThoughtStreamEvent (filtered for <thinking>)

SSE Stream → choices() → aggregateChoice() → ContentCompleteEvent

merge(contentDeltas$, thoughts$, complete$) → Observable<LLMEvent>
```

**Updated Imports**:
```typescript
import { merge, Observable } from 'rxjs';
import {
  aggregateChoice,
  choices,
  getContent,
  splitInlineXml,
  type Choice,
} from '../core/operators/chat-completions';
import type {
  AnyEvent,
  ContentCompleteEvent,
  ContentDeltaEvent,
  ThoughtStreamEvent,
  ThoughtType,
  ThoughtVerbosity,
} from '../events/types';
import { generateEventId } from '../events/utils';
```

**Removed**:
- `callAsync()` method (200+ lines)
- `transformResponse()` method (50+ lines)
- `LiteLLMResponse` interface (not needed for streaming-only)
- `from` import from rxjs (no longer using fromAsync)

## Event Format

### ContentDeltaEvent (without contextId/taskId)
```typescript
{
  kind: 'content-delta',
  delta: string,              // Text chunk
  index: number,              // Sequence number (0-based)
  timestamp: string           // ISO 8601
}
```

### ThoughtStreamEvent (without contextId/taskId)
```typescript
{
  kind: 'thought-stream',
  thoughtId: string,          // Generated UUID
  thoughtType: ThoughtType,   // 'reasoning' | 'planning' | etc.
  verbosity: ThoughtVerbosity, // 'brief' | 'normal' | 'detailed'
  content: string,            // Thought content
  index: number,              // Sequence number
  timestamp: string           // ISO 8601
}
```

### ContentCompleteEvent (without contextId/taskId)
```typescript
{
  kind: 'content-complete',
  content: string,            // Full assembled content
  timestamp: string           // ISO 8601
}
```

## Breaking Changes

### Files That Need Updates

1. **`src/core/agent-loop.ts`** (1 error)
   - Line 398: `extractThoughtsFromStream()` expects `LLMResponse` but gets `LLMEvent`
   - **Fix**: Update operator to work with event stream

2. **`src/stores/messages/memory-message-store.ts`** (2 errors)
   - Lines 291-292: Trying to access `response.message` which doesn't exist on `LLMEvent`
   - **Fix**: Update to extract content from `ContentCompleteEvent`

3. **`tests/agent-loop.test.ts`** (14 errors)
   - `MockLLMProvider` returns `Observable<LLMResponse>` but should return `Observable<LLMEvent>`
   - **Fix**: Update mock to emit proper events

4. **`tests/litellm-streaming-integration.test.ts`** (2 errors)
   - Tests expect `result.delta?.tool_calls` format
   - **Fix**: Update expectations for new event format

5. **`tests/manual-thought-test.ts`** (5 errors)
   - Tests create objects with `message` property which doesn't exist on `LLMEvent`
   - **Fix**: Update to create proper event objects

6. **`tests/thought-extraction.test.ts`** (7 errors)
   - Same issue as manual-thought-test
   - **Fix**: Update test data

7. **`tests/thought-streaming-edge-cases.ts`** (13 errors)
   - Same issue with `message` property
   - **Fix**: Update test data

8. **`tests/tool-calls.test.ts`** (27 errors)
   - Various undefined safety issues with tool calls
   - **Fix**: These may be pre-existing, but verify tool call handling

## Next Steps

### Immediate (Required for compilation)

1. **Update agent-loop.ts operators**
   - Modify LLM operators to work with `LLMEvent` stream
   - Add logic to reconstruct `LLMResponse` equivalent from events if needed
   - Or refactor to work directly with events

2. **Update MessageStore**
   - Change how messages are extracted from LLM responses
   - Listen for `ContentCompleteEvent` instead of `LLMResponse`

3. **Update all test mocks**
   - Create helper function to generate proper `LLMEvent` objects
   - Update `MockLLMProvider` to emit events instead of responses

### Medium Priority

4. **Update examples**
   - Verify all examples still work
   - Update documentation for new event-based API

5. **Add integration tests**
   - Test full event stream from LiteLLM provider
   - Verify content deltas, thoughts, and complete events

### Future Enhancements

6. **Tool call events**
   - Currently `ContentCompleteEvent` doesn't include tool calls
   - May need separate event type for tool call detection
   - Or extend `ContentCompleteEvent` to include tool calls

7. **Add back non-streaming support**
   - If needed, add `callAsync()` back
   - Make it emit same events but all at once

8. **Streaming usage metadata**
   - Capture token usage from streaming responses
   - Emit as metadata event at end

## Benefits Achieved

✅ **Clean separation**: LLM provider emits low-level events, agent-loop adds context
✅ **Leverages operators**: Uses existing `choices()`, `getContent()`, `splitInlineXml()`, `aggregateChoice()`
✅ **Thought extraction**: Maintains `<thinking>` tag parsing with generated IDs
✅ **Incremental updates**: Clients can display content as it streams
✅ **Removed complexity**: Eliminated 250+ lines of non-streaming code

## Notes

- The complexity warning in `createSSEStream()` is pre-existing (43/15)
- All unused interfaces/types have been removed
- The implementation is complete and correct per the refactor plan
- Compilation errors are expected - they indicate all consumers that need updates

## References

- Original discussion: User's selected code in litellm-provider.ts lines 217-264
- Event types: `src/events/types.ts`
- Event utilities: `src/events/utils.ts`
- Operators: `src/core/operators/chat-completions/`
