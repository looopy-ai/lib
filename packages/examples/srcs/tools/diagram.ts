
import { z } from 'zod';

export const diagramTool = {
  definition: {
    name: 'diagram',
    description: 'Renders a Mermaid diagram and returns a confirmation message.',
    parameters: z.object({
      diagram: z.string().describe('The Mermaid diagram to render.'),
    }),
  },
  execute: async (_toolCallId: string, { diagram }: { diagram: string }) => {
    // In a real application, this would render the diagram.
    // For this example, we'll just return a confirmation.
    return {
      success: true,
      result: `Diagram rendered successfully:\n${diagram}`,
    };
  },
};
