/**
 * Tool Provider Interfaces
 *
 * Defines contracts for tool execution backends.
 *
 * Design Reference: design/tool-integration.md
 */

import type { Observable } from 'rxjs';
import { z } from 'zod';
import type { ExecutionContext } from './context';
import type { ContextAnyEvent } from './event';
import type { SystemMessage } from './message';

/**
 * Tool call from LLM
 */
export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: Record<string, unknown>;
  };
}

/**
 * Result of tool execution
 */
export interface ToolResult {
  toolCallId: string;
  toolName: string;
  success: boolean;
  result: unknown;
  error?: string;
  messages?: SystemMessage[];
}

/**
 * JSON Schema property definition with recursive support
 */
export const JsonSchemaPropertySchema: z.ZodType<unknown> = z.lazy(() =>
  z.object({
    type: z.enum(['string', 'number', 'integer', 'boolean', 'array', 'object', 'null']),
    description: z.string().optional(),
    enum: z.array(z.union([z.string(), z.number()])).optional(),
    default: z.unknown().optional(),
    // Array-specific
    items: JsonSchemaPropertySchema.optional(),
    minItems: z.number().optional(),
    maxItems: z.number().optional(),
    // Object-specific
    properties: z.record(z.string(), JsonSchemaPropertySchema).optional(),
    required: z.array(z.string()).optional(),
    additionalProperties: z.union([z.boolean(), JsonSchemaPropertySchema]).optional(),
    // String-specific
    minLength: z.number().optional(),
    maxLength: z.number().optional(),
    pattern: z.string().optional(),
    format: z.string().optional(), // e.g., "email", "uri", "date-time"
    // Number-specific
    minimum: z.number().optional(),
    maximum: z.number().optional(),
    multipleOf: z.number().optional(),
  }),
);

export type JsonSchemaProperty = z.infer<typeof JsonSchemaPropertySchema>;

/**
 * Function parameters schema (JSON Schema object type)
 */
export const FunctionParametersSchema = z.object({
  type: z.literal('object'),
  properties: z.record(z.string(), JsonSchemaPropertySchema),
  required: z.array(z.string()).optional(),
  additionalProperties: z.boolean().optional(),
});

export type FunctionParameters = z.infer<typeof FunctionParametersSchema>;

/**
 * Tool definition schema
 *
 * Note: This is the core tool definition format. LLM providers that require
 * specific formats (e.g., OpenAI's { type: 'function', function: {...} })
 * should wrap this format in their implementation.
 */
export const ToolDefinitionSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(
      /^[a-zA-Z0-9_-]+$/,
      'Tool name must contain only alphanumeric characters, underscores, and hyphens',
    ),
  description: z.string().min(1).max(1024),
  icon: z.string().optional(),
  parameters: FunctionParametersSchema,
});

export type ToolDefinition = z.infer<typeof ToolDefinitionSchema>;

/**
 * Validate tool definitions from untrusted sources (e.g., client requests)
 *
 * @throws {z.ZodError} if validation fails
 */
export function validateToolDefinitions(tools: unknown): ToolDefinition[] {
  return z.array(ToolDefinitionSchema).parse(tools);
}

/**
 * Safely validate tool definitions, returning errors instead of throwing
 */
export function safeValidateToolDefinitions(tools: unknown): {
  success: boolean;
  data?: ToolDefinition[];
  errors?: z.ZodIssue[];
} {
  const result = z.array(ToolDefinitionSchema).safeParse(tools);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, errors: result.error.issues };
}

/**
 * Tool call from LLM
 */
export const ToolCallSchema = z.object({
  id: z.string(),
  type: z.literal('function'),
  function: z.object({
    name: z.string(),
    arguments: z.record(z.string(), z.unknown()), // object
  }),
});

/**
 * Tool provider type
 *
 * Implementations:
 * - LocalToolProvider: Execute local TypeScript functions
 * - MCPToolProvider: Execute MCP server tools
 * - ClientToolProvider: Delegate to client via input-required
 */
export type ToolProvider<AuthContext> = {
  get name(): string;

  /**
   * Get tool definition by name
   */
  getTool(toolName: string): Promise<ToolDefinition | undefined>;

  /**
   * Get available tools from this provider
   */
  getTools(): Promise<ToolDefinition[]>;

  /**
   * Execute a tool call
   */
  execute(toolCall: ToolCall, context: ExecutionContext<AuthContext>): Observable<ContextAnyEvent>;
};
