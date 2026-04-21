# Authentication Flows for Agent Developers

When an agent needs credentials it cannot obtain itself, it pauses execution and emits an `auth-required` event to the client. The client owns redirect and callback handling, encrypts the resulting credential, and returns it to the agent via `startTurn()`. The agent then decrypts it and continues.

This document covers the two most common patterns:

1. [OAuth 2.0 — access_token + refresh_token](#1-oauth-20--access_token--refresh_token)
2. [Personal Access Token (PAT)](#2-personal-access-token-pat)

---

## How it works (overview)

```
Agent tool                Client (browser/app)
──────────────────────    ──────────────────────────────────────────
1. Emit auth-required ──► 2. Parse event, show UI to user
                          3. Client handles redirect / callback flow
                          4. User authorises / pastes token
                          5. Client encrypts credential with encryptionKey
6. Decrypt ◄───────────── 6. Submit JWE back via startTurn()
7. Continue execution
```

Credentials are **never sent in plaintext**. The agent generates an ephemeral ECDH key pair, embeds the public key in the event, and the client uses it to encrypt the credential as a JWE before sending it back.

---

## 1. OAuth 2.0 — access_token + refresh_token

### Agent side

```typescript
import { randomUUID } from 'node:crypto';
import {
  createAuthRequiredEvent,
  generateECDHKeyPair,
  generatePKCEPair,
} from '@looopy-ai/core';

// Call this from inside a tool handler
async function requestGoogleOAuth(context: ExecutionContext) {
  // 1. Generate an ephemeral ECDH key pair (15-minute lifetime)
  const keyPair = generateECDHKeyPair();

  // 2. Generate PKCE state for the client-owned redirect flow
  const pkce = generatePKCEPair();

  // 3. Persist the PKCE verifier and private key — keyed by authId
  //    Use your preferred store (Redis, in-memory map, etc.)
  const authId = randomUUID();
  authStore.set(authId, { pkce, privateKeyPem: keyPair.privateKeyPem });

  // 4. Emit auth-required — this pauses the agent turn
  return createAuthRequiredEvent({
    authId,
    authType: 'oauth2',
    provider: 'google',
    scopes: ['calendar.readonly'],
    prompt: 'Sign in with Google to read your calendar.',
    encryptionKey: keyPair.publicKey,
    authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
    clientId: process.env.GOOGLE_CLIENT_ID!,
    codeChallenge: pkce.codeChallenge,
    codeChallengeMethod: pkce.algorithm,
  });
}
```

> **What the client receives:**
> ```json
> {
>   "kind": "auth-required",
>   "authType": "oauth2",
>   "authId": "550e8400-...",
>   "provider": "google",
>   "prompt": "Sign in with Google to read your calendar.",
>   "encryptionKey": { "kty": "EC", "crv": "P-256", "x": "...", "y": "...", "kid": "...", "alg": "ECDH-ES" },
>   "authorizationEndpoint": "https://accounts.google.com/o/oauth2/v2/auth",
>   "clientId": "...",
>   "codeChallenge": "...",
>   "codeChallengeMethod": "S256"
> }
> ```
>
> The client builds the provider authorization URL using its own redirect URI or callback/proxy endpoint. After the user authorises, the client receives the `code`, encrypts it, and sends it back.

### Client side (encrypt + submit)

```typescript
import { encryptCredential, createJWEClaims } from '@looopy-ai/core';

// Called after your client-owned OAuth callback/proxy captures the authorization code
async function submitOAuthCode(event: OAuth2AuthRequiredEvent, code: string, contextId: string) {
  const claims = createJWEClaims({
    authId: event.authId,
    contextId,
    expiresInSeconds: 300, // 5 minutes — short window for exchange
  });

  const jwe = await encryptCredential(code, event.encryptionKey, claims);

  // Return the JWE to the agent as the next turn message
  await agent.startTurn({
    role: 'user',
    content: jwe,   // The agent recognises this as a credential submission
  });
}
```

### Agent side (decrypt + exchange)

```typescript
import { decryptCredential, buildTokenExchangeRequest } from '@looopy-ai/core';

async function handleOAuthCallback(jwe: string, authId: string, contextId: string) {
  const { pkce, privateKeyPem } = authStore.get(authId)!;
  authStore.delete(authId); // Single-use

  // Decrypt the authorization code
  const code = await decryptCredential(jwe, privateKeyPem, { authId, contextId });

  // Exchange the code for tokens. The redirect URI here must match the
  // client-owned callback/proxy used during authorization.
  const body = buildTokenExchangeRequest({
    code,
    codeVerifier: pkce.codeVerifier,
    clientId: process.env.GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    redirectUri: process.env.GOOGLE_REDIRECT_URI!,
  });

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  });

  const tokens = await response.json();
  // tokens.access_token, tokens.refresh_token, tokens.expires_in
  return tokens;
}
```

---

## 2. Personal Access Token (PAT)

PATs are simpler — no redirect flow. The agent asks the user to paste a token they generate manually on an external site.

### Agent side

```typescript
import { randomUUID } from 'node:crypto';
import { createAuthRequiredEvent, generateECDHKeyPair } from '@looopy-ai/core';

async function requestGitHubPAT(context: ExecutionContext) {
  const keyPair = generateECDHKeyPair();
  const authId = randomUUID();

  // Store the private key so we can decrypt on receipt
  authStore.set(authId, { privateKeyPem: keyPair.privateKeyPem });

  return createAuthRequiredEvent({
    authId,
    authType: 'pat',
    provider: 'github',
    scopes: ['repo', 'read:org'],
    prompt: 'A GitHub Personal Access Token with repo and read:org scope is required.',
    infoUrl: 'https://github.com/settings/tokens/new',  // Optional — deep-link to token creation page
    encryptionKey: keyPair.publicKey,
  });
}
```

> **What the client receives:**
> ```json
> {
>   "kind": "auth-required",
>   "authType": "pat",
>   "authId": "550e8400-...",
>   "provider": "github",
>   "scopes": ["repo", "read:org"],
>   "prompt": "A GitHub Personal Access Token with repo and read:org scope is required.",
>   "infoUrl": "https://github.com/settings/tokens/new",
>   "encryptionKey": { "kty": "EC", "crv": "P-256", "x": "...", "y": "...", "kid": "...", "alg": "ECDH-ES" }
> }
> ```
>
> The client shows an input form. `infoUrl` can be rendered as a "Generate token" link. Once the user pastes the token, the client encrypts and submits it.

### Client side (encrypt + submit)

```typescript
import { encryptCredential, createJWEClaims } from '@looopy-ai/core';

async function submitPAT(event: PatAuthRequiredEvent, token: string, contextId: string) {
  const claims = createJWEClaims({
    authId: event.authId,
    contextId,
    expiresInSeconds: 300,
  });

  const jwe = await encryptCredential(token, event.encryptionKey, claims);

  await agent.startTurn({
    role: 'user',
    content: jwe,
  });
}
```

### Agent side (decrypt + use)

```typescript
import { decryptCredential } from '@looopy-ai/core';

async function handlePATSubmission(jwe: string, authId: string, contextId: string) {
  const { privateKeyPem } = authStore.get(authId)!;
  authStore.delete(authId); // Single-use

  const token = await decryptCredential(jwe, privateKeyPem, { authId, contextId });

  // Use the token
  const octokit = new Octokit({ auth: token });
  // ...
}
```

---

## Key points

| | OAuth 2.0 | PAT |
|---|---|---|
| `authType` | `'oauth2'` | `'pat'` |
| `infoUrl` | Not used | Optional — link to token generation page |
| Client UX | Redirect to provider | Paste-token input form |
| Credential returned | Authorization code (exchanged server-side) | The token directly |
| `encryptionKey` | Required | Required |

## Security notes

- **Never log or store the decrypted credential** longer than needed for the current operation.
- **Always validate JWE claims** (`authId`, `contextId`) on decryption to prevent replay attacks.
- The ECDH key pair has a **15-minute lifetime** — if auth takes longer than that, re-emit `auth-required`.
- The `authStore` in the examples is illustrative — use a short-TTL store (e.g. Redis with `EX 900`) in production.
