/**
 * Authentication context
 */
export interface AuthContext {
  userId?: string;
  credentials?: Record<string, unknown>;
  scopes?: string[];
}

/**
 * Execution context passed to tools
 */
export interface ExecutionContext {
  taskId: string;
  contextId: string;
  agentId: string;
  parentContext: import('@opentelemetry/api').Context;
  authContext?: AuthContext;
  metadata?: Record<string, unknown>;
}
