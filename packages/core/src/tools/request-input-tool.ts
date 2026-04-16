/**
 * Request Input Tool
 *
 * A special built-in `request_input` tool that the LLM can call to ask for
 * clarification or additional data mid-loop.
 *
 * The tool is **never executed** via the normal tool execution path — it is
 * intercepted in `runIteration` and converted directly into a
 * `tool-input-required` event, which stops the loop cleanly.
 *
 * On resume, the agent injects a synthetic `tool-complete` event whose
 * `result` contains the provided value so the LLM sees the answer as a
 * normal tool result on the next iteration.
 *
 * Usage: add `requestInputPlugin()` to the agent's plugins array.
 */

import { of } from 'rxjs';
import type { ToolPlugin } from '../types/core';
import type { ToolDefinition } from '../types/tools';
import { toolInputRequiredEvent } from './tool-result-events';

/**
 * The canonical tool name used to intercept LLM-initiated input requests.
 * This constant is shared with `runIteration` so the intercept is keyed
 * on exactly the same string.
 */
export const REQUEST_INPUT_TOOL_NAME = 'request_input' as const;

/**
 * Returns a plugin that advertises the `request_input` tool to the LLM.
 *
 * The tool schema communicates to the model that it can call this tool
 * whenever it needs clarification, credentials, confirmation, or any other
 * upstream input before it can continue.
 *
 * @example
 * ```typescript
 * const agent = new Agent({
 *   plugins: [requestInputPlugin()],
 *   // ...
 * });
 * ```
 */
export function requestInputPlugin<AuthContext>(): ToolPlugin<AuthContext> {
  const definition: ToolDefinition = {
    id: REQUEST_INPUT_TOOL_NAME,
    description:
      'Request additional input from the user or calling system before continuing. ' +
      'Use this when you need clarification, credentials, a confirmation, or any data ' +
      'that is not available in the current context. The conversation will be paused ' +
      'until the input is provided.',
    parameters: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'A clear, human-readable description of what is needed and why.',
        },
        input_type: {
          type: 'string',
          enum: ['confirmation', 'clarification', 'selection', 'data'],
          description:
            'The kind of input required: confirmation (yes/no), clarification (free text), ' +
            'selection (pick from options), or data (structured value).',
        },
        options: {
          type: 'array',
          items: { type: 'string' },
          description: 'Available choices when input_type is "selection".',
        },
        schema: {
          type: 'object',
          description:
            'JSON Schema describing the expected shape of the input when input_type is "data".',
        },
      },
      required: ['prompt', 'input_type'],
    },
  };

  return {
    name: 'request-input-plugin',

    listTools: async (): Promise<ToolDefinition[]> => [definition],

    getTool: async (toolId: string): Promise<ToolDefinition | undefined> =>
      toolId === REQUEST_INPUT_TOOL_NAME ? definition : undefined,

    /**
     * Defensive implementation — in normal operation this method is never
     * called because `runIteration` intercepts the tool call before routing
     * it here.  It is implemented so the plugin works in isolation (e.g. unit
     * tests that bypass the iteration intercept).
     */
    executeTool: (toolCall, _context) =>
      of(
        toolInputRequiredEvent(toolCall, {
          inputType:
            (toolCall.function.arguments?.input_type as
              | 'confirmation'
              | 'clarification'
              | 'selection'
              | 'data') ?? 'data',
          prompt: String(toolCall.function.arguments?.prompt ?? 'Input required'),
          options: toolCall.function.arguments?.options as unknown[] | undefined,
          schema: toolCall.function.arguments?.schema as
            | import('../types/event').JSONSchema
            | undefined,
        }),
      ),
  };
}
