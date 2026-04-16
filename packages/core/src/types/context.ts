/**
 * Execution context passed to tools
 */
export interface ExecutionContext<AuthContext> {
  taskId: string;
  contextId: string;
  agentId: string;
  /** The tool call ID associated with this execution — useful for keying resolvedInputs */
  toolCallId?: string;
  parentContext: import('@opentelemetry/api').Context;
  authContext?: AuthContext;
  /**
   * When a tool previously emitted `tool-input-required`, on resume the resolved value is
   * placed here keyed by `toolCallId`. The tool handler should check this before requesting
   * input again.
   */
  resolvedInputs?: Map<string, unknown>;
  metadata?: Record<string, unknown>;
}
