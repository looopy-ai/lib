---
"@looopy-ai/core": patch
"@looopy-ai/aws": patch
---

Move prompt and resume invocation payload parsing into core server utilities so endpoint adapters can share auth credential and resolved input validation.
