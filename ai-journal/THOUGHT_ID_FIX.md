# Thought ID Design Fix

## Problem Identified

**Original Issue**: The `thoughtId` was being generated server-side by `emitThought()`, which created a fundamental flaw:

- LLM calls `think_aloud` tool
- Server generates random `thoughtId` (e.g., `thought-1762406806-abc123`)
- LLM **never receives the thoughtId** in the response
- LLM **cannot reference** this thought in future `related_to` fields

This made thought chaining impossible!

## Solution

**LLM-Provided Thought IDs**: Allow the LLM to provide its own `thought_id` in the tool call, using meaningful names like:
- `"initial_plan"`
- `"step1"`, `"step2"`, etc.
- `"weather_check"`
- `"calculation_decision"`

If the LLM doesn't provide a `thought_id`, we generate one as a fallback.

### Benefits

1. **LLM can chain thoughts**: Knows the IDs to use in `related_to`
2. **More meaningful IDs**: "weather_check" is clearer than "thought-1762406806-abc123"
3. **LLM controls naming**: Can use semantic IDs that match its reasoning
4. **Backward compatible**: Still generates IDs if not provided

## Changes Made

### 1. Updated Schema (`src/tools/thought-tools.ts`)

**Added `thought_id` Parameter:**

```typescript
const ThinkAloudSchema = z.object({
  thought_id: z
    .string()
    .optional()
    .describe(
      'A unique ID for this thought (e.g., "initial_plan", "step1", "weather_check"). Use this to reference the thought later via related_to. If not provided, one will be generated.'
    ),
  thought: z.string().describe('Your reasoning or thought process...'),
  // ... other fields
  related_to: z
    .string()
    .optional()
    .describe('ID of a related thought (from a previous thought_id) or tool call...'),
});
```

**Updated Tool Execution:**

```typescript
// Generate thoughtId if not provided
const thoughtId =
  validation.data.thought_id ||
  `thought-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

// Emit with the ID
config.eventEmitter.emitThought(
  config.taskId,
  config.contextId,
  validation.data.thought_type,
  validation.data.thought,
  {
    thoughtId, // Pass LLM-provided or generated ID
    // ... other options
  }
);

// Return thoughtId to LLM
return {
  toolCallId: toolCall.id,
  toolName: 'think_aloud',
  success: true,
  result: {
    acknowledged: true,
    thoughtId,
    message: `Thought recorded with ID: ${thoughtId}`,
  },
};
```

### 2. Updated Event Emitter (`src/core/operators/event-emitter.ts`)

**Added `thoughtId` to Options:**

```typescript
emitThought(
  taskId: string,
  contextId: string,
  thoughtType: ThoughtType,
  content: string,
  options?: {
    thoughtId?: string; // NEW: LLM-provided ID or will generate
    verbosity?: ThoughtVerbosity;
    confidence?: number;
    relatedTo?: string;
    alternatives?: string[];
    metadata?: Record<string, unknown>;
  }
): void {
  const event = createThoughtStreamEvent({
    contextId,
    taskId,
    thoughtId:
      options?.thoughtId || // Use provided ID
      `thought-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`, // Or generate
    // ... rest of event
  });
  this.eventSubject.next(event);
}
```

### 3. Updated Kitchen Sink Example (`examples/kitchen-sink.ts`)

**Enhanced System Prompt with Thought ID Guidance:**

```typescript
Thinking Out Loud:
Use the think_aloud tool to share your reasoning process, especially when:
- Planning your approach to a complex task (thought_type: "planning")
- Working through a multi-step problem (thought_type: "reasoning")
- Making decisions between alternatives (thought_type: "decision", include alternatives array)
- Reflecting on what you've done (thought_type: "reflection")
- Noticing important details in the user's request (thought_type: "observation")

Important: Provide a thought_id (like "initial_plan", "step1", "weather_check") so you can reference
thoughts later using related_to. This helps create chains of reasoning.

Example: Before calling multiple tools, use think_aloud to explain your plan:
  think_aloud({
    thought_id: "initial_plan",
    thought: "I'll first get the weather, then calculate if temperature conversion is needed",
    thought_type: "planning",
    confidence: 0.9
  })

Then later you can reference it:
  think_aloud({
    thought_id: "weather_retrieved",
    thought: "Got the weather data, now I see it's in Celsius",
    thought_type: "observation",
    related_to: "initial_plan"
  })
```

## Usage Examples

### Simple Thought (No ID Needed)

```typescript
think_aloud({
  thought: "User wants weather data for San Francisco",
  thought_type: "observation"
})
// Returns: { acknowledged: true, thoughtId: "thought-1762406806-xyz" }
```

### Thought Chain with Meaningful IDs

```typescript
// Step 1: Initial plan
think_aloud({
  thought_id: "plan_weather_query",
  thought: "I need to get weather data, then possibly convert units",
  thought_type: "planning"
})

// Step 2: Decision with alternatives
think_aloud({
  thought_id: "tool_decision",
  thought: "I'll use get_weather instead of search because it's more reliable",
  thought_type: "decision",
  alternatives: [
    "Use search to find weather website",
    "Ask user to specify weather service"
  ],
  related_to: "plan_weather_query"
})

// Step 3: Observation after tool execution
think_aloud({
  thought_id: "weather_result",
  thought: "Weather data retrieved: 72°F in San Francisco",
  thought_type: "observation",
  related_to: "tool_decision"
})

// Step 4: Reflection
think_aloud({
  thought_id: "task_complete",
  thought: "Successfully retrieved and formatted weather data for user",
  thought_type: "reflection",
  related_to: "plan_weather_query"
})
```

### Complex Decision with Full Context

```typescript
think_aloud({
  thought_id: "database_vs_api",
  thought: "I'll query the local database instead of the external API because it's faster and we have recent cached data",
  thought_type: "decision",
  confidence: 0.85,
  verbosity: "detailed",
  alternatives: [
    "Use external API for real-time data (slower, 5-10s)",
    "Use pre-computed summary table (faster but less granular)",
    "Ask user for time/accuracy preference"
  ],
  related_to: "initial_analysis_plan"
})
```

## Event Flow

### Before (Broken)

```
LLM → think_aloud({thought: "Planning..."})
Server generates: thoughtId = "thought-1762406806-abc"
Server emits: ThoughtStreamEvent { thoughtId: "thought-1762406806-abc" }
LLM receives: { acknowledged: true } ❌ NO THOUGHT ID!
LLM → think_aloud({related_to: ???}) ❌ CANNOT REFERENCE!
```

### After (Fixed)

```
LLM → think_aloud({thought_id: "step1", thought: "Planning..."})
Server uses: thoughtId = "step1"
Server emits: ThoughtStreamEvent { thoughtId: "step1" }
LLM receives: { acknowledged: true, thoughtId: "step1" } ✅
LLM → think_aloud({thought_id: "step2", related_to: "step1"}) ✅ CAN CHAIN!
```

## Testing

All 130 tests passing:

```
✓ tests/internal-event-artifact-store.test.ts (6 tests)
✓ tests/artifact-store.test.ts (27 tests)
✓ tests/local-tools.test.ts (20 tests)
✓ tests/client-tool-provider.test.ts (24 tests)
✓ tests/sse-server.test.ts (29 tests)
✓ tests/sanitize.test.ts (12 tests)
✓ tests/agent-loop.test.ts (12 tests)

Test Files  7 passed (7)
     Tests  130 passed (130)
```

## Files Modified

1. **src/tools/thought-tools.ts**
   - Added `thought_id` to schema (optional)
   - Generate ID if not provided
   - Pass `thoughtId` to `emitThought()`
   - Return `thoughtId` in tool result

2. **src/core/operators/event-emitter.ts**
   - Added `thoughtId` to `emitThought()` options
   - Use provided ID or generate fallback

3. **examples/kitchen-sink.ts**
   - Enhanced system prompt with thought ID examples
   - Show thought chaining pattern

## Benefits Summary

✅ **Enables thought chaining**: LLM can build chains of related thoughts
✅ **Meaningful IDs**: "initial_plan" > "thought-1762406806-abc123"
✅ **LLM control**: LLM decides naming convention
✅ **Backward compatible**: Auto-generates if ID not provided
✅ **Debuggable**: Easier to trace thought sequences in logs
✅ **Aligns with design**: Matches the `relatedTo` field intent

## Design Principle

This follows the pattern used by tool calls themselves:
- Tool calls have `id` fields (e.g., `call_abc123`)
- LLM receives these IDs in the response
- LLM can reference them later (e.g., in error handling)

Now thoughts work the same way:
- Thoughts can have `thought_id` fields
- LLM receives the ID in the response
- LLM can reference them in `related_to`

This creates a **graph of reasoning** where thoughts reference other thoughts and tool calls, enabling transparency into the LLM's complete decision-making process.
