# Thought Tools Disabled by Default

## Issue

The LLM was repeatedly calling the `think_aloud` tool on every turn, causing the agent to loop through many iterations unnecessarily. When a user said "Hi there", the agent would:

1. Call `think_aloud` to acknowledge the greeting
2. Agent loop executes the tool and calls LLM again with the result
3. LLM calls `think_aloud` again to continue the conversation
4. This repeats for 15-20 iterations

This happened because the LLM treated `think_aloud` as a **required step** in every response, rather than using `<thinking>` tags for streaming thoughts.

## Root Cause

The `think_aloud` tool was **automatically enabled** by AgentLoop for all executions. While useful for explicit thought emission with metadata (confidence, alternatives, etc.), the LLM was calling it as a tool on every turn instead of just using `<thinking>` tags.

This is **unrelated to the shareReplay() fix** - that fix correctly prevented duplicate HTTP requests. This issue is about the agent loop behavior when tools are called repeatedly.

## Solution

Made `think_aloud` tool **opt-in** instead of automatic:

### 1. Added Configuration Option

Added `enableThoughtTools?: boolean` to `AgentLoopConfig`:

```typescript
interface AgentLoopConfig {
  // ... other options

  /**
   * Enable think_aloud tool for explicit thought emission
   * When disabled, only <thinking> tags are supported for streaming thoughts
   * @default false
   */
  enableThoughtTools?: boolean;
}
```

**Default**: `false` (disabled)

### 2. Updated AgentLoop

Modified the thought tools initialization to respect the config:

```typescript
// Create thought tools provider only if enabled
this.thoughtToolProvider =
  this.eventEmitter && this.config.enableThoughtTools
    ? thoughtTools({ ... })
    : null;
```

### 3. Updated System Prompt

Changed the kitchen-sink example prompt from instructing use of `think_aloud` **tool** to using `<thinking>` **tags**:

**Before**:
```
Use the think_aloud tool to share your reasoning process:
  think_aloud({
    thought_id: "initial_plan",
    thought: "I'll first get the weather...",
    thought_type: "planning"
  })
```

**After**:
```
You can share your internal reasoning process by wrapping your thoughts in <thinking> tags:

<thinking>
The user wants weather information. I'll:
1. First get the weather data
2. Then present the results clearly
</thinking>
```

## When to Use Each Approach

### Use `<thinking>` tags (default):
- ✅ Simple streaming of reasoning process
- ✅ No metadata needed
- ✅ Natural for LLM to use
- ✅ **Doesn't trigger another iteration** (extracted inline)
- ✅ Recommended for most use cases

### Use `think_aloud` tool (opt-in via `enableThoughtTools: true`):
- ✅ Need explicit metadata (confidence, alternatives, related_to)
- ✅ Building thought graphs with relationships
- ✅ Programmatic thought emission from code
- ⚠️ **Triggers another LLM iteration** (executed as tool)
- ⚠️ May cause excessive iterations if LLM calls it repeatedly

## Files Changed

1. **`src/core/config.ts`**:
   - Added `enableThoughtTools?: boolean` option (default: false)

2. **`src/core/agent-loop.ts`**:
   - Updated constructor to set `enableThoughtTools: false` by default
   - Modified `prepareExecution()` to only create thought tools if enabled

3. **`examples/kitchen-sink.ts`**:
   - Removed all references to `think_aloud` tool in system prompt
   - Updated prompt to instruct use of `<thinking>` tags instead
   - Simplified the "Streaming Your Thoughts" section

## Testing

- ✅ All 12 agent-loop tests pass
- ✅ Build succeeds with no TypeScript errors
- ✅ Thought tools can still be enabled by setting `enableThoughtTools: true`
- ✅ Default behavior: only `<thinking>` tags, no `think_aloud` tool

## Migration Guide

### If you want to keep using `think_aloud` tool:

```typescript
const agent = new Agent({
  // ... other config
  loopConfig: {
    enableThoughtTools: true,  // ← Add this
  },
});
```

### If you just want streaming thoughts (recommended):

Use `<thinking>` tags in your LLM responses - no configuration needed. The agent automatically extracts and streams them as `thought-stream` events.

## Result

The agent now responds immediately to simple greetings without unnecessary iterations. The LLM can still share its reasoning using `<thinking>` tags, which are extracted and streamed inline without triggering additional iterations.

---

**Date**: November 10, 2025
**Status**: ✅ Complete
**Tests**: 12/12 passing
**Related**: DUPLICATE_LLM_REQUEST_FIX.md (separate issue, already fixed)
