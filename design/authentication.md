# Authentication & Secure Credential Handoff

## Overview

When an agent needs external credentials it cannot obtain itself (OAuth tokens, API keys, passwords), it pauses execution and emits an `auth-required` event. The client encrypts the credential using the agent's ephemeral public key and returns it via `startTurn()`. The agent decrypts it in memory and continues.

**Key properties:**
- Raw secrets never appear in events, logs, or traces — only encrypted JWE envelopes
- Each auth request uses a fresh ephemeral ECDH key pair (15-minute lifetime)
- Claim binding (`authId`, `contextId`) prevents replay across sessions
- The client owns the OAuth redirect/callback flow; the agent only handles the resulting code

## Protocol Flow

```
Agent                    Client                   (OAuth Provider / User)
  │                         │
  ├─ auth-required ────────▶│
  │  (encryptionKey,        │
  │   PKCE challenge info   │
  │   or api-key prompt)    │
  │                         │
  │                         │  [User authorises / pastes key]
  │                         │
  │◀─ startTurn ────────────┤
  │   (with JWE(secret)     │
  │    encrypted to key)    │
  │                         │
  ├─ decryptCredential()    │
  │  → secret (in memory)   │
  │                         │
  ├─ use secret / exchange  │
  └─ secret discarded       │
```

See [docs/auth-flows.md](../docs/auth-flows.md) for complete worked examples.

## Core Interfaces

```typescript
interface EncryptionKey {
  kty: string;  // 'EC'
  crv: string;  // 'P-256'
  x: string;    // Base64url X coordinate
  y: string;    // Base64url Y coordinate
  kid: string;  // Key ID
  alg?: string; // 'ECDH-ES'
}

interface ECDHKeyPair {
  keyId: string;
  publicKey: EncryptionKey; // Embed in auth-required event
  privateKeyPem: string;    // PKCS8 PEM — keep in memory, never emit
  expiresAt: Date;          // 15-minute lifetime
}

interface JWEClaims {
  authId: string;    // Unique per auth request — prevents replay
  contextId: string; // Binds to specific conversation context
  agentId?: string;  // Optional: restricts to target agent
  iat: number;       // Issued-at (Unix seconds)
  exp: number;       // Expiry (Unix seconds)
}

interface PKCEPair {
  codeVerifier: string;    // Keep in agent memory, never emit
  codeChallenge: string;   // Derived via SHA256 — include in auth URL
  algorithm: 'S256';
}

interface CredentialSubmission {
  authId: string;
  credential: string; // JWE compact serialization
  submittedAt: string;
}
```

## Auth Event Types

```typescript
// Shared base for all variants
interface AuthRequiredEventBase {
  kind: 'auth-required';
  authId: string;           // Unique per request
  provider?: string;        // 'google', 'github', etc.
  scopes?: string[];
  prompt: string;           // User-facing message
  encryptionKey: EncryptionKey; // Client encrypts to this
  timestamp: string;
}

// OAuth 2.0 — client builds authorization URL with own redirect URI
interface OAuth2AuthRequiredEvent extends AuthRequiredEventBase {
  authType: 'oauth2';
  authorizationEndpoint?: string;
  clientId?: string;
  codeChallenge?: string;    // PKCE code challenge
  codeChallengeMethod?: 'S256';
}

// API key / PAT / password — user pastes a secret
interface ApiKeyAuthRequiredEvent extends AuthRequiredEventBase {
  authType: 'api-key' | 'pat' | 'password';
  infoUrl?: string; // Link to token generation page
}

type AuthRequiredEvent = OAuth2AuthRequiredEvent | ApiKeyAuthRequiredEvent | /* ... */;
```

## Key Functions

```typescript
// Crypto
generateECDHKeyPair(): ECDHKeyPair
isKeyExpired(keyPair: ECDHKeyPair): boolean

// JWE
encryptCredential(credential: string, publicKey: EncryptionKey, claims: JWEClaims): Promise<string>
decryptCredential(jwe: string, privateKeyPem: string, expectedClaims: Partial<JWEClaims>): Promise<string>
validateJWEClaims(claims: JWEClaims, expected: Partial<JWEClaims>): void

// PKCE
generatePKCEPair(): PKCEPair
generateCodeVerifier(): string
generateCodeChallenge(verifier: string): string
validateCodeChallenge(verifier: string, challenge: string): boolean

// OAuth URL helpers
generateOAuth2Request(options): { pkce: PKCEPair; authUrl: string }
buildOAuth2AuthUrl(options: OAuth2AuthUrlOptions): string
extractAuthorizationCode(callbackUrl: string): { code: string; state: string } | null
buildTokenExchangeRequest(options): Record<string, string>

// Claims
createJWEClaims(options: { authId, contextId, agentId?, expiresInSeconds? }): JWEClaims
validateClaims(claims: JWEClaims, expected: Partial<JWEClaims>): void
hasExpired(claims: JWEClaims): boolean
getTimeRemaining(claims: JWEClaims): number
```

## Design Decisions

**Why ECDH-ES + A256GCM?** Asymmetric encryption means clients can encrypt without sharing a secret. P-256 is widely supported, compact, and fast. A256GCM provides authenticated encryption.

**Why ephemeral keys (15-minute lifetime)?** Limits the window for key compromise; a fresh pair is generated for each auth request, so a leaked private key cannot be reused.

**Why claims in the JWE protected header?** Binding `authId` and `contextId` to the ciphertext prevents a valid JWE from being replayed in a different auth request or conversation.

**Why does the client own the OAuth redirect?** The agent cannot host a redirect URI — it has no public HTTP endpoint in the general case. The client (browser or native app) handles the redirect, captures the authorization code, and returns only the encrypted code to the agent.

## Security Properties

| Property | Mechanism |
|---|---|
| No plaintext secrets in events | JWE encryption before submission |
| No replay across auth requests | `authId` claim binding |
| No replay across sessions | `contextId` claim binding |
| PKCE code useless without verifier | Verifier kept in agent memory only |
| Short-lived credentials | `exp` claim + key expiry |

## Implementation

See [packages/core/src/auth/](../packages/core/src/auth/) for the full implementation.

