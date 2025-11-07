/**
 * LiteLLM Provider
 *
 * LLM provider implementation using LiteLLM proxy server.
 * LiteLLM provides a unified interface to 100+ LLM providers.
 *
 * Design Reference: design/agent-loop.md#llm-provider
 *
 * @see https://docs.litellm.ai/
 */

import { from, Observable } from 'rxjs';
import { filter, map } from 'rxjs/operators';
import { getLogger } from '../core/logger';
import { aggregateChoice, choices, getContent, splitInlineXml } from '../core/operators/chat-completions';
import type { LLMProvider, LLMResponse, Message, ToolCall, ToolDefinition } from '../core/types';

const logger = getLogger({ component: 'LiteLLMProvider' });

/**
 * LiteLLM configuration
 */
export interface LiteLLMConfig {
  /** LiteLLM proxy URL (e.g., http://localhost:4000) */
  baseUrl: string;

  /** Model name (e.g., gpt-4, claude-3-opus, etc.) */
  model: string;

  /** API key for authentication (optional if using proxy) */
  apiKey?: string;

  /** Temperature for generation (0-2) */
  temperature?: number;

  /** Maximum tokens to generate */
  maxTokens?: number;

  /** Top P sampling */
  topP?: number;

  /** Timeout in milliseconds */
  timeout?: number;

  /** Additional parameters to pass to LiteLLM */
  extraParams?: Record<string, unknown>;
}

/**
 * LiteLLM API request format
 */
interface LiteLLMRequest {
  model: string;
  messages: Array<{
    role: string;
    content: string;
    name?: string;
    tool_call_id?: string;
    tool_calls?: Array<{
      id: string;
      type: string;
      function: {
        name: string;
        arguments: string;
      };
    }>;
  }>;
  tools?: Array<{
    type: string;
    function: {
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    };
  }>;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  stream?: boolean;
  [key: string]: unknown;
}

/**
 * LiteLLM API response format
 */
interface LiteLLMResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: string;
        function: {
          name: string;
          arguments: string;
        };
      }>;
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * LiteLLM streaming chunk format (SSE)
 */
interface LiteLLMStreamChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      role?: string;
      content?: string;
      tool_calls?: Array<{
        index: number;
        id?: string;
        type?: 'function';
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
    finish_reason: string | null;
  }>;
}

/**
 * LiteLLM Provider Implementation
 */
export class LiteLLMProvider implements LLMProvider {
  private readonly config: LiteLLMConfig & {
    temperature: number;
    maxTokens: number;
    topP: number;
    timeout: number;
    extraParams: Record<string, unknown>;
  };

  constructor(config: LiteLLMConfig) {
    this.config = {
      ...config,
      temperature: config.temperature ?? 0.7,
      maxTokens: config.maxTokens ?? 4096,
      topP: config.topP ?? 1.0,
      timeout: config.timeout ?? 60000,
      extraParams: config.extraParams ?? {},
    };

    logger.info(
      {
        baseUrl: this.config.baseUrl,
        model: this.config.model,
        temperature: this.config.temperature,
        maxTokens: this.config.maxTokens,
        timeout: this.config.timeout,
        hasApiKey: !!this.config.apiKey,
      },
      'LiteLLM provider initialized'
    );
  }

  /**
   * Call LiteLLM to generate a response
   */
  call(request: {
    messages: Message[];
    tools?: ToolDefinition[];
    stream?: boolean;
    sessionId?: string;
  }): Observable<LLMResponse> {
    // If streaming is requested, use SSE streaming
    if (request.stream) {
      return this.callStreaming(request);
    }

    // Otherwise use non-streaming call
    return from(this.callAsync(request));
  }

  /**
   * Stream LLM responses via SSE using the new aggregation pipeline
   */
  private callStreaming(request: {
    messages: Message[];
    tools?: ToolDefinition[];
    sessionId?: string;
  }): Observable<LLMResponse> {
    const stream$ = this.createSSEStream(request).pipe(choices());

    const {content, tags} = splitInlineXml(stream$.pipe(
      getContent(),
    ));

    const contentDelta = content.pipe(
      map((text) => ({ delta: { content: text } })),
    )

    const throughts = tags.pipe(
      filter((tag) => tag.name === 'thinking')
    );

    const finalContent = stream$.pipe(
      aggregateChoice(),
      map((event) => {
        const toolCalls = event.delta?.tool_calls?.map((tc) => ({
          id: tc.id || '',
          type: 'function' as const,
          function: {
            name: tc.function?.name || 'unknown',
            arguments: JSON.parse(tc.function?.arguments || '{}'),
          },
        }));

        return ({
          message: {
            role: 'assistant' as const,
            content: event.delta?.content || '',
            toolCalls,
          } satisfies Message,
          toolCalls,
          finished: true,
          finishReason: (event.finish_reason as LLMResponse['finishReason']) || 'stop',
          model: this.config.model, // TODO
      } satisfies LLMResponse)})
    );

    // Create the SSE stream observable and convert to Choice stream
    return finalContent;
  }

  /**
   * Create the raw SSE stream from LiteLLM
   */
  private createSSEStream(request: {
    messages: Message[];
    tools?: ToolDefinition[];
    sessionId?: string;
  }): Observable<LiteLLMStreamChunk> {
    return new Observable<LiteLLMStreamChunk>((subscriber) => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

      // Prepare request
      const litellmRequest: LiteLLMRequest = {
        model: this.config.model,
        messages: request.messages.map((msg) => {
          const baseMsg: LiteLLMRequest['messages'][0] = {
            role: msg.role,
            content: msg.content,
          };

          if (msg.name) baseMsg.name = msg.name;
          if (msg.toolCallId) baseMsg.tool_call_id = msg.toolCallId;

          if (msg.toolCalls && msg.toolCalls.length > 0) {
            baseMsg.tool_calls = msg.toolCalls.map((tc) => ({
              id: tc.id,
              type: tc.type,
              function: {
                name: tc.function.name,
                arguments:
                  typeof tc.function.arguments === 'string'
                    ? tc.function.arguments
                    : JSON.stringify(tc.function.arguments),
              },
            }));
          }

          return baseMsg;
        }),
        temperature: this.config.temperature,
        max_tokens: this.config.maxTokens,
        top_p: this.config.topP,
        stream: true,
        ...this.config.extraParams,
      };

      if (request.sessionId) {
        litellmRequest.metadata = {
          ...((litellmRequest.metadata as Record<string, unknown>) || {}),
          session_id: request.sessionId,
        };
      }

      if (request.tools && request.tools.length > 0) {
        litellmRequest.tools = request.tools.map((tool) => ({
          type: 'function',
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters as Record<string, unknown>,
          },
        }));
      }

      const url = `${this.config.baseUrl}/chat/completions`;

      // Start the streaming request
      (async () => {
        try {
          const response = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(this.config.apiKey && {
                Authorization: `Bearer ${this.config.apiKey}`,
              }),
            },
            body: JSON.stringify(litellmRequest),
            signal: controller.signal,
          });

          clearTimeout(timeoutId);

          if (!response.ok) {
            const errorText = await response.text();
            throw new Error(
              `LiteLLM API error: ${response.status} ${response.statusText} - ${errorText}`
            );
          }

          if (!response.body) {
            throw new Error('No response body');
          }

          // Parse SSE stream and emit chunks
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';

          while (true) {
            const { done, value } = await reader.read();

            if (done) {
              break;
            }

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              if (!line.trim() || line.trim() === '') continue;
              if (!line.startsWith('data: ')) continue;

              const data = line.slice(6).trim();
              if (data === '[DONE]') continue;

              try {
                const chunk: LiteLLMStreamChunk = JSON.parse(data);
                subscriber.next(chunk);
              } catch (error) {
                logger.warn({ error, line }, 'Failed to parse SSE chunk');
              }
            }
          }

          subscriber.complete();
        } catch (error) {
          clearTimeout(timeoutId);
          subscriber.error(error);
        }
      })();

      // Cleanup on unsubscribe
      return () => {
        clearTimeout(timeoutId);
        controller.abort();
      };
    });
  }

  /**
   * Async implementation of LLM call
   */
  private async callAsync(request: {
    messages: Message[];
    tools?: ToolDefinition[];
    stream?: boolean;
    sessionId?: string;
  }): Promise<LLMResponse> {
    const litellmRequest: LiteLLMRequest = {
      model: this.config.model,
      messages: request.messages.map((msg) => {
        const baseMsg: {
          role: string;
          content: string;
          name?: string;
          tool_call_id?: string;
          tool_calls?: Array<{
            id: string;
            type: string;
            function: { name: string; arguments: string };
          }>;
        } = {
          role: msg.role,
          content: msg.content,
          name: msg.name,
          tool_call_id: msg.toolCallId,
        };

        // Include tool_calls for assistant messages
        if (msg.toolCalls && msg.toolCalls.length > 0) {
          baseMsg.tool_calls = msg.toolCalls.map((tc) => ({
            id: tc.id,
            type: tc.type,
            function: {
              name: tc.function.name,
              // Always send arguments as a string to LiteLLM
              arguments:
                typeof tc.function.arguments === 'string'
                  ? tc.function.arguments
                  : JSON.stringify(tc.function.arguments),
            },
          }));
        }

        return baseMsg;
      }),
      temperature: this.config.temperature,
      max_tokens: this.config.maxTokens,
      top_p: this.config.topP,
      stream: request.stream || false,
      ...this.config.extraParams,
    };

    // Add session ID if provided (useful for tracking)
    if (request.sessionId) {
      litellmRequest.metadata = {
        ...((litellmRequest.metadata as Record<string, unknown>) || {}),
        session_id: request.sessionId,
      };
    }

    // Add tools if provided (wrap in OpenAI format)
    if (request.tools && request.tools.length > 0) {
      litellmRequest.tools = request.tools.map((tool) => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters as Record<string, unknown>,
        },
      }));
    }

    // Make API request
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

    const url = `${this.config.baseUrl}/chat/completions`;

    logger.trace(
      {
        url,
        model: this.config.model,
        messageCount: request.messages.length,
        toolCount: request.tools?.length || 0,
        sessionId: request.sessionId,
      },
      'Making LiteLLM API request'
    );

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.config.apiKey && {
            Authorization: `Bearer ${this.config.apiKey}`,
          }),
        },
        body: JSON.stringify(litellmRequest),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        let errorDetail: string;
        try {
          errorDetail = JSON.parse(errorText);
        } catch {
          errorDetail = errorText;
        }

        logger.error(
          {
            status: response.status,
            statusText: response.statusText,
            url,
            model: this.config.model,
            error: errorDetail,
          },
          'LiteLLM API error response'
        );

        throw new Error(
          `LiteLLM API error: ${response.status} ${response.statusText} - ${errorText}`
        );
      }

      const data = (await response.json()) as LiteLLMResponse;

      logger.trace(
        {
          model: data.model,
          finishReason: data.choices[0]?.finish_reason,
          promptTokens: data.usage?.prompt_tokens,
          completionTokens: data.usage?.completion_tokens,
          totalTokens: data.usage?.total_tokens,
        },
        'LiteLLM API response received'
      );

      return this.transformResponse(data);
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof Error) {
        // Timeout error
        if (error.name === 'AbortError') {
          logger.error(
            {
              timeout: this.config.timeout,
              url,
              model: this.config.model,
            },
            'LiteLLM request timeout'
          );
          throw new Error(`LiteLLM request timeout after ${this.config.timeout}ms`);
        }

        // Network/connection errors
        if (error.message.includes('fetch failed')) {
          logger.error(
            {
              url,
              model: this.config.model,
              baseUrl: this.config.baseUrl,
              error: error.message,
              cause: (error as { cause?: { message: string } }).cause?.message,
            },
            'LiteLLM connection failed - is the server running?'
          );

          throw new Error(
            `Failed to connect to LiteLLM at ${this.config.baseUrl}. ` +
              `Is the server running? Error: ${error.message}. ` +
              `Cause: ${(error as { cause?: { message: string } }).cause?.message || 'unknown'}`
          );
        }

        // Re-throw if already handled above
        if (error.message.startsWith('LiteLLM API error')) {
          throw error;
        }

        // Other errors
        logger.error(
          {
            url,
            model: this.config.model,
            error: error.message,
            stack: error.stack,
          },
          'Unexpected error calling LiteLLM'
        );
        throw error;
      }

      logger.error(
        {
          url,
          model: this.config.model,
          error: String(error),
        },
        'Unknown error type calling LiteLLM'
      );
      throw new Error('Unknown error calling LiteLLM');
    }
  }

  /**
   * Transform LiteLLM response to our format
   */
  private transformResponse(response: LiteLLMResponse): LLMResponse {
    const choice = response.choices[0];

    if (!choice) {
      throw new Error('LiteLLM returned no choices');
    }

    const toolCalls: ToolCall[] | undefined = choice.message.tool_calls?.map((tc) => ({
      id: tc.id,
      type: 'function' as const,
      function: {
        name: tc.function.name,
        // Parse arguments string to object for compatibility with tool providers
        arguments:
          typeof tc.function.arguments === 'string'
            ? JSON.parse(tc.function.arguments)
            : tc.function.arguments,
      },
    }));

    const message: Message = {
      role: choice.message.role as 'assistant',
      content: choice.message.content || '',
      toolCalls, // Include tool calls in the message
    };

    const finished =
      choice.finish_reason === 'stop' ||
      choice.finish_reason === 'length' ||
      choice.finish_reason === 'content_filter';

    return {
      message,
      toolCalls,
      finished,
      finishReason: choice.finish_reason as 'stop' | 'length' | 'tool_calls' | 'content_filter',
      model: response.model, // Include model name from response
      usage: response.usage
        ? {
            promptTokens: response.usage.prompt_tokens,
            completionTokens: response.usage.completion_tokens,
            totalTokens: response.usage.total_tokens,
          }
        : undefined,
    };
  }

  /**
   * Get the current model name
   */
  getModel(): string {
    return this.config.model;
  }

  /**
   * Update configuration
   */
  updateConfig(updates: Partial<LiteLLMConfig>): void {
    Object.assign(this.config, updates);
  }
}

/**
 * Create a LiteLLM provider with common presets
 */
export const LiteLLM = {
  /**
   * Create provider for Nova Micro
   */
  novaMicro(baseUrl: string, apiKey?: string): LiteLLMProvider {
    return new LiteLLMProvider({
      baseUrl,
      model: 'amazon.nova-micro-v1:0',
      apiKey,
      temperature: 0.7,
      maxTokens: 8192,
    });
  },

  /**
   * Create provider for Nova Lite
   */
  novaLite(baseUrl: string, apiKey?: string): LiteLLMProvider {
    return new LiteLLMProvider({
      baseUrl,
      model: 'amazon.nova-lite-v1:0',
      apiKey,
      temperature: 0.7,
      maxTokens: 8192,
    });
  },

  /**
   * Create provider for GPT-4
   */
  gpt4(baseUrl: string, apiKey?: string): LiteLLMProvider {
    return new LiteLLMProvider({
      baseUrl,
      model: 'gpt-4',
      apiKey,
      temperature: 0.7,
      maxTokens: 4096,
    });
  },

  /**
   * Create provider for GPT-4 Turbo
   */
  gpt4Turbo(baseUrl: string, apiKey?: string): LiteLLMProvider {
    return new LiteLLMProvider({
      baseUrl,
      model: 'gpt-4-turbo-preview',
      apiKey,
      temperature: 0.7,
      maxTokens: 4096,
    });
  },

  /**
   * Create provider for GPT-3.5 Turbo
   */
  gpt35Turbo(baseUrl: string, apiKey?: string): LiteLLMProvider {
    return new LiteLLMProvider({
      baseUrl,
      model: 'gpt-3.5-turbo',
      apiKey,
      temperature: 0.7,
      maxTokens: 4096,
    });
  },

  /**
   * Create provider for Claude 3 Opus
   */
  claude3Opus(baseUrl: string, apiKey?: string): LiteLLMProvider {
    return new LiteLLMProvider({
      baseUrl,
      model: 'claude-3-opus-20240229',
      apiKey,
      temperature: 0.7,
      maxTokens: 4096,
    });
  },

  /**
   * Create provider for Claude 3 Sonnet
   */
  claude3Sonnet(baseUrl: string, apiKey?: string): LiteLLMProvider {
    return new LiteLLMProvider({
      baseUrl,
      model: 'claude-3-sonnet-20240229',
      apiKey,
      temperature: 0.7,
      maxTokens: 4096,
    });
  },

  /**
   * Create provider for Claude 3 Haiku
   */
  claude3Haiku(baseUrl: string, apiKey?: string): LiteLLMProvider {
    return new LiteLLMProvider({
      baseUrl,
      model: 'claude-3-haiku-20240307',
      apiKey,
      temperature: 0.7,
      maxTokens: 4096,
    });
  },

  /**
   * Create provider for local models via Ollama
   */
  ollama(baseUrl: string, model: string): LiteLLMProvider {
    return new LiteLLMProvider({
      baseUrl,
      model: `ollama/${model}`,
      temperature: 0.7,
      maxTokens: 2048,
    });
  },
};
