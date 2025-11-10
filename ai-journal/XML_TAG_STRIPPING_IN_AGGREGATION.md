# XML Tag Processing During Content Aggregation

## Issue

When using inline `<thinking>` XML tags for streaming thoughts, the tags were properly extracted during streaming (via `splitInlineXml()`) and emitted as separate `thought` events. However, the XML tags remained in the final aggregated content of `content-complete` events.

**Example Problem:**
```
Streaming deltas (clean):
  - "Let me think about this."
  - "The answer is 42."

Aggregated content (had XML tags):
  "Let me think about this. <thinking>I need to analyze</thinking> The answer is 42."
```

## Solution

Process XML tags **during** content aggregation (not at the end) using the same logic as `splitInlineXml()` for consistent whitespace handling. Also collect extracted thoughts in the aggregated Choice object.

### Implementation

1. **Created `InlineXmlParser` class** in `src/core/operators/chat-completions/content.ts`:
   - Stateful parser that processes chunks incrementally
   - Reuses exact logic from `splitInlineXml()` for consistent whitespace handling
   - Accumulates clean content and extracted tags separately
   - Handles tags across chunk boundaries (buffers internally)

2. **Updated `AggregatedChoice` type** to include `thoughts` array

3. **Updated `Choice` type** to include `thoughts?: InlineXml[]`

4. **Modified aggregation logic** in `src/core/operators/chat-completions/aggregate.ts`:
   - Creates `InlineXmlParser` instance for each aggregation
   - Processes each content chunk through the parser (not string concatenation)
   - Finalizes parser to get clean content and extracted thoughts
   - Stores both clean content and thoughts array in result

### Code Changes

**`src/core/operators/chat-completions/content.ts`**:
```typescript
export class InlineXmlParser {
  private buffer = '';
  private prevEmittedWasTag = false;
  private contentParts: string[] = [];
  private extractedTags: InlineXml[] = [];

  processChunk(chunk: string): void {
    // Process chunk using same logic as splitInlineXml
  }

  finalize(): { content: string; tags: InlineXml[] } {
    // Return accumulated clean content and extracted tags
  }
}
```

**`src/core/operators/chat-completions/types.ts`**:
```typescript
export type Choice = {
  delta?: { content?: string; tool_calls?: ToolCall[] };
  index: number;
  finish_reason?: string | null;
  thoughts?: InlineXml[];  // NEW
};
```

**`src/core/operators/chat-completions/aggregate.ts`**:
```typescript
const xmlParser = new InlineXmlParser();

// Process each chunk through parser
next: (choice) => {
  if (choice.delta?.content) {
    xmlParser.processChunk(choice.delta.content);
  }
}

// Finalize and set clean content + thoughts
complete: () => {
  const { content, tags } = xmlParser.finalize();

  if (content) {
    aggregated.delta = { ...aggregated.delta, content };
  }

  if (tags.length > 0) {
    aggregated.thoughts = tags;
  }
}
```

## Benefits

1. **Cleaner Final Output**: Content-complete events no longer contain XML tags
2. **Reusable Logic**: Same parsing logic as `splitInlineXml()` for consistency
3. **Consistent Whitespace**: Identical behavior to streaming extraction
4. **Thoughts Collection**: Aggregated Choice includes array of extracted thoughts
5. **Incremental Processing**: Tags removed during chunk processing, not at the end
6. **Handles Multiple Tags**: Works with multiple tags across chunk boundaries

## Testing

Updated 3 test cases in `tests/chat-completions-aggregate.test.ts`:

1. **Paired tags across chunks**: `<thinking>...</thinking>` removed, thought collected
2. **Self-closing tags**: `<thinking />` removed, thought collected
3. **Multiple tags**: Multiple `<thinking>` tags cleaned, all thoughts collected

All 230 tests passing (including 8 aggregate tests).

**Test Examples**:
```typescript
// Paired tag with content
expect(result[0].delta?.content).toBe('Let me think about this.The answer is 42.');
expect(result[0].thoughts).toEqual([
  {
    name: 'thinking',
    content: 'I need to analyze the problem carefully',
    attributes: {},
  },
]);

// Multiple tags
expect(result[0].thoughts).toEqual([
  { name: 'thinking', content: 'First thought', attributes: {} },
  { name: 'thinking', content: 'Second thought', attributes: {} },
]);
```

## Example Output

**Before** (with XML tags):
```json
{
  "kind": "content-complete",
  "choice": {
    "delta": {
      "content": "Let me think. <thinking>I should analyze</thinking> The answer is 42."
    }
  }
}
```

**After** (clean content + thoughts array):
```json
{
  "kind": "content-complete",
  "choice": {
    "delta": {
      "content": "Let me think.The answer is 42."
    },
    "thoughts": [
      {
        "name": "thinking",
        "content": "I should analyze",
        "attributes": {}
      }
    ]
  }
}
```

**Note**: Whitespace at tag boundaries is trimmed per `splitInlineXml()` behavior. If you need space preserved, add explicit space in content chunks: `"Let me think. "` instead of `"Let me think."`.

## Related Changes

- Previous fix: Added `shareReplay()` to prevent duplicate LLM requests
- Previous fix: Disabled `think_aloud` tool by default (now using inline `<thinking>` tags)
- Current streaming: `splitInlineXml()` extracts tags during streaming
- Current aggregation: `stripInlineXmlTags()` cleans final content

## Migration

No breaking changes. This is a quality improvement that automatically applies to all content aggregation.

**Benefits users automatically get:**
- Cleaner content in `content-complete` events
- No manual XML tag removal needed
- Consistent output format

## Technical Notes

### Why Process During Aggregation?

Processing during aggregation (chunk by chunk) rather than at the end provides:
1. **Consistent Logic**: Uses exact same parser as `splitInlineXml()`
2. **Consistent Whitespace**: Identical trimming behavior
3. **Reusability**: `InlineXmlParser` class can be used elsewhere
4. **Thought Collection**: Natural place to accumulate extracted thoughts
5. **Handles Boundaries**: Tags spanning chunks handled correctly

### Whitespace Handling

Follows `splitInlineXml()` trimming rules:
- Left-trim if previous emission was a tag: `\s+` at start removed
- Right-trim if next content is a tag: `\s+` at end removed
- Preserves single spaces within normal content
- Result: `"text. <tag>...</tag> more"` → `"text.more"` (no space at boundaries)

To preserve space: `"text. "` + `"<tag>..."` + `" more"` → `"text. more"`

### Parser State Machine

The `InlineXmlParser` maintains:
- **buffer**: Accumulates chunks until tags are complete
- **prevEmittedWasTag**: Tracks whether to left-trim next content
- **contentParts**: Array of clean content strings
- **extractedTags**: Array of `InlineXml` objects

Methods:
- `processChunk(chunk)`: Process a new text chunk
- `finalize()`: Return `{ content, tags }` after all chunks processed

## Status

✅ **Complete**
- Implementation done
- Tests passing (230/230)
- Build succeeds
- Documentation created

## Files Modified

- `src/core/operators/chat-completions/content.ts` - Added `InlineXmlParser` class (reusing splitInlineXml logic)
- `src/core/operators/chat-completions/types.ts` - Added `thoughts?: InlineXml[]` to `Choice` type
- `src/core/operators/chat-completions/aggregate.ts` - Process chunks through parser, collect thoughts
- `tests/chat-completions-aggregate.test.ts` - Updated 3 test cases to verify thoughts collection

## Date

2025-01-14
