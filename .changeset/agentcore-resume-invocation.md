---
"@looopy-ai/aws": patch
---

Wire auth-required / waiting-auth resume path into the AgentCore runtime adapter.

- New `POST /invocations` body type `"resume"` calls `agent.startTurn(null, { credentials, inputs })` to resume a waiting-auth or waiting-input turn
- Legacy payloads (object with `prompt` field but no `type`) are normalised to `type: "prompt"` for backward compatibility
- Validation errors now always reset the busy flag
- Subscribe `.error` handler added so stream errors reset the busy flag and don't leave the agent stuck
- Shared `streamTurn` helper extracts the SSE streaming logic, used by both prompt and resume handlers
- Input size bounds: max 20 entries in credentials/inputs arrays, max 100 000 chars for prompt, max 65 536 chars per credential
