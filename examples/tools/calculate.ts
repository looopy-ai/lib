/**
 * Calculate Tool
 *
 * Evaluates mathematical expressions
 */

import { z } from 'zod';
import { tool } from '../../src/tools/local-tools';

export const calculateTool = tool(
  'calculate',
  'Evaluate a mathematical expression. Supports +, -, *, /, parentheses.',
  z.object({
    expression: z.string().describe('The mathematical expression to evaluate (e.g., "2 + 2 * 3")'),
  }),
  async ({ expression }) => {
    console.log(`\n🔧 [LOCAL] Executing: calculate`);
    console.log(`   Arguments:`, { expression });

    try {
      // eslint-disable-next-line no-eval
      const result = eval(expression);
      console.log(`   ✓ Result: ${result}`);

      return { expression, result };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      console.error(`   ✗ Error: ${err.message}`);
      throw err;
    }
  }
);
