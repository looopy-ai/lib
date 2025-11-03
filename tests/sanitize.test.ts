/**
 * Tests for LLM Response Sanitization
 */

import { describe, expect, it } from 'vitest';
import type { LLMResponse } from '../src/core';
import { sanitizeLLMResponse, validateLLMResponse } from '../src/core';

describe('LLM Response Sanitization', () => {
  describe('sanitizeLLMResponse', () => {
    it('should trim whitespace from message content', () => {
      const response: LLMResponse = {
        message: {
          role: 'assistant',
          content: '  Hello World  \n\n',
        },
        finishReason: 'stop',
        finished: true,
      };

      const sanitized = sanitizeLLMResponse(response);

      expect(sanitized.message.content).toBe('Hello World');
    });

    it('should clear whitespace-only content when tool calls are present', () => {
      const response: LLMResponse = {
        message: {
          role: 'assistant',
          content: '  \n  \n  ',
        },
        toolCalls: [
          {
            id: 'call_1',
            type: 'function',
            function: {
              name: 'get_weather',
              arguments: { location: 'SF' },
            },
          },
        ],
        finishReason: 'stop',
        finished: true,
      };

      const sanitized = sanitizeLLMResponse(response);

      expect(sanitized.message.content).toBe('');
      expect(sanitized.toolCalls).toHaveLength(1);
    });

    it('should filter out invalid tool calls', () => {
      const response: LLMResponse = {
        message: {
          role: 'assistant',
          content: 'Using tools',
        },
        toolCalls: [
          {
            id: 'call_1',
            type: 'function',
            function: {
              name: 'valid_tool',
              arguments: { arg: 'value' },
            },
          },
          {
            id: '',
            type: 'function',
            function: {
              name: 'invalid_no_id',
              arguments: {},
            },
          },
          {
            id: 'call_3',
            type: 'function',
            function: {
              name: '',
              arguments: {},
            },
          },
        ],
        finishReason: 'tool_calls',
        finished: false,
      };

      const sanitized = sanitizeLLMResponse(response);

      expect(sanitized.toolCalls).toHaveLength(1);
      expect(sanitized.toolCalls?.[0].id).toBe('call_1');
    });

    it('should set finish reason to tool_calls when tool calls are present', () => {
      const response: LLMResponse = {
        message: {
          role: 'assistant',
          content: '',
        },
        toolCalls: [
          {
            id: 'call_1',
            type: 'function',
            function: {
              name: 'get_weather',
              arguments: { location: 'SF' },
            },
          },
        ],
        finishReason: 'stop',
        finished: true,
      };

      const sanitized = sanitizeLLMResponse(response);

      expect(sanitized.finishReason).toBe('tool_calls');
      expect(sanitized.finished).toBe(false);
    });

    it('should add tool calls to message if not present', () => {
      const response: LLMResponse = {
        message: {
          role: 'assistant',
          content: '',
        },
        toolCalls: [
          {
            id: 'call_1',
            type: 'function',
            function: {
              name: 'test',
              arguments: {},
            },
          },
        ],
        finishReason: 'tool_calls',
        finished: false,
      };

      const sanitized = sanitizeLLMResponse(response);

      expect(sanitized.message.toolCalls).toBeDefined();
      expect(sanitized.message.toolCalls).toHaveLength(1);
    });

    it('should handle responses with no tool calls', () => {
      const response: LLMResponse = {
        message: {
          role: 'assistant',
          content: 'Hello!',
        },
        finishReason: 'stop',
        finished: true,
      };

      const sanitized = sanitizeLLMResponse(response);

      expect(sanitized.message.content).toBe('Hello!');
      expect(sanitized.finishReason).toBe('stop');
      expect(sanitized.finished).toBe(true);
      expect(sanitized.toolCalls).toBeUndefined();
    });

    it('should handle tool calls with invalid arguments', () => {
      const response: LLMResponse = {
        message: {
          role: 'assistant',
          content: '',
        },
        toolCalls: [
          {
            id: 'call_1',
            type: 'function',
            function: {
              name: 'test',
              arguments: null as unknown as Record<string, unknown>,
            },
          },
        ],
        finishReason: 'tool_calls',
        finished: false,
      };

      const sanitized = sanitizeLLMResponse(response);

      expect(sanitized.toolCalls).toHaveLength(1);
      expect(sanitized.toolCalls?.[0].function.arguments).toEqual({});
    });
  });

  describe('validateLLMResponse', () => {
    it('should validate correct responses', () => {
      const response: LLMResponse = {
        message: {
          role: 'assistant',
          content: 'Hello!',
        },
        finishReason: 'stop',
        finished: true,
      };

      expect(validateLLMResponse(response)).toBe(true);
    });

    it('should reject responses without message', () => {
      const response = {
        finishReason: 'stop',
        finished: true,
      } as LLMResponse;

      expect(validateLLMResponse(response)).toBe(false);
    });

    it('should reject responses without finish reason', () => {
      const response = {
        message: {
          role: 'assistant',
          content: 'Hello!',
        },
        finished: true,
      } as LLMResponse;

      expect(validateLLMResponse(response)).toBe(false);
    });

    it('should validate responses with valid tool calls', () => {
      const response: LLMResponse = {
        message: {
          role: 'assistant',
          content: '',
        },
        toolCalls: [
          {
            id: 'call_1',
            type: 'function',
            function: {
              name: 'test',
              arguments: {},
            },
          },
        ],
        finishReason: 'tool_calls',
        finished: false,
      };

      expect(validateLLMResponse(response)).toBe(true);
    });

    it('should reject responses with all invalid tool calls', () => {
      const response: LLMResponse = {
        message: {
          role: 'assistant',
          content: '',
        },
        toolCalls: [
          {
            id: '',
            type: 'function',
            function: {
              name: '',
              arguments: {},
            },
          },
        ],
        finishReason: 'tool_calls',
        finished: false,
      };

      expect(validateLLMResponse(response)).toBe(false);
    });
  });
});
