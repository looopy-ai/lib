# @looopy-ai/react

## 1.0.13

### Patch Changes

- eff5cf2: Updated packages
- 66695a4: Upgrade key dependencies across the workspace, including `jose` v6, `pino` v10, `@hono/node-server` v2, `streamdown` v2, Vite 8, Vitest 4, and TypeScript 6.

  Includes a compatibility fix for `jose` v6 in JWE decryption by updating private key import to use `ECDH-ES` in `decryptCredential`.

  Includes TypeScript 6 build compatibility updates:

  - Use recursive workspace package builds from the root `build` script.
  - Update package ESM tsconfig interop settings for `@looopy-ai/core` and `@looopy-ai/aws`.
  - Add TS6 deprecation ignore setting in `@looopy-ai/react` build tsconfig.

## 1.0.12

### Patch Changes

- 5c474f9: Publish readme files

## 1.0.11

### Patch Changes

- 34ce5d1: Add `tool-input-required` interrupt mechanism

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

## 1.0.10

### Patch Changes

- 5e9cc57: Update packages

## 1.0.9

### Patch Changes

- 6dd9260: add prompt error

## 1.0.8

### Patch Changes

- 8de36d7: Show prompt in conversation

## 1.0.7

### Patch Changes

- bbc0052: Nested tasks

## 1.0.6

### Patch Changes

- ba98083: update task content handling to use arrays and add stream property

## 1.0.5

### Patch Changes

- 7c8d53d: publish

## 1.0.4

### Patch Changes

- 07695fb: Fix content delta reduction

## 1.0.3

### Patch Changes

- 783d497: prompt fetching to kitchen-sink example

## 1.0.2

### Patch Changes

- 6dc8058: Change shutdown handling

## 1.0.1

### Patch Changes

- 4f90ceb: Added lucide icons
