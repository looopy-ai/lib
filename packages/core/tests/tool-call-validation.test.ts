import { describe, expect, it } from 'vitest';
import { safeValidateToolCall, validateToolCall } from '../src/types/tools';

describe('Tool Call Validation', () => {
  describe('validateToolCall', () => {
    it('should accept valid tool names with alphanumeric characters', () => {
      const toolCall = {
        id: 'call-123',
        type: 'function' as const,
        function: {
          name: 'my_tool_123',
          arguments: { key: 'value' },
        },
      };

      const result = validateToolCall(toolCall);
      expect(result).toEqual(toolCall);
    });

    it('should accept tool names with hyphens', () => {
      const toolCall = {
        id: 'call-123',
        type: 'function' as const,
        function: {
          name: 'my-tool-name',
          arguments: {},
        },
      };

      const result = validateToolCall(toolCall);
      expect(result).toEqual(toolCall);
    });

    it('should accept tool names with underscores', () => {
      const toolCall = {
        id: 'call-123',
        type: 'function' as const,
        function: {
          name: 'my_tool_name',
          arguments: {},
        },
      };

      const result = validateToolCall(toolCall);
      expect(result).toEqual(toolCall);
    });

    it('should throw error for tool names with spaces', () => {
      const toolCall = {
        id: 'call-123',
        type: 'function' as const,
        function: {
          name: 'my tool',
          arguments: {},
        },
      };

      expect(() => validateToolCall(toolCall)).toThrow();
    });

    it('should throw error for tool names with special characters', () => {
      const toolCall = {
        id: 'call-123',
        type: 'function' as const,
        function: {
          name: 'my@tool',
          arguments: {},
        },
      };

      expect(() => validateToolCall(toolCall)).toThrow();
    });

    it('should throw error for tool names with dots', () => {
      const toolCall = {
        id: 'call-123',
        type: 'function' as const,
        function: {
          name: 'my.tool',
          arguments: {},
        },
      };

      expect(() => validateToolCall(toolCall)).toThrow();
    });

    it('should throw error for tool names with slashes', () => {
      const toolCall = {
        id: 'call-123',
        type: 'function' as const,
        function: {
          name: 'my/tool',
          arguments: {},
        },
      };

      expect(() => validateToolCall(toolCall)).toThrow();
    });
  });

  describe('safeValidateToolCall', () => {
    it('should return success for valid tool names', () => {
      const toolCall = {
        id: 'call-123',
        type: 'function' as const,
        function: {
          name: 'valid_tool-name_123',
          arguments: { key: 'value' },
        },
      };

      const result = safeValidateToolCall(toolCall);
      expect(result.success).toBe(true);
      expect(result.data).toEqual(toolCall);
    });

    it('should return error details for invalid tool names with spaces', () => {
      const toolCall = {
        id: 'call-123',
        type: 'function' as const,
        function: {
          name: 'invalid tool',
          arguments: {},
        },
      };

      const result = safeValidateToolCall(toolCall);
      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors?.[0].message).toContain('alphanumeric');
    });

    it('should return error details for invalid tool names with special characters', () => {
      const toolCall = {
        id: 'call-123',
        type: 'function' as const,
        function: {
          name: 'tool$name',
          arguments: {},
        },
      };

      const result = safeValidateToolCall(toolCall);
      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
    });

    it('should return error details for invalid tool names with brackets', () => {
      const toolCall = {
        id: 'call-123',
        type: 'function' as const,
        function: {
          name: 'tool[name]',
          arguments: {},
        },
      };

      const result = safeValidateToolCall(toolCall);
      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
    });
  });
});
