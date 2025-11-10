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

import { appendFileSync, promises as fs, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import pino from 'pino';
import { merge, Observable } from 'rxjs';
import { filter, map, shareReplay, tap } from 'rxjs/operators';
import {
  aggregateChoice,
  aggregateLLMUsage,
  type Choice,
  choices,
  getContent,
  splitInlineXml,
  usage,
} from '../core/operators/chat-completions';
import type { LLMProvider, Message, ToolDefinition } from '../core/types';
import type {
  AnyEvent,
  ContentCompleteEvent,
  ContentDeltaEvent,
  ThoughtStreamEvent,
  ThoughtType,
  ThoughtVerbosity,
} from '../events/types';
import { generateEventId } from '../events/utils';
import type { FinishReason, LLMEvent, LLMUsageEvent } from './../events/types';

const singleString = (input: string | string[] | null | undefined): string | undefined => {
  if (!input) return undefined;

  if (Array.isArray(input)) {
    return input.join('');
  }
  return input;
};

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

  /** Debug logging - path to file where all LLM events will be logged */
  debugLogPath?: string;
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
  private debugLogInitialized = false;
  private readonly logger: pino.Logger;

  constructor(config: LiteLLMConfig) {
    this.config = {
      ...config,
      temperature: config.temperature ?? 0.7,
      maxTokens: config.maxTokens ?? 4096,
      topP: config.topP ?? 1.0,
      timeout: config.timeout ?? 60000,
      extraParams: config.extraParams ?? {},
    };

    this.logger = pino({ base: { component: 'LiteLLMProvider' } });
    this.logger.info(
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
   * Call LiteLLM to generate a response (always streaming)
   *
   * Returns an Observable of LLMEvent (without contextId/taskId - those are added by agent-loop)
   */
  call(request: {
    messages: Message[];
    tools?: ToolDefinition[];
    stream?: boolean;
    sessionId?: string;
  }): Observable<LLMEvent<AnyEvent>> {
    return this.streamEvents(request);
  }

  /**
   * Stream LLM events using the operator pipeline
   *
   * Emits three types of events (all without contextId/taskId):
   * 1. ContentDeltaEvent - incremental text chunks
   * 2. ThoughtStreamEvent - extracted <thinking> tags
   * 3. ContentCompleteEvent - final complete message with tool calls
   */
  private streamEvents(request: {
    messages: Message[];
    tools?: ToolDefinition[];
    sessionId?: string;
  }): Observable<LLMEvent<AnyEvent>> {
    const rawStream$ = this.createSSEStream(request);

    // Log raw chunks if debug logging is enabled
    // shareReplay() ensures only ONE subscription to the underlying HTTP stream
    // even though multiple operators (content, tags, complete$) derive from it
    const stream$ = (
      this.config.debugLogPath
        ? rawStream$.pipe(tap((chunk) => this.debugLogRawChunk(chunk)))
        : rawStream$
    ).pipe(shareReplay());

    const choices$ = stream$.pipe(choices());
    const usage$ = stream$.pipe(usage());

    // Split content into text and inline XML tags
    const { content, tags } = splitInlineXml(choices$.pipe(getContent()));

    // Map content chunks to ContentDeltaEvent (without contextId/taskId)
    let contentIndex = 0;
    const contentDeltas$ = content.pipe(
      map(
        (delta): LLMEvent<ContentDeltaEvent> => ({
          kind: 'content-delta',
          delta,
          index: contentIndex++,
          timestamp: new Date().toISOString(),
        })
      ),
      this.debugLog('content-delta')
    );

    // Map <thinking> tags to ThoughtStreamEvent (without contextId/taskId)
    let thoughtIndex = 0;
    const thoughts$ = tags.pipe(
      filter((tag) =>
        [
          'thinking',
          'analysis',
          'reasoning',
          'reflection',
          'planning',
          'debugging',
          'decision',
          'observation',
          'strategizing',
        ].includes(tag.name)
      ),
      map((tag): LLMEvent<ThoughtStreamEvent> => {
        const thoughtType =
          (singleString(
            tag.attributes.thoughtType || tag.attributes.thought_type || tag.name
          ) as ThoughtType) || 'thinking';

        const verbosity = (singleString(tag.attributes.verbosity) as ThoughtVerbosity) || 'normal';

        const content = singleString(tag.attributes.content || tag.content) || '';

        return {
          kind: 'thought-stream',
          thoughtId: generateEventId(),
          thoughtType,
          verbosity,
          content,
          index: thoughtIndex++,
          timestamp: new Date().toISOString(),
          metadata: {
            source: 'content-delta',
          },
        };
      }),
      this.debugLog('thought-stream')
    );

    // Aggregate final response with tool calls
    const contentComplete$ = choices$.pipe(
      aggregateChoice<Choice>(),
      map((aggregated): LLMEvent<ContentCompleteEvent> => {
        // Assemble complete content
        const content = aggregated.delta?.content || '';

        // Transform tool calls to match ContentCompleteEvent format (only complete ones)
        const toolCalls = aggregated.delta?.tool_calls
          ?.filter((tc) => tc.id && tc.function?.name && tc.function?.arguments)
          .map((tc) => ({
            id: tc.id as string,
            type: 'function' as const,
            function: {
              name: tc.function?.name as string,
              arguments:
                (typeof tc.function?.arguments === 'string'
                  ? JSON.parse(tc.function?.arguments)
                  : tc.function?.arguments) || {},
            },
          }));

        return {
          kind: 'content-complete',
          content,
          toolCalls: toolCalls?.length ? toolCalls : undefined,
          finishReason: (aggregated.finish_reason as FinishReason) || 'stop',
          timestamp: new Date().toISOString(),
        };
      }),
      this.debugLog('content-complete')
    );

    const usageComplete$ = usage$.pipe(
      aggregateLLMUsage(),
      map(
        (usage): LLMEvent<LLMUsageEvent> => ({
          kind: 'llm-usage' as const,
          model: this.config.model,
          ...usage,
          timestamp: new Date().toISOString(),
        })
      ),
      this.debugLog('llm-usage')
    );

    // Merge all event streams
    return merge(contentDeltas$, thoughts$, contentComplete$, usageComplete$);
  }

  /**
   * Debug log raw SSE chunks from LiteLLM
   */
  private debugLogRawChunk(chunk: LiteLLMStreamChunk): void {
    if (!this.config.debugLogPath) {
      return;
    }

    // Initialize on first write
    if (!this.debugLogInitialized) {
      try {
        mkdirSync(dirname(this.config.debugLogPath), { recursive: true });
        writeFileSync(
          this.config.debugLogPath,
          `# LLM Raw Stream Debug Log\n# Started: ${new Date().toISOString()}\n# Model: ${this.config.model}\n\n`,
          { flag: 'w' }
        );
        this.debugLogInitialized = true;
      } catch (error) {
        this.logger.warn({ error }, 'Failed to initialize debug log file');
        return;
      }
    }

    try {
      // Format similar to sse-debug.log but for raw LLM chunks
      const logEntry = [
        `chunk: ${new Date().toISOString()}`,
        `data: ${JSON.stringify(chunk)}`,
        '', // blank line separator
      ].join('\n');

      appendFileSync(this.config.debugLogPath, `${logEntry}\n`);
    } catch (error) {
      this.logger.warn({ error }, 'Failed to write debug log');
    }
  }

  /**
   * Debug logging operator - logs events to file if debugLogPath is configured
   */
  private debugLog<T extends LLMEvent<AnyEvent>>(
    eventType: string
  ): (source: Observable<T>) => Observable<T> {
    if (!this.config.debugLogPath) {
      // No-op if debug logging is disabled
      return (source) => source;
    }

    return (source: Observable<T>) =>
      source.pipe(
        tap(async (event) => {
          try {
            // Ensure directory exists on first write
            if (!this.debugLogInitialized) {
              await fs.mkdir(dirname(this.config.debugLogPath!), { recursive: true });
              // Write header on first use
              await fs.writeFile(
                this.config.debugLogPath!,
                `# LLM Event Debug Log\n# Started: ${new Date().toISOString()}\n# Model: ${this.config.model}\n\n`,
                { flag: 'w' }
              );
              this.debugLogInitialized = true;
            }

            // Format similar to sse-debug.log
            const logEntry = [
              `event: ${eventType}`,
              `data: ${JSON.stringify(event)}`,
              `when: ${new Date().toISOString()}`,
              '', // blank line separator
            ].join('\n');

            await fs.appendFile(this.config.debugLogPath!, `${logEntry}\n`);
          } catch (error) {
            // Log error but don't disrupt the stream
            this.logger.warn({ error, eventType }, 'Failed to write debug log');
          }
        })
      );
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
        stream_options: { include_usage: true },
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
                this.logger.warn({ error, line }, 'Failed to parse SSE chunk');
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

// Note: callAsync and transformResponse methods removed as we now use streaming only
// These can be added back if non-streaming support is needed in the future

/**
 * REMOVED METHODS (for reference if non-streaming is needed later):
 *
 */

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
  novaLite(baseUrl: string, apiKey?: string, debugLogPath?: string): LiteLLMProvider {
    return new LiteLLMProvider({
      baseUrl,
      model: 'amazon.nova-lite-v1:0',
      apiKey,
      temperature: 0.7,
      maxTokens: 8192,
      debugLogPath,
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
