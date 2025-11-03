# Authentication & Security

## Overview

Looopy provides a flexible authentication framework that supports:

1. **Authentication Validation**: Verify incoming requests
2. **Credential Passthrough**: Forward auth to tools and sub-agents
3. **Token Re-issuance**: Generate scoped tokens for external services
4. **Authorization**: Fine-grained permission control
5. **Audit Logging**: Track all authenticated operations

## Authentication Architecture

```
┌──────────────────────────────────────────────────────────┐
│                    Client Request                         │
│              Authorization: Bearer <token>                │
└────────────────────────┬─────────────────────────────────┘
                         │
┌────────────────────────▼─────────────────────────────────┐
│              Authentication Middleware                    │
│  ┌────────────────────────────────────────────────────┐  │
│  │  1. Extract credentials                            │  │
│  │  2. Validate with AuthStrategy                     │  │
│  │  3. Build AuthContext                              │  │
│  │  4. Attach to request                              │  │
│  └────────────────────────────────────────────────────┘  │
└────────────────────────┬─────────────────────────────────┘
                         │
┌────────────────────────▼─────────────────────────────────┐
│                  Agent Execution                          │
│                 (with AuthContext)                        │
└────────┬────────────────────────────┬────────────────────┘
         │                            │
         ▼                            ▼
┌──────────────────┐        ┌──────────────────┐
│   Tool Call      │        │  Sub-Agent Call  │
└────────┬─────────┘        └────────┬─────────┘
         │                           │
         ▼                           ▼
┌──────────────────┐        ┌──────────────────┐
│ Auth Propagation │        │ Auth Propagation │
│  - Passthrough   │        │  - Passthrough   │
│  - Re-issue      │        │  - Re-issue      │
│  - Scope down    │        │  - Scope down    │
└──────────────────┘        └──────────────────┘
```

## Core Interfaces

### AuthContext

```typescript
interface AuthContext {
  /**
   * Authenticated user/service identity
   */
  principal: Principal;

  /**
   * Original credentials (if passthrough is enabled)
   */
  credentials?: Credentials;

  /**
   * Granted permissions
   */
  permissions: Permission[];

  /**
   * Token metadata
   */
  token?: {
    type: 'bearer' | 'api-key' | 'oauth2';
    value: string;
    expiresAt?: Date;
    scopes?: string[];
  };

  /**
   * Audit trail
   */
  audit: {
    sessionId: string;
    ipAddress: string;
    userAgent?: string;
    timestamp: Date;
  };
}

interface Principal {
  id: string;
  type: 'user' | 'service' | 'api-key';
  name: string;
  email?: string;
  metadata?: Record<string, unknown>;
}

interface Permission {
  resource: string;  // e.g., "tool:search", "agent:invoke"
  actions: string[]; // e.g., ["execute", "read"]
  constraints?: Record<string, unknown>;
}
```

### AuthStrategy

```typescript
interface AuthStrategy {
  /**
   * Validate incoming credentials
   */
  validate(credentials: Credentials): Observable<AuthContext>;

  /**
   * Check if principal has permission
   */
  authorize(
    context: AuthContext,
    resource: string,
    action: string
  ): Observable<boolean>;

  /**
   * Prepare credentials for external service
   */
  prepareForward(
    context: AuthContext,
    target: ForwardTarget
  ): Observable<Credentials>;

  /**
   * Refresh expired credentials
   */
  refresh?(context: AuthContext): Observable<AuthContext>;
}

type ForwardTarget = {
  type: 'tool' | 'agent';
  id: string;
  endpoint?: string;
  requiredScopes?: string[];
};
```

## Authentication Strategies

### JWT Bearer Token

```typescript
class JWTAuthStrategy implements AuthStrategy {
  constructor(
    private config: {
      secretOrPublicKey: string | Buffer;
      issuer?: string;
      audience?: string;
    }
  ) {}

  validate(credentials: Credentials): Observable<AuthContext> {
    if (credentials.type !== 'bearer') {
      return throwError(() => new Error('Invalid credentials type'));
    }

    return defer(() => {
      const decoded = jwt.verify(credentials.token, this.config.secretOrPublicKey, {
        issuer: this.config.issuer,
        audience: this.config.audience
      }) as JWTPayload;

      return of({
        principal: {
          id: decoded.sub!,
          type: decoded.type || 'user',
          name: decoded.name || decoded.sub!,
          email: decoded.email
        },
        credentials,
        permissions: this.extractPermissions(decoded),
        token: {
          type: 'bearer',
          value: credentials.token,
          expiresAt: decoded.exp ? new Date(decoded.exp * 1000) : undefined,
          scopes: decoded.scope?.split(' ')
        },
        audit: {
          sessionId: decoded.jti || generateId(),
          ipAddress: credentials.metadata?.ip || 'unknown',
          timestamp: new Date()
        }
      } as AuthContext);
    }).pipe(
      catchError(error => {
        logger.warn('JWT validation failed', { error: error.message });
        return throwError(() => new UnauthorizedError('Invalid token'));
      })
    );
  }

  authorize(
    context: AuthContext,
    resource: string,
    action: string
  ): Observable<boolean> {
    const hasPermission = context.permissions.some(p =>
      this.matchesResource(p.resource, resource) &&
      p.actions.includes(action)
    );

    if (!hasPermission) {
      logger.warn('Authorization failed', {
        principal: context.principal.id,
        resource,
        action
      });
    }

    return of(hasPermission);
  }

  prepareForward(
    context: AuthContext,
    target: ForwardTarget
  ): Observable<Credentials> {
    // Default: passthrough original token
    if (context.credentials) {
      return of(context.credentials);
    }

    // Generate new token with reduced scope
    return this.generateScopedToken(context, target);
  }

  private generateScopedToken(
    context: AuthContext,
    target: ForwardTarget
  ): Observable<Credentials> {
    const payload: JWTPayload = {
      sub: context.principal.id,
      iss: 'looopy',
      aud: target.id,
      scope: target.requiredScopes?.join(' '),
      exp: Math.floor(Date.now() / 1000) + 3600, // 1 hour
      iat: Math.floor(Date.now() / 1000),
      jti: generateId()
    };

    const token = jwt.sign(payload, this.config.secretOrPublicKey);

    return of({
      type: 'bearer',
      token
    });
  }

  private extractPermissions(decoded: JWTPayload): Permission[] {
    // Extract from custom claim
    if (decoded.permissions) {
      return decoded.permissions as Permission[];
    }

    // Extract from scopes
    if (decoded.scope) {
      return decoded.scope.split(' ').map(scope => ({
        resource: scope,
        actions: ['execute']
      }));
    }

    // Default permissions
    return [];
  }

  private matchesResource(pattern: string, resource: string): boolean {
    // Support wildcards: "tool:*", "agent:data-*"
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
    return regex.test(resource);
  }
}
```

### API Key Strategy

```typescript
class APIKeyAuthStrategy implements AuthStrategy {
  constructor(
    private apiKeyStore: APIKeyStore,
    private permissionStore: PermissionStore
  ) {}

  validate(credentials: Credentials): Observable<AuthContext> {
    if (credentials.type !== 'api-key') {
      return throwError(() => new Error('Invalid credentials type'));
    }

    return this.apiKeyStore.find(credentials.key).pipe(
      switchMap(apiKey => {
        if (!apiKey || apiKey.revoked) {
          throw new UnauthorizedError('Invalid API key');
        }

        if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
          throw new UnauthorizedError('API key expired');
        }

        return this.permissionStore.getPermissions(apiKey.id).pipe(
          map(permissions => ({
            principal: {
              id: apiKey.id,
              type: 'api-key' as const,
              name: apiKey.name
            },
            credentials,
            permissions,
            token: {
              type: 'api-key' as const,
              value: credentials.key,
              expiresAt: apiKey.expiresAt
            },
            audit: {
              sessionId: generateId(),
              ipAddress: credentials.metadata?.ip || 'unknown',
              timestamp: new Date()
            }
          }))
        );
      }),
      tap(() => {
        // Update last used timestamp
        this.apiKeyStore.updateLastUsed(credentials.key);
      })
    );
  }

  authorize(
    context: AuthContext,
    resource: string,
    action: string
  ): Observable<boolean> {
    // Same as JWT strategy
    return of(context.permissions.some(p =>
      p.resource === resource && p.actions.includes(action)
    ));
  }

  prepareForward(
    context: AuthContext,
    target: ForwardTarget
  ): Observable<Credentials> {
    // API keys are typically not forwarded
    // Generate a short-lived JWT instead
    return this.generateJWT(context, target);
  }

  private generateJWT(
    context: AuthContext,
    target: ForwardTarget
  ): Observable<Credentials> {
    // Implementation similar to JWT strategy
    const token = jwt.sign({
      sub: context.principal.id,
      aud: target.id,
      exp: Math.floor(Date.now() / 1000) + 300 // 5 minutes
    }, process.env.JWT_SECRET!);

    return of({
      type: 'bearer',
      token
    });
  }
}
```

### OAuth2 Strategy

```typescript
class OAuth2AuthStrategy implements AuthStrategy {
  constructor(
    private config: {
      issuer: string;
      jwksUri: string;
      tokenEndpoint: string;
      clientId: string;
      clientSecret: string;
    }
  ) {}

  validate(credentials: Credentials): Observable<AuthContext> {
    if (credentials.type !== 'bearer') {
      return throwError(() => new Error('Invalid credentials type'));
    }

    // Validate with OAuth2 introspection endpoint
    return this.introspectToken(credentials.token).pipe(
      map(introspection => {
        if (!introspection.active) {
          throw new UnauthorizedError('Token not active');
        }

        return {
          principal: {
            id: introspection.sub,
            type: 'user' as const,
            name: introspection.username || introspection.sub,
            email: introspection.email
          },
          credentials,
          permissions: this.scopesToPermissions(introspection.scope),
          token: {
            type: 'bearer' as const,
            value: credentials.token,
            expiresAt: introspection.exp
              ? new Date(introspection.exp * 1000)
              : undefined,
            scopes: introspection.scope?.split(' ')
          },
          audit: {
            sessionId: generateId(),
            ipAddress: credentials.metadata?.ip || 'unknown',
            timestamp: new Date()
          }
        } as AuthContext;
      })
    );
  }

  prepareForward(
    context: AuthContext,
    target: ForwardTarget
  ): Observable<Credentials> {
    // Use token exchange (RFC 8693)
    return this.exchangeToken(
      context.credentials!.token,
      target
    );
  }

  private introspectToken(token: string): Observable<TokenIntrospection> {
    return from(
      fetch(this.config.tokenEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Basic ${Buffer.from(
            `${this.config.clientId}:${this.config.clientSecret}`
          ).toString('base64')}`
        },
        body: new URLSearchParams({ token })
      })
    ).pipe(
      switchMap(res => from(res.json())),
      map(json => json as TokenIntrospection)
    );
  }

  private exchangeToken(
    subjectToken: string,
    target: ForwardTarget
  ): Observable<Credentials> {
    return from(
      fetch(this.config.tokenEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
          subject_token: subjectToken,
          subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
          audience: target.id,
          scope: target.requiredScopes?.join(' ') || ''
        })
      })
    ).pipe(
      switchMap(res => from(res.json())),
      map(json => ({
        type: 'bearer' as const,
        token: json.access_token
      }))
    );
  }
}
```

## Authorization

### Permission Checking

```typescript
class AuthorizationService {
  constructor(private strategy: AuthStrategy) {}

  /**
   * Check if context has permission for action
   */
  authorize(
    context: AuthContext,
    resource: string,
    action: string
  ): Observable<void> {
    return this.strategy.authorize(context, resource, action).pipe(
      switchMap(allowed => {
        if (!allowed) {
          return throwError(() => new ForbiddenError(
            `Not authorized: ${action} on ${resource}`
          ));
        }
        return of(void 0);
      })
    );
  }

  /**
   * Filter list of items by permissions
   */
  filterByPermissions<T extends { id: string }>(
    context: AuthContext,
    items: T[],
    resourceType: string,
    action: string
  ): Observable<T[]> {
    return from(items).pipe(
      mergeMap(item =>
        this.strategy.authorize(
          context,
          `${resourceType}:${item.id}`,
          action
        ).pipe(
          map(allowed => allowed ? item : null)
        ),
        10 // Concurrency
      ),
      filter(item => item !== null),
      toArray()
    ) as Observable<T[]>;
  }
}
```

### Tool Authorization

```typescript
const executeToolWithAuth$ = (
  toolCall: ToolCall,
  context: ExecutionContext
): Observable<ToolResult> => {
  const resource = `tool:${toolCall.function.name}`;

  return authService.authorize(context.auth, resource, 'execute').pipe(
    switchMap(() => {
      // Prepare credentials for tool
      return authStrategy.prepareForward(context.auth, {
        type: 'tool',
        id: toolCall.function.name
      });
    }),
    switchMap(credentials => {
      // Execute tool with forwarded credentials
      return toolProvider.execute(toolCall, {
        ...context,
        credentials
      });
    })
  );
};
```

### Sub-Agent Authorization

```typescript
const invokeSubAgentWithAuth$ = (
  agentId: string,
  prompt: string,
  context: ExecutionContext
): Observable<string> => {
  const resource = `agent:${agentId}`;

  return authService.authorize(context.auth, resource, 'invoke').pipe(
    switchMap(() => {
      return authStrategy.prepareForward(context.auth, {
        type: 'agent',
        id: agentId,
        requiredScopes: ['agent:execute']
      });
    }),
    switchMap(credentials => {
      return a2aClient.invoke({
        prompt,
        credentials
      });
    })
  );
};
```

## Credential Management

### Secure Storage

```typescript
class CredentialStore {
  constructor(
    private encryption: EncryptionService,
    private storage: SecureStorage
  ) {}

  async store(
    principalId: string,
    service: string,
    credentials: Credentials
  ): Promise<void> {
    const encrypted = await this.encryption.encrypt(
      JSON.stringify(credentials)
    );

    await this.storage.set(
      `creds:${principalId}:${service}`,
      encrypted,
      {
        ttl: 3600, // 1 hour
        tags: ['credentials', principalId]
      }
    );
  }

  async retrieve(
    principalId: string,
    service: string
  ): Promise<Credentials | null> {
    const encrypted = await this.storage.get(
      `creds:${principalId}:${service}`
    );

    if (!encrypted) return null;

    const decrypted = await this.encryption.decrypt(encrypted);
    return JSON.parse(decrypted) as Credentials;
  }
}
```

### Token Rotation

```typescript
class TokenRotationService {
  constructor(
    private authStrategy: AuthStrategy,
    private credentialStore: CredentialStore
  ) {}

  /**
   * Automatically refresh token before expiry
   */
  withAutoRefresh(
    context$: Observable<AuthContext>
  ): Observable<AuthContext> {
    return context$.pipe(
      switchMap(context => {
        if (!context.token?.expiresAt) {
          return of(context);
        }

        const expiresIn = context.token.expiresAt.getTime() - Date.now();
        const refreshAt = expiresIn - 60000; // 1 minute before expiry

        if (refreshAt <= 0) {
          // Already expired, refresh immediately
          return this.refreshToken(context);
        }

        // Schedule refresh
        return timer(refreshAt).pipe(
          switchMap(() => this.refreshToken(context)),
          startWith(context)
        );
      })
    );
  }

  private refreshToken(
    context: AuthContext
  ): Observable<AuthContext> {
    if (!this.authStrategy.refresh) {
      return of(context);
    }

    return this.authStrategy.refresh(context).pipe(
      tap(newContext => {
        logger.info('Token refreshed', {
          principal: newContext.principal.id
        });
      }),
      catchError(error => {
        logger.error('Token refresh failed', { error });
        return throwError(() => new UnauthorizedError('Token refresh failed'));
      })
    );
  }
}
```

## Audit Logging

### Audit Trail

```typescript
interface AuditEvent {
  timestamp: Date;
  principal: Principal;
  action: string;
  resource: string;
  outcome: 'success' | 'failure';
  details?: Record<string, unknown>;
  traceId?: string;
}

class AuditLogger {
  constructor(private storage: AuditStorage) {}

  log(event: AuditEvent): void {
    this.storage.append({
      ...event,
      id: generateId(),
      timestamp: event.timestamp || new Date()
    });

    // Also emit metric
    meter.counter('auth.audit_events').add(1, {
      'auth.action': event.action,
      'auth.outcome': event.outcome
    });
  }

  logAuthorization(
    context: AuthContext,
    resource: string,
    action: string,
    allowed: boolean
  ): void {
    this.log({
      timestamp: new Date(),
      principal: context.principal,
      action: `authorize:${action}`,
      resource,
      outcome: allowed ? 'success' : 'failure',
      details: {
        sessionId: context.audit.sessionId,
        ipAddress: context.audit.ipAddress
      }
    });
  }
}
```

### Extension Hook

```typescript
const auditExtension: Extension = {
  name: 'audit',
  priority: 100,
  hooks: {
    beforeToolExecution: (toolCall, context) => {
      auditLogger.log({
        timestamp: new Date(),
        principal: context.auth.principal,
        action: 'tool:execute',
        resource: `tool:${toolCall.function.name}`,
        outcome: 'success', // Will be updated if fails
        details: {
          taskId: context.taskId,
          traceId: context.traceContext.traceId
        }
      });

      return of({ toolCall, context });
    },

    afterToolExecution: (result, context) => {
      auditLogger.log({
        timestamp: new Date(),
        principal: context.auth.principal,
        action: 'tool:complete',
        resource: `tool:${result.toolName}`,
        outcome: result.success ? 'success' : 'failure',
        details: {
          taskId: context.taskId,
          executionTime: result.metadata?.executionTime
        }
      });

      return of(result);
    }
  }
};
```

## Security Best Practices

### 1. Principle of Least Privilege

```typescript
// Grant minimal permissions
const permissions: Permission[] = [
  {
    resource: 'tool:search',
    actions: ['execute']
  }
  // Don't grant tool:* unless necessary
];
```

### 2. Credential Scoping

```typescript
// Scope down credentials when forwarding
const scopedCreds = await authStrategy.prepareForward(context.auth, {
  type: 'tool',
  id: 'external-api',
  requiredScopes: ['read:data'] // Not write
});
```

### 3. Short-Lived Tokens

```typescript
// Issue tokens with minimal TTL
const token = jwt.sign(payload, secret, {
  expiresIn: '5m' // 5 minutes for tool calls
});
```

### 4. Rate Limiting

```typescript
class RateLimitedAuthStrategy implements AuthStrategy {
  constructor(
    private wrapped: AuthStrategy,
    private rateLimiter: RateLimiter
  ) {}

  validate(credentials: Credentials): Observable<AuthContext> {
    return this.rateLimiter.checkLimit(credentials).pipe(
      switchMap(allowed => {
        if (!allowed) {
          return throwError(() => new TooManyRequestsError());
        }
        return this.wrapped.validate(credentials);
      })
    );
  }
}
```

### 5. Secrets Encryption

```typescript
// Never log credentials
logger.info('Auth successful', {
  principal: context.principal.id,
  // DO NOT: credentials: context.credentials
});

// Encrypt at rest
const encrypted = await encryption.encrypt(credentials);
await storage.set(key, encrypted);
```
