# Thought Source Metadata - Complete

**Date**: 2025-11-09
**Status**: ✅ Complete

## Summary

Added metadata tracking to distinguish thoughts extracted from LLM content (`<thinking>` tags) versus thoughts emitted explicitly via the `think_aloud` tool.

## Changes

### 1. Updated Thought Extraction Operators

**File**: `src/core/operators/thought-stream.ts`

- Added `source: 'content'` to metadata for thoughts extracted from `<thinking>` tags
- Fixed metadata passing to wrap in `{ metadata: ... }` options object (not pass directly)
- Handles 3 thought formats:
  1. `<thinking>content</thinking>` (content between tags)
  2. `<thinking thought="..." />` (self-closing with attributes)
  3. `<thinking thought="..."></thinking>` (attributes with closing tag)

### 2. Updated Think Aloud Tool

**File**: `src/tools/thought-tools.ts`

- Added `source: 'tool-call'` to metadata for thoughts emitted via `think_aloud` tool
- Metadata is merged with other fields (`confidence`, `alternatives`, `relatedTo`)

### 3. Updated Type Definitions

**File**: `src/events/types.ts`

- Documented `source` field in `ThoughtStreamEvent.metadata`
- Type: `'content' | 'tool-call'`

### 4. Comprehensive Tests

**File**: `tests/thought-source-metadata.test.ts`

Created 3 test cases:

1. **Content extraction**: Verifies thoughts from `<thinking>` tags have `source: 'content'`
2. **Tool call extraction**: Verifies thoughts from `think_aloud` have `source: 'tool-call'` (and confidence is passed through)
3. **Multiple sources**: Verifies both sources can be used in same execution

All tests passing ✅

## Why This Matters

### Observability

Users can now filter and analyze thoughts by their origin:

```typescript
// Filter for explicit tool-based thoughts
const explicitThoughts = events.filter(
  e => e.kind === 'thought-stream' && e.metadata?.source === 'tool-call'
);

// Filter for thoughts extracted from content
const extractedThoughts = events.filter(
  e => e.kind === 'thought-stream' && e.metadata?.source === 'content'
);
```

### Different Semantics

- **Content extraction** (`source: 'content'`): Thoughts the LLM embedded in its response without being explicitly asked. May be more casual or background reasoning.

- **Tool call** (`source: 'tool-call'`): Explicit, structured thoughts the LLM chose to emit via `think_aloud`. Typically more formal, confident, and intentional.

### Debugging

When debugging why an agent made a decision, knowing the thought source helps understand:
- Was this reasoning explicit or implicit?
- Did the LLM choose to surface this thought, or was it extracted?
- What confidence level did the LLM assign (only available for tool-call thoughts)?

## Implementation Details

### Metadata Flow

**Content Extraction Path**:
```
LLM response with <thinking>...</thinking>
  → extractThoughtsFromStream operator
  → Creates { kind: 'thought', content, metadata: { source: 'content' } }
  → Calls eventEmitter.emitThought(..., { metadata: { source: 'content' } })
  → Event emitted with metadata.source = 'content'
```

**Tool Call Path**:
```
LLM returns tool_call to think_aloud
  → thoughtTools.execute()
  → Calls eventEmitter.emitThought(..., { confidence, metadata: { source: 'tool-call' } })
  → Event emitted with metadata.source = 'tool-call' (and confidence merged in)
```

### Metadata Merging

The `LoopEventEmitter.emitThought` method merges metadata fields:

```typescript
emitThought(taskId, contextId, thoughtType, content, options) {
  const event = createThoughtStreamEvent({
    // ...
    metadata: {
      confidence: options?.confidence,      // Top-level option
      relatedTo: options?.relatedTo,        // Top-level option
      alternatives: options?.alternatives,  // Top-level option
      ...options?.metadata,                 // Spread additional metadata (includes source)
    },
  });
}
```

This allows both:
- Dedicated fields like `confidence` (passed as top-level options)
- Custom fields like `source` (passed in `options.metadata`)

## Test Coverage

All 227 tests pass, including:
- 3 new tests specifically for source metadata
- Existing thought extraction tests (ensure no regression)
- Full agent-loop integration tests

## Breaking Changes

None. This is a purely additive change:
- New optional `metadata.source` field
- Existing code continues to work without modification
- Metadata is optional and backward-compatible

## Future Enhancements

Potential follow-ups:
1. Add `source` field to documentation/examples
2. Create filtering utilities for thoughts by source
3. Add metrics/analytics based on thought source distribution
4. Consider adding more granular source types (e.g., `'content:streaming'` vs `'content:final'`)

## Related Files

- `src/core/operators/thought-stream.ts` - Content extraction
- `src/tools/thought-tools.ts` - Tool-based thoughts
- `src/events/types.ts` - Type definitions
- `src/core/operators/event-emitter.ts` - Event emission logic
- `tests/thought-source-metadata.test.ts` - Test coverage
