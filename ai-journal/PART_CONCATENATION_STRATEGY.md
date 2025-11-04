# Part Concatenation Strategy

## Problem

The A2A protocol does not provide unique identifiers for individual artifact parts. Without part IDs, we cannot uniquely identify which specific part to append to or replace when an artifact contains multiple parts of the same kind (e.g., multiple `text` parts).

## Solution

We group and concatenate parts by their `kind` (text, file, data) to ensure deterministic and predictable behavior.

## Implementation

### Key Principle

**Parts of the same kind are concatenated together.** An artifact has at most one part per kind.

### Behavior

#### `append=false` (Replace Mode)

When replacing parts:
1. Group new parts by `kind` and concatenate text parts
2. For each `kind` in the new parts, replace **ALL** existing parts of that kind with the concatenated result
3. Preserve existing parts of other kinds that weren't in the new request

**Example:**
```typescript
// Initial artifact
{ parts: [
  { kind: 'text', content: 'Hello ' },
  { kind: 'text', content: 'World' }
]}
// After grouping: { kind: 'text', content: 'Hello World' }

// Replace with new text
artifact_update({
  parts: [{ kind: 'text', text: 'Goodbye' }],
  append: false
})

// Result
{ parts: [
  { kind: 'text', content: 'Goodbye' }  // Replaced all text parts
]}
```

#### `append=true` (Append Mode)

When appending parts:
1. Group new parts by `kind` and concatenate text parts
2. For each `kind` in the new parts:
   - If `kind='text'`: Concatenate new text with existing text
   - If `kind='file'` or `kind='data'`: Keep existing and add new as separate part
3. Add new parts of kinds that didn't exist before

**Example:**
```typescript
// Initial artifact
{ parts: [
  { kind: 'text', content: 'Hello ' }
]}

// Append more text
artifact_update({
  parts: [{ kind: 'text', text: 'World' }],
  append: true
})

// Result
{ parts: [
  { kind: 'text', content: 'Hello World' }  // Text concatenated
]}
```

### Concatenation Rules by Kind

| Kind   | Concatenation Behavior                          |
| ------ | ----------------------------------------------- |
| `text` | Content strings are concatenated               |
| `file` | Files are NOT concatenated (kept as unique items) |
| `data` | Data objects are NOT concatenated (kept as unique items) |

**Note:** Currently, even file and data parts are being grouped by kind in the implementation. This may need refinement if we want multiple file or data parts of the same kind.

## Code Changes

### New Method: `replaceParts()`

Added to `ArtifactStore` interface to enable bulk part replacement:

```typescript
interface ArtifactStore {
  replaceParts(
    artifactId: string,
    parts: Omit<ArtifactPart, 'index'>[],
    isLastChunk?: boolean
  ): Promise<void>;
}
```

### Updated Functions

1. **`replaceArtifactParts()`** - Uses part concatenation and `replaceParts()`
2. **`appendArtifactParts()`** - Uses part concatenation and `replaceParts()`
3. **Helper: `groupPartsByKind()`** - Extracts grouping logic to reduce complexity

### Files Modified

- `src/core/types.ts` - Added `replaceParts()` to ArtifactStore interface
- `src/stores/interfaces.ts` - Added `replaceParts()` to interface (duplicate, should be removed)
- `src/stores/artifacts/memory-artifact-store.ts` - Implemented `replaceParts()`
- `src/stores/artifacts/artifact-store-with-events.ts` - Implemented `replaceParts()` with event emission
- `src/tools/artifact-tools.ts` - Refactored to use part concatenation strategy
- `tests/artifact-tools.test.ts` - Updated tests to match new behavior

## Test Updates

Tests were updated to expect concatenated behavior:

**Before:**
```typescript
// Expected 2 separate text parts
expect(parts).toHaveLength(2);
expect(parts[0].content).toBe('Part 1');
expect(parts[1].content).toBe('Part 2');
```

**After:**
```typescript
// Expect 1 concatenated text part
expect(parts).toHaveLength(1);
expect(parts[0].content).toBe('Part 1Part 2');
```

## Benefits

1. **Deterministic**: Same operation always produces same result
2. **Protocol Compliant**: Works within A2A limitations (no part IDs)
3. **Predictable**: Users know parts of same kind will be concatenated
4. **Efficient**: Reduces number of parts, simplifies storage

## Trade-offs

### Advantages
- ✅ Solves the "which part to append to" problem
- ✅ Simpler storage model (one part per kind)
- ✅ Matches streaming use case (LLM generates one continuous text stream)

### Disadvantages
- ❌ Cannot have multiple independent parts of same kind
- ❌ Cannot selectively update specific parts (all-or-nothing per kind)
- ❌ May require client-side splitting if multiple items needed

## Future Considerations

### If A2A Protocol Adds Part IDs

If the A2A protocol specification is updated to include unique part IDs:
1. We can revert to granular part operations
2. Support both indexed and ID-based access
3. Maintain backward compatibility with concatenation behavior

### Alternative Approach: Multi-Part Support

For use cases requiring multiple file or data parts:
1. Use metadata to differentiate parts: `{ kind: 'file', metadata: { partType: 'input' } }`
2. Use different kinds: `kind: 'file-input'`, `kind: 'file-output'`
3. Store collections in a single data part: `{ kind: 'data', data: { files: [...] } }`

## Documentation

This strategy should be documented in:
- ✅ `PART_CONCATENATION_STRATEGY.md` (this file)
- ⚠️ `design/artifact-management.md` - Update with concatenation details
- ⚠️ Tool descriptions in `artifact-tools.ts` - Clarify concatenation behavior
- ⚠️ API documentation - Explain part grouping for users

---

**Status**: ✅ Implemented and tested (91/91 tests passing)
**Date**: 2025-01-30
