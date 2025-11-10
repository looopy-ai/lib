import { from, toArray } from 'rxjs';
import { describe, expect, it } from 'vitest';
import { aggregateChoice } from '../src/core/operators/chat-completions/aggregate';
import type { Choice } from '../src/core/operators/chat-completions/types';

describe('aggregateChoice', () => {
  it('should aggregate content chunks into a single Choice', async () => {
    const chunks: Choice[] = [
      {
        index: 0,
        delta: { content: 'Hello' },
        finish_reason: null,
      },
      {
        index: 0,
        delta: { content: ' world' },
        finish_reason: null,
      },
      {
        index: 0,
        delta: { content: '!' },
        finish_reason: 'stop',
      },
    ];

    const result = await from(chunks).pipe(aggregateChoice(), toArray()).toPromise();

    if (!result) throw new Error('Result is undefined');

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      index: 0,
      delta: {
        content: 'Hello world!',
      },
      finish_reason: 'stop',
    });
  });

  it('should aggregate tool call deltas by index', async () => {
    const chunks: Choice[] = [
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
      {
        index: 0,
        delta: {
          tool_calls: [
            {
              index: 0,
              id: null,
              type: 'function',
              function: { name: '', arguments: '{"location":' },
            },
          ],
        },
        finish_reason: null,
      },
      {
        index: 0,
        delta: {
          tool_calls: [
            {
              index: 0,
              id: null,
              type: 'function',
              function: { name: '', arguments: '"San Francisco"}' },
            },
          ],
        },
        finish_reason: 'tool_calls',
      },
    ];

    const result = await from(chunks).pipe(aggregateChoice(), toArray()).toPromise();

    if (!result) throw new Error('Result is undefined');

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      index: 0,
      delta: {
        tool_calls: [
          {
            index: 0,
            id: 'call_123',
            type: 'function',
            function: {
              name: 'get_weather',
              arguments: '{"location":"San Francisco"}',
            },
          },
        ],
      },
      finish_reason: 'tool_calls',
    });
  });

  it('should handle multiple tool calls with different indices', async () => {
    const chunks: Choice[] = [
      {
        index: 0,
        delta: {
          tool_calls: [
            {
              index: 0,
              id: 'call_1',
              type: 'function',
              function: { name: 'search', arguments: '{"q":"' },
            },
            {
              index: 1,
              id: 'call_2',
              type: 'function',
              function: { name: 'calculate', arguments: '{"expr":"' },
            },
          ],
        },
        finish_reason: null,
      },
      {
        index: 0,
        delta: {
          tool_calls: [
            {
              index: 0,
              id: null,
              type: 'function',
              function: { name: '', arguments: 'test"}' },
            },
            {
              index: 1,
              id: null,
              type: 'function',
              function: { name: '', arguments: '2+2"}' },
            },
          ],
        },
        finish_reason: 'tool_calls',
      },
    ];

    const result = await from(chunks).pipe(aggregateChoice(), toArray()).toPromise();

    if (!result) throw new Error('Result is undefined');

    expect(result).toHaveLength(1);
    expect(result[0].delta?.tool_calls).toHaveLength(2);
    expect(result[0].delta?.tool_calls?.[0]).toEqual({
      index: 0,
      id: 'call_1',
      type: 'function',
      function: {
        name: 'search',
        arguments: '{"q":"test"}',
      },
    });
    expect(result[0].delta?.tool_calls?.[1]).toEqual({
      index: 1,
      id: 'call_2',
      type: 'function',
      function: {
        name: 'calculate',
        arguments: '{"expr":"2+2"}',
      },
    });
  });

  it('should aggregate both content and tool calls', async () => {
    const chunks: Choice[] = [
      {
        index: 0,
        delta: { content: 'Let me ' },
        finish_reason: null,
      },
      {
        index: 0,
        delta: { content: 'check that' },
        finish_reason: null,
      },
      {
        index: 0,
        delta: {
          tool_calls: [
            {
              index: 0,
              id: 'call_x',
              type: 'function',
              function: { name: 'search', arguments: '{}' },
            },
          ],
        },
        finish_reason: 'tool_calls',
      },
    ];

    const result = await from(chunks).pipe(aggregateChoice(), toArray()).toPromise();

    if (!result) throw new Error('Result is undefined');

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      index: 0,
      delta: {
        content: 'Let me check that',
        tool_calls: [
          {
            index: 0,
            id: 'call_x',
            type: 'function',
            function: { name: 'search', arguments: '{}' },
          },
        ],
      },
      finish_reason: 'tool_calls',
    });
  });

  it('should handle empty stream', async () => {
    const result = await from([]).pipe(aggregateChoice<Choice>(), toArray()).toPromise();

    if (!result) throw new Error('Result is undefined');

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({});
  });

  it('should strip inline XML tags from aggregated content and extract thoughts', async () => {
    const chunks: Choice[] = [
      {
        index: 0,
        delta: { content: 'Let me think about this. <thinking>I need to ' },
        finish_reason: null,
      },
      {
        index: 0,
        delta: { content: 'analyze the problem carefully</thinking> The answer is ' },
        finish_reason: null,
      },
      {
        index: 0,
        delta: { content: '42.' },
        finish_reason: 'stop',
      },
    ];

    const result = await from(chunks).pipe(aggregateChoice(), toArray()).toPromise();

    if (!result) throw new Error('Result is undefined');

    expect(result).toHaveLength(1);
    expect(result[0].delta?.content).toBe('Let me think about this.The answer is 42.');
    expect(result[0].thoughts).toEqual([
      {
        name: 'thinking',
        content: 'I need to analyze the problem carefully',
        attributes: {},
      },
    ]);
    expect(result[0].finish_reason).toBe('stop');
  });

  it('should strip self-closing XML tags from aggregated content', async () => {
    const chunks: Choice[] = [
      {
        index: 0,
        delta: { content: 'Processing<thinking />Now complete.' },
        finish_reason: 'stop',
      },
    ];

    const result = await from(chunks).pipe(aggregateChoice(), toArray()).toPromise();

    if (!result) throw new Error('Result is undefined');

    expect(result).toHaveLength(1);
    expect(result[0].delta?.content).toBe('ProcessingNow complete.');
    expect(result[0].thoughts).toEqual([
      {
        name: 'thinking',
        attributes: {},
      },
    ]);
    expect(result[0].finish_reason).toBe('stop');
  });

  it('should handle multiple XML tags in aggregated content', async () => {
    const chunks: Choice[] = [
      {
        index: 0,
        delta: { content: '<thinking>First thought</thinking> Content <thinking>Second thought</thinking>' },
        finish_reason: 'stop',
      },
    ];

    const result = await from(chunks).pipe(aggregateChoice(), toArray()).toPromise();

    if (!result) throw new Error('Result is undefined');

    expect(result).toHaveLength(1);
    expect(result[0].delta?.content).toBe('Content');
    expect(result[0].thoughts).toEqual([
      {
        name: 'thinking',
        content: 'First thought',
        attributes: {},
      },
      {
        name: 'thinking',
        content: 'Second thought',
        attributes: {},
      },
    ]);
    expect(result[0].finish_reason).toBe('stop');
  });
});
