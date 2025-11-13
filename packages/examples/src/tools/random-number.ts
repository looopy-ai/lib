/**
 * Random Number Tool
 *
 * Generate a random number between min and max
 */

import { tool } from '@looopy-ai/core/ts/tools';
import { z } from 'zod';

export const randomNumberTool = tool(
  'get_random_number',
  'Generate a random number between min and max',
  z.object({
    min: z.number().describe('Minimum value (inclusive)'),
    max: z.number().describe('Maximum value (inclusive)'),
  }),
  async ({ min, max }) => {
    const result = Math.floor(Math.random() * (max - min + 1)) + min;
    return {
      min,
      max,
      result,
    };
  },
);
