/**
 * Agent Loop - Core Execution Engine
 *
 * Orchestrates interactions between LLMs, tools, and sub-agents using RxJS observables.
 * Implements the reactive agent loop pattern with checkpointing and resumption support.
 *
 * Design Reference: design/agent-loop.md
 */

import type { Span, Context as SpanContext } from '@opentelemetry/api';
import { concat, defer, type Observable, of } from 'rxjs';
import { catchError, map, shareReplay, switchMap, tap } from 'rxjs/operators';
import {
  completeToolExecutionSpan,
  failToolExecutionSpan,
  failToolExecutionSpanWithException,
  startToolExecutionSpan,
} from '../observability/spans';
import type { AgentLoopConfig } from './config';
import { createCompletedEvent, createTaskEvent, createWorkingEvent, stateToEvents } from './events';
import { getLogger } from './logger';
import {
  catchExecuteError,
  catchIterationError,
  catchLLMError,
  completeIteration,
  mapLLMResponseToState,
  prepareLLMCall,
  startIterationSpan,
  tapAfterExecuteEvents,
  tapBeforeExecute,
  tapLLMResponse,
} from './operators';
import type {
  AgentEvent,
  Context,
  ExecutionContext,
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
}

/**
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
   * Execute a single turn with message history
   *
   * New API for Agent integration - executes one turn with provided messages
   *
   * @param messages - Full conversation history including new user message
   * @param context - Turn execution context
   * @returns Observable stream of events for this turn
   */
  executeTurn(
    messages: Message[],
    context: {
      contextId: string;
      taskId?: string;
      turnNumber: number;
      artifacts?: Array<{ id: string; content: unknown }>;
      authContext?: import('./types').AuthContext;
      traceContext?: import('./types').TraceContext;
      metadata?: Record<string, unknown>;
    }
  ): Observable<AgentEvent> {
    // Pass full message history through context
    // This allows the LLM to see the entire conversation
    return this.execute('', {
      contextId: context.contextId,
      taskId: context.taskId || `turn-${context.turnNumber}`,
      authContext: context.authContext,
      traceContext: context.traceContext,
      messages, // Pass full conversation history
      ...context.metadata,
    });
  }

  /**
   * Execute agent loop
   *
   * @param prompt - Legacy: User prompt (optional if context.messages provided)
   * @param context - Execution context (can include full message history)
   */
  execute(prompt: string = '', context: Partial<Context> = {}): Observable<AgentEvent> {
    const execId = `exec_${Math.random().toString(36).slice(2, 8)}`;
    this.config.logger.info({ prompt, context, execId }, 'Starting agent execution');

    // Store root span in ref so operators can access it
    const rootSpanRef = { current: null as Span | null };

    return defer(() => {
      this.config.logger.trace({ execId }, 'defer() executing - prepareExecution');
      return this.prepareExecution(prompt, context);
    }).pipe(
      tap(tapBeforeExecute(rootSpanRef, context, this.config.logger)),
      switchMap((state: LoopState) => {
        this.config.logger.trace({ taskId: state.taskId }, 'switchMap to runLoop');
        return this.runLoop(state);
      }),
      tap(tapAfterExecuteEvents()),
      catchError(catchExecuteError(rootSpanRef, context, this.config.logger, execId)),
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
      return of(
        createCompletedEvent(state.taskId, state.contextId, state.lastLLMResponse?.message)
      );
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

    // Use full message history if provided (from Agent), otherwise create initial message
    // System prompt message is injected in callLLM() to aid history compaction
    const initialMessages: Message[] = context.messages || [
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
    // Emit initial events
    const taskEvent = createTaskEvent(
      initialState.taskId,
      initialState.contextId,
      initialState.messages
    );
    const workingEvent = createWorkingEvent(initialState.taskId, initialState.contextId);

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
    const spanRef = { current: null as Span | null };

    return of(state).pipe(
      map(startIterationSpan(spanRef, nextIteration, this.config.logger)),
      switchMap((s: LoopState) => this.callLLM(s, nextIteration)),
      switchMap((s: LoopState) => this.processLLMResponse(s)),
      switchMap((s: LoopState) => this.checkpointIfNeeded(s)),
      map(completeIteration(spanRef, nextIteration, this.config.logger)),
      catchError(catchIterationError(spanRef))
    );
  }

  /**
   * Call the LLM provider
   */
  private callLLM(state: LoopState, _iteration: number): Observable<LoopState> {
    const spanRef = { current: null as Span | null };
    const { state: preparedState, messages } = prepareLLMCall(spanRef, this.config.logger)(state);

    return this.config.llmProvider
      .call({
        messages,
        tools: preparedState.availableTools.length > 0 ? preparedState.availableTools : undefined,
        sessionId: preparedState.taskId,
      })
      .pipe(
        tap(tapLLMResponse(spanRef, messages, this.config.logger)),
        map(mapLLMResponseToState(preparedState)),
        catchError(catchLLMError(spanRef))
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
          const updatedResults = toolResults.reduce(
            (acc, r: ToolResult) => acc.set(r.toolCallId, r),
            new Map(state.toolResults)
          );

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

    const resultPromises = toolCalls.map(async (toolCall) => {
      // Start tool execution span
      const span = startToolExecutionSpan({
        agentId: state.agentId,
        taskId: state.taskId,
        toolCall,
        traceContext: state.traceContext,
      });

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
        failToolExecutionSpan(span, errorMessage);

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

        // Complete span with result
        completeToolExecutionSpan(span, result);

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

        // Fail span with exception
        failToolExecutionSpanWithException(span, err);

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
    const events = stateToEvents(state);

    // Attach root span to completed event so it can be completed in execute()
    if (state.completed && (state as WithTraceContext)._rootSpan) {
      const completedEvent = events[0];
      if (completedEvent) {
        (completedEvent as WithTraceContext)._rootSpan = (state as WithTraceContext)._rootSpan;
      }
    }

    return of(...events);
  }
}
