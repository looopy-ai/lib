/**
 * Agent Loop - Core Execution Engine
 *
 * Orchestrates interactions between LLMs, tools, and sub-agents using RxJS observables.
 * Implements the reactive agent loop pattern with checkpointing and resumption support.
 *
 * Design Reference: design/agent-loop.md
 */

import { context as otelContext, type Span } from '@opentelemetry/api';
import { concat, defer, merge, type Observable, of, Subject } from 'rxjs';
import { catchError, filter, finalize, map, shareReplay, switchMap, tap } from 'rxjs/operators';
import type { ContentCompleteEvent, LLMEvent } from '../events/types';
import {
  addLLMUsageToSpan,
  completeLLMCallSpan,
  completeToolExecutionSpan,
  failToolExecutionSpan,
  failToolExecutionSpanWithException,
  startAgentLoopSpan,
  startToolExecutionSpan,
} from '../observability/spans';
import type { AgentLoopConfig } from './config';
import { createCompletedEvent, createTaskEvent, createWorkingEvent, stateToEvents } from './events';
import { getLogger } from './logger';
import {
  catchIterationError,
  catchLLMError,
  catchTurnError,
  completeIteration,
  mapLLMResponseToState,
  prepareLLMCall,
  startIterationSpan,
  tapAfterTurn,
} from './operators';
import { LoopEventEmitter } from './operators/event-emitter';
import type {
  AgentEvent,
  AgentLoopContext,
  ExecutionContext,
  LLMResponse,
  LoopState,
  Message,
  PersistedLoopState,
  ToolCall,
  ToolResult,
} from './types';

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
  private eventEmitter: LoopEventEmitter | null = null;
  private thoughtToolProvider: import('../tools/interfaces').ToolProvider | null = null;

  constructor(config: AgentLoopConfig) {
    this.config = {
      maxIterations: 20,
      systemPrompt: 'You are a helpful AI assistant.',
      enableCheckpoints: true,
      checkpointInterval: 3,
      enableThoughtTools: false,
      ...config,
      logger: config.logger || getLogger({ component: 'AgentLoop' }),
    };
  }

  /**
   * Start a single conversational turn loop
   *
   * New API for Agent integration - starts one turn with provided messages
   *
   * @param messages - Full conversation history including new user message
   * @param context - Turn execution context
   * @returns Observable stream of events for this turn
   */
  startTurnLoop(
    messages: Message[],
    context: {
      contextId: string;
      taskId?: string;
      turnNumber: number;
      artifacts?: Array<{ id: string; content: unknown }>;
      authContext?: import('./types').AuthContext;
      parentContext: import('@opentelemetry/api').Context;
      metadata?: Record<string, unknown>;
    }
  ): Observable<AgentEvent> {
    // Pass full message history through context
    // This allows the LLM to see the entire conversation
    return this.execute({
      agentId: this.config.agentId,
      contextId: context.contextId,
      taskId: context.taskId || `turn-${context.turnNumber}`,
      authContext: context.authContext,
      parentContext: context.parentContext,
      messages, // Pass full conversation history
      ...context.metadata,
    });
  }

  /**
   * Execute agent loop
   *
   * @param context - Execution context (must include messages)
   */
  execute(context: AgentLoopContext): Observable<AgentEvent> {
    const execId = `exec_${Math.random().toString(36).slice(2, 8)}`;
    this.config.logger.info({ context, execId }, 'Starting agent execution');
    const {
      traceContext: loopContext,
      setOutput,
      setSuccess,
      setError,
    } = startAgentLoopSpan({
      agentId: context.agentId,
      taskId: context.taskId,
      contextId: context.contextId,
      prompt: context.messages?.at(-1)?.content,
      parentContext: context.parentContext,
    });

    // Create event emitter for this execution
    this.eventEmitter = new LoopEventEmitter();

    // Store root span in ref so operators can access it
    const rootSpanRef = { current: null as Span | null };

    // Create execution pipeline
    const turnEvents$ = defer(() => {
      this.config.logger.trace({ execId }, 'defer() executing - prepareExecution');
      return this.prepareTurnLoopState(context);
    }).pipe(
      // tap(tapBeforeTurn(rootSpanRef, context, this.config.logger)),
      switchMap((state: LoopState) => {
        this.config.logger.trace({ taskId: state.taskId }, 'switchMap to runLoop');
        return this.runLoop(state, loopContext);
      }),
      tap(tapAfterTurn(setOutput)),
      catchError(catchTurnError(rootSpanRef, context, this.config.logger, execId)),
      // Complete event emitter on execution completion
      tap({
        complete: () => {
          setSuccess();
          if (this.eventEmitter) {
            this.eventEmitter.complete();
          }
        },
        error: (err) => {
          setError(err);
          if (this.eventEmitter) {
            this.eventEmitter.error(err);
          }
        },
      })
    );

    // Merge execution events with internal protocol events
    return merge(turnEvents$, this.eventEmitter.events$).pipe(
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
    context: Partial<AgentLoopContext> = {}
  ): Promise<Observable<AgentEvent>> {
    const logger = config.logger || getLogger({ component: 'AgentLoop' });
    logger.info({ taskId }, 'Resuming agent execution');

    const state = await config.taskStateStore.load(taskId);

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

    // Create tracing context for resumed execution
    const { traceContext: loopContext } = startAgentLoopSpan({
      agentId: state.agentId,
      taskId: state.taskId,
      contextId: state.contextId,
      prompt: state.messages?.at(-1)?.content,
      parentContext: context.parentContext || otelContext.active(),
    });

    return loop.runLoop(loopState, loopContext);
  }

  /**
   * Prepare initial execution state
   */
  private async prepareTurnLoopState(context: AgentLoopContext): Promise<LoopState> {
    const taskId = context.taskId || generateTaskId();
    const contextId = context.contextId;

    // Gather tools from all providers (including thought tools if enabled)
    const allProviders = this.thoughtToolProvider
      ? [...this.config.toolProviders, this.thoughtToolProvider]
      : this.config.toolProviders;

    const toolPromises = allProviders.map((p) => p.getTools());
    const toolArrays = await Promise.all(toolPromises);
    const availableTools = toolArrays.flat();

    // Use provided message history
    // System prompt message is injected in callLLM() to aid history compaction
    const initialMessages: Message[] = context.messages || [];

    return {
      taskId,
      agentId: context.agentId,
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
      context,
      authContext: context.authContext,
      taskStateStore: this.config.taskStateStore,
      artifactStore: this.config.artifactStore,
    };
  }

  /**
   * Restore state from persisted data
   */
  private async restoreState(
    persisted: PersistedLoopState,
    context: Partial<AgentLoopContext>
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
        parentContext: context.parentContext || otelContext.active(),
      },
      taskStateStore: this.config.taskStateStore,
      artifactStore: this.config.artifactStore,
    };
  }

  /**
   * Run the main agent loop.
   * Collects LLM events from all iterations and merges them with state events.
   */
  private runLoop(
    initialState: LoopState,
    loopContext: import('@opentelemetry/api').Context
  ): Observable<AgentEvent> {
    // Emit initial events
    const taskEvent = createTaskEvent(
      initialState.taskId,
      initialState.contextId,
      initialState.messages
    );
    const workingEvent = createWorkingEvent(initialState.taskId, initialState.contextId);

    // Subject to collect LLM events from all iterations
    const llmEventsCollector = new Subject<AgentEvent>();

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

      // Execute iteration (returns state$ and events$ which includes LLM + tool events)
      const { state$, events$ } = this.executeIteration(state, loopContext);

      // Subscribe to iteration events (LLM + tool) and forward to collector
      events$.subscribe({
        next: (event: AgentEvent) => llmEventsCollector.next(event),
        error: (err: Error) => llmEventsCollector.error(err),
      });

      // Continue iteration with state pipeline
      return state$.pipe(
        switchMap((nextState: LoopState) => {
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

    const stateLoop$ = defer(() => {
      this.config.logger.trace({ taskId: initialState.taskId }, 'Starting iteration recursion');
      return iterate(initialState);
    }).pipe(
      // Convert final state to status events
      switchMap((state: LoopState) => this.stateToEvents(state)),
      // Complete the LLM events collector when state loop completes
      finalize(() => llmEventsCollector.complete())
    );

    // Merge initial events, LLM events from iterations, and final state events
    return concat(of(taskEvent, workingEvent), merge(stateLoop$, llmEventsCollector));
  }

  /**
   * Execute a single iteration.
   * Returns both state observable and events observables (LLM + tool + checkpoint).
   */
  private executeIteration(
    state: LoopState,
    loopContext: import('@opentelemetry/api').Context
  ): {
    state$: Observable<LoopState>;
    events$: Observable<AgentEvent>;
  } {
    const nextIteration = state.iteration + 1;
    const { span: iterationSpan, traceContext: iterationContext } = startIterationSpan(
      state,
      nextIteration,
      this.config.logger,
      loopContext
    );

    const { state$: llmState$, events$: llmEvents$ } = this.callLLMAndProcessEvents(
      { ...state, iteration: nextIteration },
      nextIteration,
      iterationContext
    );

    // Subject to collect tool and checkpoint events
    const internalEventsCollector = new Subject<AgentEvent>();

    // Apply iteration span and continue state pipeline
    const state$ = llmState$.pipe(
      // map(startIterationSpan(spanRef, nextIteration, this.config.logger, loopContext)),
      // switchMap(() => llmState$),
      switchMap((s: LoopState) =>
        this.processLLMResponse(s, internalEventsCollector, iterationContext)
      ),
      switchMap((s: LoopState) => this.checkpointIfNeeded(s, internalEventsCollector)),
      map(completeIteration(iterationSpan, nextIteration, this.config.logger)),
      tap({
        complete: () => internalEventsCollector.complete(),
        error: (err) => internalEventsCollector.error(err),
      }),
      catchError(catchIterationError(iterationSpan))
    );

    // Merge LLM events with tool and checkpoint events
    const events$ = merge(llmEvents$, internalEventsCollector.asObservable());

    return { state$, events$ };
  }

  /**
   * Call LLM and return both state observable and events observable.
   * Events stream should be merged at execute() level, not copied via tap.
   */
  private callLLMAndProcessEvents(
    state: LoopState,
    iteration: number,
    iterationContext: import('@opentelemetry/api').Context
  ): { state$: Observable<LoopState>; events$: Observable<AgentEvent> } {
    const {
      state: preparedState,
      messages,
      span,
    } = prepareLLMCall(state, iterationContext, this.config.logger);

    // Get LLM event stream from provider (without contextId/taskId)
    const llmEvents$ = this.config.llmProvider
      .call({
        messages,
        tools: preparedState.availableTools.length > 0 ? preparedState.availableTools : undefined,
        sessionId: preparedState.taskId,
        stream: true,
      })
      .pipe(shareReplay());

    // Create internal LLM call event
    const llmCallEvent: AgentEvent = {
      kind: 'internal:llm-call',
      contextId: state.contextId,
      taskId: state.taskId,
      iteration,
      messageCount: messages.length,
      toolCount: preparedState.availableTools.length,
      timestamp: new Date().toISOString(),
    };

    // Convert LLM events to AgentEvents by stamping with contextId/taskId
    // Merge with the initial LLM call event
    const events$ = concat(
      of(llmCallEvent),
      llmEvents$.pipe(
        map(
          (event): AgentEvent =>
            ({
              ...event,
              contextId: state.contextId,
              taskId: state.taskId,
            }) as AgentEvent
        ),
        tap({
          next: (event) => {
            switch (event.kind) {
              case 'llm-usage':
                addLLMUsageToSpan(span, event);
                break;
              case 'content-complete':
                completeLLMCallSpan(span, event);
                break;
            }
          },
        })
      )
    );

    // Extract final response and build LoopState
    const state$ = llmEvents$.pipe(
      filter((event): event is LLMEvent<ContentCompleteEvent> => event.kind === 'content-complete'),
      // last(),
      map((event): LLMResponse => {
        const toolCalls = event.toolCalls?.map((tc) => ({
          ...tc,
          function: {
            ...tc.function,
            arguments:
              typeof tc.function.arguments === 'string'
                ? JSON.parse(tc.function.arguments)
                : tc.function.arguments,
          },
        }));

        return {
          message: {
            role: 'assistant',
            content: event.content,
            toolCalls,
          },
          toolCalls,
          finished: true,
          finishReason: event.finishReason || (toolCalls?.length ? 'tool_calls' : 'stop'),
        };
      }),
      map(mapLLMResponseToState(preparedState)),
      catchError(catchLLMError(span)) // TODO align error handling with completion (from events above)
    );

    return { state$, events$ };
  }

  /**
   * Process LLM response - execute tools or complete
   */
  private processLLMResponse(
    state: LoopState,
    toolEventsCollector: Subject<AgentEvent>,
    iterationContext: import('@opentelemetry/api').Context
  ): Observable<LoopState> {
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

      const { results$, events$ } = this.executeToolsAndProcessEvents(
        response.toolCalls,
        state,
        iterationContext
      );

      // Subscribe to tool events and forward to collector
      events$.subscribe({
        next: (event: AgentEvent) => toolEventsCollector.next(event),
        error: (err: Error) => toolEventsCollector.error(err),
      });

      return results$.pipe(
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
   * Execute tool calls and return both results and events
   */
  private executeToolsAndProcessEvents(
    toolCalls: ToolCall[],
    state: LoopState,
    parentContext: import('@opentelemetry/api').Context
  ): { results$: Observable<ToolResult[]>; events$: Observable<AgentEvent> } {
    const execContext: ExecutionContext = {
      taskId: state.taskId,
      contextId: state.contextId,
      agentId: state.agentId,
      parentContext,
      authContext: state.authContext,
    };

    // Create observables for each tool execution
    const toolExecutions = toolCalls.map((toolCall) => {
      // Create tool-start event
      const toolStartEvent: AgentEvent = {
        kind: 'internal:tool-start',
        contextId: state.contextId,
        taskId: state.taskId,
        toolCallId: toolCall.id,
        toolName: toolCall.function.name,
        timestamp: new Date().toISOString(),
      };

      // Execute tool and create events
      const execution$ = defer(async () => {
        // Start tool execution span
        const { span } = startToolExecutionSpan({
          agentId: state.agentId,
          taskId: state.taskId,
          toolCall,
          parentContext,
        });

        this.config.logger.trace(
          {
            taskId: state.taskId,
            toolName: toolCall.function.name,
            toolCallId: toolCall.id,
          },
          'Executing tool'
        );

        // Find provider that can handle this tool (check thought tools first, then regular providers)
        const provider = this.thoughtToolProvider?.canHandle(toolCall.function.name)
          ? this.thoughtToolProvider
          : this.config.toolProviders.find((p) => p.canHandle(toolCall.function.name));

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
      }).pipe(shareReplay());

      // Create tool-complete event from result
      const toolCompleteEvent$ = execution$.pipe(
        map(
          (result): AgentEvent => ({
            kind: 'internal:tool-complete',
            contextId: state.contextId,
            taskId: state.taskId,
            toolCallId: result.toolCallId,
            toolName: result.toolName,
            success: result.success,
            error: result.error,
            timestamp: new Date().toISOString(),
          })
        )
      );

      // Merge start and complete events for this tool
      const toolEvents$ = merge(of(toolStartEvent), toolCompleteEvent$);

      return { result$: execution$, events$: toolEvents$ };
    });

    // Collect all results
    const results$ = defer(async () => {
      const results = await Promise.all(toolExecutions.map((t) => t.result$.toPromise()));
      // Filter out undefined values (shouldn't happen, but for type safety)
      return results.filter((r): r is ToolResult => r !== undefined);
    });

    // Merge all tool events
    const events$ = merge(...toolExecutions.map((t) => t.events$));

    return { results$, events$ };
  }

  /**
   * Checkpoint state if needed and return both state and checkpoint event
   */
  private checkpointIfNeeded(
    state: LoopState,
    checkpointEventsCollector: Subject<AgentEvent>
  ): Observable<LoopState> {
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
      await this.config.taskStateStore.save(state.taskId, persisted);
      this.config.logger.trace({ taskId: state.taskId }, 'State checkpoint saved');

      // Create checkpoint event as observable and emit to collector
      const checkpointEvent: AgentEvent = {
        kind: 'internal:checkpoint',
        contextId: state.contextId,
        taskId: state.taskId,
        iteration: state.iteration,
        timestamp: new Date().toISOString(),
      };
      checkpointEventsCollector.next(checkpointEvent);

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

    return of(...events);
  }
}
