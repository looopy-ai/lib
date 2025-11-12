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
export * from './local-tools';
export * from './types';
export {
  FunctionParametersSchema,
  // Schemas
  JsonSchemaPropertySchema,
  safeValidateToolDefinitions,
  ToolCallSchema,
  ToolDefinitionSchema,
  // Validation
  validateToolDefinitions,
  type ExecutionContext,
  type FunctionParameters,
  // Types
  type JsonSchemaProperty,
  type ToolCall,
  type ToolDefinition,
  type ToolProvider,
  type ToolResult,
} from './types';
