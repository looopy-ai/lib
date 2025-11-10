# Streaming Architecture Documentation Update

**Date**: 2025-11-05
**Status**: ✅ Complete

## Summary

Updated `design/streaming-architecture.md` to accurately reflect the actual implementation flow between the LiteLLM provider and kitchen sink CLI example. Removed outdated SSE server architecture references and documented the three-path streaming pattern.

## Changes Made

### 1. High-Level Architecture Diagram

**Before**: Showed SSE Server layer, EventRouter, long-lived HTTP connections
**After**: Shows Kitchen Sink CLI → Agent → AgentLoop → LiteLLM Provider → External LLM

Key additions:
- Three parallel paths in LiteLLM Provider:
  - Path A: Content deltas (`getContent()` → `splitInlineXml()` → content chunks)
  - Path B: Thought streams (`getContent()` → `splitInlineXml()` → tags → filter)
  - Path C: Content complete (`aggregateChoice()` → final message)
- Shows `merge(A, B, C)` pattern
- Reflects `shareReplay()` for single HTTP request

### 2. Data Flow Sections (1-6)

**Section 1: Client Initiates Request**
- Changed from HTTP POST to SSE endpoint → Kitchen sink interactive prompt
- Shows direct `agent.startTurn()` call instead of HTTP request

**Section 2: SSE Server Creates Subscription**
- Removed entire section (not applicable to kitchen sink)

**Section 3: Agent Starts Turn**
- Updated to show actual `Agent.startTurn()` implementation
- Shows MessageStore loading, appending user message, calling AgentLoop
- No EventRouter layer (direct Observable return)

**Section 4: AgentLoop Executes Pipeline**
- Updated to show actual `AgentLoop.startTurn()` implementation
- Shows initial event emission (task-created, task-status)
- Documents tool execution loop with `expand()` operator

**Section 5: LLM Provider Streams Response** (Most Important)
- **NEW**: Complete three-path architecture documentation
- Shows `rawStream$` → `choices()` → `shareReplay()`
- Path A: `splitInlineXml()` → content → `ContentDeltaEvent`
- Path B: `splitInlineXml()` → tags → filter → `ThoughtStreamEvent`
- Path C: `aggregateChoice()` → `ContentCompleteEvent`
- Documents `merge()` combinator
- Explains synchronous processing guarantees

**Section 6: splitInlineXml() Utility**
- Replaced old "Thought Extraction Operator" section
- Documents `ReplaySubject` usage for buffering
- Shows `InlineXmlParser` synchronous processing
- Example input/output for tag extraction

**Section 7: Event Emission Timeline**
- Updated timeline to show three parallel paths
- Shows content-delta, thought-stream, and content-complete events
- Documents timing and ordering guarantees

### 3. Key Design Patterns

**Pattern 1: Three-Path Merge Pattern**
- Documents single HTTP connection split into three observables
- Shows benefits (efficiency, low latency, natural ordering)

**Pattern 2: Content Deltas (Not Accumulated)**
- Clarifies that provider emits true deltas from SSE stream
- Shows example of delta emission vs accumulation

**Pattern 3: shareReplay() for Single HTTP Connection**
- Documents multicasting to avoid multiple HTTP requests
- Shows how all three paths subscribe to same `stream$`

**Pattern 4: ReplaySubject for Buffering**
- Explains why `ReplaySubject` used instead of `Subject`
- Prevents timing issues with late subscribers

**Pattern 5: Synchronous Writes for Ordering**
- Documents `fs.writeSync()` in kitchen sink
- Explains trade-off between blocking and ordering guarantee

### 4. Updated Sections

**Kitchen Sink CLI Event Handling**
- Replaced SSE client-side examples
- Shows direct Observable subscription pattern
- Documents synchronous write usage
- Shows event handling for content-delta, thought-stream, etc.

**Thought Extraction: Supported Formats**
- Updated to reflect actual `<thinking id="abc">` format
- Removed old attribute-based formats (not implemented)
- Shows incremental streaming of thought content
- Documents completion event when tag closes

**Performance Considerations**
- Removed SSE keep-alive section
- Added synchronous write performance analysis
- Added `shareReplay()` memory impact
- Added `ReplaySubject` buffer size discussion

**Testing Strategy**
- Updated test file references (`content.test.ts` with 61 tests)
- Removed references to non-existent test files
- Added actual test coverage for `splitInlineXml()`

**Future Enhancements**
- Removed SSE-specific enhancements (compression, event prioritization)
- Added relevant enhancements (additional XML tags, adaptive buffering)
- Added optional SSE server layer as future work

**Implementation References**
- **NEW**: Complete section listing all relevant files
- Core files: `litellm-provider.ts`, `content.ts`, `aggregate.ts`, `agent.ts`, `agent-loop.ts`
- Example files: `kitchen-sink.ts`, `litellm-agent.ts`
- Test files: `content.test.ts`, `agent-loop.test.ts`
- Related docs: `THOUGHT_EXTRACTION.md`, `CONTENT_DELTA_ORDER_FIX.md`

### 5. Removed Sections

- ❌ "SSE Server Creates Subscription" (Section 2)
- ❌ Duplicate "AgentLoop Executes Pipeline" (Section 4 duplicate)
- ❌ "Event Emission Points" subsection
- ❌ "Accumulated Content (Not Deltas)" outdated pattern
- ❌ "Event Filtering at SSE Layer" pattern
- ❌ "Operator Factory Pattern" (moved to other design docs)
- ❌ "Server-Sent Events (SSE)" with server/client code
- ❌ "Connection Failures" error handling
- ❌ "Subscriber Errors" error handling
- ❌ Keep-alive and subscriber cleanup (SSE-specific)

## Validation

### Accuracy Checks

✅ High-level diagram matches actual flow (CLI → Agent → AgentLoop → Provider)
✅ Three-path architecture reflects `streamEvents()` implementation
✅ `splitInlineXml()` documentation matches `content.ts` code
✅ Event types match `InternalEvent` discriminated union
✅ Kitchen sink event handling matches `kitchen-sink.ts` code
✅ Implementation references point to actual files
✅ Test coverage numbers accurate (61 content tests passing)

### Completeness

✅ All major sections updated to reflect actual implementation
✅ SSE server references removed or marked as future work
✅ Three-path streaming architecture fully documented
✅ ReplaySubject timing fix documented
✅ Synchronous write pattern documented
✅ Performance considerations relevant to actual code
✅ Testing strategy matches actual test files

## Related Documentation

- **`design/streaming-architecture.md`** - This document (now updated)
- **`ai-journal/CONTENT_DELTA_ORDER_FIX.md`** - Synchronous write fix
- **`docs/THOUGHT_EXTRACTION.md`** - Detailed thought extraction docs
- **`src/providers/litellm-provider.ts`** - Implementation reference
- **`src/core/operators/chat-completions/content.ts`** - splitInlineXml implementation

## Key Takeaways

1. **Three-Path Architecture**: LiteLLM provider splits single SSE stream into content deltas, thoughts, and completion
2. **Synchronous Processing**: `splitInlineXml()` guarantees ordering through synchronous left-to-right parsing
3. **ReplaySubject Buffering**: Prevents timing issues with late subscribers
4. **Kitchen Sink Pattern**: Direct Observable subscription (no SSE server layer needed for CLI)
5. **Synchronous Writes**: `fs.writeSync()` guarantees console output ordering

## Next Steps

- ✅ Streaming architecture documentation complete
- Consider: Add SSE server implementation (currently only design, not implemented)
- Consider: Add more XML tag types beyond `<thinking>`
- Consider: Implement adaptive buffer sizing for large responses
