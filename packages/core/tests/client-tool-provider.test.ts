/**
 * Client Tool Provider Tests
 */

import { context } from '@opentelemetry/api';
import { lastValueFrom, toArray } from 'rxjs';
import { describe, expect, it } from 'vitest';
import { ClientToolProvider } from '../src/tools/client-tool-provider';
import type { ExecutionContext } from '../src/types/context';
import type { ToolCall, ToolResult } from '../src/types/tools';

describe('ClientToolProvider', () => {
  const mockContext: ExecutionContext = {
    taskId: 'task-123',
    contextId: 'ctx-456',
    agentId: 'agent-1',
    parentContext: context.active(),
  };

  const validTools = [
    {
      name: 'get_weather',
      description: 'Get weather for a location',
      parameters: {
        type: 'object' as const,
        properties: {
          location: {
            type: 'string' as const,
            description: 'City name',
          },
          units: {
            type: 'string' as const,
            description: 'Temperature units',
            enum: ['celsius', 'fahrenheit'],
          },
        },
        required: ['location'],
      },
    },
    {
      name: 'calculate',
      description: 'Perform a calculation',
      parameters: {
        type: 'object' as const,
        properties: {
          expression: {
            type: 'string' as const,
            description: 'Math expression',
          },
          precision: {
            type: 'integer' as const,
            description: 'Decimal places',
            minimum: 0,
            maximum: 10,
          },
        },
        required: ['expression'],
      },
    },
  ];

  const mockOnInputRequired = async (
    toolCall: ToolCall,
    _context: ExecutionContext,
  ): Promise<ToolResult> => {
    return {
      toolCallId: toolCall.id,
      toolName: toolCall.function.name,
      success: true,
      result: { mock: 'result' },
    };
  };

  describe('constructor', () => {
    it('should create provider with valid tools', () => {
      const provider = new ClientToolProvider({
        tools: validTools,
        onInputRequired: mockOnInputRequired,
      });

      expect(provider).toBeDefined();
    });

    it('should reject invalid tool definitions', () => {
      const invalidTools = [
        {
          type: 'function',
          function: {
            name: '', // Empty name
            description: 'Test',
            parameters: {
              type: 'object',
              properties: {},
            },
          },
        },
      ];

      expect(() => {
        new ClientToolProvider({
          tools: invalidTools,
          onInputRequired: mockOnInputRequired,
        });
      }).toThrow('Invalid client tool definitions');
    });

    it('should reject tools with invalid names', () => {
      const invalidTools = [
        {
          type: 'function',
          function: {
            name: 'invalid name!', // Contains invalid characters
            description: 'Test',
            parameters: {
              type: 'object',
              properties: {},
            },
          },
        },
      ];

      expect(() => {
        new ClientToolProvider({
          tools: invalidTools,
          onInputRequired: mockOnInputRequired,
        });
      }).toThrow();
    });

    it('should reject duplicate tool names', () => {
      const duplicateTools = [
        ...validTools,
        validTools[0], // Duplicate
      ];

      expect(() => {
        new ClientToolProvider({
          tools: duplicateTools,
          onInputRequired: mockOnInputRequired,
        });
      }).toThrow('Duplicate tool names');
    });

    it('should accept tools with names containing hyphens and underscores', () => {
      const toolsWithSpecialChars = [
        {
          name: 'my-tool_name-123',
          description: 'Test tool',
          parameters: {
            type: 'object' as const,
            properties: {},
          },
        },
      ];

      const provider = new ClientToolProvider({
        tools: toolsWithSpecialChars,
        onInputRequired: mockOnInputRequired,
      });

      expect(provider).toBeDefined();
    });
  });

  describe('getTools', () => {
    it('should return all tools', async () => {
      const provider = new ClientToolProvider({
        tools: validTools,
        onInputRequired: mockOnInputRequired,
      });

      const tools = await provider.getTools();
      expect(tools).toHaveLength(2);
      expect(tools[0].name).toBe('get_weather');
      expect(tools[1].name).toBe('calculate');
    });

    it('should return a copy of tools array', async () => {
      const provider = new ClientToolProvider({
        tools: validTools,
        onInputRequired: mockOnInputRequired,
      });

      const tools1 = await provider.getTools();
      const tools2 = await provider.getTools();

      expect(tools1).not.toBe(tools2);
      expect(tools1).toEqual(tools2);
    });
  });

  describe('execute', () => {
    it('should execute valid tool call', async () => {
      const provider = new ClientToolProvider({
        tools: validTools,
        onInputRequired: mockOnInputRequired,
      });

      const toolCall: ToolCall = {
        id: 'call-1',
        type: 'function',
        function: {
          name: 'get_weather',
          arguments: { location: 'San Francisco' },
        },
      };

      const events = await lastValueFrom(provider.execute(toolCall, mockContext).pipe(toArray()));
      const result = events[0];

      expect(result).toBeDefined();
      expect(result.kind).toBe('tool-complete');
      if (result.kind !== 'tool-complete') return;

      expect(result.success).toBe(true);
      expect(result.toolCallId).toBe('call-1');
      expect(result.toolName).toBe('get_weather');
    });

    it('should return error for unknown tool', async () => {
      const provider = new ClientToolProvider({
        tools: validTools,
        onInputRequired: mockOnInputRequired,
      });

      const toolCall: ToolCall = {
        id: 'call-1',
        type: 'function',
        function: {
          name: 'unknown_tool',
          arguments: {},
        },
      };

      const events = await lastValueFrom(provider.execute(toolCall, mockContext).pipe(toArray()));
      const result = events[0];

      expect(result).toBeDefined();
      expect(result.kind).toBe('tool-complete');
      if (result.kind !== 'tool-complete') return;

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should return error for invalid JSON arguments', async () => {
      const provider = new ClientToolProvider({
        tools: validTools,
        onInputRequired: mockOnInputRequired,
      });

      const toolCall: ToolCall = {
        id: 'call-1',
        type: 'function',
        function: {
          name: 'get_weather',
          // biome-ignore lint/suspicious/noExplicitAny: simulate invalid for testing
          arguments: null as any, // simulate invalid
        },
      };

      const events = await lastValueFrom(provider.execute(toolCall, mockContext).pipe(toArray()));
      const result = events[0];

      expect(result).toBeDefined();
      expect(result.kind).toBe('tool-complete');
      if (result.kind !== 'tool-complete') return;

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid tool arguments: must be an object.');
    });

    it('should handle callback errors gracefully', async () => {
      const errorCallback = async () => {
        throw new Error('Client execution failed');
      };

      const provider = new ClientToolProvider({
        tools: validTools,
        onInputRequired: errorCallback, // Use error callback
      });

      const toolCall: ToolCall = {
        id: 'call-1',
        type: 'function',
        function: {
          name: 'get_weather',
          arguments: { location: 'San Francisco' },
        },
      };

      const events = await lastValueFrom(provider.execute(toolCall, mockContext).pipe(toArray()));
      const result = events[0];

      expect(result).toBeDefined();
      expect(result.kind).toBe('tool-complete');
      if (result.kind !== 'tool-complete') return;

      expect(result.success).toBe(false);
      expect(result.error).toBe('Client execution failed');
    });

    it('should return tool definition by name', async () => {
      const provider = new ClientToolProvider({
        tools: validTools,
        onInputRequired: mockOnInputRequired,
      });

      const tool = await provider.getTool('get_weather');
      expect(tool).toBeDefined();
      expect(tool?.name).toBe('get_weather');
    });

    it('should return undefined for unknown tool', async () => {
      const provider = new ClientToolProvider({
        tools: validTools,
        onInputRequired: mockOnInputRequired,
      });

      const tool = await provider.getTool('unknown');
      expect(tool).toBeUndefined();
    });
  });

  describe('validateToolArguments', () => {
    const provider = new ClientToolProvider({
      tools: validTools,
      onInputRequired: mockOnInputRequired,
    });

    it('should validate correct arguments', async () => {
      const toolCall: ToolCall = {
        id: 'call-1',
        type: 'function',
        function: {
          name: 'get_weather',
          arguments: { location: 'San Francisco', units: 'celsius' },
        },
      };

      const result = await provider.validateToolArguments(toolCall);
      expect(result.valid).toBe(true);
      expect(result.errors).toBeUndefined();
    });

    it('should detect missing required parameters', async () => {
      const toolCall: ToolCall = {
        id: 'call-1',
        type: 'function',
        function: {
          name: 'get_weather',
          arguments: { units: 'celsius' }, // Missing location
        },
      };

      const result = await provider.validateToolArguments(toolCall);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing required parameter: location');
    });

    it('should detect wrong parameter types', async () => {
      const toolCall: ToolCall = {
        id: 'call-1',
        type: 'function',
        function: {
          name: 'get_weather',
          arguments: { location: 123 }, // Should be string
        },
      };

      const result = await provider.validateToolArguments(toolCall);
      expect(result.valid).toBe(false);
    });

    it('should validate integer type correctly', async () => {
      const toolCall: ToolCall = {
        id: 'call-1',
        type: 'function',
        function: {
          name: 'calculate',
          arguments: { expression: '2+2', precision: 2 },
        },
      };

      const result = await provider.validateToolArguments(toolCall);
      expect(result.valid).toBe(true);
    });

    it('should detect wrong integer values', async () => {
      const toolCall: ToolCall = {
        id: 'call-1',
        type: 'function',
        function: {
          name: 'calculate',
          arguments: { expression: '2+2', precision: 2.5 }, // Should be integer
        },
      };

      const result = await provider.validateToolArguments(toolCall);
      expect(result.valid).toBe(false);
      expect(result.errors?.some((e) => e.includes('must be an integer'))).toBe(true);
    });

    it('should return error for unknown tool', async () => {
      const toolCall: ToolCall = {
        id: 'call-1',
        type: 'function',
        function: {
          name: 'unknown_tool',
          arguments: {},
        },
      };

      const result = await provider.validateToolArguments(toolCall);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Tool unknown_tool not found');
    });

    it('should return error for invalid JSON', async () => {
      const toolCall: ToolCall = {
        id: 'call-1',
        type: 'function',
        function: {
          name: 'get_weather',
          // biome-ignore lint/suspicious/noExplicitAny: simulate invalid for testing
          arguments: null as any,
        },
      };

      const result = await provider.validateToolArguments(toolCall);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Arguments are not valid: must be an object.');
    });

    it('should allow additional properties by default', async () => {
      const toolCall: ToolCall = {
        id: 'call-1',
        type: 'function',
        function: {
          name: 'get_weather',
          arguments: { location: 'San Francisco', extra: 'property' }, // Not in schema
        },
      };

      const result = await provider.validateToolArguments(toolCall);
      expect(result.valid).toBe(true);
    });

    it('should reject additional properties when additionalProperties is false', async () => {
      const strictTools = [
        {
          name: 'strict_tool',
          description: 'Strict tool',
          parameters: {
            type: 'object' as const,
            properties: {
              name: { type: 'string' as const },
            },
            required: ['name'],
            additionalProperties: false,
          },
        },
      ];

      const strictProvider = new ClientToolProvider({
        tools: strictTools,
        onInputRequired: mockOnInputRequired,
      });

      const toolCall: ToolCall = {
        id: 'call-1',
        type: 'function',
        function: {
          name: 'strict_tool',
          arguments: { name: 'test', extra: 'property' },
        },
      };

      const result = await strictProvider.validateToolArguments(toolCall);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Unknown parameter: extra');
    });
  });
});
