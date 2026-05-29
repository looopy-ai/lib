---
"@looopy-ai/core": minor
---

Add secure auth-required handoff support to local tools, including waiting-auth loop behavior and credential-based resume handling in Agent.startTurn().

Update the random number example tool to require secure authentication for ranges exceeding 100 and decrypt returned JWE credentials before continuing.
