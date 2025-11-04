# Documentation Update Needed

## Summary of Recent Changes

### 1. Method Renaming: `startTurn()` → `startTurn()`
**Reason**: Better reflects that the method *initiates* a conversational turn rather than just executing it.

**Implementation Status**: ✅ Complete
- ✅ `src/core/agent.ts` - Method renamed
- ✅ `examples/agent-lifecycle.ts` - All calls updated
- ✅ `examples/README.md` - Documentation updated

**Needs Update**:
- [ ] `design/agent-lifecycle.md` - Multiple references to `startTurn()`
- [ ] `AGENT_LIFECYCLE_COMPLETE.md` - Documentation and examples
- [ ] `AGENT_LIFECYCLE_SIMPLIFIED.md` - Multiple references
- [ ] `TASKID_IMPLEMENTATION_COMPLETE.md` - All examples and documentation
- [ ] Main `README.md` - If it contains usage examples
- [ ] `docs/CLIENT_TOOL_PROVIDER.md` - If it contains examples

### 2. Span Naming Convention Updates
**Changes**:
- `agent.startTurn` → `agent.turn[{agentId}]` (dynamic with agent ID)
- `agent.execute` → `loop.start`
- `agent.iteration` → `loop.iteration`

**Implementation Status**: ✅ Complete
- ✅ `src/observability/tracing.ts` - SpanNames constants updated
- ✅ `src/observability/spans/agent-execute.ts` - Uses `loop.start`
- ✅ `src/observability/spans/agent-iteration.ts` - Uses `loop.iteration`
- ✅ `src/core/agent.ts` - Uses `agent.turn[{agentId}]`

**Needs Update**:
- [ ] `design/observability.md` - Span naming examples
- [ ] `docs/OBSERVABILITY.md` - Span hierarchy documentation
- [ ] `A2A_ALIGNMENT.md` - If it mentions span names
- [ ] Any tracing examples in design docs

### 3. Session ID Tracking
**Changes**:
- Added `session.id` attribute to all spans (set to `contextId`)
- Enables grouping related traces in observability platforms (Langfuse)

**Implementation Status**: ✅ Complete
- ✅ `src/observability/spans/agent-execute.ts` - Added session.id
- ✅ `src/observability/spans/agent-iteration.ts` - Added session.id
- ✅ `src/core/agent.ts` - Added session.id to agent.turn span
- ✅ `src/core/operators/iteration-operators.ts` - Passes contextId

**Needs Update**:
- [ ] `design/observability.md` - Document session.id attribute
- [ ] `docs/OBSERVABILITY.md` - Explain session grouping
- [ ] Examples showing how sessions are grouped in Langfuse

### 4. Input/Output Tracking on Spans
**Changes**:
- Changed from span **events** to span **attributes**
- `input` attribute contains user message
- `output` attribute contains assistant response
- Required for proper Langfuse UI display

**Implementation Status**: ✅ Complete
- ✅ `src/core/agent.ts` - Uses `setAttribute('input', ...)` and `setAttribute('output', ...)`

**Needs Update**:
- [ ] `design/observability.md` - Document input/output attributes
- [ ] `docs/OBSERVABILITY.md` - Explain how I/O is captured
- [ ] Examples showing trace inspection

## Detailed File-by-File Update Plan

### Design Documents (`design/`)

#### `design/agent-lifecycle.md`
**Issues**:
- Uses `startTurn()` extensively (24 occurrences)
- Diagrams show `startTurn(userMessage)` flow
- Code examples use old method name

**Changes Needed**:
```diff
- agent.startTurn('Hello').subscribe()
+ agent.startTurn('Hello').subscribe()

- │    │ AgentLoop.startTurn()      │    │
+ │    │ AgentLoop.startTurn()       │    │
```

**Priority**: 🔴 HIGH (Core design document)

#### `design/observability.md`
**Issues**:
- Span names are outdated
- No mention of session.id attribute
- No documentation of input/output attributes
- Span hierarchy examples need updating

**Changes Needed**:
```diff
Span Hierarchy:
- agent.execute (root)
+ loop.start (root)
  - llm.call
-   - agent.iteration
+   - loop.iteration
      - tool.execute

Span Attributes:
+ session.id: string         // Groups related traces
+ input: string              // User message (on agent.turn)
+ output: string             // Assistant response (on agent.turn)
```

**Priority**: 🔴 HIGH (Critical for observability understanding)

#### `design/a2a-protocol.md`
**Issues**: May reference old span names or startTurn
**Priority**: 🟡 MEDIUM

#### `design/tool-integration.md`
**Issues**: May contain startTurn references
**Priority**: 🟡 MEDIUM

### Implementation Guides (Root `*.md` files)

#### `AGENT_LIFECYCLE_COMPLETE.md`
**Issues**:
- 15+ references to `startTurn()`
- Code examples all use old method
- Diagrams show old flow

**Changes Needed**:
- Global find/replace: `startTurn` → `startTurn`
- Update all code examples
- Review diagrams for method name references

**Priority**: 🔴 HIGH

#### `AGENT_LIFECYCLE_SIMPLIFIED.md`
**Issues**:
- 25+ references to `startTurn()`
- Multiple code examples
- State transition diagrams

**Changes Needed**:
- Global find/replace: `startTurn` → `startTurn`
- Update examples and diagrams

**Priority**: 🔴 HIGH

#### `TASKID_IMPLEMENTATION_COMPLETE.md`
**Issues**:
- 20+ references to `startTurn()`
- All examples show old API

**Changes Needed**:
```diff
- await agent.startTurn('message', { taskId: 'custom-id' });
+ await agent.startTurn('message', { taskId: 'custom-id' });
```

**Priority**: 🟡 MEDIUM

#### `A2A_ALIGNMENT.md`
**Issues**: May reference span names
**Priority**: 🟡 MEDIUM

### Documentation (`docs/`)

#### `docs/OBSERVABILITY.md`
**Issues**: Likely outdated with span names and attributes
**Priority**: 🔴 HIGH

#### `docs/CLIENT_TOOL_PROVIDER.md`
**Issues**: May contain startTurn examples
**Priority**: 🟢 LOW

#### `docs/LOGGING.md`
**Issues**: May reference old log messages
**Priority**: 🟢 LOW

### Main README

#### `README.md`
**Issues**:
- Likely contains usage examples with `startTurn()`
- May show old span names

**Priority**: 🔴 HIGH (First thing users see)

## Recommended Update Order

### Phase 1: Critical User-Facing Docs (Do First)
1. ✅ `examples/README.md` - Already updated
2. `README.md` - Main project README
3. `design/agent-lifecycle.md` - Core design document
4. `design/observability.md` - Tracing and spans

### Phase 2: Implementation Guides
5. `AGENT_LIFECYCLE_COMPLETE.md`
6. `AGENT_LIFECYCLE_SIMPLIFIED.md`
7. `docs/OBSERVABILITY.md`

### Phase 3: Supporting Documentation
8. `TASKID_IMPLEMENTATION_COMPLETE.md`
9. `A2A_ALIGNMENT.md`
10. `design/a2a-protocol.md`
11. `design/tool-integration.md`

### Phase 4: Other Documentation
12. `docs/CLIENT_TOOL_PROVIDER.md`
13. `docs/LOGGING.md`
14. Other design docs as needed

## Quick Reference: What Changed

### API Changes
```typescript
// OLD
await agent.startTurn('message', { authContext, taskId });

// NEW
await agent.startTurn('message', { authContext, taskId });
```

### Span Names
```typescript
// OLD
'agent.startTurn'  // Dynamic agent span
'agent.execute'      // AgentLoop execution
'agent.iteration'    // Loop iteration

// NEW
`agent.turn[${agentId}]`  // Dynamic agent span (includes agent ID)
'loop.start'              // AgentLoop execution
'loop.iteration'          // Loop iteration
```

### Span Attributes
```typescript
// NEW - Added to agent.turn span
{
  'session.id': contextId,    // For grouping traces
  'input': userMessage,        // User message content
  'output': assistantMessage   // Assistant response content
}
```

## Automation Suggestions

For bulk updates, consider:

1. **Find/Replace Pattern** (with caution):
   ```bash
   # Find all startTurn references
   grep -r "startTurn" design/ docs/ *.md

   # Replace in documentation (dry run first)
   find design/ docs/ -name "*.md" -exec sed -i 's/startTurn/startTurn/g' {} \;
   ```

2. **Manual Review Required** for:
   - Diagrams (may need redrawing)
   - Architecture explanations
   - Design rationale sections
   - Code examples (ensure context is correct)

## Testing After Updates

After updating documentation:
- [ ] Verify all code examples are runnable
- [ ] Check internal links still work
- [ ] Ensure diagrams match current implementation
- [ ] Verify terminology is consistent across all docs
- [ ] Run spell check
- [ ] Have someone unfamiliar with changes review for clarity

---

**Last Updated**: November 4, 2025
**Status**: Documentation updates needed across ~15 files
**Estimated Effort**: 2-4 hours for thorough updates
