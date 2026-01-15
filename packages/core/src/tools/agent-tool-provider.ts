import { consumeSSEStream } from '@geee-be/sse-stream-parser';
import { trace } from '@opentelemetry/api';
import type pino from 'pino';
import { Observable } from 'rxjs';
import z from 'zod';
import { getLogger } from '../core';
import type {
  AnyEvent,
  ContextAnyEvent,
  ExecutionContext,
  ToolCompleteEvent,
  ToolPlugin,
} from '../types';
import type { ToolCall, ToolDefinition } from '../types/tools';
import { toolErrorEvent } from './tool-result-events';

export type HeaderFactory<AuthContext> = (
  context: ExecutionContext<AuthContext>,
  card: AgentCard,
) => Promise<Record<string, string | undefined>>;

export const cardSchema = z.object({
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
      token_endpoint: z.string(),
      scopes: z.array(z.string()),
    })
    .loose()
    .optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type AgentCard = z.infer<typeof cardSchema>;

const safeName = (name: string): string => name.replace(/[^a-zA-Z0-9-]+/g, '-').toLowerCase();

export class AgentToolProvider<AuthContext> implements ToolPlugin<AuthContext> {
  static fromUrl = <AuthContext>(
    cardUrl: string,
    getHeaders?: HeaderFactory<AuthContext>,
  ): Promise<AgentToolProvider<AuthContext>> => {
    return fetch(cardUrl)
      .then((response) => response.json())
      .then((card) => {
        return AgentToolProvider.from(card as AgentCard, getHeaders);
      });
  };

  static from = <AuthContext>(
    card: AgentCard,
    getHeaders?: HeaderFactory<AuthContext>,
  ): AgentToolProvider<AuthContext> => {
    const parsed = cardSchema.parse(card);
    return new AgentToolProvider(parsed, getHeaders);
  };

  private readonly agentName: string;
  readonly name: string;
  private readonly tools: ToolDefinition[];
  private readonly logger: pino.Logger;

  constructor(
    readonly card: AgentCard,
    readonly getHeaders?: HeaderFactory<AuthContext>,
  ) {
    this.agentName = safeName(card.name);
    this.name = `agent__${this.agentName}`;
    this.logger = getLogger({ component: 'agent-tool-provider', agentName: this.agentName });

    this.tools = [
      {
        id: `${this.name}__invoke`,
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
    const tool = this.tools.find((t) => t.id === toolName);
    return Promise.resolve(tool);
  }

  listTools(): Promise<ToolDefinition[]> {
    return Promise.resolve(this.tools);
  }

  executeTool(toolCall: ToolCall, context: ExecutionContext<AuthContext>) {
    const logger = this.logger.child({
      taskId: context.taskId,
      toolCallId: toolCall.id,
    });
    logger.debug({ toolCallId: toolCall.id }, 'Executing agent tool call');

    return new Observable<AnyEvent>((subscriber) => {
      const abortController = new AbortController();

      const run = async () => {
        const tool = await this.getTool(toolCall.function.name);
        if (!tool) {
          logger.error({ toolName: toolCall.function.name }, 'Tool not found');
          subscriber.next(toolErrorEvent(toolCall, `Tool not found: ${toolCall.function.name}`));
          subscriber.complete();
          return;
        }

        const prompt = toolCall.function.arguments.prompt;
        if (!prompt || typeof prompt !== 'string') {
          logger.error('Invalid tool call arguments');
          subscriber.next(
            toolErrorEvent(toolCall, 'Tool argument must include "prompt" and it must be a string'),
          );
          subscriber.complete();
          return;
        }

        const span = trace.getSpan(context.parentContext);
        span?.updateName(`agent.invoke[${toolCall.function.name}]`);

        const res = await fetch(`${this.card.url}/invocations?qualifier=DEFAULT`, {
          method: 'POST',
          headers: {
            Accept: 'text/event-stream',
            'X-Amzn-Bedrock-AgentCore-Runtime-Session-Id': `${context.contextId}`,
            ...(await this.getHeaders?.(context, this.card)),
          },
          body: JSON.stringify({ type: 'prompt', prompt }),
          signal: abortController.signal,
        });

        if (!res.ok) {
          logger.error({ status: res.status, statusText: res.statusText }, 'Agent call failed');
          subscriber.next(
            toolErrorEvent(
              toolCall,
              `Agent endpoint responded with ${res.status} ${res.statusText}`,
            ),
          );
          subscriber.complete();
          return;
        }

        const body = res.body;
        if (!body) {
          logger.error('Agent response has no body');
          subscriber.next(toolErrorEvent(toolCall, 'Agent returned no response body'));
          subscriber.complete();
          return;
        }

        let content = '';
        await consumeSSEStream(body, (e) => {
          if (subscriber.closed) return;
          const data = JSON.parse(e.data) as Record<string, unknown>;
          subscriber.next({
            kind: e.event,
            parentTaskId: context.taskId,
            ...data,
            path: [
              `agent:${this.card.name}`,
              ...('path' in data && Array.isArray(data.path)
                ? data.path.filter((p) => typeof p === 'string' && p)
                : []),
            ],
          } as ContextAnyEvent);
          if (e.event === 'task-complete') {
            content = data.content as string;
          }
          logger.debug({ event: e.event }, 'Received SSE event');
        });

        if (!subscriber.closed) {
          const toolCompleteEvent: ToolCompleteEvent = {
            kind: 'tool-complete',
            toolCallId: toolCall.id,
            toolName: toolCall.function.name,
            success: true, // TODO
            result: content || 'Complete',
            timestamp: new Date().toISOString(),
          };
          subscriber.next(toolCompleteEvent);
          subscriber.complete();
          logger.debug('Tool execution complete');
        }
      };

      run().catch((err) => {
        logger.error({ err }, 'Tool execution error');
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
