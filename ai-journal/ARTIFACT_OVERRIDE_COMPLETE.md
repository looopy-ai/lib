# Artifact Override Feature Complete

## Problem

User reported error: **"Artifact already exists: bruno-poem"**

When LLM tried to recreate an artifact with the same ID, it would fail with "already exists" error. User requested: *"Attempting to recreate an artifact need to be a reset operation to clear it for reuse (override)"*

## Solution

Added optional `override: boolean` parameter to all three artifact creation methods:
- `createFileArtifact()`
- `createDataArtifact()`
- `createDatasetArtifact()`

### Behavior

**Without override (default):**
```typescript
await store.createFileArtifact({
  artifactId: 'existing-artifact',
  // ... other params
});
// ❌ Throws: "Artifact already exists: existing-artifact. Use override: true to replace it, or use a different artifactId."
```

**With override:**
```typescript
await store.createFileArtifact({
  artifactId: 'existing-artifact',
  override: true,  // ✅ Reset the artifact
  // ... other params
});
```

### Reset Semantics

When `override: true`:

1. **Version incremented**: `version: existing.version + 1`
2. **Operation logged**: `{ type: 'reset', timestamp: now }`
3. **Content cleared**: All chunks/rows/data reset to empty
4. **Status reset**: Back to `'building'`
5. **Metadata updated**: New name/description if provided
6. **Timestamp preserved**: `createdAt` remains from original
7. **Updated timestamp**: `updatedAt` set to current time

### File Store Behavior

For FileSystemArtifactStore, override also:
- Removes existing directory: `rm(artifactDir, { recursive: true, force: true })`
- Creates fresh directory structure
- Resets all content files

## Implementation

### Files Modified

1. **src/core/types.ts**
   - Added `'reset'` to `ArtifactOperation` type union
   - Added `override?: boolean` to all three create method signatures in `ArtifactStore` interface

2. **src/stores/artifacts/memory-artifact-store.ts**
   - Added override logic to `createFileArtifact()`
   - Added override logic to `createDataArtifact()`
   - Added override logic to `createDatasetArtifact()`
   - Fixed `createdAt` preservation: `createdAt: existing ? existing.createdAt : now`

3. **src/stores/filesystem/filesystem-artifact-store.ts**
   - Added override logic to `createFileArtifact()` with directory removal
   - Added override logic to `createDataArtifact()` with directory removal
   - Added override logic to `createDatasetArtifact()` with directory removal
   - Fixed `createdAt` preservation in all three methods

4. **src/stores/artifacts/artifact-scheduler.ts**
   - Added `override?: boolean` parameter to all three create method signatures
   - Passes through to underlying store (no special handling needed)

5. **src/tools/artifact-tools.ts**
   - Updated `create_file_artifact` tool:
     - Added `override` to Zod schema with `.optional().default(false)`
     - Updated description: "Set override=true to replace existing artifact."
     - Removed manual existence check (store handles it now)
     - Pass `override` parameter to store
     - Updated success message to indicate "reset" vs "created"

   - Updated `create_data_artifact` tool:
     - Same changes as above

   - Updated `create_dataset_artifact` tool:
     - Same changes as above

### Tests Added

Created **tests/artifact-override.test.ts** with 6 tests:

1. ✅ `should throw error when creating artifact with existing ID without override`
2. ✅ `should reset file artifact when override=true`
3. ✅ `should reset data artifact when override=true`
4. ✅ `should reset dataset artifact when override=true`
5. ✅ `should allow creating new artifact with same ID in different context without override` (documents current behavior)
6. ✅ `should work with override through ArtifactScheduler wrapper`

### Test Coverage

Tests verify:
- Error thrown without override
- Version increment on override
- Content cleared on override
- Status reset to 'building'
- Operation type 'reset' logged
- `createdAt` preserved from original
- Works through ArtifactScheduler
- New content can be added after reset

## Usage Examples

### LLM Tool Usage

The LLM can now use the override parameter directly:

```json
{
  "tool": "create_file_artifact",
  "arguments": {
    "artifactId": "bruno-poem",
    "name": "Poem about Bruno",
    "mimeType": "text/plain",
    "override": true
  }
}
```

### Programmatic Usage

```typescript
// Create initial artifact
await store.createFileArtifact({
  artifactId: 'my-report',
  taskId: 'task-1',
  contextId: 'ctx-1',
  name: 'Q1 Report',
});

await store.appendFileChunk('my-report', 'Initial content', { isLastChunk: true });

// Later: Reset and recreate
await store.createFileArtifact({
  artifactId: 'my-report',
  taskId: 'task-2',
  contextId: 'ctx-1',
  name: 'Q1 Report (Revised)',
  override: true,  // ← Reset the artifact
});

await store.appendFileChunk('my-report', 'New content', { isLastChunk: true });
```

### With Scheduler

```typescript
const scheduledStore = new ArtifactScheduler(baseStore);

// Override works through scheduler
await scheduledStore.createFileArtifact({
  artifactId: 'scheduled-artifact',
  override: true,
  // ... other params
});
```

## Design Decisions

### 1. Optional Parameter with Default False

- **Why**: Backward compatible - existing code works without changes
- **Alternative**: Separate `resetArtifact()` method (more API surface)

### 2. Version Increment on Override

- **Why**: Maintains audit trail of artifact resets
- **Alternative**: Reset version to 1 (loses history)

### 3. Preserve createdAt

- **Why**: Shows original creation time even after resets
- **Alternative**: Update createdAt (loses original timestamp)

### 4. 'reset' Operation Type

- **Why**: Distinguishes reset from create in audit log
- **Alternative**: Use 'create' (loses distinction)

### 5. Error Message with Guidance

```
Artifact already exists: {id}. Use override: true to replace it, or use a different artifactId.
```

- **Why**: Guides user to solution
- **Alternative**: Simple "already exists" (less helpful)

### 6. Global artifactId Scope

Current implementation: artifactId is globally unique (not scoped to contextId).

This means:
```typescript
// These will conflict even with different contextIds
await store.createFileArtifact({
  artifactId: 'shared-id',
  contextId: 'ctx-1',
  // ...
});

await store.createFileArtifact({
  artifactId: 'shared-id',
  contextId: 'ctx-2',  // Different context
  // ❌ Still throws error
});
```

This is **intentional** - artifactId is the primary key, not (contextId, artifactId).

## Test Results

All tests pass:

```
Test Files  16 passed (16)
Tests  251 passed (251)
Duration  1.22s
```

Including:
- 245 existing tests (no regressions)
- 6 new override tests (all passing)

## What's Next

### Potential Future Enhancements

1. **Scope artifactId to contextId**: If needed, could change to use `(contextId, artifactId)` as composite key

2. **Override metadata**: Could add override reason/comment:
   ```typescript
   {
     override: true,
     overrideReason: "User requested revision"
   }
   ```

3. **Archive instead of reset**: Keep old version accessible:
   ```typescript
   {
     override: true,
     archiveOld: true  // Move to archived versions
   }
   ```

4. **Conditional override**: Only override if certain conditions met:
   ```typescript
   {
     override: true,
     overrideIf: { versionLessThan: 5 }
   }
   ```

5. **Bulk override**: Reset multiple artifacts at once:
   ```typescript
   await store.resetAllArtifacts(taskId);
   ```

## Related Files

- Design: [design/artifact-management.md](../design/artifact-management.md)
- Implementation:
  - [src/core/types.ts](../src/core/types.ts)
  - [src/stores/artifacts/memory-artifact-store.ts](../src/stores/artifacts/memory-artifact-store.ts)
  - [src/stores/filesystem/filesystem-artifact-store.ts](../src/stores/filesystem/filesystem-artifact-store.ts)
  - [src/stores/artifacts/artifact-scheduler.ts](../src/stores/artifacts/artifact-scheduler.ts)
  - [src/tools/artifact-tools.ts](../src/tools/artifact-tools.ts)
- Tests: [tests/artifact-override.test.ts](../tests/artifact-override.test.ts)

## Summary

The artifact override feature is **fully implemented and tested**. Users can now recreate artifacts with the same ID by setting `override: true`, which resets the artifact while preserving audit history (incremented version, 'reset' operation logged, original createdAt preserved).

The LLM can use this feature directly through the updated tool schemas. All 251 tests pass, including 6 new tests specifically for override functionality.
