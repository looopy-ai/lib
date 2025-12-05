/**
 * Random Number Tool
 *
 * Generate a random number between min and max
 */

import { tool } from '@looopy-ai/core';
import { z } from 'zod';

export const randomNumberTool = tool({
  name: 'get_random_number',
  description: 'Generate a random number between min and max',
  schema: z.object({
    min: z.number().describe('Minimum value (inclusive)'),
    max: z.number().describe('Maximum value (inclusive)'),
  }),
  handler: async ({ min, max }) => {
    const result = Math.floor(Math.random() * (max - min + 1)) + min;
    return {
      success: true,
      result: {
        min,
        max,
        result,
      },
    };
  },
});
