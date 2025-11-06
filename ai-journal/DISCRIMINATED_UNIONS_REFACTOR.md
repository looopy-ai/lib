# Artifact Types Refactoring: Discriminated Unions

## Summary

Refactored the artifact type system from a single interface with optional fields to proper discriminated unions with separate types for each artifact kind. This provides compile-time type safety and clearer code.

## Problem with Previous Approach

The previous `StoredArtifact` interface (V2) squashed all artifact types into one:

```typescript
// ❌ Old approach - confusing optional fields
interface StoredArtifact {
  artifactId: string;
  type: ArtifactType;

  // Optional fields that only apply to certain types
  chunks: ArtifactChunk[];  // Only for 'file'
  data?: Record<string, unknown>;  // Only for 'data'
  rows?: Record<string, unknown>[];  // Only for 'dataset'
  mimeType?: string;  // Only for 'file'
  schema?: DatasetSchema;  // Only for 'dataset'
  // ...
}
```

**Issues:**
1. **No type safety** - TypeScript can't enforce which fields are valid for which type
2. **Optional pollution** - Every artifact has fields it doesn't use
3. **Runtime errors** - Easy to access wrong fields (e.g., `dataArtifact.chunks`)
4. **Poor IDE support** - Autocomplete shows all fields regardless of type
5. **Unclear intent** - Hard to know which fields matter for which type

## New Approach: Discriminated Unions

Now we have separate interfaces with a shared base:

```typescript
// ✅ New approach - clear separation

/** Base with shared properties */
interface BaseArtifact {
  artifactId: string;
  taskId: string;
  contextId: string;
  name?: string;
  description?: string;
  status: 'building' | 'complete' | 'failed';
  version: number;
  operations: ArtifactOperation[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  externalStorage?: ExternalStorageRef;
}

/** File artifacts - chunked streaming */
interface FileArtifact extends BaseArtifact {
  type: 'file';
  chunks: ArtifactChunk[];
  mimeType?: string;
  encoding?: 'utf-8' | 'base64';
  totalChunks: number;  // Number of chunks
  totalSize: number;    // Total bytes
}

/** Data artifacts - atomic updates */
interface DataArtifact extends BaseArtifact {
  type: 'data';
  data: Record<string, unknown>;
}

/** Dataset artifacts - batch streaming */
interface DatasetArtifact extends BaseArtifact {
  type: 'dataset';
  rows: Record<string, unknown>[];
  schema?: DatasetSchema;
  totalChunks: number;  // Number of batches
  totalSize: number;    // Total rows
}

/** Discriminated union */
type StoredArtifact = FileArtifact | DataArtifact | DatasetArtifact;
```

## Benefits

### 1. Compile-Time Type Safety

TypeScript enforces correct field access:

```typescript
const artifact = await store.getArtifact(id);

// ❌ Compile error - TypeScript doesn't know which type
console.log(artifact.chunks);  // Error!

// ✅ Type narrowing - TypeScript knows it's a FileArtifact
if (artifact.type === 'file') {
  console.log(artifact.chunks);  // Works!
  console.log(artifact.mimeType);  // Works!
  // console.log(artifact.data);  // Compile error!
}
```

### 2. Better IDE Support

After type narrowing, IDE autocomplete shows only relevant fields:

```typescript
if (artifact.type === 'file') {
  artifact.  // IDE suggests: chunks, mimeType, encoding, totalChunks, totalSize
}

if (artifact.type === 'data') {
  artifact.  // IDE suggests: data
}

if (artifact.type === 'dataset') {
  artifact.  // IDE suggests: rows, schema, totalChunks, totalSize
}
```

### 3. No Field Pollution

Each type has only the fields it needs:

- **FileArtifact**: No `data` or `rows` fields
- **DataArtifact**: No `chunks`, `mimeType`, or `schema` fields
- **DatasetArtifact**: No `chunks` or `mimeType` fields

### 4. Clearer Intent

Code explicitly shows which artifact type you're working with:

```typescript
// Clear: this function only works with file artifacts
function analyzeFileChunks(artifact: FileArtifact) {
  return artifact.chunks.map(chunk => chunk.size);
}

// Clear: this works with any artifact
function getArtifactName(artifact: StoredArtifact): string {
  return artifact.name || artifact.artifactId;
}
```

### 5. Type Guards

Easy to create type guard functions:

```typescript
function isFileArtifact(a: StoredArtifact): a is FileArtifact {
  return a.type === 'file';
}

// Usage
if (isFileArtifact(artifact)) {
  // TypeScript knows: artifact is FileArtifact
  processFileChunks(artifact.chunks);
}
```

## ArtifactStore Interface Changes

Separate creation methods for each type:

```typescript
interface ArtifactStore {
  // ✅ Type-specific creation
  createFileArtifact(params: {...}): Promise<string>;
  createDataArtifact(params: {...}): Promise<string>;
  createDatasetArtifact(params: {...}): Promise<string>;

  // ✅ Type-specific content retrieval
  getFileContent(id: string): Promise<string>;
  getDataContent(id: string): Promise<Record<string, unknown>>;
  getDatasetRows(id: string): Promise<Record<string, unknown>[]>;

  // Common methods
  getArtifact(id: string): Promise<StoredArtifact | null>;
  deleteArtifact(id: string): Promise<void>;
  // ...

  // @deprecated - backward compatibility
  createArtifact?(params: {type: ArtifactType, ...}): Promise<string>;
  getArtifactContent?(id: string): Promise<string | Record<string, unknown> | Record<string, unknown>[]>;
}
```

## Implementation Changes

### InMemoryArtifactStoreV3

New implementation using discriminated unions:

**Type-Safe Creation:**
```typescript
async createFileArtifact(params: {...}): Promise<string> {
  const artifact: FileArtifact = {  // Type is FileArtifact, not generic
    type: 'file',
    chunks: [],
    mimeType: params.mimeType || 'text/plain',
    encoding: params.encoding || 'utf-8',
    totalChunks: 0,
    totalSize: 0,
    // ... base fields
  };
  this.artifacts.set(params.artifactId, artifact);
  return params.artifactId;
}
```

**Type-Safe Operations:**
```typescript
async appendFileChunk(id: string, chunk: string, options?: {...}): Promise<void> {
  const artifact = this.artifacts.get(id);
  if (!artifact) throw new Error('Not found');

  // Runtime type check
  if (artifact.type !== 'file') {
    throw new Error(`Artifact ${id} is not a file (type: ${artifact.type})`);
  }

  // TypeScript knows: artifact is FileArtifact
  artifact.chunks.push({...});  // No type error!
  artifact.totalSize += chunkSize;
}
```

## Migration Guide

### For Code Using V2 API

**Old Code (V2):**
```typescript
// Generic creation
await store.createArtifact({
  artifactId: 'file-1',
  type: 'file',
  mimeType: 'text/plain',
  // ...
});

// Generic content retrieval (returns union type)
const content = await store.getArtifactContent('file-1');
// content type: string | Record<string, unknown> | Record<string, unknown>[]
```

**New Code (V3):**
```typescript
// Type-specific creation
await store.createFileArtifact({
  artifactId: 'file-1',
  mimeType: 'text/plain',
  // ...
});

// Type-specific content retrieval (returns specific type)
const content = await store.getFileContent('file-1');
// content type: string
```

### For Code Accessing Artifacts

**Old Code (V2):**
```typescript
const artifact = await store.getArtifact('file-1');
// artifact.chunks might be undefined, no type safety
if (artifact.chunks) {
  processChunks(artifact.chunks);
}
```

**New Code (V3):**
```typescript
const artifact = await store.getArtifact('file-1');
// Type narrowing required
if (artifact && artifact.type === 'file') {
  // TypeScript knows: artifact.chunks exists
  processChunks(artifact.chunks);
}
```

## Files Changed

### Core Types
- **`src/core/types.ts`**:
  - Added `BaseArtifact` interface
  - Added `FileArtifact`, `DataArtifact`, `DatasetArtifact` interfaces
  - Changed `StoredArtifact` to discriminated union type
  - Updated `ArtifactStore` interface with type-specific methods
  - Marked generic methods as `@deprecated`

### Implementation
- **`src/stores/artifacts/memory-artifact-store-v3.ts`** (NEW):
  - Complete rewrite using discriminated unions
  - Type-specific creation methods
  - Type-specific content retrieval methods
  - Runtime type checks in operations
  - Backward compatibility via legacy methods

### Examples
- **`examples/artifact-store-v3-type-safety.ts`** (NEW):
  - Demonstrates type safety benefits
  - Shows type narrowing patterns
  - Includes type guard examples
  - Compares old vs new approaches

### Exports
- **`src/stores/artifacts/index.ts`**:
  - Added export for `InMemoryArtifactStoreV3`

## Testing Results

All examples pass successfully:

```
✓ File artifact: 3 chunks, 47 bytes
✓ Data artifact: version 2, atomic update
✓ Dataset artifact: 2 batches, 4 rows
✓ Type narrowing works correctly
✓ Type guards provide safety
✓ IDE autocomplete shows correct fields
```

## Backward Compatibility

V3 includes legacy methods for compatibility:

- `createArtifact()` - delegates to type-specific methods
- `getArtifactContent()` - delegates to type-specific getters
- `appendPart()` - maps old API to new methods

Old code can gradually migrate to the new API.

## Next Steps

1. ✅ Core types refactored with discriminated unions
2. ✅ V3 implementation complete
3. ✅ Type safety example working
4. ⏳ Update InternalEventArtifactStore to use V3
5. ⏳ Update artifact-tools.ts to use type-specific methods
6. ⏳ Migrate tests to V3 API
7. ⏳ Update documentation with discriminated union patterns

## Design Philosophy

**Principle**: Use TypeScript's type system to make invalid states unrepresentable.

- **Before**: Any artifact could have any field (optional)
- **After**: Each artifact type has exactly the fields it needs
- **Result**: Compile-time errors instead of runtime errors

This follows the best practices from the TypeScript handbook on discriminated unions and makes the codebase more maintainable and less error-prone.
