/**
 * Execution context passed to tools
 */
export interface ExecutionContext<AuthContext> {
  taskId: string;
  contextId: string;
  agentId: string;
  parentContext: import('@opentelemetry/api').Context;
  authContext?: AuthContext;
  metadata?: Record<string, unknown>;
}
