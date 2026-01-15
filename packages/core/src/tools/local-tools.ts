/**
 * Local Tools Helper
 *
 * Provides ergonomic API for creating local tool providers with Zod schemas.
 *
 * Design Reference: design/tool-integration.md#local-tool-provider
 */

import { catchError, defer, mergeMap, of } from 'rxjs';
import { z } from 'zod';
import type { ExecutionContext } from '../types/context';
import type { ToolPlugin } from '../types/core';
import type { ToolCall, ToolDefinition, ToolResult } from '../types/tools';
import { toolErrorEvent, toolResultToEvents } from './tool-result-events';

type InternalToolResult = Omit<ToolResult, 'toolCallId' | 'toolName'>;

/**
 * Tool handler function with typed parameters
 */
export type ToolHandler<TParams, AuthContext> = (
  params: TParams,
  context: ExecutionContext<AuthContext>,
) => Promise<InternalToolResult> | InternalToolResult;

/**
 * Tool definition with Zod schema and handler
 */
export interface LocalToolDefinition<TSchema extends z.ZodObject, AuthContext> {
  id: string;
  description: string;
  icon?: string;
  schema: TSchema;
  handler: ToolHandler<z.infer<TSchema>, AuthContext>;
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
export function tool<TSchema extends z.ZodObject, AuthContext>(
  definition: LocalToolDefinition<TSchema, AuthContext>,
): LocalToolDefinition<TSchema, AuthContext> {
  return { ...definition };
}

/**
 * Convert Zod schema to JSON Schema for tool parameters
 */
const zodToJsonSchema = (
  schema: z.ZodObject,
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
export function localTools<AuthContext>(
  tools: LocalToolDefinition<z.ZodObject, AuthContext>[],
): ToolPlugin<AuthContext> {
  const toolMap = new Map<string, LocalToolDefinition<z.ZodObject, AuthContext>>();

  for (const tool of tools) {
    if (toolMap.has(tool.id)) {
      throw new Error(`Duplicate tool name: ${tool.id}`);
    }
    toolMap.set(tool.id, tool);
  }

  return {
    name: 'local-tool-provider',
    listTools: async (): Promise<ToolDefinition[]> =>
      tools.map((t) => ({
        id: t.id,
        description: t.description,
        icon: t.icon,
        parameters: zodToJsonSchema(t.schema),
      })),

    getTool: async (toolName: string): Promise<ToolDefinition | undefined> => {
      const toolDef = toolMap.get(toolName);
      if (!toolDef) {
        return undefined;
      }
      return {
        id: toolDef.id,
        description: toolDef.description,
        icon: toolDef.icon,
        parameters: zodToJsonSchema(toolDef.schema),
      };
    },

    executeTool: (toolCall: ToolCall, context: ExecutionContext<AuthContext>) =>
      defer(async () => {
        const toolDef = toolMap.get(toolCall.function.name);

        if (!toolDef) {
          return {
            toolCallId: toolCall.id,
            toolName: toolCall.function.name,
            success: false,
            result: null,
            error: `Tool ${toolCall.function.name} not found`,
          } satisfies ToolResult;
        }

        try {
          // Arguments should be an object, not a string. If a provider delivers a string, it should parse it before calling this.
          const validatedParams = toolDef.schema.parse(toolCall.function.arguments);

          // Execute handler with validated params
          const result = await toolDef.handler(validatedParams, context);

          return {
            toolCallId: toolCall.id,
            toolName: toolCall.function.name,
            success: result.success,
            error: result.error,
            result: result.result,
            messages: result.messages,
          } satisfies ToolResult;
        } catch (error) {
          // Handle Zod validation errors
          if (error instanceof z.ZodError) {
            return {
              toolCallId: toolCall.id,
              toolName: toolCall.function.name,
              success: false,
              result: null,
              error: `Invalid arguments: ${error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`,
            } satisfies ToolResult;
          }

          // Handle execution errors
          const err = error instanceof Error ? error : new Error(String(error));
          return {
            toolCallId: toolCall.id,
            toolName: toolCall.function.name,
            success: false,
            result: null,
            error: err.message,
          } satisfies ToolResult;
        }
      }).pipe(
        mergeMap((result) => toolResultToEvents(result)),
        catchError((error) =>
          of(toolErrorEvent(toolCall, error instanceof Error ? error.message : String(error))),
        ),
      ),
  };
}
