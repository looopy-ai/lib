/**
 * Agent Loop - Core Execution Engine
 *
 * Orchestrates interactions between LLMs, tools, and sub-agents using RxJS observables.
 * Implements the reactive agent loop pattern with checkpointing and resumption support.
 *
 * Design Reference: design/agent-loop.md
 */

import {
  context as otelContext,
  type Span,
  type Context as SpanContext,
  SpanStatusCode,
  trace,
} from '@opentelemetry/api';
import { concat, defer, type Observable, of } from 'rxjs';
import { catchError, map, shareReplay, switchMap, tap } from 'rxjs/operators';
import {
  extractTraceContext,
  injectTraceContext,
  SpanAttributes,
  SpanNames,
} from '../observability/tracing';
import type { AgentLoopConfig } from './config';
import { getLogger } from './logger';
import type {
  AgentEvent,
  Context,
  ExecutionContext,
  LLMResponse,
  LoopState,
  Message,
  PersistedLoopState,
  ToolCall,
  ToolResult,
} from './types';

type WithTraceContext = {
  _rootSpan?: Span;
  _rootContext?: SpanContext;
};

/**
 * Generate unique task ID
 */
function generateTaskId(): string {
  return `task_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
} /**
 * Agent Loop
 *
 * Main execution engine for the agent framework.
 */
export class AgentLoop {
  private readonly config: Required<Omit<AgentLoopConfig, 'logger'>> & {
    logger: import('pino').Logger;
  };

  constructor(config: AgentLoopConfig) {
    this.config = {
      maxIterations: 20,
      systemPrompt: 'You are a helpful AI assistant.',
      enableCheckpoints: true,
      checkpointInterval: 3,
      ...config,
      logger: config.logger || getLogger({ component: 'AgentLoop' }),
    };
  }

  /**
   * Execute agent loop with a prompt
   */
  execute(prompt: string, context: Partial<Context> = {}): Observable<AgentEvent> {
    const execId = `exec_${Math.random().toString(36).slice(2, 8)}`;
    this.config.logger.info({ prompt, context, execId }, 'Starting agent execution');

    // Create root span for the entire execution
    const tracer = trace.getTracer('looopy');
    const parentContext = context.traceContext
      ? extractTraceContext(context.traceContext)
      : undefined;

    // Store root span in closure so we can access it in catchError
    let rootSpan: Span | null = null;

    return defer(() => {
      this.config.logger.trace({ execId }, 'defer() executing - prepareExecution');
      return this.prepareExecution(prompt, context);
    }).pipe(
      tap((state) => {
        // Inject trace context into state
        const activeContext = parentContext || otelContext.active();
        const span = tracer.startSpan(
          SpanNames.AGENT_EXECUTE,
          {
            attributes: {
              [SpanAttributes.AGENT_ID]: state.agentId,
              [SpanAttributes.TASK_ID]: state.taskId,
              [SpanAttributes.CONTEXT_ID]: state.contextId,
              input: prompt,
              // Mark as "agent" type in Langfuse (agent decides on application flow)
              [SpanAttributes.LANGFUSE_OBSERVATION_TYPE]: 'agent',
            },
          },
          activeContext
        );

        const spanContext = trace.setSpan(activeContext, span);
        state.traceContext = injectTraceContext(spanContext);

        // Store the span so we can set output later
        rootSpan = span;
        (state as WithTraceContext)._rootSpan = span;
        // Store the root context so iterations can use it as parent (not nest in each other)
        (state as WithTraceContext)._rootContext = spanContext;

        this.config.logger.debug(
          {
            taskId: state.taskId,
            contextId: state.contextId,
            toolCount: state.availableTools.length,
            traceId: state.traceContext?.traceId,
          },
          'Execution prepared'
        );
      }),
      switchMap((state: LoopState) => {
        this.config.logger.trace({ taskId: state.taskId }, 'switchMap to runLoop');
        return this.runLoop(state);
      }),
      tap((event) => {
        // Set output on root span when task completes
        if (event.kind === 'status-update' && event.final) {
          const span = (event as WithTraceContext)._rootSpan;
          if (span) {
            if (event.status.state === 'completed' && event.status.message?.content) {
              span.setAttribute('output', event.status.message.content);
            }
            span.setStatus({
              code: event.status.state === 'completed' ? SpanStatusCode.OK : SpanStatusCode.ERROR,
            });
            span.end();
          }
        }
      }),
      catchError((error: Error) => {
        this.config.logger.error(
          { error: error.message, stack: error.stack, execId },
          'Agent execution failed'
        );

        // End root span with error
        if (rootSpan) {
          rootSpan.setStatus({
            code: SpanStatusCode.ERROR,
            message: error.message,
          });
          rootSpan.recordException(error);
          rootSpan.end();
        }

        const errorEvent: AgentEvent = {
          kind: 'status-update',
          taskId: context.taskId || 'unknown',
          contextId: context.contextId || 'unknown',
          status: {
            state: 'failed',
            timestamp: new Date().toISOString(),
          },
          final: true,
          metadata: { error: error.message },
        };

        return of(errorEvent);
      }),
      // Share the execution to prevent duplicate executions on multiple subscriptions
      // shareReplay(1) ensures:
      // - Only one execution happens regardless of subscriber count
      // - Late subscribers get all events from the beginning
      // - The observable stays "hot" and shared
      shareReplay()
    );
  }

  /**
   * Resume execution from persisted state
   */
  static async resume(
    taskId: string,
    config: AgentLoopConfig,
    context: Partial<Context> = {}
  ): Promise<Observable<AgentEvent>> {
    const logger = config.logger || getLogger({ component: 'AgentLoop' });
    logger.info({ taskId }, 'Resuming agent execution');

    const state = await config.stateStore.load(taskId);

    if (!state) {
      logger.warn({ taskId }, 'Task not found or expired');
      throw new Error(`Task ${taskId} not found or expired`);
    }

    if (state.completed) {
      logger.info({ taskId }, 'Task already completed');
      return of({
        kind: 'status-update',
        taskId: state.taskId,
        contextId: state.contextId,
        status: {
          state: 'completed',
          timestamp: new Date().toISOString(),
        },
        final: true,
      });
    }

    logger.debug(
      { taskId, iteration: state.iteration },
      'Restoring state and continuing execution'
    );

    const loop = new AgentLoop(config);
    const loopState = await loop.restoreState(state, context);
    return loop.runLoop(loopState);
  }

  /**
   * Prepare initial execution state
   */
  private async prepareExecution(prompt: string, context: Partial<Context>): Promise<LoopState> {
    const taskId = context.taskId || generateTaskId();
    const contextId = context.contextId || `ctx_${Date.now()}`;

    // Gather tools from all providers
    const toolPromises = this.config.toolProviders.map((p) => p.getTools());
    const toolArrays = await Promise.all(toolPromises);
    const availableTools = toolArrays.flat();

    // System prompt message is injected in callLLM() to aid history compaction
    const initialMessages: Message[] = [
      {
        role: 'user',
        content: prompt,
      },
    ];

    return {
      taskId,
      agentId: this.config.agentId,
      parentTaskId: context.parentTaskId,
      contextId,
      messages: initialMessages,
      systemPrompt: context.systemPrompt || this.config.systemPrompt,
      availableTools,
      toolResults: new Map(),
      subAgents: [],
      activeSubAgents: new Set(),
      completed: false,
      iteration: 0,
      maxIterations: context.maxIterations || this.config.maxIterations,
      context: {
        agentId: this.config.agentId,
        contextId,
        ...context,
      },
      traceContext: context.traceContext,
      authContext: context.authContext,
      stateStore: this.config.stateStore,
      artifactStore: this.config.artifactStore,
    };
  }

  /**
   * Restore state from persisted data
   */
  private async restoreState(
    persisted: PersistedLoopState,
    context: Partial<Context>
  ): Promise<LoopState> {
    return {
      ...persisted,
      subAgents: persisted.activeSubAgents,
      maxIterations: this.config.maxIterations,
      toolResults: new Map(Object.entries(persisted.completedToolCalls)),
      activeSubAgents: new Set(persisted.activeSubAgents.map((a) => a.taskId)),
      context: {
        agentId: persisted.agentId,
        contextId: persisted.contextId,
        taskId: persisted.taskId,
        ...context,
      },
      stateStore: this.config.stateStore,
      artifactStore: this.config.artifactStore,
    };
  }

  /**
   * Run the main agent loop
   */
  private runLoop(initialState: LoopState): Observable<AgentEvent> {
    // Emit initial task event (A2A protocol)
    const taskEvent: AgentEvent = {
      kind: 'task',
      id: initialState.taskId,
      contextId: initialState.contextId,
      status: {
        state: 'submitted',
        timestamp: new Date().toISOString(),
      },
      history: initialState.messages,
      artifacts: [],
    };

    // Emit working status
    const workingEvent: AgentEvent = {
      kind: 'status-update',
      taskId: initialState.taskId,
      contextId: initialState.contextId,
      status: {
        state: 'working',
        timestamp: new Date().toISOString(),
      },
      final: false,
    };

    // Emit initial events, then start the loop
    return concat(
      of(taskEvent, workingEvent),
      defer(() => {
        this.config.logger.trace({ taskId: initialState.taskId }, 'Starting iteration recursion');

        // Create observable that recursively executes iterations
        const iterate = (state: LoopState): Observable<LoopState> => {
          this.config.logger.trace(
            {
              taskId: state.taskId,
              iteration: state.iteration,
              completed: state.completed,
            },
            'iterate() called'
          );

          // Check termination conditions
          if (state.completed || state.iteration >= state.maxIterations) {
            this.config.logger.debug(
              {
                taskId: state.taskId,
                completed: state.completed,
                iteration: state.iteration,
                maxIterations: state.maxIterations,
              },
              'Loop done - terminating'
            );
            return of(state);
          }

          // Execute iteration and continue
          return this.executeIteration(state).pipe(
            switchMap((nextState) => {
              this.config.logger.trace(
                {
                  taskId: nextState.taskId,
                  iteration: nextState.iteration,
                  completed: nextState.completed,
                },
                'Continuing to next iteration'
              );
              return iterate(nextState);
            })
          );
        };

        return iterate(initialState);
      }).pipe(
        // Filter to only emit events, not state
        switchMap((state: LoopState) => this.stateToEvents(state))
      )
    );
  }

  /**
   * Execute a single iteration
   */
  private executeIteration(state: LoopState): Observable<LoopState> {
    const nextIteration = state.iteration + 1;

    this.config.logger.debug(
      {
        taskId: state.taskId,
        iteration: nextIteration,
      },
      'Starting iteration'
    );

    // Create span for this iteration
    const tracer = trace.getTracer('looopy');
    // Use the root context so iterations are siblings, not nested
    const rootContext = (state as WithTraceContext)._rootContext || otelContext.active();

    const span = tracer.startSpan(
      SpanNames.AGENT_ITERATION,
      {
        attributes: {
          [SpanAttributes.AGENT_ID]: state.agentId,
          [SpanAttributes.TASK_ID]: state.taskId,
          [SpanAttributes.ITERATION]: nextIteration,
          // Mark as "chain" in Langfuse (links application steps)
          [SpanAttributes.LANGFUSE_OBSERVATION_TYPE]: 'chain',
        },
      },
      rootContext
    );

    // Set this iteration span as active context for child spans (LLM, tools)
    const iterationContext = trace.setSpan(rootContext, span);

    return of(state).pipe(
      // Inject iteration context into state so child operations can use it
      map((s: LoopState) => ({
        ...s,
        traceContext: injectTraceContext(iterationContext),
      })),

      // Call LLM (will be child of iteration span)
      switchMap((s: LoopState) => this.callLLM(s, nextIteration)),

      // Process LLM response (tool executions will be children of iteration span)
      switchMap((s: LoopState) => this.processLLMResponse(s)),

      // Checkpoint if needed
      switchMap((s: LoopState) => this.checkpointIfNeeded(s)),

      // Update iteration
      map((s: LoopState) => {
        this.config.logger.trace(
          {
            taskId: s.taskId,
            iteration: nextIteration,
            completed: s.completed,
          },
          'Iteration complete'
        );

        // End span
        span.setStatus({ code: SpanStatusCode.OK });
        span.end();

        return { ...s, iteration: nextIteration };
      }),
      catchError((error) => {
        // Record error in span
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : String(error),
        });
        span.recordException(error as Error);
        span.end();
        throw error;
      })
    );
  }

  /**
   * Call the LLM provider
   */
  private callLLM(state: LoopState, _iteration: number): Observable<LoopState> {
    const messages = [
      {
        role: 'system' as const,
        content: state.systemPrompt,
      },
      ...state.messages,
    ];
    this.config.logger.debug(
      {
        taskId: state.taskId,
        messageCount: messages.length,
        toolCount: state.availableTools.length,
      },
      'Calling LLM'
    );

    // Create span for LLM call
    const tracer = trace.getTracer('looopy');
    const parentContext = state.traceContext ? extractTraceContext(state.traceContext) : undefined;

    const span = tracer.startSpan(
      SpanNames.LLM_CALL,
      {
        attributes: {
          [SpanAttributes.AGENT_ID]: state.agentId,
          [SpanAttributes.TASK_ID]: state.taskId,
          // Mark as "generation" for Langfuse to recognize it as an LLM call
          [SpanAttributes.LANGFUSE_OBSERVATION_TYPE]: 'generation',
        },
      },
      parentContext || otelContext.active()
    );

    return this.config.llmProvider
      .call({
        messages,
        tools: state.availableTools.length > 0 ? state.availableTools : undefined,
        sessionId: state.taskId, // Pass taskId as session ID for tracking
      })
      .pipe(
        tap((response: LLMResponse) => {
          // Add LLM response attributes to span
          span.setAttribute(SpanAttributes.LLM_FINISH_REASON, response.finishReason || 'unknown');

          // Set input/output for Langfuse (uses gen_ai.prompt and gen_ai.completion)
          span.setAttribute(SpanAttributes.GEN_AI_PROMPT, JSON.stringify(state.messages));
          span.setAttribute(SpanAttributes.GEN_AI_COMPLETION, response.message.content || '');

          // Set model information if available
          if (response.model) {
            span.setAttribute(SpanAttributes.GEN_AI_REQUEST_MODEL, response.model);
            span.setAttribute(SpanAttributes.GEN_AI_RESPONSE_MODEL, response.model);
          }

          // Set usage information if available
          if (response.usage) {
            if (response.usage.promptTokens) {
              span.setAttribute(
                SpanAttributes.GEN_AI_USAGE_PROMPT_TOKENS,
                response.usage.promptTokens
              );
            }
            if (response.usage.completionTokens) {
              span.setAttribute(
                SpanAttributes.GEN_AI_USAGE_COMPLETION_TOKENS,
                response.usage.completionTokens
              );
            }
            if (response.usage.totalTokens) {
              span.setAttribute(
                SpanAttributes.GEN_AI_USAGE_TOTAL_TOKENS,
                response.usage.totalTokens
              );
            }
          }

          this.config.logger.debug(
            {
              taskId: state.taskId,
              finishReason: response.finishReason,
              hasToolCalls: !!response.toolCalls?.length,
              toolCallCount: response.toolCalls?.length || 0,
            },
            'LLM response received'
          );

          // End span successfully
          span.setStatus({ code: SpanStatusCode.OK });
          span.end();
        }),
        map((response: LLMResponse) => ({
          ...state,
          lastLLMResponse: response,
        })),
        catchError((error) => {
          // Record error in span
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: error instanceof Error ? error.message : String(error),
          });
          span.recordException(error as Error);
          span.end();
          throw error;
        })
      );
  }

  /**
   * Process LLM response - execute tools or complete
   */
  private processLLMResponse(state: LoopState): Observable<LoopState> {
    const response = state.lastLLMResponse;

    if (!response) {
      this.config.logger.warn({ taskId: state.taskId }, 'No LLM response');
      return of({ ...state, completed: true });
    }

    // Execute tool calls if present (priority over finish check)
    if (response.toolCalls && response.toolCalls.length > 0) {
      this.config.logger.info(
        {
          taskId: state.taskId,
          toolCallCount: response.toolCalls.length,
          tools: response.toolCalls.map((tc) => tc.function.name),
        },
        'Executing tool calls'
      );

      return this.executeTools(response.toolCalls, state).pipe(
        tap((toolResults: ToolResult[]) => {
          this.config.logger.trace(
            {
              taskId: state.taskId,
              results: toolResults.map((r) => ({
                tool: r.toolName,
                success: r.success,
                error: r.error,
              })),
            },
            'Tool execution complete'
          );
        }),
        map((toolResults: ToolResult[]) => {
          // Add assistant message and tool results to conversation
          const newMessages: Message[] = [
            response.message,
            ...toolResults.map((result: ToolResult) => ({
              role: 'tool' as const,
              content: JSON.stringify(result.result),
              toolCallId: result.toolCallId,
              name: result.toolName,
            })),
          ];

          // Store tool results
          const updatedResults = new Map(state.toolResults);
          toolResults.forEach((r: ToolResult) => {
            updatedResults.set(r.toolCallId, r);
          });

          // Don't mark as completed - we need to call LLM again with tool results
          this.config.logger.trace(
            { taskId: state.taskId },
            'Tool results added to conversation, continuing loop'
          );

          return {
            ...state,
            messages: [...state.messages, ...newMessages],
            toolResults: updatedResults,
            completed: false, // Continue loop to process tool results
          };
        })
      );
    }

    // Check if finished (only if no tool calls)
    if (response.finished || response.finishReason === 'stop') {
      this.config.logger.info(
        {
          taskId: state.taskId,
          finishReason: response.finishReason,
        },
        'Task completed'
      );
      return of({ ...state, completed: true });
    }

    // No tools and not finished, continue
    this.config.logger.trace(
      {
        taskId: state.taskId,
        finishReason: response.finishReason,
      },
      'Continuing loop (no tools, not finished)'
    );
    return of(state);
  }

  /**
   * Execute tool calls
   */
  private executeTools(toolCalls: ToolCall[], state: LoopState): Observable<ToolResult[]> {
    const execContext: ExecutionContext = {
      taskId: state.taskId,
      contextId: state.contextId,
      agentId: state.agentId,
      traceContext: state.traceContext,
      authContext: state.authContext,
    };

    const tracer = trace.getTracer('looopy');
    const parentContext = state.traceContext ? extractTraceContext(state.traceContext) : undefined;

    const resultPromises = toolCalls.map(async (toolCall) => {
      // Create span for this tool execution
      const span = tracer.startSpan(
        SpanNames.TOOL_EXECUTE,
        {
          attributes: {
            [SpanAttributes.AGENT_ID]: state.agentId,
            [SpanAttributes.TASK_ID]: state.taskId,
            [SpanAttributes.TOOL_NAME]: toolCall.function.name,
            [SpanAttributes.TOOL_CALL_ID]: toolCall.id,
            // Mark as "tool" type in Langfuse (represents tool calls)
            [SpanAttributes.LANGFUSE_OBSERVATION_TYPE]: 'tool',
            // Set input (tool arguments)
            input: JSON.stringify(toolCall.function.arguments),
          },
        },
        parentContext || otelContext.active()
      );

      this.config.logger.trace(
        {
          taskId: state.taskId,
          toolName: toolCall.function.name,
          toolCallId: toolCall.id,
        },
        'Executing tool'
      );

      // Find provider that can handle this tool
      const provider = this.config.toolProviders.find((p) => p.canHandle(toolCall.function.name));

      if (!provider) {
        this.config.logger.warn(
          {
            taskId: state.taskId,
            toolName: toolCall.function.name,
          },
          'No provider found for tool'
        );

        const errorMessage = `No provider found for tool: ${toolCall.function.name}`;
        span.setAttribute('output', errorMessage);
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: errorMessage,
        });
        span.end();

        return {
          toolCallId: toolCall.id,
          toolName: toolCall.function.name,
          success: false,
          result: null,
          error: errorMessage,
        };
      }

      try {
        const result = await provider.execute(toolCall, execContext);
        this.config.logger.trace(
          {
            taskId: state.taskId,
            toolName: toolCall.function.name,
            success: result.success,
          },
          'Tool execution complete'
        );

        // Set output attribute
        if (result.success) {
          span.setAttribute('output', JSON.stringify(result.result));
        } else {
          span.setAttribute('output', result.error || 'Tool execution failed');
        }

        // End span successfully
        span.setStatus({ code: result.success ? SpanStatusCode.OK : SpanStatusCode.ERROR });
        if (!result.success && result.error) {
          span.setAttribute('error.message', result.error);
        }
        span.end();

        return result;
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        this.config.logger.error(
          {
            taskId: state.taskId,
            toolName: toolCall.function.name,
            error: err.message,
            stack: err.stack,
          },
          'Tool execution failed'
        );

        // Set error output
        span.setAttribute('output', err.message);

        // Record error in span
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: err.message,
        });
        span.recordException(err);
        span.end();

        return {
          toolCallId: toolCall.id,
          toolName: toolCall.function.name,
          success: false,
          result: null,
          error: err.message,
        };
      }
    });

    return defer(() => Promise.all(resultPromises));
  }

  /**
   * Checkpoint state if needed
   */
  private checkpointIfNeeded(state: LoopState): Observable<LoopState> {
    if (!this.config.enableCheckpoints) {
      return of(state);
    }

    const shouldCheckpoint =
      state.iteration % this.config.checkpointInterval === 0 ||
      state.lastLLMResponse !== undefined ||
      state.toolResults.size > 0;

    if (!shouldCheckpoint) {
      return of(state);
    }

    this.config.logger.trace(
      {
        taskId: state.taskId,
        iteration: state.iteration,
      },
      'Checkpointing state'
    );

    return defer(async () => {
      const persisted = this.serializeState(state);
      await this.config.stateStore.save(state.taskId, persisted);
      this.config.logger.trace({ taskId: state.taskId }, 'State checkpoint saved');
      return state;
    });
  }

  /**
   * Serialize state for persistence
   */
  private serializeState(state: LoopState): PersistedLoopState {
    return {
      taskId: state.taskId,
      agentId: state.agentId,
      parentTaskId: state.parentTaskId,
      contextId: state.contextId,
      messages: state.messages,
      systemPrompt: state.systemPrompt,
      iteration: state.iteration,
      completed: state.completed,
      availableTools: state.availableTools,
      pendingToolCalls: state.lastLLMResponse?.toolCalls || [],
      completedToolCalls: Object.fromEntries(state.toolResults),
      artifactIds: [],
      activeSubAgents: state.subAgents,
      lastLLMResponse: state.lastLLMResponse,
      lastActivity: new Date().toISOString(),
      resumeFrom: state.completed ? 'completed' : 'llm-call',
    };
  }

  /**
   * Convert state to events for emission
   */
  private stateToEvents(state: LoopState): Observable<AgentEvent> {
    const events: AgentEvent[] = [];

    if (state.completed) {
      // Emit final status-update with completed state
      const completedEvent: AgentEvent = {
        kind: 'status-update',
        taskId: state.taskId,
        contextId: state.contextId,
        status: {
          state: 'completed',
          message: state.lastLLMResponse?.message,
          timestamp: new Date().toISOString(),
        },
        final: true,
      };

      // Attach root span so it can be completed in execute()
      if ((state as WithTraceContext)._rootSpan) {
        (completedEvent as WithTraceContext)._rootSpan = (state as WithTraceContext)._rootSpan;
      }

      events.push(completedEvent);
    } else {
      // Emit internal iteration event for debugging
      events.push({
        kind: 'internal:checkpoint',
        taskId: state.taskId,
        iteration: state.iteration,
        timestamp: new Date().toISOString(),
      });
    }

    return of(...events);
  }
}
