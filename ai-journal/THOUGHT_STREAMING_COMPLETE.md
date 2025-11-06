# Thought Streaming Implementation - Complete

**Date**: November 6, 2025
**Status**: ✅ Complete
**Phase**: Phase 2.3 of Internal Event Protocol Implementation

## Summary

Successfully implemented **LLM-driven thought streaming** where the LLM can explicitly emit its reasoning process via tool calls, rather than hardcoded logging at predefined execution points.

## What Was Implemented

### 1. Thought Tools Provider (`src/tools/thought-tools.ts`)

Created a clean tool provider following the `localTools()` pattern:

- **Factory Function**: `thoughtTools(config)` returns a `ToolProvider`
- **Zod Validation**: Uses Zod schemas with proper TypeScript inference
- **Tool Definition**: `think_aloud` tool for LLM to emit thoughts
- **Event Emission**: Emits `thought-stream` events via `LoopEventEmitter`

**Tool Parameters**:
```typescript
{
  thought: string;              // The reasoning or thought process
  thought_type: 'planning' | 'reasoning' | 'reflection' | 'decision' | 'observation' | 'critique';
  confidence?: number;          // 0-1, how confident the LLM is
  verbosity?: 'brief' | 'normal' | 'detailed';
}
```

**Example LLM Tool Call**:
```json
{
  "name": "think_aloud",
  "arguments": {
    "thought": "I need to calculate 2+2, so I'll use the calculate tool",
    "thought_type": "planning",
    "confidence": 0.9,
    "verbosity": "normal"
  }
}
```

### 2. Integration with AgentLoop

Modified `src/core/agent-loop.ts`:

- **Automatic Registration**: Thought tools are automatically added to available tools for each execution
- **Event Emitter Connection**: Thought tool provider receives the event emitter during initialization
- **Tool Routing**: Modified `executeTools()` to check thought tool provider first, then regular providers
- **No Hardcoded Thoughts**: Removed all hardcoded thought emissions (planning, decision, observation, reflection)

**Implementation Details**:
```typescript
// In prepareExecution()
this.thoughtToolProvider = this.eventEmitter
  ? thoughtTools({
      eventEmitter: this.eventEmitter,
      taskId,
      contextId,
      enabled: true,
    })
  : null;

// Tools automatically include thought tools
const allProviders = this.thoughtToolProvider
  ? [...this.config.toolProviders, this.thoughtToolProvider]
  : this.config.toolProviders;

// Tool execution checks thought provider first
let provider = this.thoughtToolProvider?.canHandle(toolCall.function.name)
  ? this.thoughtToolProvider
  : this.config.toolProviders.find((p) => p.canHandle(toolCall.function.name));
```

### 3. Content Streaming (Already Implemented)

Content streaming was already in place from earlier work:

- **content-delta**: Emitted for each chunk of LLM response
- **content-complete**: Emitted when LLM response is complete
- These events remain and work correctly

## Removed Code

### Hardcoded Thought Emissions

Removed the following hardcoded thought emissions from `agent-loop.ts`:

1. **Planning Thought** (before LLM call):
   ```typescript
   // REMOVED
   this.eventEmitter.emitThought(
     state.taskId,
     state.contextId,
     'planning',
     `Calling LLM with ${messageCount} messages and ${toolCount} available tools`,
     // ...
   );
   ```

2. **Decision Thought** (after tool selection):
   ```typescript
   // REMOVED
   this.eventEmitter.emitThought(
     state.taskId,
     state.contextId,
     'decision',
     `The LLM decided to call ${toolCount} tools...`,
     // ...
   );
   ```

3. **Observation Thought** (on task completion):
   ```typescript
   // REMOVED
   this.eventEmitter.emitThought(
     state.taskId,
     state.contextId,
     'observation',
     'The LLM has finished generating a response...',
     // ...
   );
   ```

4. **Reflection Thought** (at iteration start):
   ```typescript
   // REMOVED
   this.eventEmitter.emitThought(
     state.taskId,
     state.contextId,
     'reflection',
     `Starting iteration ${state.iteration + 1}...`,
     // ...
   );
   ```

## Test Results

✅ **All 130 tests passing**

Fixed one test that needed to account for content-complete events:
- Test: `should respect max iterations`
- Fix: Added `'content-complete'` to the expected final event types

## Files Modified

1. **Created**:
   - `src/tools/thought-tools.ts` (225 lines) - Thought tool provider implementation

2. **Modified**:
   - `src/core/agent-loop.ts` - Integration, removed hardcoded thoughts
   - `src/core/operators/event-emitter.ts` - Already had emitThought() method from earlier
   - `src/tools/index.ts` - Exported thought tools
   - `tests/agent-loop.test.ts` - Fixed test assertion

## Design Principles Followed

1. **LLM-Driven**: Thoughts are emitted by the LLM when it chooses, not at hardcoded execution points
2. **Clean Pattern**: Followed `localTools()` pattern with Zod validation
3. **Automatic Integration**: No user action required - thought tools are automatically available
4. **Type Safety**: Full TypeScript type checking with Zod schema inference
5. **Event Protocol**: Emits standard `thought-stream` events via the internal event protocol

## Usage Example

The LLM now has access to the `think_aloud` tool and can use it to share reasoning:

```typescript
// The LLM sees this tool in its tool list:
{
  name: 'think_aloud',
  description: 'Share your reasoning process with the user...',
  parameters: {
    type: 'object',
    properties: {
      thought: { type: 'string', description: '...' },
      thought_type: { type: 'string', enum: ['planning', 'reasoning', ...] },
      // ...
    },
    required: ['thought', 'thought_type']
  }
}

// The LLM can call it:
think_aloud({
  thought: "I see the user wants weather. I'll use the get_weather tool with city='London'",
  thought_type: "planning",
  confidence: 0.95
})

// This emits:
{
  kind: "thought-stream",
  taskId: "task-123",
  contextId: "ctx-456",
  thoughtType: "planning",
  content: "I see the user wants weather. I'll use the get_weather tool with city='London'",
  index: 0,
  verbosity: "normal",
  confidence: 0.95,
  timestamp: "2025-11-06T18:02:20.000Z"
}
```

## Phase 2 Progress

**Phase 2: Event Emission in AgentLoop** - Now **100% Complete** ✅

- ✅ 2.1: Basic Events (task, status-update)
- ✅ 2.2: Internal Events (llm-call, tool-start, tool-complete, checkpoint)
- ✅ 2.3: **Thought Streaming** (LLM-driven via think_aloud tool)
- ✅ 2.4: **Content Streaming** (content-delta, content-complete)

## Next Steps

With Phase 2 complete, the next phases to implement are:

**Phase 3**: Event Types & Schemas
- Define complete TypeScript interfaces for all event types
- Add Zod schemas for validation
- Document event format in detail

**Phase 4**: Event Consumers
- SSE server integration
- Event filtering and routing
- Client examples

**Phase 5**: Event Persistence (Optional)
- Event store interface
- Replay capability
- Audit trail

## Benefits of This Implementation

1. **Transparency**: Users can see how the LLM reasons through problems
2. **Debugging**: Easier to understand why the LLM made certain decisions
3. **Trust**: Users understand the agent's thought process
4. **Control**: LLM decides when thoughts are relevant, not hardcoded logic
5. **Flexibility**: LLM can provide different verbosity levels based on task complexity

## Related Documentation

- **Design**: `design/internal-event-protocol.md` (Thought Streaming section)
- **Implementation**: `src/tools/thought-tools.ts`
- **Integration**: `src/core/agent-loop.ts`
- **Pattern Reference**: `src/tools/local-tools.ts`
