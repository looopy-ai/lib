# Secure Credential Handoff

Utilities for implementing secure external credential exchange in a multi-agent system using standardized cryptographic protocols.

## Overview

This module provides end-to-end encryption and authentication for credentials flowing between agents and external services. It prevents raw secrets from traversing event chains, logs, or untrusted intermediaries.

**Key design:**
- **Ephemeral ECDH key pairs** for each auth request (15-minute lifetime)
- **JWE encryption** (ECDH-ES with A256GCM) with claim binding
- **OAuth 2.0 PKCE** for provider-based authentication
- **No raw secrets in events** — only encrypted envelopes or OAuth codes

## Auth Types Supported

| Type | Flow | Transport |
|------|------|-----------|
| `oauth2` | User → OAuth Provider callback → Agent | Authorization code via JWE |
| `api-key` | User input → encrypted → Agent | JWE envelope to agent private key |
| `password` | User input → encrypted → Agent | JWE envelope to agent private key |
| `custom` | Provider-specific | JWE envelope to agent private key |
| `biometric` | Device-local only | N/A (no network transit) |

## Protocol Flow

### OAuth2 with PKCE

```
Agent                    Client                   OAuth Authorization Server
  │                         │                                  │
  ├─ auth-required ─────────▶                                  │
  │  (encryptionKey,        │                                  │
  │   authUrl with PKCE)    │                                  │
  │                         │                                  │
  │                         ├─ open authUrl ──────────────────▶│
  │                         │                                  │
  │                         │◀─ redirect with auth code ───────┤
  │                         │  (to client callback URL)        │
  │                         │                                  │
  │◀─ startTurn ────────────┤                                  │
  │  (with JWE(authCode)    │                                  │
  │   encrypted to key)     │                                  │
  │                         │                                  │
  ├─ decrypt JWE            │                                  │
  │  → authCode             │                                  │
  │                         │                                  │
  ├─ exchange(code + verifier + secret) ──────────────────────▶│
  │                         │                                  │
  │◀─ access_token ────────────────────────────────────────────┤
  │  (kept in agent memory) │                                  │
```

**Why this is secure:**
- Authorization code is useless without `code_verifier` (held only in agent)
- `code_verifier` never transmitted
- Encrypted code prevents intermediate agents from reading it
- Claim binding (authId, contextId) prevents replay across sessions

### API Key / Password with JWE

```
Agent                    Client                   (External Service)
  │                         │
  ├─ auth-required ────────▶│
  │  (api-key type,         │
  │   encryptionKey)        │
  │                         │
  │                         │  [User enters secret]
  │                         │
  │  ◀─ startTurn ──────────┤
  │     (with JWE(secret)   │
  │      encrypted to key)  │
  │                         │
  ├─ decrypt JWE            │
  │  → secret (in memory)   │
  │                         │                            │
  ├─ call service with secret ──────────────────────────▶│
  │                         │                            │
  │◀─ response ──────────────────────────────────────────┤
  │                         │                            │
  └─ secret discarded       │                            │
```

## Installation

```bash
cd packages/core
pnpm add jose
pnpm install
```

## API Reference

### PKCE (OAuth Authorization Code)

```typescript
import {
  generateCodeVerifier,
  generateCodeChallenge,
  generatePKCEPair,
  validateCodeChallenge,
} from '@looopy-ai/core/auth';

// Generate PKCE pair
const { codeVerifier, codeChallenge } = generatePKCEPair();

// Use challenge in authorization URL
const authUrl = `https://provider.com/auth?code_challenge=${codeChallenge}&code_challenge_method=S256`;

// After getting the authorization code, use verifier to exchange for token
const isValid = validateCodeChallenge(codeVerifier, receivedChallenge);
```

### ECDH Key Generation

```typescript
import { generateECDHKeyPair, isKeyExpired } from '@looopy-ai/core/auth';

// Generate ephemeral key pair (15-minute lifetime)
const keyPair = generateECDHKeyPair();

// {
//   keyId: "uuid",
//   publicKey: {
//     kty: "EC",
//     crv: "P-256",
//     x: "base64url...",
//     y: "base64url...",
//     kid: "uuid",
//     alg: "ECDH-ES"
//   },
//   privateKeyPem: "-----BEGIN PRIVATE KEY-----...",
//   expiresAt: Date
// }

// Check expiration
if (isKeyExpired(keyPair)) {
  // Generate new pair
}

// Include publicKey in auth-required event
// Store privateKeyPem in memory (never emit)
```

### JWE Encryption/Decryption

```typescript
import {
  encryptCredential,
  decryptCredential,
} from '@looopy-ai/core/auth';
import { createJWEClaims } from '@looopy-ai/core/auth';

// Agent side: emit auth-required with encryptionKey
const keyPair = generateECDHKeyPair();
const authEvent: AuthRequiredEvent = {
  kind: 'auth-required',
  authId: 'auth-xyz',
  authType: 'api-key',
  prompt: 'Enter your API key',
  encryptionKey: keyPair.publicKey,
  // ... other fields
};

// Client side: encrypt secret
const claims = createJWEClaims({
  authId: authEvent.authId,
  contextId: currentContext,
  expiresInSeconds: 300, // 5 minutes
});

const jwe = await encryptCredential(
  userSecret,
  authEvent.encryptionKey,
  claims
);

// Submit JWE to agent
await agent.startTurn(prompt, {
  credentials: [{ authId: authEvent.authId, credential: jwe }],
});

// Agent side: decrypt on receipt
const credential = await decryptCredential(
  jwe,
  keyPair.privateKeyPem,
  { authId: authEvent.authId, contextId: currentContext }
);

// Use credential
const result = await externalService.call(credential);

// Clear from memory
credential = undefined;
```

### OAuth Flows

```typescript
import {
  generateOAuth2Request,
  extractAuthorizationCode,
  buildTokenExchangeRequest,
} from '@looopy-ai/core/auth';

// Agent: generate OAuth request
const request = generateOAuth2Request({
  clientId: process.env.OAUTH_CLIENT_ID,
  redirectUri: 'https://app.example.com/callback',
  provider: 'google',
  scopes: ['openid', 'profile', 'email'],
});

// Client: redirect user
window.location.href = request.authUrl; // PKCE challenge embedded

// Client callback handler
const { code, state } = extractAuthorizationCode(window.location.href);

// Encrypt code to agent
const jwe = await encryptCredential(code, request.publicKey, claims);

// Agent: exchange code for token
const tokenRequest = buildTokenExchangeRequest({
  code: decryptedCode,
  codeVerifier: request.pkce.codeVerifier, // Kept in agent memory
  clientId: process.env.OAUTH_CLIENT_ID,
  clientSecret: process.env.OAUTH_CLIENT_SECRET,
  redirectUri: 'https://app.example.com/callback',
});

const response = await fetch('https://oauth-provider.com/token', {
  method: 'POST',
  body: new URLSearchParams(tokenRequest),
});

const { access_token } = await response.json();
// Token stays in agent, never transmitted
```

### Claims Management

```typescript
import {
  createJWEClaims,
  validateClaims,
  hasExpired,
  getTimeRemaining,
} from '@looopy-ai/core/auth';

// Create claims with default 1-hour expiration
const claims = createJWEClaims({
  authId: 'auth-123',
  contextId: 'ctx-456',
});

// Custom expiration
const shortLived = createJWEClaims({
  authId: 'auth-123',
  contextId: 'ctx-456',
  expiresInSeconds: 300, // 5 minutes
});

// Validate claims
validateClaims(claims, {
  authId: 'auth-123', // Must match
  contextId: 'ctx-456', // Must match
});

// Check expiration
if (hasExpired(claims)) {
  // Claims are invalid
}

// Get time remaining
const secondsLeft = getTimeRemaining(claims);
if (secondsLeft < 60) {
  console.warn('Credential expiring soon');
}
```

## Type Definitions

### EncryptionKey (JWK)

```typescript
interface EncryptionKey {
  kty: string; // 'EC'
  crv: string; // 'P-256'
  x: string; // Base64url X coordinate
  y: string; // Base64url Y coordinate
  kid: string; // Key ID
  alg?: string; // 'ECDH-ES'
}
```

### JWEClaims

```typescript
interface JWEClaims {
  authId: string; // Unique auth request ID
  contextId: string; // Task context ID
  agentId?: string; // Target agent ID
  iat: number; // Issued-at (Unix timestamp)
  exp: number; // Expiration (Unix timestamp)
  [key: string]: unknown;
}
```

### PKCEPair

```typescript
interface PKCEPair {
  codeVerifier: string; // RFC 7636 unreserved chars
  codeChallenge: string; // SHA256(verifier) base64url
  algorithm: 'S256';
}
```

## Event Integration

### AuthRequiredEvent

```typescript
export interface AuthRequiredEvent {
  kind: 'auth-required';
  authId: string; // Unique for this auth request
  authType: 'oauth2' | 'api-key' | 'password' | 'biometric' | 'custom';
  provider?: string; // 'google', 'github', 'stripe', etc.
  scopes?: string[]; // Requested permissions
  prompt: string; // User-facing message
  authUrl?: string; // OAuth redirect URL (oauth2 only)
  encryptionKey?: {
    // Public key for credential encryption
    kty: string;
    crv: string;
    x: string;
    y: string;
    kid: string;
    alg?: string;
  };
  timestamp: string;
  metadata?: {
    expiresIn?: number; // Seconds until auth expires
    [key: string]: unknown;
  };
}
```

## Security Considerations

### Key Lifecycle

- **Generation:** Fresh ECDH key pair per auth request
- **Public:** Emitted in auth-required event
- **Private:** Kept in agent memory, never serialized
- **Expiration:** 15 minutes by default (prevent key reuse)
- **Rotation:** Automatic on next auth request

### Claim Binding

- **authId:** Prevents reuse of JWE across different auth requests
- **contextId:** Binds credential to specific task context
- **agentId:** (Optional) Restricts to target agent
- **exp:** Prevents use after timeout (default 1 hour)
- **iat:** Prevents use before issued (clock skew tolerance 60s)

### Confidentiality

- JWE ciphertext is opaque; intermediate agents cannot decrypt
- Authorization codes useful only with `code_verifier` (kept by agent)
- Secrets decrypted only in agent memory, never persisted
- Logs/traces do not include plaintext credentials

### Integrity

- JWE protects against tampering
- Claims in protected header prevent modification
- PKCE `S256` protects against authorization code interception

## Testing

```bash
pnpm test -- auth

# Run specific test file
pnpm test -- auth-pkce.test.ts

# With coverage
pnpm test:coverage -- auth
```

## Migration Guide

### From plaintext credentials in events

**Before (⚠️ unsafe):**
```typescript
// ❌ DO NOT DO THIS
const input = { credentialType: 'api-key', value: userApiKey };
agent.startTurn(prompt, { inputs: [input] });
```

**After (✅ secure):**
```typescript
import { encryptCredential, createJWEClaims } from '@looopy-ai/core/auth';

// Emit auth-required with encryptionKey
const claims = createJWEClaims({
  authId: event.authId,
  contextId: taskContext,
});

const jwe = await encryptCredential(userApiKey, event.encryptionKey, claims);

agent.startTurn(prompt, {
  credentials: [{ authId: event.authId, credential: jwe }],
});
```

## Examples

See `packages/examples/src/auth-*.ts` for complete working examples:

- `auth-oauth.ts` — OAuth2 PKCE flow with Google
- `auth-apikey.ts` — API key submission with JWE
- `auth-password.ts` — Password submission with JWE

## Known Limitations

1. **Asymmetric crypto only:** Agents must have private keys in memory (not suitable for highly distributed/stateless deployments).
2. **Clock skew:** System clocks should be reasonably synchronized (60s tolerance built in).
3. **Token storage:** After decryption, tokens are in agent memory (vulnerable if agent memory is dumped).
4. **No revocation:** Issued JWE cannot be revoked; use short expiration times.

## Future Improvements

- [ ] Hardware security module (HSM) integration for private keys
- [ ] Key derivation from master secret instead of per-request generation
- [ ] Token cache with automatic refresh
- [ ] Credential vault integration for long-lived keys
- [ ] Audit logging for credential access
