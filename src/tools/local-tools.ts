/**
 * Local Tools Helper
 *
 * Provides ergonomic API for creating local tool providers with Zod schemas.
 *
 * Design Reference: design/tool-integration.md#local-tool-provider
 */

import { z } from 'zod';
import type {
  ExecutionContext,
  ToolCall,
  ToolDefinition,
  ToolProvider,
  ToolResult,
} from './interfaces';

/**
 * Tool handler function with typed parameters
 */
type ToolHandler<TParams> = (
  params: TParams,
  context: ExecutionContext
) => Promise<unknown> | unknown;

/**
 * Tool definition with Zod schema and handler
 */
interface LocalToolDefinition<TSchema extends z.ZodObject> {
  name: string;
  description: string;
  schema: TSchema;
  handler: ToolHandler<z.infer<TSchema>>;
}

/**
 * Create a local tool definition with Zod schema
 *
 * @example
 * const calcTool = tool(
 *   'calculate',
 *   'Evaluate a mathematical expression',
 *   z.object({
 *     expression: z.string().describe('The math expression to evaluate'),
 *   }),
 *   async ({ expression }) => {
 *     return eval(expression);
 *   }
 * );
 */
export function tool<TSchema extends z.ZodObject>(
  name: string,
  description: string,
  schema: TSchema,
  handler: ToolHandler<z.infer<TSchema>>
): LocalToolDefinition<TSchema> {
  return { name, description, schema, handler };
}

/**
 * Convert Zod schema to JSON Schema for tool parameters
 */
const zodToJsonSchema = (
  schema: z.ZodObject
): {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
} => {
  // Use Zod's built-in toJSONSchema conversion
  const fullSchema = z.toJSONSchema(schema);

  // Remove $schema field (not needed for OpenAI tool definitions)
  const { $schema: _$schema, ...jsonSchema } = fullSchema;

  if (jsonSchema.type !== 'object' || !jsonSchema.properties) {
    throw new Error('Tool parameters schema must be a Zod object schema');
  }

  return jsonSchema as {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
};

/**
 * Create a local tool provider from tool definitions
 *
 * @example
 * const provider = localTools([
 *   tool(
 *     'calculate',
 *     'Evaluate a mathematical expression',
 *     z.object({
 *       expression: z.string().describe('Math expression to evaluate'),
 *     }),
 *     async ({ expression }) => eval(expression)
 *   ),
 *   tool(
 *     'get_weather',
 *     'Get weather for a city',
 *     z.object({
 *       city: z.string().describe('City name'),
 *       units: z.enum(['celsius', 'fahrenheit']).optional().describe('Temperature units'),
 *     }),
 *     async ({ city, units }) => {
 *       return { city, temp: 20, units: units || 'celsius' };
 *     }
 *   ),
 * ]);
 */
export function localTools(tools: LocalToolDefinition<z.ZodObject>[]): ToolProvider {
  const toolMap = new Map<string, LocalToolDefinition<z.ZodObject>>();

  for (const tool of tools) {
    if (toolMap.has(tool.name)) {
      throw new Error(`Duplicate tool name: ${tool.name}`);
    }
    toolMap.set(tool.name, tool);
  }

  return {
    getTools: async (): Promise<ToolDefinition[]> =>
      tools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: zodToJsonSchema(t.schema),
      })),

    canHandle: (toolName: string): boolean => toolMap.has(toolName),

    execute: async (toolCall: ToolCall, context: ExecutionContext): Promise<ToolResult> => {
      const toolDef = toolMap.get(toolCall.function.name);

      if (!toolDef) {
        return {
          toolCallId: toolCall.id,
          toolName: toolCall.function.name,
          success: false,
          result: null,
          error: `Tool ${toolCall.function.name} not found`,
        };
      }

      try {
        // Arguments should be an object, not a string. If a provider delivers a string, it should parse it before calling this.
        const validatedParams = toolDef.schema.parse(toolCall.function.arguments);

        // Execute handler with validated params
        const result = await toolDef.handler(validatedParams, context);

        return {
          toolCallId: toolCall.id,
          toolName: toolCall.function.name,
          success: true,
          result,
        };
      } catch (error) {
        // Handle Zod validation errors
        if (error instanceof z.ZodError) {
          return {
            toolCallId: toolCall.id,
            toolName: toolCall.function.name,
            success: false,
            result: null,
            error: `Invalid arguments: ${error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`,
          };
        }

        // Handle execution errors
        const err = error instanceof Error ? error : new Error(String(error));
        return {
          toolCallId: toolCall.id,
          toolName: toolCall.function.name,
          success: false,
          result: null,
          error: err.message,
        };
      }
    },
  };
}
