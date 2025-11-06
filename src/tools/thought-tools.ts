/**
 * Thought Tools - Enable LLM to emit reasoning thoughts
 *
 * Provides a tool that allows the LLM to express its reasoning process.
 * Following the localTools() pattern with Zod validation.
 *
 * Design: design/internal-event-protocol.md (Thought Streaming)
 */

import { z } from 'zod';
import type { LoopEventEmitter } from '../core/operators/event-emitter';
import type {
  ExecutionContext,
  ToolCall,
  ToolDefinition,
  ToolProvider,
  ToolResult,
} from './interfaces';

/**
 * Thought types that LLM can emit
 */
const ThoughtTypeSchema = z.enum([
  'planning',
  'reasoning',
  'reflection',
  'decision',
  'observation',
  'critique',
]);

/**
 * Verbosity levels for thoughts
 */
const VerbositySchema = z.enum(['brief', 'normal', 'detailed']);

/**
 * Schema for think_aloud tool parameters
 */
const ThinkAloudSchema = z.object({
  thought_id: z
    .string()
    .optional()
    .describe(
      'A unique ID for this thought (e.g., "initial_plan", "step1", "weather_check"). Use this to reference the thought later via related_to. If not provided, one will be generated.'
    ),
  thought: z
    .string()
    .describe('Your reasoning or thought process. Be clear and explain your thinking.'),
  thought_type: ThoughtTypeSchema.describe(
    'The type of thought: planning (what to do next), reasoning (how you figured something out), reflection (looking back), decision (choosing between options), observation (noticing something), or critique (evaluating an approach)'
  ),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe('How confident you are in this reasoning (0-1, optional)'),
  verbosity: VerbositySchema.optional().describe(
    'How detailed this thought is. Use brief for quick notes, normal for typical reasoning, detailed for complex explanations. Defaults to normal.'
  ),
  alternatives: z
    .array(z.string())
    .optional()
    .describe('Alternative approaches or thoughts you considered (optional)'),
  related_to: z
    .string()
    .optional()
    .describe(
      'ID of a related thought (from a previous thought_id) or tool call, if this thought builds on something previous (optional)'
    ),
});

/**
 * Configuration for thought tools
 */
export interface ThoughtToolsConfig {
  /** Event emitter to send thought events to */
  eventEmitter: LoopEventEmitter;

  /** Task ID for the current execution */
  taskId: string;

  /** Context ID for the current execution */
  contextId: string;

  /** Enable thought streaming (default: true) */
  enabled?: boolean;

  /** Allowed thought types (default: all) */
  allowedTypes?: z.infer<typeof ThoughtTypeSchema>[];

  /** Default verbosity level */
  defaultVerbosity?: z.infer<typeof VerbositySchema>;
}

/**
 * Create a thought tool provider
 *
 * This gives the LLM the ability to emit its reasoning process via the think_aloud tool.
 *
 * @example
 * const thoughtProvider = thoughtTools({
 *   eventEmitter: loopEventEmitter,
 *   taskId: 'task-123',
 *   contextId: 'ctx-456',
 * });
 *
 * // LLM can now call:
 * // think_aloud({
 * //   thought: "I need to calculate 2+2, so I'll use the calculate tool",
 * //   thought_type: "planning",
 * //   confidence: 0.9
 * // })
 */
export function thoughtTools(config: ThoughtToolsConfig): ToolProvider {
  const enabled = config.enabled ?? true;
  const allowedTypes = config.allowedTypes ?? [
    'planning',
    'reasoning',
    'reflection',
    'decision',
    'observation',
    'critique',
  ];
  const defaultVerbosity = config.defaultVerbosity ?? 'normal';

  // Helper: Validate and parse arguments
  function validateArgs(toolCall: ToolCall):
    | {
        success: true;
        data: z.infer<typeof ThinkAloudSchema>;
      }
    | {
        success: false;
        error: string;
      } {
    try {
      const args =
        typeof toolCall.function.arguments === 'string'
          ? JSON.parse(toolCall.function.arguments)
          : toolCall.function.arguments;

      const validated = ThinkAloudSchema.parse(args);

      // Check if thought type is allowed
      if (!allowedTypes.includes(validated.thought_type)) {
        return {
          success: false,
          error: `Thought type '${validated.thought_type}' is not allowed. Allowed types: ${allowedTypes.join(', ')}`,
        };
      }

      return { success: true, data: validated };
    } catch (error) {
      if (error instanceof z.ZodError) {
        const errorMsg = error.issues
          .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
          .join(', ');
        return { success: false, error: `Invalid parameters: ${errorMsg}` };
      }
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  return {
    async getTools(): Promise<ToolDefinition[]> {
      if (!enabled) {
        return [];
      }

      return [
        {
          name: 'think_aloud',
          description:
            'Share your reasoning process with the user. Use this to explain your thought process, planning, or decision-making. This helps users understand how you arrived at your conclusions.',
          parameters: zodToJsonSchema(ThinkAloudSchema),
        },
      ];
    },

    canHandle(toolName: string): boolean {
      return enabled && toolName === 'think_aloud';
    },

    async execute(toolCall: ToolCall, _context: ExecutionContext): Promise<ToolResult> {
      // Check if enabled
      if (!enabled) {
        return {
          toolCallId: toolCall.id,
          toolName: toolCall.function.name,
          success: false,
          result: null,
          error: 'Thought streaming is disabled',
        };
      }

      // Check tool name
      if (toolCall.function.name !== 'think_aloud') {
        return {
          toolCallId: toolCall.id,
          toolName: toolCall.function.name,
          success: false,
          result: null,
          error: `Unknown thought tool: ${toolCall.function.name}`,
        };
      }

      // Validate arguments
      const validation = validateArgs(toolCall);
      if (!validation.success) {
        return {
          toolCallId: toolCall.id,
          toolName: 'think_aloud',
          success: false,
          result: null,
          error: validation.error,
        };
      }

      // Generate thoughtId if not provided
      const thoughtId =
        validation.data.thought_id ||
        `thought-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

      // Emit thought event
      config.eventEmitter.emitThought(
        config.taskId,
        config.contextId,
        validation.data.thought_type as
          | 'planning'
          | 'reasoning'
          | 'reflection'
          | 'decision'
          | 'observation',
        validation.data.thought,
        {
          thoughtId, // Pass the ID to use
          verbosity: validation.data.verbosity ?? defaultVerbosity,
          confidence: validation.data.confidence,
          alternatives: validation.data.alternatives,
          relatedTo: validation.data.related_to,
        }
      );

      // Success - return the thoughtId so LLM knows it for future reference
      return {
        toolCallId: toolCall.id,
        toolName: 'think_aloud',
        success: true,
        result: {
          acknowledged: true,
          thoughtId,
          message: `Thought recorded with ID: ${thoughtId}`,
        },
      };
    },
  };
}

/**
 * Convert Zod schema to JSON Schema for tool parameters
 */
function zodToJsonSchema(schema: z.ZodObject): {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
} {
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
}
