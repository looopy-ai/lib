/**
 * Integration test for LiteLLM provider with new aggregation operators
 */

import { from } from 'rxjs';
import { map } from 'rxjs/operators';
import { describe, expect, it } from 'vitest';
import { aggregateChoice, type Choice } from '../src/core/operators/chat-completions';

describe('LiteLLM Streaming Integration', () => {
  it('should correctly convert and aggregate LiteLLM chunks', async () => {
    // Simulate LiteLLM SSE chunks
    const litellmChunks = [
      {
        id: 'chatcmpl-1',
        created: 1234567890,
        model: 'gpt-4',
        object: 'chat.completion.chunk',
        choices: [
          {
            index: 0,
            delta: { role: 'assistant', content: 'Hello' },
            finish_reason: null,
          },
        ],
      },
      {
        id: 'chatcmpl-1',
        created: 1234567890,
        model: 'gpt-4',
        object: 'chat.completion.chunk',
        choices: [
          {
            index: 0,
            delta: { content: ' world' },
            finish_reason: null,
          },
        ],
      },
      {
        id: 'chatcmpl-1',
        created: 1234567890,
        model: 'gpt-4',
        object: 'chat.completion.chunk',
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: 'stop',
          },
        ],
      },
    ];

    // Convert to Choice format (like in litellm-provider)
    const choices$ = from(litellmChunks).pipe(
      map((chunk): Choice => {
        const litellmChoice = chunk.choices[0];
        const delta = litellmChoice.delta as { content?: string; role?: string };
        return {
          index: litellmChoice.index,
          delta: {
            content: delta.content,
            tool_calls: undefined,
          },
          finish_reason: litellmChoice.finish_reason ?? undefined,
        };
      }),
      aggregateChoice()
    );

    // Collect result
    const result = await new Promise<Choice>((resolve) => {
      choices$.subscribe({
        next: (choice) => resolve(choice),
      });
    });

    // Verify aggregation
    expect(result.delta?.content).toBe('Hello world');
    expect(result.finish_reason).toBe('stop');
    expect(result.index).toBe(0);
  });

  it('should correctly aggregate tool calls', async () => {
    // Simulate LiteLLM SSE chunks with tool calls
    const litellmChunks = [
      {
        id: 'chatcmpl-2',
        created: 1234567890,
        model: 'gpt-4',
        object: 'chat.completion.chunk',
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'call_123',
                  type: 'function',
                  function: { name: 'get_weather', arguments: '' },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      },
      {
        id: 'chatcmpl-2',
        created: 1234567890,
        model: 'gpt-4',
        object: 'chat.completion.chunk',
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  function: { arguments: '{"location"' },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      },
      {
        id: 'chatcmpl-2',
        created: 1234567890,
        model: 'gpt-4',
        object: 'chat.completion.chunk',
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  function: { arguments: ':"SF"}' },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      },
      {
        id: 'chatcmpl-2',
        created: 1234567890,
        model: 'gpt-4',
        object: 'chat.completion.chunk',
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: 'tool_calls',
          },
        ],
      },
    ];

    // Convert to Choice format
    const choices$ = from(litellmChunks).pipe(
      map((chunk): Choice => {
        const litellmChoice = chunk.choices[0];
        const delta = litellmChoice.delta as { tool_calls?: unknown[] };
        return {
          index: litellmChoice.index,
          delta: {
            content: (delta as { content?: string }).content,
            tool_calls: delta.tool_calls?.map((tc: unknown) => {
              const toolCall = tc as {
                index: number;
                id?: string;
                function?: { name?: string; arguments?: string };
              };
              return {
                index: toolCall.index,
                id: toolCall.id ?? null,
                type: 'function' as const,
                function: {
                  name: toolCall.function?.name || '',
                  arguments: toolCall.function?.arguments || '',
                },
              };
            }),
          },
          finish_reason: litellmChoice.finish_reason ?? undefined,
        };
      }),
      aggregateChoice()
    );

    // Collect result
    const result = await new Promise<Choice>((resolve) => {
      choices$.subscribe({
        next: (choice) => resolve(choice),
      });
    });

    // Verify aggregation
    expect(result.delta?.tool_calls).toHaveLength(1);
    expect(result.delta?.tool_calls?.[0].id).toBe('call_123');
    expect(result.delta?.tool_calls?.[0].function?.name).toBe('get_weather');
    expect(result.delta?.tool_calls?.[0].function?.arguments).toBe('{"location":"SF"}');
    expect(result.finish_reason).toBe('tool_calls');
  });
});
