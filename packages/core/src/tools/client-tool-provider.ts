/**
 * Client Tool Provider
 *
 * Handles tools provided by the client in A2A requests.
 * These tools are executed by returning a "status-update" with state "input-required",
 * allowing the client to execute the tool and return the result.
 *
 * Design Reference: design/tool-integration.md#client-tool-provider
 */

import { catchError, defer, mergeMap, of } from 'rxjs';
import type { ExecutionContext } from '../types/context';
import {
  type ToolCall,
  type ToolDefinition,
  type ToolProvider,
  type ToolResult,
  validateToolDefinitions,
} from '../types/tools';
import { toolErrorEvent, toolResultToEvents } from './tool-result-events';

export interface ClientToolConfig {
  /**
   * Tools provided by the client (validated on construction)
   */
  tools: unknown; // Will be validated

  /**
   * Callback to request input from client
   * Returns a promise that resolves when client provides the tool result
   */
  onInputRequired: (toolCall: ToolCall, context: ExecutionContext) => Promise<ToolResult>;
}

/**
 * Client Tool Provider
 *
 * Validates and manages tools provided by the client.
 * Tool execution delegates to the client via the "input-required" mechanism.
 */
export class ClientToolProvider implements ToolProvider {
  name = 'client-tool-provider';
  private readonly tools: ToolDefinition[];
  private readonly toolNames: Set<string>;
  private readonly onInputRequired: (
    toolCall: ToolCall,
    context: ExecutionContext,
  ) => Promise<ToolResult>;

  constructor(config: ClientToolConfig) {
    // Validate client-provided tools
    try {
      this.tools = validateToolDefinitions(config.tools);
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Invalid client tool definitions: ${error.message}`);
      }
      throw error;
    }

    // Build tool name index for fast lookup
    this.toolNames = new Set(this.tools.map((t) => t.name));

    // Check for duplicate tool names
    if (this.toolNames.size !== this.tools.length) {
      const names = this.tools.map((t) => t.name);
      const duplicates = names.filter((name, index) => names.indexOf(name) !== index);
      throw new Error(`Duplicate tool names: ${duplicates.join(', ')}`);
    }

    this.onInputRequired = config.onInputRequired;
  }

  /**
   * Get all client-provided tools
   */
  async getTools(): Promise<ToolDefinition[]> {
    return [...this.tools];
  }

  /**
   * Execute tool by delegating to client
   *
   * This triggers the "input-required" flow:
   * 1. Agent emits status-update with state="input-required"
   * 2. Client receives the event and executes the tool
   * 3. Client sends the result back via tasks/resume or message/stream continuation
   * 4. Agent continues with the tool result
   */
  execute(toolCall: ToolCall, context: ExecutionContext) {
    return defer(async () => {
      const tool = await this.getTool(toolCall.function.name);
      if (!tool) {
        return {
          toolCallId: toolCall.id,
          toolName: toolCall.function.name,
          success: false,
          result: null,
          error: `Tool ${toolCall.function.name} not found in client tools`,
        } satisfies ToolResult;
      }

      try {
        // Validate arguments are valid JSON
        if (
          typeof toolCall.function.arguments !== 'object' ||
          toolCall.function.arguments === null
        ) {
          return {
            toolCallId: toolCall.id,
            toolName: toolCall.function.name,
            success: false,
            result: null,
            error: `Invalid tool arguments: must be an object.`,
          } satisfies ToolResult;
        }

        // Delegate to client via callback
        const result = await this.onInputRequired(toolCall, context);
        return result;
      } catch (error) {
        return {
          toolCallId: toolCall.id,
          toolName: toolCall.function.name,
          success: false,
          result: null,
          error: error instanceof Error ? error.message : String(error),
        } satisfies ToolResult;
      }
    }).pipe(
      mergeMap((result) => toolResultToEvents(context, toolCall, result)),
      catchError((error) =>
        of(
          toolErrorEvent(context, toolCall, error instanceof Error ? error.message : String(error)),
        ),
      ),
    );
  }

  /**
   * Get tool definition by name
   */
  async getTool(name: string): Promise<ToolDefinition | undefined> {
    return this.tools.find((t) => t.name === name);
  }

  /**
   * Validate that tool call arguments match the tool's parameter schema
   *
   * Note: This is a basic structural validation. Full JSON Schema validation
   * would require a JSON Schema validator library.
   */
  async validateToolArguments(toolCall: ToolCall): Promise<{ valid: boolean; errors?: string[] }> {
    const tool = await this.getTool(toolCall.function.name);
    if (!tool) {
      return { valid: false, errors: [`Tool ${toolCall.function.name} not found`] };
    }

    if (typeof toolCall.function.arguments !== 'object' || toolCall.function.arguments === null) {
      return {
        valid: false,
        errors: ['Arguments are not valid: must be an object.'],
      };
    }
    const args: Record<string, unknown> = toolCall.function.arguments;

    const errors: string[] = [];

    // Check required parameters
    this.validateRequiredParams(tool, args, errors);

    // Check for unknown parameters
    this.validateUnknownParams(tool, args, errors);

    // Type check provided parameters
    this.validateParamTypes(tool, args, errors);

    return errors.length > 0 ? { valid: false, errors } : { valid: true };
  }

  /**
   * Validate required parameters are present
   */
  private validateRequiredParams(
    tool: ToolDefinition,
    args: Record<string, unknown>,
    errors: string[],
  ): void {
    const required = tool.parameters.required || [];
    for (const param of required) {
      if (!(param in args)) {
        errors.push(`Missing required parameter: ${param}`);
      }
    }
  }

  /**
   * Validate no unknown parameters are present (if additionalProperties is false)
   */
  private validateUnknownParams(
    tool: ToolDefinition,
    args: Record<string, unknown>,
    errors: string[],
  ): void {
    if (tool.parameters.additionalProperties === false) {
      const allowedParams = new Set(Object.keys(tool.parameters.properties));
      for (const param of Object.keys(args)) {
        if (!allowedParams.has(param)) {
          errors.push(`Unknown parameter: ${param}`);
        }
      }
    }
  }

  /**
   * Validate parameter types match schema
   */
  private validateParamTypes(
    tool: ToolDefinition,
    args: Record<string, unknown>,
    errors: string[],
  ): void {
    for (const [paramName, paramValue] of Object.entries(args)) {
      const schema = tool.parameters.properties[paramName];
      if (!schema) continue; // Skip if additionalProperties is allowed
      const type = (schema as { type?: string }).type;
      if (!type) continue;

      const typeError = this.checkParamType(paramName, paramValue, type);
      if (typeError) {
        errors.push(typeError);
      }
    }
  }

  /**
   * Check if a parameter value matches the expected JSON Schema type
   */
  private checkParamType(
    paramName: string,
    paramValue: unknown,
    expectedType: string,
  ): string | null {
    const actualType = this.getJsonSchemaType(paramValue);

    // Special case: integer type
    if (expectedType === 'integer') {
      if (actualType !== 'number') {
        return `Parameter ${paramName} has wrong type: expected integer, got ${actualType}`;
      }
      if (!Number.isInteger(paramValue as number)) {
        return `Parameter ${paramName} must be an integer, got: ${paramValue}`;
      }
      return null;
    }

    // Standard type check
    if (actualType !== expectedType) {
      return `Parameter ${paramName} has wrong type: expected ${expectedType}, got ${actualType}`;
    }

    return null;
  }

  /**
   * Get JSON Schema type from JavaScript value
   */
  private getJsonSchemaType(value: unknown): string {
    if (Array.isArray(value)) return 'array';
    if (value === null) return 'null';
    return typeof value;
  }
}
