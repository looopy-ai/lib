---
"@looopy-ai/core": major
"@looopy-ai/aws": major
"@looopy-ai/react": patch
---

Upgrade key dependencies across the workspace, including `jose` v6, `pino` v10, `@hono/node-server` v2, `streamdown` v2, Vite 8, Vitest 4, and TypeScript 6.

Includes a compatibility fix for `jose` v6 in JWE decryption by updating private key import to use `ECDH-ES` in `decryptCredential`.
