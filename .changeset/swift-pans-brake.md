---
"@looopy-ai/core": major
"@looopy-ai/aws": major
"@looopy-ai/react": patch
---

Upgrade key dependencies across the workspace, including `jose` v6, `pino` v10, `@hono/node-server` v2, `streamdown` v2, Vite 8, Vitest 4, and TypeScript 6.

Includes a compatibility fix for `jose` v6 in JWE decryption by updating private key import to use `ECDH-ES` in `decryptCredential`.

Includes TypeScript 6 build compatibility updates:
- Use recursive workspace package builds from the root `build` script.
- Update package ESM tsconfig interop settings for `@looopy-ai/core` and `@looopy-ai/aws`.
- Add TS6 deprecation ignore setting in `@looopy-ai/react` build tsconfig.
