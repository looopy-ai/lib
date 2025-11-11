/**
 * Tool Provider Module
 *
 * Exports all tool-related types and implementations.
 */

/**
 * Tool Providers and Utilities
 */

// Note: artifact-tools removed - will be re-implemented using V3 API if needed
export * from './client-tool-provider';
export * from './interfaces';
export {
  type ExecutionContext,
  type FunctionParameters,
  FunctionParametersSchema,
  // Types
  type JsonSchemaProperty,
  // Schemas
  JsonSchemaPropertySchema,
  safeValidateToolDefinitions,
  type ToolCall,
  ToolCallSchema,
  type ToolDefinition,
  ToolDefinitionSchema,
  type ToolProvider,
  type ToolResult,
  // Validation
  validateToolDefinitions,
} from './interfaces';
export * from './local-tools';
