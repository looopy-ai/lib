import type { Observable } from 'rxjs';
import type { AnyEvent, LLMEvent } from './event';
import type { Message } from './message';
import type { ToolCall, ToolDefinition } from './tools';

/**
 * LLM Provider interface
 */
export interface LLMProvider {
  call(request: {
    messages: Message[];
    tools?: ToolDefinition[];
    stream?: boolean;
    sessionId?: string;
  }): Observable<LLMEvent<AnyEvent>>;
}

/**
 * LLM response
 */
export interface LLMResponse {
  message: Message;
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
