import { evaluate } from 'mathjs';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { ExecutionContext } from '../src/tools/interfaces';
import { localTools, tool } from '../src/tools/local-tools';

describe('local-tools', () => {
  describe('tool()', () => {
    it('should create a tool definition with Zod schema', () => {
      const testTool = tool(
        'test-tool',
        'A test tool',
        z.object({
          input: z.string().describe('Test input'),
        }),
        async ({ input }) => `Processed: ${input}`,
      );

      expect(testTool.name).toBe('test-tool');
      expect(testTool.description).toBe('A test tool');
      expect(testTool.schema).toBeDefined();
      expect(testTool.handler).toBeDefined();
    });

    it('should support complex Zod schemas', () => {
      const complexTool = tool(
        'complex',
        'Complex tool',
        z.object({
          name: z.string().min(1).max(50),
          age: z.number().int().min(0).max(120),
          email: z.string().email(),
          tags: z.array(z.string()).min(1),
          role: z.enum(['admin', 'user', 'guest']),
          metadata: z.object({
            enabled: z.boolean(),
            score: z.number().optional(),
          }),
        }),
        async (params) => params,
      );

      expect(complexTool.name).toBe('complex');
      expect(complexTool.schema).toBeDefined();
    });
  });

  describe('localTools()', () => {
    it('should create a ToolProvider from tool definitions', () => {
      const tool1 = tool(
        'add',
        'Add two numbers',
        z.object({
          a: z.number(),
          b: z.number(),
        }),
        async ({ a, b }) => a + b,
      );

      const tool2 = tool(
        'multiply',
        'Multiply two numbers',
        z.object({
          x: z.number(),
          y: z.number(),
        }),
        async ({ x, y }) => x * y,
      );

      const provider = localTools([tool1, tool2]);

      expect(provider).toBeDefined();
      expect(typeof provider.getTools).toBe('function');
      expect(typeof provider.canHandle).toBe('function');
      expect(typeof provider.execute).toBe('function');
    });

    it('should throw error for duplicate tool names', () => {
      const tool1 = tool('duplicate', 'First', z.object({}), async () => 'first');
      const tool2 = tool('duplicate', 'Second', z.object({}), async () => 'second');

      expect(() => {
        localTools([tool1, tool2]);
      }).toThrow('Duplicate tool name: duplicate');
    });

    describe('getTools()', () => {
      it('should return tool definitions with JSON Schema parameters', async () => {
        const calculatorTool = tool(
          'calculate',
          'Perform calculation',
          z.object({
            expression: z.string().describe('Math expression to evaluate'),
            precision: z.number().int().min(0).max(10).optional(),
          }),
          async ({ expression }) => evaluate(expression),
        );

        const provider = localTools([calculatorTool]);
        const tools = await provider.getTools();

        expect(tools).toHaveLength(1);
        expect(tools[0].name).toBe('calculate');
        expect(tools[0].description).toBe('Perform calculation');
        expect(tools[0].parameters).toEqual({
          type: 'object',
          properties: {
            expression: {
              type: 'string',
              description: 'Math expression to evaluate',
            },
            precision: {
              type: 'integer',
              minimum: 0,
              maximum: 10,
            },
          },
          required: ['expression'],
          additionalProperties: false,
        });
      });

      it('should convert Zod string constraints to JSON Schema', async () => {
        const stringTool = tool(
          'string-test',
          'Test strings',
          z.object({
            name: z.string().min(3).max(20),
            email: z.string().email(),
            url: z.string().url(),
          }),
          async (params) => params,
        );

        const provider = localTools([stringTool]);
        const tools = await provider.getTools();

        expect(tools[0].parameters.properties.name).toEqual({
          type: 'string',
          minLength: 3,
          maxLength: 20,
        });
        expect(tools[0].parameters.properties.email).toMatchObject({
          type: 'string',
          format: 'email',
          // Zod also includes pattern for email validation
        });
        expect(tools[0].parameters.properties.url).toEqual({
          type: 'string',
          format: 'uri',
        });
      });

      it('should convert Zod number constraints to JSON Schema', async () => {
        const numberTool = tool(
          'number-test',
          'Test numbers',
          z.object({
            age: z.number().int().min(0).max(120),
            score: z.number().min(0).max(100),
            multiple: z.number().multipleOf(5),
          }),
          async (params) => params,
        );

        const provider = localTools([numberTool]);
        const tools = await provider.getTools();

        expect(tools[0].parameters.properties.age).toEqual({
          type: 'integer',
          minimum: 0,
          maximum: 120,
        });
        expect(tools[0].parameters.properties.score).toEqual({
          type: 'number',
          minimum: 0,
          maximum: 100,
        });
        expect(tools[0].parameters.properties.multiple).toEqual({
          type: 'number',
          multipleOf: 5,
        });
      });

      it('should convert Zod arrays to JSON Schema', async () => {
        const arrayTool = tool(
          'array-test',
          'Test arrays',
          z.object({
            tags: z.array(z.string()).min(1).max(10),
            numbers: z.array(z.number()),
          }),
          async (params) => params,
        );

        const provider = localTools([arrayTool]);
        const tools = await provider.getTools();

        expect(tools[0].parameters.properties.tags).toEqual({
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
          maxItems: 10,
        });
        expect(tools[0].parameters.properties.numbers).toEqual({
          type: 'array',
          items: { type: 'number' },
        });
      });

      it('should convert Zod enums to JSON Schema', async () => {
        const enumTool = tool(
          'enum-test',
          'Test enums',
          z.object({
            role: z.enum(['admin', 'user', 'guest']),
          }),
          async (params) => params,
        );

        const provider = localTools([enumTool]);
        const tools = await provider.getTools();

        expect(tools[0].parameters.properties.role).toEqual({
          type: 'string',
          enum: ['admin', 'user', 'guest'],
        });
      });

      it('should handle nested objects', async () => {
        const nestedTool = tool(
          'nested-test',
          'Test nested objects',
          z.object({
            user: z.object({
              name: z.string(),
              settings: z.object({
                theme: z.string(),
                notifications: z.boolean(),
              }),
            }),
          }),
          async (params) => params,
        );

        const provider = localTools([nestedTool]);
        const tools = await provider.getTools();

        expect(tools[0].parameters.properties.user).toEqual({
          type: 'object',
          properties: {
            name: { type: 'string' },
            settings: {
              type: 'object',
              properties: {
                theme: { type: 'string' },
                notifications: { type: 'boolean' },
              },
              required: ['theme', 'notifications'],
              additionalProperties: false,
            },
          },
          required: ['name', 'settings'],
          additionalProperties: false,
        });
      });

      it('should handle optional fields', async () => {
        const optionalTool = tool(
          'optional-test',
          'Test optional fields',
          z.object({
            required: z.string(),
            optional: z.string().optional(),
          }),
          async (params) => params,
        );

        const provider = localTools([optionalTool]);
        const tools = await provider.getTools();

        expect(tools[0].parameters.required).toEqual(['required']);
      });
    });

    describe('canHandle()', () => {
      it('should return true for registered tool names', () => {
        const testTool = tool('test', 'Test', z.object({}), async () => 'result');
        const provider = localTools([testTool]);

        expect(provider.canHandle('test')).toBe(true);
      });

      it('should return false for unknown tool names', () => {
        const testTool = tool('test', 'Test', z.object({}), async () => 'result');
        const provider = localTools([testTool]);

        expect(provider.canHandle('unknown')).toBe(false);
      });
    });

    describe('execute()', () => {
      const mockContext: ExecutionContext = {
        taskId: 'test-task',
        contextId: 'test-context',
        agentId: 'test-agent',
      };

      it('should execute tool with valid arguments', async () => {
        const addTool = tool(
          'add',
          'Add numbers',
          z.object({
            a: z.number(),
            b: z.number(),
          }),
          async ({ a, b }) => a + b,
        );

        const provider = localTools([addTool]);
        const result = await provider.execute(
          {
            id: 'call-1',
            type: 'function',
            function: {
              name: 'add',
              arguments: { a: 5, b: 3 },
            },
          },
          mockContext,
        );

        expect(result.success).toBe(true);
        expect(result.result).toBe(8);
      });

      it('should validate arguments with Zod schema', async () => {
        const strictTool = tool(
          'strict',
          'Strict validation',
          z.object({
            email: z.string().email(),
            age: z.number().int().min(0),
          }),
          async (params) => params,
        );

        const provider = localTools([strictTool]);

        // Valid arguments
        const validResult = await provider.execute(
          {
            id: 'call-2',
            type: 'function',
            function: {
              name: 'strict',
              arguments: { email: 'test@example.com', age: 25 },
            },
          },
          mockContext,
        );
        expect(validResult.success).toBe(true);

        // Invalid email
        const invalidEmailResult = await provider.execute(
          {
            id: 'call-3',
            type: 'function',
            function: {
              name: 'strict',
              arguments: { email: 'not-an-email', age: 25 },
            },
          },
          mockContext,
        );
        expect(invalidEmailResult.success).toBe(false);
        expect(invalidEmailResult.error).toContain('Invalid arguments');

        // Invalid age (negative)
        const invalidAgeResult = await provider.execute(
          {
            id: 'call-4',
            type: 'function',
            function: {
              name: 'strict',
              arguments: { email: 'test@example.com', age: -1 },
            },
          },
          mockContext,
        );
        expect(invalidAgeResult.success).toBe(false);
        expect(invalidAgeResult.error).toContain('Too small');
      });

      it('should handle JSON parse errors', async () => {
        const testTool = tool('test', 'Test', z.object({}), async () => 'result');
        const provider = localTools([testTool]);

        const result = await provider.execute(
          {
            id: 'call-5',
            type: 'function',
            function: {
              name: 'test',
              // biome-ignore lint/suspicious/noExplicitAny: simulate invalid for testing
              arguments: null as any, // simulate invalid
            },
          },
          mockContext,
        );

        expect(result.success).toBe(false);
        expect(result.error).toContain('Invalid arguments');
      });

      it('should handle handler errors', async () => {
        const errorTool = tool('error', 'Throws error', z.object({}), async () => {
          throw new Error('Test error');
        });

        const provider = localTools([errorTool]);
        const result = await provider.execute(
          {
            id: 'call-6',
            type: 'function',
            function: {
              name: 'error',
              arguments: {},
            },
          },
          mockContext,
        );

        expect(result.success).toBe(false);
        expect(result.error).toContain('Test error');
      });

      it('should return error for unknown tools', async () => {
        const testTool = tool('test', 'Test', z.object({}), async () => 'result');
        const provider = localTools([testTool]);

        const result = await provider.execute(
          {
            id: 'call-7',
            type: 'function',
            function: {
              name: 'unknown',
              arguments: {},
            },
          },
          mockContext,
        );

        expect(result.success).toBe(false);
        expect(result.error).toContain('Tool unknown not found');
      });

      it('should provide execution context to handler', async () => {
        let receivedContext: ExecutionContext | null = null;

        const contextTool = tool(
          'context-test',
          'Test context',
          z.object({}),
          async (_params, context) => {
            receivedContext = context;
            return 'success';
          },
        );

        const provider = localTools([contextTool]);
        await provider.execute(
          {
            id: 'call-8',
            type: 'function',
            function: {
              name: 'context-test',
              arguments: {},
            },
          },
          mockContext,
        );

        expect(receivedContext).toEqual(mockContext);
      });

      it('should handle complex return values', async () => {
        const complexTool = tool('complex', 'Complex return', z.object({}), async () => ({
          status: 'success',
          data: [1, 2, 3],
          nested: { key: 'value' },
        }));

        const provider = localTools([complexTool]);
        const result = await provider.execute(
          {
            id: 'call-9',
            type: 'function',
            function: {
              name: 'complex',
              arguments: {},
            },
          },
          mockContext,
        );

        expect(result.success).toBe(true);
        expect(result.result).toEqual({
          status: 'success',
          data: [1, 2, 3],
          nested: { key: 'value' },
        });
      });
    });
  });
});
