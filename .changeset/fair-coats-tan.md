---
"@looopy-ai/react": patch
---

Fix tool cancellation handling so linked auth/input requests are cancelled even when tool-complete arrives before the corresponding task turn is created.
