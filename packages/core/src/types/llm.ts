import type { Observable } from 'rxjs';
import type { AnyEvent } from './event';
import type { LLMMessage } from './message';
import type { ToolCall, ToolDefinition } from './tools';

/**
 * LLM Provider interface
 */
export interface LLMProvider {
  call(request: {
    messages: LLMMessage[];
    tools?: ToolDefinition[];
    stream?: boolean;
    sessionId?: string;
  }): Observable<AnyEvent>;
}

/**
 * LLM response
 */
export interface LLMResponse {
  message: LLMMessage;
  toolCalls?: ToolCall[];
  finished: boolean;
  finishReason?: 'stop' | 'length' | 'tool_calls' | 'content_filter';
  model?: string; // Model used for this response
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
}
