/**
 * Calculate Tool
 *
 * Evaluates mathematical expressions
 */

import { getLogger, tool } from '@looopy-ai/core';
import { evaluate } from 'mathjs';
import { z } from 'zod';

export const calculateTool = tool({
  id: 'calculate',
  icon: 'lucide:calculator',
  description: 'Evaluate a mathematical expression. Supports +, -, *, /, parentheses.',
  schema: z.object({
    expression: z.string().describe('The mathematical expression to evaluate (e.g., "2 + 2 * 3")'),
  }),
  handler: async ({ expression }) => {
    const logger = getLogger({ component: 'calculate-tool', expression });
    logger.info(`🔧 [LOCAL] Executing: calculate`);

    try {
      const result = evaluate(expression);
      logger.info({ result }, 'Success');

      return { success: true, result: { expression, result } };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error({ error: err.message }, 'Error');
      throw err;
    }
  },
});
