# Code Extraction Progress

## Overview

This document tracks the progress of extracting implementation code from design documents to the `src/` directory.

## Completed Extractions

### Phase 1: Core Stores (Partial)

✅ **Created Base Structure**
- `src/stores/interfaces.ts` - Interface definitions
- `src/stores/factory.ts` - Factory pattern
- `src/stores/redis/redis-state-store.ts` - Redis state store
- `src/stores/memory/memory-state-store.ts` - In-memory state store
- `src/core/cleanup.ts` - State cleanup service

## Remaining Extractions

### High Priority (design/agent-loop.md)

This file has ~2500 lines with significant implementation code that needs extraction:

**To Extract:**
- [ ] `RedisArtifactStore` class (line 852) → `src/stores/redis/redis-artifact-store.ts`
- [ ] `InMemoryArtifactStore` class (line 1198) → `src/stores/memory/memory-artifact-store.ts`
- [ ] `ArtifactToolProvider` class (line 1546) → `src/tools/artifact-tools.ts`
- [ ] `ArtifactStoreWithEvents` class (line 1859) → `src/stores/decorators.ts`
- [ ] `AgentLoop` class (lines 539, 2095) → `src/core/agent-loop.ts`
- [ ] Checkpoint logic → `src/core/checkpoint.ts`
- [ ] Resumption logic → `src/core/resumption.ts`

**After Extraction, Keep in Design:**
- Interface definitions (`PersistedLoopState`, `StateStore`, `ArtifactStore`)
- Conceptual RxJS pipeline flows
- Architecture diagrams
- Design decisions and rationale
- Simplified examples showing concepts

### Medium Priority (design/tool-integration.md)

**To Extract (~800 lines of implementation):**
- [ ] `LocalToolProvider` (line 114) → `src/tools/local/local-provider.ts`
- [ ] `MCPToolProvider` (line 221) → `src/tools/mcp/mcp-provider.ts`
- [ ] `MCPClient` (line 308) → `src/tools/mcp/mcp-client.ts`
- [ ] `ClientToolProvider` (line 388) → `src/tools/client/client-provider.ts`
- [ ] `ClientToolHandler` (line 482) → `src/tools/client/handler.ts`
- [ ] `ToolRouter` (line 541) → `src/tools/router.ts`
- [ ] `DynamicToolDiscovery` (line 605) → `src/tools/discovery.ts`
- [ ] `CachingToolProvider` (line 718) → `src/tools/caching-provider.ts`
- [ ] `MockToolProvider` (line 777) → `src/tools/mock-provider.ts`

**Keep in Design:**
- `ToolProvider` interface
- Tool routing architecture
- Provider patterns
- Integration concepts

### Medium Priority (design/a2a-protocol.md)

**To Extract:**
- [ ] `processMessage` function (line 668) → `src/a2a/message-processor.ts`
- [ ] `A2AClientImpl` class (line 1080) → `src/a2a/client.ts`
- [ ] Server implementation → `src/a2a/server.ts`
- [ ] Message validation → `src/a2a/validation.ts`

**Keep in Design:**
- A2A protocol specification
- Message format definitions
- Error codes table
- SSE format examples
- Compliance checklist

### Lower Priority

**design/authentication.md:**
- [ ] 9 classes to extract to `src/auth/strategies/`

**design/observability.md:**
- [ ] 4 functions/classes to extract to `src/observability/`

**design/extension-points.md:**
- [ ] 12 extension implementations to extract to `src/extensions/`

**design/dynamic-discovery.md:**
- [ ] 8 service registry and discovery classes to extract to `src/discovery/`

## Automated Extraction Script Needed

Due to the volume of code to extract (60+ classes, ~5000+ lines), this would benefit from a script:

```typescript
// Pseudocode for extraction script
for each design file:
  1. Parse markdown to find code blocks with class/function definitions
  2. Extract each implementation with its imports
  3. Create corresponding src/ file with:
     - Design reference comment
     - Proper imports
     - Full implementation
  4. Replace in design file with:
     - Interface (if applicable)
     - Conceptual description
     - Link to implementation
```

## Manual Approach

For manual extraction, follow this pattern for each class:

### 1. Create Implementation File

```typescript
/**
 * [Class Name]
 *
 * [Brief description of what it does]
 *
 * Design Reference: design/[file].md#[section]
 */

import { [Interfaces] } from '../interfaces';
import type { [Types] } from '../types';

export class [ClassName] implements [Interface] {
  // Full implementation from design doc
}
```

### 2. Update Design Doc

Replace the full implementation with:

```markdown
### [Class Name]

[Conceptual description of what it does and why]

**Key Features:**
- Feature 1
- Feature 2

**Example Usage:**
```typescript
// Simplified conceptual example
const instance = factory.create[ClassName]();
await instance.method();
```

**Implementation:** See [src/path/to/file.ts](../src/path/to/file.ts)
```

## Recommendation

Given the scale of this refactoring, I recommend:

1. **Automated Script:** Create a script to parse markdown and extract classes
2. **Phased Approach:** Extract one design doc at a time, testing after each
3. **Start with:** `agent-loop.md` (highest impact, most code)
4. **Validate:** Ensure each extracted class compiles and tests pass
5. **Update Docs:** Keep design docs conceptual with clear references

Would you like me to:
- A) Continue manually extracting files (will be time-consuming)
- B) Create a Node.js script to automate the extraction
- C) Focus on just one design file at a time with complete extraction
