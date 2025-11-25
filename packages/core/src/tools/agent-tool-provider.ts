import z from 'zod';
import type { ExecutionContext } from '../types';
import type { ToolCall, ToolDefinition, ToolProvider, ToolResult } from '../types/tools';

const cardSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  url: z.url(),
  icon: z.string().optional(),
  skills: z
    .array(
      z.object({
        name: z.string(),
        description: z.string().optional(),
      }),
    )
    .optional(),
  auth: z
    .object({
      issuer: z.string(),
      audience: z.string(),
      scopes: z.array(z.string()),
    })
    .optional(),
});

type AgentCard = z.infer<typeof cardSchema>;

const safeName = (name: string): string => name.replace(/[^a-zA-Z0-9-]+/g, '-').toLowerCase();

export class AgentToolProvider implements ToolProvider {
  static fromUrl = (cardUrl: string): Promise<AgentToolProvider> => {
    return fetch(cardUrl)
      .then((response) => response.json())
      .then((card) => {
        return AgentToolProvider.from(card as AgentCard);
      });
  };

  static from = (card: AgentCard): AgentToolProvider => {
    const parsed = cardSchema.parse(card);
    return new AgentToolProvider(parsed);
  };

  private readonly agentName: string;
  readonly name: string;
  private readonly tools: ToolDefinition[];

  constructor(readonly card: AgentCard) {
    this.agentName = safeName(card.name);
    this.name = `agent:${this.agentName}`;

    this.tools = [
      {
        name: `${this.name}/invoke`,
        description: card.description || `Invoke the ${card.name} agent`,
        icon: card.icon,
        parameters: {
          type: 'object',
          properties: {
            prompt: { type: 'string', description: 'The prompt to send to the agent' },
          },
          additionalProperties: false,
        },
      },
    ] satisfies ToolDefinition[];
  }

  getTool(toolName: string): Promise<ToolDefinition | undefined> {
    const tool = this.tools.find((t) => t.name === toolName);
    return Promise.resolve(tool);
  }

  getTools(): Promise<ToolDefinition[]> {
    return Promise.resolve(this.tools);
  }

  execute(toolCall: ToolCall, _context: ExecutionContext): Promise<ToolResult> {
    const tool = this.getTool(toolCall.function.name);
    if (!tool) {
      return Promise.reject(new Error(`Tool not found: ${toolCall.function.name}`));
    }
    // TODO implement agent invocation and streaming response
    throw new Error('Method not implemented.');
  }
}
