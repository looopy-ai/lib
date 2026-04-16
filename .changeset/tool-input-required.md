---
"@looopy-ai/core": minor
"@looopy-ai/aws": patch
"@looopy-ai/react": patch
---

Add `tool-input-required` interrupt mechanism

Tools can now pause the agent loop to request upstream input rather than failing or guessing. The loop stops cleanly, the agent transitions to `waiting-input`, and the caller resumes by supplying resolved values on the next `startTurn()` call.

**New APIs**

- `inputRequired(spec)` — helper for tool handlers to signal that input is needed
- `requestInputPlugin()` — advertises a `request_input` tool the LLM can call when it needs clarification; the call is intercepted before execution and surfaces as `tool-input-required`
- `ToolInputRequiredEvent` — new event emitted in place of `tool-complete` for an interrupted tool call; carries `inputId`, `inputType`, `prompt`, original `toolArguments`, and optional `schema`/`options`
- `PendingToolInput` — serialisable state saved to `AgentState`; survives process restarts when an `AgentStore` is configured
- `AgentState.status: 'waiting-input'` — new lifecycle status
- `startTurn(null, { inputs: [{ inputId, value }] })` — resume path; resolved values are threaded through `ExecutionContext.resolvedInputs` so the tool can proceed
- `isToolInputRequiredEvent(event)` — type guard

**Behaviour**

- Parallel tool calls: completed tools emit `tool-complete` immediately; only the interrupted tool(s) pause the loop
- Cancel path: passing a new `userMessage` while `waiting-input` injects synthetic `tool-complete` errors for all pending calls and continues as a fresh turn
- Chained interrupts: a tool may call `inputRequired` again on resume (e.g. multi-step wizard), keeping the agent in `waiting-input` with a fresh `inputId`
- LLM-initiated requests via `requestInputPlugin` inject a synthetic `tool-complete` carrying the resolved value on resume so the LLM sees a well-formed answer
