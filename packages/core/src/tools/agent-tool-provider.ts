import { consumeSSEStream } from '@geee-be/sse-stream-parser';
import type pino from 'pino';
import { Observable } from 'rxjs';
import z from 'zod';
import { getLogger } from '../core';
import type { ContextAnyEvent, ContextEvent, ExecutionContext, ToolCompleteEvent } from '../types';
import type { ToolCall, ToolDefinition, ToolProvider } from '../types/tools';
import { toolErrorEvent } from './tool-result-events';

export type HeaderFactory = (context?: ExecutionContext) => Promise<Record<string, string>>;

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
  static fromUrl = (cardUrl: string, getHeaders?: HeaderFactory): Promise<AgentToolProvider> => {
    return fetch(cardUrl)
      .then((response) => response.json())
      .then((card) => {
        return AgentToolProvider.from(card as AgentCard, getHeaders);
      });
  };

  static from = (card: AgentCard, getHeaders?: HeaderFactory): AgentToolProvider => {
    const parsed = cardSchema.parse(card);
    return new AgentToolProvider(parsed, getHeaders);
  };

  private readonly agentName: string;
  readonly name: string;
  private readonly tools: ToolDefinition[];
  private readonly logger: pino.Logger;

  constructor(
    readonly card: AgentCard,
    readonly getHeaders?: HeaderFactory,
  ) {
    this.agentName = safeName(card.name);
    this.name = `agent__${this.agentName}`;
    this.logger = getLogger({ component: 'agent-tool-provider', agentName: this.agentName });

    this.tools = [
      {
        name: `${this.name}__invoke`,
        description:
          `Invoke the ${card.name} agent.\n\n${card.description}` ||
          `Invoke the ${card.name} agent`,
        icon: card.icon,
        parameters: {
          type: 'object',
          properties: {
            prompt: {
              type: 'string',
              description:
                'The prompt to send to the agent. This will call or invoke the agent sending this prompt as the input. This will start or continue a conversation "turn" with this agent. Example: "What is the weather today?"',
            },
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

  execute(toolCall: ToolCall, context: ExecutionContext) {
    this.logger.debug(
      { toolCallId: toolCall.id, toolName: toolCall.function.name },
      'Executing agent tool call',
    );

    return new Observable<ContextAnyEvent>((subscriber) => {
      const abortController = new AbortController();

      const run = async () => {
        const tool = await this.getTool(toolCall.function.name);
        if (!tool) {
          this.logger.error({ toolName: toolCall.function.name }, 'Tool not found');
          subscriber.next(
            toolErrorEvent(context, toolCall, `Tool not found: ${toolCall.function.name}`),
          );
          subscriber.complete();
          return;
        }

        const prompt = toolCall.function.arguments.prompt;
        if (!prompt || typeof prompt !== 'string') {
          this.logger.error('Invalid tool call arguments');
          subscriber.next(
            toolErrorEvent(
              context,
              toolCall,
              'Tool argument must include "prompt" and it must be a string',
            ),
          );
          subscriber.complete();
          return;
        }

        const res = await fetch(`${this.card.url}/invocations?qualifier=DEFAULT`, {
          method: 'POST',
          headers: {
            Accept: 'text/event-stream',
            'X-Amzn-Bedrock-AgentCore-Runtime-Session-Id': context.contextId,
            ...(await this.getHeaders?.(context)),
          },
          body: JSON.stringify({ prompt }),
          signal: abortController.signal,
        });

        if (!res.ok) {
          this.logger.error(
            { status: res.status, statusText: res.statusText },
            'Agent call failed',
          );
          subscriber.next(
            toolErrorEvent(
              context,
              toolCall,
              `Agent endpoint responded with ${res.status} ${res.statusText}`,
            ),
          );
          subscriber.complete();
          return;
        }

        const body = res.body;
        if (!body) {
          this.logger.error('Agent response has no body');
          subscriber.next(toolErrorEvent(context, toolCall, 'Agent returned no response body'));
          subscriber.complete();
          return;
        }

        await consumeSSEStream(
          body,
          (e) => {
            if (subscriber.closed) return;
            subscriber.next({
              kind: e.event,
              parentTaskId: context.taskId,
              ...JSON.parse(e.data),
            });
            this.logger.debug({ event: e.event }, 'Received SSE event');
          },
          () => {
            if (!subscriber.closed) {
              const toolCompleteEvent: ContextEvent<ToolCompleteEvent> = {
                kind: 'tool-complete',
                contextId: context.contextId,
                taskId: context.taskId,
                toolCallId: toolCall.id,
                toolName: toolCall.function.name,
                success: true, // TODO
                result: 'Complete',
                timestamp: new Date().toISOString(),
              };
              subscriber.next(toolCompleteEvent);
              subscriber.complete();
              this.logger.debug('Tool execution complete');
            }
          },
        );
      };

      run().catch((err) => {
        this.logger.error({ err }, 'Tool execution error');
        if (!subscriber.closed) {
          subscriber.error(err);
        }
      });

      return () => {
        abortController.abort();
      };
    });
  }
}
