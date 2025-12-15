/**
 * LLM Call Span Helpers
 *
 * Tracing utilities for LLM provider calls
 */

import { SpanStatusCode, trace } from '@opentelemetry/api';
import { tap } from 'rxjs/internal/operators/tap';
import { isChildTaskEvent } from '../../events/utils';
import type { LoopContext } from '../../types/core';
import type { AnyEvent } from '../../types/event';
import type { LLMMessage } from '../../types/message';
import type { ToolDefinition } from '../../types/tools';
import type { SystemPrompts } from '../../utils/prompt';
import { SpanAttributes, SpanNames } from '../tracing';

export interface LLMCallSpanParams {
  agentId: string;
  taskId: string;
  messages: LLMMessage[];
  parentContext: import('@opentelemetry/api').Context;
}

/**
 * Start LLM call span
 */
export const startLLMCallSpan = <AuthContext>(
  context: LoopContext<AuthContext>,
  systemPrompts: SystemPrompts,
  messages: LLMMessage[],
  tools: ToolDefinition[],
) => {
  const tracer = trace.getTracer('looopy');

  const source = systemPrompts.before
    .concat(systemPrompts.after)
    .filter((sp) => sp.source?.providerName === 'langfuse')
    .at(0)?.source;

  const span = tracer.startSpan(
    SpanNames.LLM_CALL,
    {
      attributes: {
        [SpanAttributes.AGENT_ID]: context.agentId,
        [SpanAttributes.TASK_ID]: context.taskId,
        [SpanAttributes.GEN_AI_PROMPT]: JSON.stringify(messages),
        [SpanAttributes.LANGFUSE_OBSERVATION_TYPE]: 'generation',
        [SpanAttributes.LANGFUSE_PROMPT_NAME]: source?.promptName,
        [SpanAttributes.LANGFUSE_PROMPT_VERSION]: source?.promptVersion,
        'tools.available': tools.map((t) => t.id),
      },
    },
    context.parentContext,
  );

  const traceContext = trace.setSpan(context.parentContext, span);

  return {
    span,
    traceContext,
    tapFinish: tap<AnyEvent>({
      next: (event) => {
        if (isChildTaskEvent(event)) return;
        switch (event.kind) {
          case 'content-complete':
            if (event.content) {
              span.setAttribute(SpanAttributes.GEN_AI_COMPLETION, event.content);
            }
            span.setAttribute(SpanAttributes.LLM_FINISH_REASON, event.finishReason || 'unknown');
            span.setStatus({ code: SpanStatusCode.OK });
            break;
          case 'llm-usage':
            span.setAttribute(SpanAttributes.GEN_AI_RESPONSE_MODEL, event.model);
            span.setAttribute(SpanAttributes.GEN_AI_USAGE_PROMPT_TOKENS, event.prompt_tokens || 0);
            span.setAttribute(
              SpanAttributes.GEN_AI_USAGE_COMPLETION_TOKENS,
              event.completion_tokens || 0,
            );
            span.setAttribute(SpanAttributes.GEN_AI_USAGE_TOTAL_TOKENS, event.total_tokens || 0);
            span.setAttribute(
              SpanAttributes.GEN_AI_USAGE_COMPLETION_TOKENS_DETAILS,
              JSON.stringify(event.completion_tokens_details || {}),
            );
            span.setAttribute(
              SpanAttributes.GEN_AI_USAGE_PROMPT_TOKENS_DETAILS,
              JSON.stringify(event.prompt_tokens_details || {}),
            );
            span.setAttribute(
              SpanAttributes.GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS,
              event.cache_creation_input_tokens || 0,
            );
            span.setAttribute(
              SpanAttributes.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS,
              event.cache_read_input_tokens || 0,
            );
            break;
          default:
            break;
        }
      },
      complete: () => span.end(),
      error: (err) => {
        span.recordException(err);
        span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
        span.end();
      },
    }),
  };
};
