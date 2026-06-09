---
"@looopy-ai/core": patch
---

Stop loop execution after a configurable number of consecutive tool failures to prevent infinite retry cycles when tools keep failing, and expose this as `AgentConfig.maxConsecutiveToolFailures` with a default of `3`.
