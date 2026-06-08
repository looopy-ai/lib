---
"@looopy-ai/react": patch
---

Fix out-of-order conversation reducer handling so auth-required and input-required prompts initialize as non-pending when related completion events (input-received, auth-completed, or tool-complete) arrive first.
