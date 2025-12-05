import { context } from '@opentelemetry/api';
import { evaluate } from 'mathjs';
import { lastValueFrom, toArray } from 'rxjs';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { localTools, tool } from '../src/tools/local-tools';
import type { ExecutionContext } from '../src/types';

describe('local-tools', () => {
  describe('tool()', () => {
    it('should create a tool definition with Zod schema', () => {
      const testTool = tool({
        id: 'test-tool',
        description: 'A test tool',
        schema: z.object({
          input: z.string().describe('Test input'),
        }),
        handler: async ({ input }) => ({ success: true, result: `Processed: ${input}` }),
      });

      expect(testTool.id).toBe('test-tool');
      expect(testTool.description).toBe('A test tool');
      expect(testTool.schema).toBeDefined();
      expect(testTool.handler).toBeDefined();
    });

    it('should support complex Zod schemas', () => {
      const complexTool = tool({
        id: 'complex',
        description: 'Complex tool',
        schema: z.object({
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
        handler: async (params) => ({ success: true, result: params }),
      });

      expect(complexTool.id).toBe('complex');
      expect(complexTool.schema).toBeDefined();
    });
  });

  describe('localTools()', () => {
    it('should create a ToolProvider from tool definitions', () => {
      const tool1 = tool({
        id: 'add',
        description: 'Add two numbers',
        schema: z.object({
          a: z.number(),
          b: z.number(),
        }),
        handler: async ({ a, b }) => ({ success: true, result: a + b }),
      });

      const tool2 = tool({
        id: 'multiply',
        description: 'Multiply two numbers',
        schema: z.object({
          x: z.number(),
          y: z.number(),
        }),
        handler: async ({ x, y }) => ({ success: true, result: x * y }),
      });

      const provider = localTools([tool1, tool2]);

      expect(provider).toBeDefined();
      expect(typeof provider.listTools).toBe('function');
      expect(typeof provider.getTool).toBe('function');
      expect(typeof provider.executeTool).toBe('function');
    });

    it('should throw error for duplicate tool names', () => {
      const tool1 = tool({
        id: 'duplicate',
        description: 'First',
        schema: z.object({}),
        handler: async () => ({ success: true, result: 'first' }),
      });
      const tool2 = tool({
        id: 'duplicate',
        description: 'Second',
        schema: z.object({}),
        handler: async () => ({ success: true, result: 'second' }),
      });

      expect(() => {
        localTools([tool1, tool2]);
      }).toThrow('Duplicate tool name: duplicate');
    });

    describe('getTools()', () => {
      it('should return tool definitions with JSON Schema parameters', async () => {
        const calculatorTool = tool({
          id: 'calculate',
          description: 'Perform calculation',
          schema: z.object({
            expression: z.string().describe('Math expression to evaluate'),
            precision: z.number().int().min(0).max(10).optional(),
          }),
          handler: async ({ expression }) => evaluate(expression),
        });

        const provider = localTools([calculatorTool]);
        const tools = await provider.listTools();

        expect(tools).toHaveLength(1);
        expect(tools[0].id).toBe('calculate');
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
        const stringTool = tool({
          id: 'string-test',
          description: 'Test strings',
          schema: z.object({
            name: z.string().min(3).max(20),
            email: z.string().email(),
            url: z.string().url(),
          }),
          handler: async (params) => ({ success: true, result: params }),
        });

        const provider = localTools([stringTool]);
        const tools = await provider.listTools();

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
        const numberTool = tool({
          id: 'number-test',
          description: 'Test numbers',
          schema: z.object({
            age: z.number().int().min(0).max(120),
            score: z.number().min(0).max(100),
            multiple: z.number().multipleOf(5),
          }),
          handler: async (params) => ({ success: true, result: params }),
        });

        const provider = localTools([numberTool]);
        const tools = await provider.listTools();

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
        const arrayTool = tool({
          id: 'array-test',
          description: 'Test arrays',
          schema: z.object({
            tags: z.array(z.string()).min(1).max(10),
            numbers: z.array(z.number()),
          }),
          handler: async (params) => ({ success: true, result: params }),
        });

        const provider = localTools([arrayTool]);
        const tools = await provider.listTools();

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
        const enumTool = tool({
          id: 'enum-test',
          description: 'Test enums',
          schema: z.object({
            role: z.enum(['admin', 'user', 'guest']),
          }),
          handler: async (params) => ({ success: true, result: params }),
        });

        const provider = localTools([enumTool]);
        const tools = await provider.listTools();

        expect(tools[0].parameters.properties.role).toEqual({
          type: 'string',
          enum: ['admin', 'user', 'guest'],
        });
      });

      it('should handle nested objects', async () => {
        const nestedTool = tool({
          id: 'nested-test',
          description: 'Test nested objects',
          schema: z.object({
            user: z.object({
              name: z.string(),
              settings: z.object({
                theme: z.string(),
                notifications: z.boolean(),
              }),
            }),
          }),
          handler: async (params) => ({ success: true, result: params }),
        });

        const provider = localTools([nestedTool]);
        const tools = await provider.listTools();

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
        const optionalTool = tool({
          id: 'optional-test',
          description: 'Test optional fields',
          schema: z.object({
            required: z.string(),
            optional: z.string().optional(),
          }),
          handler: async (params) => ({ success: true, result: params }),
        });

        const provider = localTools([optionalTool]);
        const tools = await provider.listTools();

        expect(tools[0].parameters.required).toEqual(['required']);
      });
    });

    describe('getTool()', () => {
      it('should return tool definition for known tool', async () => {
        const testTool = tool({
          id: 'test',
          description: 'Test',
          schema: z.object({}),
          handler: async () => ({ success: true, result: 'result' }),
        });
        const provider = localTools([testTool]);

        const toolDef = await provider.getTool('test');
        expect(toolDef?.id).toBe('test');
      });

      it('should return undefined for unknown tool', async () => {
        const testTool = tool({
          id: 'test',
          description: 'Test',
          schema: z.object({}),
          handler: async () => ({ success: true, result: 'result' }),
        });
        const provider = localTools([testTool]);

        const toolDef = await provider.getTool('unknown');
        expect(toolDef).toBeUndefined();
      });
    });

    describe('execute()', () => {
      const mockContext: ExecutionContext<unknown> = {
        taskId: 'test-task',
        contextId: 'test-context',
        agentId: 'test-agent',
        parentContext: context.active(),
      };
      type LocalProvider = ReturnType<typeof localTools>;
      type LocalToolCall = Parameters<LocalProvider['executeTool']>[0];
      const getFirstEvent = async (provider: LocalProvider, toolCall: LocalToolCall) => {
        const events = await lastValueFrom(
          provider.executeTool(toolCall, mockContext).pipe(toArray()),
        );
        return events[0];
      };

      it('should execute tool with valid arguments', async () => {
        const addTool = tool({
          id: 'add',
          description: 'Add numbers',
          schema: z.object({
            a: z.number(),
            b: z.number(),
          }),
          handler: async ({ a, b }) => ({ success: true, result: a + b }),
        });

        const provider = localTools([addTool]);
        const result = await getFirstEvent(provider, {
          id: 'call-1',
          type: 'function',
          function: {
            name: 'add',
            arguments: { a: 5, b: 3 },
          },
        });

        expect(result).toBeDefined();
        expect(result.kind).toBe('tool-complete');
        if (result.kind !== 'tool-complete') return;

        expect(result.success).toBe(true);
        expect(result.result).toBe(8);
      });

      it('should validate arguments with Zod schema', async () => {
        const strictTool = tool({
          id: 'strict',
          description: 'Strict validation',
          schema: z.object({
            email: z.string().email(),
            age: z.number().int().min(0),
          }),
          handler: async (params) => ({ success: true, result: params }),
        });

        const provider = localTools([strictTool]);

        // Valid arguments
        const validResult = await getFirstEvent(provider, {
          id: 'call-2',
          type: 'function',
          function: {
            name: 'strict',
            arguments: { email: 'test@example.com', age: 25 },
          },
        });

        expect(validResult).toBeDefined();
        expect(validResult.kind).toBe('tool-complete');
        if (validResult.kind !== 'tool-complete') return;

        expect(validResult.success).toBe(true);

        // Invalid email
        const invalidEmailResult = await getFirstEvent(provider, {
          id: 'call-3',
          type: 'function',
          function: {
            name: 'strict',
            arguments: { email: 'not-an-email', age: 25 },
          },
        });

        expect(invalidEmailResult).toBeDefined();
        expect(invalidEmailResult.kind).toBe('tool-complete');
        if (invalidEmailResult.kind !== 'tool-complete') return;

        expect(invalidEmailResult.success).toBe(false);
        expect(invalidEmailResult.error).toContain('Invalid arguments');

        // Invalid age (negative)
        const invalidAgeResult = await getFirstEvent(provider, {
          id: 'call-4',
          type: 'function',
          function: {
            name: 'strict',
            arguments: { email: 'test@example.com', age: -1 },
          },
        });

        expect(invalidAgeResult).toBeDefined();
        expect(invalidAgeResult.kind).toBe('tool-complete');
        if (invalidAgeResult.kind !== 'tool-complete') return;

        expect(invalidAgeResult?.success).toBe(false);
        expect(invalidAgeResult?.error).toContain('Too small');
      });

      it('should handle JSON parse errors', async () => {
        const testTool = tool({
          id: 'test',
          description: 'Test',
          schema: z.object({}),
          handler: async () => ({ success: true, result: 'result' }),
        });
        const provider = localTools([testTool]);

        const result = await getFirstEvent(provider, {
          id: 'call-5',
          type: 'function',
          function: {
            name: 'test',
            // biome-ignore lint/suspicious/noExplicitAny: simulate invalid for testing
            arguments: null as any, // simulate invalid
          },
        });

        expect(result).toBeDefined();
        expect(result.kind).toBe('tool-complete');
        if (result.kind !== 'tool-complete') return;

        expect(result.success).toBe(false);
        expect(result.error).toContain('Invalid arguments');
      });

      it('should handle handler errors', async () => {
        const errorTool = tool({
          id: 'error',
          description: 'Throws error',
          schema: z.object({}),
          handler: async () => {
            throw new Error('Test error');
          },
        });

        const provider = localTools([errorTool]);
        const result = await getFirstEvent(provider, {
          id: 'call-6',
          type: 'function',
          function: {
            name: 'error',
            arguments: {},
          },
        });

        expect(result).toBeDefined();
        expect(result.kind).toBe('tool-complete');
        if (result.kind !== 'tool-complete') return;

        expect(result.success).toBe(false);
        expect(result.error).toContain('Test error');
      });

      it('should return error for unknown tools', async () => {
        const testTool = tool({
          id: 'test',
          description: 'Test',
          schema: z.object({}),
          handler: async () => ({ success: true, result: 'result' }),
        });
        const provider = localTools([testTool]);

        const result = await getFirstEvent(provider, {
          id: 'call-7',
          type: 'function',
          function: {
            name: 'unknown',
            arguments: {},
          },
        });

        expect(result).toBeDefined();
        expect(result.kind).toBe('tool-complete');
        if (result.kind !== 'tool-complete') return;

        expect(result.success).toBe(false);
        expect(result.error).toContain('Tool unknown not found');
      });

      it('should provide execution context to handler', async () => {
        let receivedContext: ExecutionContext<unknown> | null = null;

        const contextTool = tool({
          id: 'context-test',
          description: 'Test context',
          schema: z.object({}),
          handler: async (_params, context) => {
            receivedContext = context;
            return { success: true, result: 'success' };
          },
        });

        const provider = localTools([contextTool]);
        await getFirstEvent(provider, {
          id: 'call-8',
          type: 'function',
          function: {
            name: 'context-test',
            arguments: {},
          },
        });

        expect(receivedContext).toEqual(mockContext);
      });

      it('should handle complex return values', async () => {
        const complexTool = tool({
          id: 'complex',
          description: 'Complex return',
          schema: z.object({}),
          handler: async () => ({
            success: true,
            result: {
              status: 'success',
              data: [1, 2, 3],
              nested: { key: 'value' },
            },
          }),
        });

        const provider = localTools([complexTool]);
        const result = await getFirstEvent(provider, {
          id: 'call-9',
          type: 'function',
          function: {
            name: 'complex',
            arguments: {},
          },
        });

        expect(result).toBeDefined();
        expect(result.kind).toBe('tool-complete');
        if (result.kind !== 'tool-complete') return;

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
