import { concat, EMPTY, from, type Observable, of } from 'rxjs';
import type {
  AnyEvent,
  AuthEncryptionKey,
  AuthRequiredEvent,
  AuthType,
  InputType,
  InternalToolMessageEvent,
  JSONSchema,
  ToolCompleteEvent,
  ToolInputRequiredEvent,
} from '../types/event';
import type { ToolCall, ToolResult } from '../types/tools';

export const toolErrorEvent = (toolCall: ToolCall, errorMessage: string): ToolCompleteEvent => ({
  kind: 'tool-complete',
  toolCallId: toolCall.id,
  toolName: toolCall.function.name,
  success: false,
  result: null,
  error: errorMessage,
  timestamp: new Date().toISOString(),
});

export interface ToolInputRequiredSpec {
  inputId?: string;
  inputType: InputType;
  prompt: string;
  schema?: JSONSchema;
  options?: unknown[];
}

export interface ToolAuthRequiredSpec {
  authId: string;
  authType: AuthType;
  prompt: string;
  encryptionKey: AuthEncryptionKey;
  provider?: string;
  scopes?: string[];
  infoUrl?: string;
  authorizationEndpoint?: string;
  clientId?: string;
  codeChallenge?: string;
  codeChallengeMethod?: 'S256';
  metadata?: {
    expiresIn?: number;
    [key: string]: unknown;
  };
}

export const toolInputRequiredEvent = (
  toolCall: ToolCall,
  spec: ToolInputRequiredSpec,
): ToolInputRequiredEvent => ({
  kind: 'tool-input-required',
  toolCallId: toolCall.id,
  toolName: toolCall.function.name,
  toolArguments: toolCall.function.arguments,
  inputId: spec.inputId ?? crypto.randomUUID(),
  inputType: spec.inputType,
  prompt: spec.prompt,
  schema: spec.schema,
  options: spec.options,
  timestamp: new Date().toISOString(),
});

export const toolAuthRequiredEvent = (
  toolCall: ToolCall,
  spec: ToolAuthRequiredSpec,
): AuthRequiredEvent => ({
  kind: 'auth-required',
  authId: spec.authId,
  authType: spec.authType,
  prompt: spec.prompt,
  encryptionKey: spec.encryptionKey,
  provider: spec.provider,
  scopes: spec.scopes,
  infoUrl: spec.infoUrl,
  authorizationEndpoint: spec.authorizationEndpoint,
  clientId: spec.clientId,
  codeChallenge: spec.codeChallenge,
  codeChallengeMethod: spec.codeChallengeMethod,
  metadata: {
    ...spec.metadata,
    toolCallId: toolCall.id,
    toolName: toolCall.function.name,
    toolArguments: toolCall.function.arguments,
  },
  timestamp: new Date().toISOString(),
});

export const toolResultToEvents = (result: ToolResult): Observable<AnyEvent> => {
  const toolCompleteEvent: ToolCompleteEvent = {
    kind: 'tool-complete',
    toolCallId: result.toolCallId,
    toolName: result.toolName,
    success: result.success,
    result: result.result,
    error: result.error,
    timestamp: new Date().toISOString(),
  };

  const messageEvents: InternalToolMessageEvent[] =
    result.messages?.map((message) => ({
      kind: 'internal:tool-message',
      message,
      timestamp: new Date().toISOString(),
    })) ?? [];

  return concat(of(toolCompleteEvent), messageEvents.length > 0 ? from(messageEvents) : EMPTY);
};
