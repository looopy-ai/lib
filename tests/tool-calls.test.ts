/**
 * Tests for streaming operators
 */

import { firstValueFrom, from, lastValueFrom, toArray } from 'rxjs';
import { describe, expect, it } from 'vitest';
import { assembleToolCalls } from '../src/core/operators/chat-completions/tool-calls';

type ToolCallFragment = {
  index: number;
  id?: string | null;
  function?: {
    name?: string;
    arguments?: string;
  };
  type?: 'function';
};

describe('assembleToolCalls', () => {
  describe('basic assembly', () => {
    it('should assemble a single complete tool call from fragments', async () => {
      const fragments: ToolCallFragment[] = [
        { index: 0, id: 'call_1' },
        { index: 0, function: { name: 'get_weather' } },
        { index: 0, function: { arguments: '{"location": ' } },
        { index: 0, function: { arguments: '"San Francisco"}' } },
      ];

      const result = await lastValueFrom(from(fragments).pipe(assembleToolCalls(), toArray()));

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        index: 0,
        id: 'call_1',
        function: {
          name: 'get_weather',
          arguments: '{"location": "San Francisco"}',
        },
        type: 'function',
      });
    });

    it('should assemble tool call with null id', async () => {
      const fragments: ToolCallFragment[] = [
        { index: 0, id: null },
        { index: 0, function: { name: 'search' } },
        { index: 0, function: { arguments: '{"query": "test"}' } },
      ];

      const result = await lastValueFrom(from(fragments).pipe(assembleToolCalls(), toArray()));

      expect(result).toHaveLength(1);
      expect(result[0].id).toBeNull();
      expect(result[0].function.name).toBe('search');
    });

    it('should handle single fragment with all data', async () => {
      const fragments: ToolCallFragment[] = [
        {
          index: 0,
          id: 'call_1',
          function: {
            name: 'calculate',
            arguments: '{"operation": "add", "numbers": [1, 2, 3]}',
          },
        },
      ];

      const result = await lastValueFrom(from(fragments).pipe(assembleToolCalls(), toArray()));

      expect(result).toHaveLength(1);
      expect(result[0].function.arguments).toBe('{"operation": "add", "numbers": [1, 2, 3]}');
    });
  });

  describe('multiple tool calls', () => {
    it('should assemble multiple tool calls with different indices', async () => {
      const fragments: ToolCallFragment[] = [
        { index: 0, id: 'call_1', function: { name: 'get_weather' } },
        { index: 1, id: 'call_2', function: { name: 'search' } },
        { index: 0, function: { arguments: '{"location": "NYC"}' } },
        { index: 1, function: { arguments: '{"query": "test"}' } },
      ];

      const result = await lastValueFrom(from(fragments).pipe(assembleToolCalls(), toArray()));

      expect(result).toHaveLength(2);

      const call0 = result.find((r) => r.index === 0);
      const call1 = result.find((r) => r.index === 1);

      expect(call0?.function.name).toBe('get_weather');
      expect(call0?.function.arguments).toBe('{"location": "NYC"}');

      expect(call1?.function.name).toBe('search');
      expect(call1?.function.arguments).toBe('{"query": "test"}');
    });

    it('should handle interleaved fragments from multiple tool calls', async () => {
      const fragments: ToolCallFragment[] = [
        { index: 0, id: 'call_1' },
        { index: 1, id: 'call_2' },
        { index: 0, function: { name: 'tool_a' } },
        { index: 1, function: { name: 'tool_b' } },
        { index: 0, function: { arguments: '{"key":' } },
        { index: 1, function: { arguments: '{"value":' } },
        { index: 0, function: { arguments: ' "a"}' } },
        { index: 1, function: { arguments: ' "b"}' } },
      ];

      const result = await lastValueFrom(from(fragments).pipe(assembleToolCalls(), toArray()));

      expect(result).toHaveLength(2);

      const call0 = result.find((r) => r.index === 0);
      const call1 = result.find((r) => r.index === 1);

      expect(call0?.function.arguments).toBe('{"key": "a"}');
      expect(call1?.function.arguments).toBe('{"value": "b"}');
    });
  });

  describe('JSON validation', () => {
    it('should not emit until JSON is complete and valid', async () => {
      const fragments: ToolCallFragment[] = [
        { index: 0, id: 'call_1', function: { name: 'test' } },
        { index: 0, function: { arguments: '{"incomplete":' } },
      ];

      const result = await lastValueFrom(from(fragments).pipe(assembleToolCalls(), toArray()));

      // Should not emit because JSON is incomplete
      expect(result).toHaveLength(0);
    });

    it('should emit on completion when JSON becomes valid', async () => {
      const fragments: ToolCallFragment[] = [
        { index: 0, id: 'call_1', function: { name: 'test' } },
        { index: 0, function: { arguments: '{"key":' } },
        { index: 0, function: { arguments: ' "value"}' } },
      ];

      const result = await lastValueFrom(from(fragments).pipe(assembleToolCalls(), toArray()));

      expect(result).toHaveLength(1);
      expect(result[0].function.arguments).toBe('{"key": "value"}');
    });

    it('should handle array arguments', async () => {
      const fragments: ToolCallFragment[] = [
        { index: 0, id: 'call_1', function: { name: 'batch' } },
        { index: 0, function: { arguments: '[1, 2,' } },
        { index: 0, function: { arguments: ' 3]' } },
      ];

      const result = await lastValueFrom(from(fragments).pipe(assembleToolCalls(), toArray()));

      expect(result).toHaveLength(1);
      expect(result[0].function.arguments).toBe('[1, 2, 3]');
      expect(() => JSON.parse(result[0].function.arguments)).not.toThrow();
    });

    it('should handle empty object arguments', async () => {
      const fragments: ToolCallFragment[] = [
        { index: 0, id: 'call_1', function: { name: 'no_args' } },
        { index: 0, function: { arguments: '{}' } },
      ];

      const result = await lastValueFrom(from(fragments).pipe(assembleToolCalls(), toArray()));

      expect(result).toHaveLength(1);
      expect(result[0].function.arguments).toBe('{}');
    });

    it('should handle whitespace in JSON', async () => {
      const fragments: ToolCallFragment[] = [
        { index: 0, id: 'call_1', function: { name: 'test' } },
        { index: 0, function: { arguments: '  {"key":  "value"}  ' } },
      ];

      const result = await lastValueFrom(from(fragments).pipe(assembleToolCalls(), toArray()));

      expect(result).toHaveLength(1);
      expect(() => JSON.parse(result[0].function.arguments.trim())).not.toThrow();
    });
  });

  describe('edge cases', () => {
    it('should not emit if name is missing', async () => {
      const fragments: ToolCallFragment[] = [
        { index: 0, id: 'call_1' },
        { index: 0, function: { arguments: '{"key": "value"}' } },
        // name never provided
      ];

      const result = await lastValueFrom(from(fragments).pipe(assembleToolCalls(), toArray()));

      expect(result).toHaveLength(0);
    });

    it('should handle empty arguments string', async () => {
      const fragments: ToolCallFragment[] = [
        { index: 0, id: 'call_1', function: { name: 'test' } },
        { index: 0, function: { arguments: '' } },
      ];

      const result = await lastValueFrom(from(fragments).pipe(assembleToolCalls(), toArray()));

      // Empty string is not valid JSON
      expect(result).toHaveLength(0);
    });

    it('should not emit duplicate tool calls', async () => {
      const fragments: ToolCallFragment[] = [
        { index: 0, id: 'call_1', function: { name: 'test' } },
        { index: 0, function: { arguments: '{"key": "value"}' } },
        // Try to emit again with more fragments
        { index: 0, function: { arguments: '' } },
      ];

      const result = await lastValueFrom(from(fragments).pipe(assembleToolCalls(), toArray()));

      // Should only emit once
      expect(result).toHaveLength(1);
    });

    it('should handle id being set after name', async () => {
      const fragments: ToolCallFragment[] = [
        { index: 0, function: { name: 'test' } },
        { index: 0, id: 'call_1' },
        { index: 0, function: { arguments: '{"key": "value"}' } },
      ];

      const result = await lastValueFrom(from(fragments).pipe(assembleToolCalls(), toArray()));

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('call_1');
    });

    it('should handle empty stream', async () => {
      const fragments: ToolCallFragment[] = [];

      const result = await lastValueFrom(from(fragments).pipe(assembleToolCalls(), toArray()));

      expect(result).toHaveLength(0);
    });
  });

  describe('completion flushing', () => {
    it('should flush complete buffered tool calls on completion', async () => {
      const fragments: ToolCallFragment[] = [
        { index: 0, id: 'call_1', function: { name: 'test1' } },
        { index: 1, id: 'call_2', function: { name: 'test2' } },
        { index: 0, function: { arguments: '{"a": 1}' } },
        { index: 1, function: { arguments: '{"b": 2}' } },
      ];

      const result = await lastValueFrom(from(fragments).pipe(assembleToolCalls(), toArray()));

      // Both should be flushed on completion
      expect(result).toHaveLength(2);
    });

    it('should not flush incomplete tool calls on completion', async () => {
      const fragments: ToolCallFragment[] = [
        { index: 0, id: 'call_1', function: { name: 'test1' } },
        { index: 0, function: { arguments: '{"incomplete":' } },
        { index: 1, id: 'call_2', function: { name: 'test2' } },
        { index: 1, function: { arguments: '{"complete": true}' } },
      ];

      const result = await lastValueFrom(from(fragments).pipe(assembleToolCalls(), toArray()));

      // Only index 1 should be emitted
      expect(result).toHaveLength(1);
      expect(result[0].index).toBe(1);
    });

    it('should flush tool calls that become valid at the end', async () => {
      const fragments: ToolCallFragment[] = [
        { index: 0, id: 'call_1', function: { name: 'test' } },
        { index: 0, function: { arguments: '{"key":' } },
        { index: 0, function: { arguments: ' "value"}' } },
      ];

      const result = await lastValueFrom(from(fragments).pipe(assembleToolCalls(), toArray()));

      // Should be flushed on completion even though it wasn't emitted during streaming
      expect(result).toHaveLength(1);
    });
  });

  describe('complex JSON structures', () => {
    it('should handle nested objects', async () => {
      const fragments: ToolCallFragment[] = [
        { index: 0, id: 'call_1', function: { name: 'complex' } },
        { index: 0, function: { arguments: '{"nested": {' } },
        { index: 0, function: { arguments: '"deep": {"value": 42}' } },
        { index: 0, function: { arguments: '}}' } },
      ];

      const result = await lastValueFrom(from(fragments).pipe(assembleToolCalls(), toArray()));

      expect(result).toHaveLength(1);
      const parsed = JSON.parse(result[0].function.arguments);
      expect(parsed.nested.deep.value).toBe(42);
    });

    it('should handle arrays of objects', async () => {
      const fragments: ToolCallFragment[] = [
        { index: 0, id: 'call_1', function: { name: 'batch' } },
        { index: 0, function: { arguments: '[{"id": 1}, ' } },
        { index: 0, function: { arguments: '{"id": 2}]' } },
      ];

      const result = await lastValueFrom(from(fragments).pipe(assembleToolCalls(), toArray()));

      expect(result).toHaveLength(1);
      const parsed = JSON.parse(result[0].function.arguments);
      expect(parsed).toHaveLength(2);
      expect(parsed[0].id).toBe(1);
      expect(parsed[1].id).toBe(2);
    });

    it('should handle strings with special characters', async () => {
      const fragments: ToolCallFragment[] = [
        { index: 0, id: 'call_1', function: { name: 'test' } },
        { index: 0, function: { arguments: '{"text": "Hello\\nWorld\\t' } },
        { index: 0, function: { arguments: 'with \\"quotes\\""}' } },
      ];

      const result = await lastValueFrom(from(fragments).pipe(assembleToolCalls(), toArray()));

      expect(result).toHaveLength(1);
      const parsed = JSON.parse(result[0].function.arguments);
      // After parsing, escape sequences are converted to actual characters
      expect(parsed.text).toContain('\n');
      expect(parsed.text).toContain('"');
    });
  });

  describe('error handling', () => {
    it('should propagate source errors', async () => {
      const source = from(
        (async function* () {
          yield { index: 0, id: 'call_1', function: { name: 'test' } } as ToolCallFragment;
          throw new Error('Stream error');
        })()
      );

      await expect(lastValueFrom(source.pipe(assembleToolCalls(), toArray()))).rejects.toThrow(
        'Stream error'
      );
    });

    it('should handle early unsubscription', async () => {
      const fragments: ToolCallFragment[] = [
        { index: 0, id: 'call_1', function: { name: 'test' } },
        { index: 0, function: { arguments: '{"key": "value"}' } },
      ];

      const result = await firstValueFrom(from(fragments).pipe(assembleToolCalls()));

      // Should get the first emitted tool call
      expect(result.index).toBe(0);
      expect(result.function.name).toBe('test');
    });
  });

  describe('real-world scenarios', () => {
    it('should handle typical OpenAI streaming pattern', async () => {
      const fragments: ToolCallFragment[] = [
        { index: 0, id: 'call_abc123', type: 'function' },
        { index: 0, function: { name: 'get_current_weather' } },
        { index: 0, function: { arguments: '' } },
        { index: 0, function: { arguments: '{' } },
        { index: 0, function: { arguments: '"' } },
        { index: 0, function: { arguments: 'location' } },
        { index: 0, function: { arguments: '": "' } },
        { index: 0, function: { arguments: 'San' } },
        { index: 0, function: { arguments: ' Francisco' } },
        { index: 0, function: { arguments: ', CA' } },
        { index: 0, function: { arguments: '"' } },
        { index: 0, function: { arguments: '}' } },
      ];

      const result = await lastValueFrom(from(fragments).pipe(assembleToolCalls(), toArray()));

      expect(result).toHaveLength(1);
      const parsed = JSON.parse(result[0].function.arguments);
      expect(parsed.location).toBe('San Francisco, CA');
    });

    it('should handle multiple parallel tool calls', async () => {
      const fragments: ToolCallFragment[] = [
        { index: 0, id: 'call_1', function: { name: 'get_weather' } },
        { index: 1, id: 'call_2', function: { name: 'get_time' } },
        { index: 2, id: 'call_3', function: { name: 'search' } },
        { index: 0, function: { arguments: '{"city": "NYC"}' } },
        { index: 1, function: { arguments: '{"timezone": "EST"}' } },
        { index: 2, function: { arguments: '{"query": "weather"}' } },
      ];

      const result = await lastValueFrom(from(fragments).pipe(assembleToolCalls(), toArray()));

      expect(result).toHaveLength(3);
      expect(result.map((r) => r.function.name)).toContain('get_weather');
      expect(result.map((r) => r.function.name)).toContain('get_time');
      expect(result.map((r) => r.function.name)).toContain('search');
    });
  });
});
