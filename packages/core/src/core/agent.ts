/**
 * Agent - Stateful Multi-turn Conversation Manager
 *
 * Manages lifecycle, persistence, and state for multi-turn agent conversations.
 * Coordinates with AgentLoop for single-turn execution.
 *
 * Design Reference: design/agent-lifecycle.md
 */

import type { Context } from '@opentelemetry/api';
import type pino from 'pino';
import {
  catchError,
  concat,
  concatMap,
  filter,
  lastValueFrom,
  Observable,
  of,
  type Subscription,
  toArray,
} from 'rxjs';
import { createTaskStatusEvent } from '../events';
import { isChildTaskEvent } from '../events/utils';
import {
  addMessagesCompactedEvent,
  addMessagesLoadedEvent,
  completeAgentInitializeSpan,
  completeAgentTurnSpan,
  failAgentInitializeSpan,
  failAgentTurnSpan,
  setResumeAttributes,
  setTurnCountAttribute,
  startAgentInitializeSpan,
  startAgentTurnSpan,
} from '../observability/spans';
import { REQUEST_INPUT_TOOL_NAME } from '../tools/request-input-tool';
import type { AgentConfig, AgentState, PendingToolInput } from '../types/agent';
import type { IterationContext } from '../types/core';
import type {
  ContextAnyEvent,
  ContextEvent,
  ToolCallEvent,
  ToolInputRequiredEvent,
} from '../types/event';
import { isToolInputRequiredEvent } from '../types/event';
import type { LLMMessage } from '../types/message';
import { serializeError } from '../utils/error';
import { getLogger } from './logger';
import { runLoop } from './loop';
import { runToolCall } from './tools';

/**
 * Options for getting messages
 */
export interface GetMessagesOptions {
  /** Maximum number of messages to return */
  maxMessages?: number;

  /** Maximum tokens to return */
  maxTokens?: number;
}

type AgentConfigRequired<AuthContext> = AgentConfig<AuthContext> &
  Required<Pick<AgentConfig<AuthContext>, 'logger' | 'autoCompact' | 'maxMessages'>>;

/**
 * Agent - Stateful Multi-turn Manager
 *
 * Manages the lifecycle of a multi-turn conversation:
 * - Loads and saves message history
 * - Coordinates turn execution via AgentLoop
 * - Handles pause/resume/shutdown
 * - Manages artifacts
 */
export class Agent<AuthContext> {
  private readonly config: AgentConfigRequired<AuthContext>;
  private _state: AgentState;
  private logger: pino.Logger;
  private shuttingDown = false;
  private shutdownComplete = false;

  constructor(config: AgentConfig<AuthContext>) {
    this.config = {
      autoCompact: false,
      maxMessages: 100,
      ...config,
      logger:
        config.logger?.child({ contextId: config.contextId }) ||
        getLogger({ contextId: config.contextId }),
    };

    this.logger = this.config.logger.child({ component: 'agent' });

    // Initialize state
    this._state = {
      status: 'created',
      turnCount: 0,
      lastActivity: new Date(),
      createdAt: new Date(),
    };

    this.logger.debug('Agent created');
    this.persistStateSafely();
  }

  /**
   * Get current agent state
   */
  get state(): Readonly<AgentState> {
    return { ...this._state };
  }

  /**
   * Get agent ID
   */
  get agentId(): string {
    return this.config.agentId;
  }

  /**
   * Get context ID
   */
  get contextId(): string {
    return this.config.contextId;
  }

  /**
   * Initialize agent state by loading existing messages
   * Called automatically on first startTurn() if not already initialized
   *
   * @param parentContext - Parent context to nest the initialization span within
   */
  private async initialize(parentContext: Context): Promise<void> {
    const { span } = startAgentInitializeSpan({
      agentId: this.config.agentId,
      contextId: this.config.contextId,
      parentContext,
    });

    try {
      this.logger.info('Initializing agent');

      const hasStoredState = await this.loadPersistedState();

      // Try to load existing messages (resume scenario)
      // Note: If messageStore requires auth, pass authContext to startTurn instead
      const existingMessages = await this.config.messageStore.getAll(this.config.contextId);

      if (existingMessages.length > 0) {
        this.logger.info(
          { messageCount: existingMessages.length },
          'Resuming agent with existing message history',
        );

        if (!hasStoredState) {
          // Infer state from message count when no persisted state exists
          this._state.turnCount = Math.floor(existingMessages.length / 2); // Rough estimate
        }

        setResumeAttributes(span, existingMessages.length);
      }

      // Preserve 'waiting-input' from persisted state; for everything else transition to 'idle'
      if (this._state.status !== 'waiting-input') {
        this._state.status = 'idle';
      }
      this._state.lastActivity = new Date();

      await this.persistState();

      this.logger.info({ status: this._state.status }, 'Agent initialized');

      completeAgentInitializeSpan(span);
    } catch (error) {
      this._state.status = 'error';
      this._state.error = serializeError(error);
      this.logger.error({ error: serializeError(error) }, 'Failed to initialize agent');

      await this.persistState();

      failAgentInitializeSpan(span, error as Error);
      throw error;
    }
  }

  /**
   * Start a single conversational turn
   *
   * Automatically initializes the agent on first call.
   *
   * @param userMessage - User's message (or null for continuation)
   * @param options - Turn options including authContext and optional taskId
   * @returns Observable stream of agent events
   */
  async startTurn(
    userMessage: string | null,
    options?: {
      authContext?: AuthContext;
      taskId?: string;
      metadata?: Record<string, unknown>;
      /**
       * Resolved inputs for a `waiting-input` resume.
       * Each entry maps an `inputId` (from the prior `tool-input-required` event) to the value
       * to inject.  When provided alongside a `userMessage`, the inputs are resolved first and
       * the user message is only appended if the loop can restart immediately.
       * When provided without a `userMessage`, only the input-resume path runs.
       */
      inputs?: Array<{ inputId: string; value: unknown }>;
    },
  ): Promise<Observable<ContextAnyEvent>> {
    const turnNumber = this._state.turnCount + 1;

    // Generate taskId if not provided
    const taskId = options?.taskId || `${this.config.contextId}-turn-${turnNumber}-${Date.now()}`;
    const logger = this.logger.child({ taskId, turnNumber });

    // Create span for the entire turn execution (including initialization and validation)
    const {
      span: rootSpan,
      traceContext: rootContext,
      tapFinish,
    } = startAgentTurnSpan({
      agentId: this.config.agentId,
      taskId,
      contextId: this.config.contextId,
      turnNumber,
      userMessage,
    });

    logger.trace(
      { userMessage, spanName: `agent.turn[${this.config.agentId}]` },
      'Created agent turn span with input',
    );

    try {
      // Capture status before any mutations to avoid TOCTOU race on concurrent calls
      const priorStatus = this._state.status;

      // Validate state synchronously before any awaits
      if (priorStatus === 'shutdown') {
        const error = new Error('Cannot execute turn: Agent has been shutdown');
        logger.error(error.message);

        failAgentTurnSpan(rootSpan, error);

        return of(
          createTaskStatusEvent({
            contextId: this.config.contextId,
            taskId,
            status: 'failed',
            message: error.message,
            metadata: { error: error.message },
          }),
        );
      }

      if (priorStatus === 'error') {
        const error = new Error(
          `Cannot execute turn: Agent is in error state: ${this._state.error?.message}`,
        );
        logger.error(this._state.error, 'Cannot execute turn due to agent error state');

        failAgentTurnSpan(rootSpan, error);

        return of(
          createTaskStatusEvent({
            contextId: this.config.contextId,
            taskId,
            status: 'failed',
            message: error.message,
            metadata: { error: error.message },
          }),
        );
      }

      if (priorStatus === 'busy') {
        const error = new Error('Cannot execute turn: Agent is already executing a turn');
        logger.error(error.message);

        failAgentTurnSpan(rootSpan, error);

        return of(
          createTaskStatusEvent({
            contextId: this.config.contextId,
            taskId,
            status: 'failed',
            message: error.message,
            metadata: { error: error.message },
          }),
        );
      }

      // Claim the busy slot synchronously before any awaits to prevent concurrent turns
      this._state.status = 'busy';

      // Auto-initialize on first turn (nested within this span)
      if (priorStatus === 'created') {
        try {
          await this.initialize(rootContext);
        } catch (error) {
          const err = error as Error;
          failAgentTurnSpan(rootSpan, err);
          return of(
            createTaskStatusEvent({
              contextId: this.config.contextId,
              taskId,
              status: 'failed',
              message: err.message,
              metadata: { error: err.message },
            }),
          );
        }
        // Re-check status after initialization — it may be 'waiting-input' if restored from persistence
        // Reclaim the busy slot regardless; executeInternal will use the effective status below
        this._state.status = 'busy';
      }

      logger.info({ userMessage }, 'Starting turn');

      this._state.lastActivity = new Date();
      await this.persistState();

      // Determine the effective pre-busy status to pass into executeInternal.
      // If we just initialized and the persisted state had 'waiting-input', the status was
      // restored before we reclaimed 'busy', so we can check pendingToolInputs as a signal.
      const effectiveStatus: AgentState['status'] =
        priorStatus === 'created' && (this._state.pendingToolInputs?.length ?? 0) > 0
          ? 'waiting-input'
          : priorStatus;

      // Load conversation history and execute turn
      return this.executeInternal(
        userMessage,
        taskId,
        options?.authContext,
        options?.metadata,
        options?.inputs,
        effectiveStatus,
        rootSpan,
        rootContext,
        this.logger.child({ taskId, turnNumber }),
      ).pipe(tapFinish);
    } catch (error) {
      const err = error as Error;
      logger.error({ error: err }, 'Failed to start turn');

      failAgentTurnSpan(rootSpan, err);

      return of(
        createTaskStatusEvent({
          contextId: this.config.contextId,
          taskId,
          status: 'failed',
          message: err.message,
          metadata: { error: err.message },
        }),
      );
    }
  }

  /**
   * Internal turn execution with full error handling
   *
   * @param userMessage - User's message (or null for continuation)
   * @param taskId - Task ID for this turn
   * @param authContext - Authentication context (refreshed token, user credentials)
   * @param metadata - Additional metadata for the turn
   * @param inputs - Resolved inputs for a `waiting-input` resume (keyed by inputId)
   * @param priorStatus - Agent status captured before claiming the busy slot
   * @param turnSpan - Parent span created in startTurn()
   * @param turnContext - Parent context for tracing
   */
  private executeInternal(
    userMessage: string | null,
    taskId: string,
    authContext: AuthContext | undefined,
    metadata: Record<string, unknown> | undefined,
    inputs: Array<{ inputId: string; value: unknown }> | undefined,
    priorStatus: AgentState['status'],
    turnSpan: import('@opentelemetry/api').Span,
    turnContext: import('@opentelemetry/api').Context,
    logger: pino.Logger,
  ): Observable<ContextAnyEvent> {
    const turnNumber = this._state.turnCount + 1;

    return concat(
      // Load messages, execute turn, save results
      new Observable<ContextAnyEvent>((observer) => {
        // Mutable ref so continueWithLoop can set the subscription for teardown
        const subRef: { current: Subscription | undefined } = { current: undefined };

        const execute = async () => {
          try {
            // 1. Load conversation history
            const messages = await this.loadMessages();
            addMessagesLoadedEvent(turnSpan, messages.length);

            // ----------------------------------------------------------------
            // 2. Handle waiting-input state
            // ----------------------------------------------------------------
            if (priorStatus === 'waiting-input') {
              const pendingToolInputs = this._state.pendingToolInputs ?? [];

              if (!inputs?.length && !userMessage) {
                // Guard: calling startTurn in waiting-input with no inputs and no userMessage
                // would result in a re-run with unresolved tool calls in history — not safe.
                const error = new Error(
                  'Cannot execute turn: Agent is waiting for input. ' +
                    'Provide `inputs` to resume or a `userMessage` to cancel pending inputs.',
                );
                logger.error(error.message);
                failAgentTurnSpan(turnSpan, error);
                observer.error(error);
                return;
              }

              if (inputs && inputs.length > 0) {
                // ── RESUME PATH ────────────────────────────────────────────
                // The consumer supplied resolved values for one or more pending
                // tool calls.  Re-run those tools with the inputs injected,
                // then either restart the loop (all resolved) or stay paused.

                const resolvedInputs = new Map<string, unknown>();
                const resolvedPending: PendingToolInput[] = [];

                for (const { inputId, value } of inputs) {
                  const pending = pendingToolInputs.find((p) => p.inputId === inputId);
                  if (pending) {
                    resolvedInputs.set(pending.toolCallId, value);
                    resolvedPending.push(pending);
                  }
                }

                // Remove the now-resolved entries from state immediately
                this._state.pendingToolInputs = pendingToolInputs.filter(
                  (p) => !resolvedPending.some((r) => r.inputId === p.inputId),
                );

                // Build an IterationContext that carries the resolved inputs
                const iterCtx: IterationContext<AuthContext> = {
                  agentId: this.config.agentId,
                  contextId: this.config.contextId,
                  taskId,
                  authContext,
                  parentContext: turnContext,
                  logger: this.config.logger.child({ taskId, turnNumber }),
                  plugins: this.config.plugins || [],
                  turnNumber,
                  metadata,
                  resolvedInputs,
                };

                // Re-run each resolved tool call
                const resumeEvents: ContextAnyEvent[] = [];
                const newPendingInputs: PendingToolInput[] = [];

                for (const pending of resolvedPending) {
                  const resolvedValue = resolvedInputs.get(pending.toolCallId);

                  if (pending.isLlmRequest) {
                    // ── LLM-initiated request_input ──────────────────────────
                    // The LLM asked for input via the `request_input` tool.
                    // Inject a synthetic tool-complete whose result is the
                    // resolved value so the LLM sees it as an answer on the
                    // next iteration.
                    const syntheticComplete: ContextAnyEvent = {
                      contextId: this.config.contextId,
                      taskId,
                      path: undefined,
                      kind: 'tool-complete',
                      toolCallId: pending.toolCallId,
                      toolName: pending.toolName,
                      success: true,
                      result: resolvedValue,
                      timestamp: new Date().toISOString(),
                    };
                    resumeEvents.push(syntheticComplete);

                    logger.debug(
                      { toolCallId: pending.toolCallId },
                      'Saving synthetic tool-complete for LLM request_input to message store',
                    );
                    await this.config.messageStore.append(this.config.contextId, [
                      {
                        role: 'tool',
                        content: JSON.stringify({ success: true, result: resolvedValue }),
                        toolCallId: pending.toolCallId,
                      },
                    ]);
                    continue;
                  }
                  const tcEvent: ContextEvent<ToolCallEvent> = {
                    contextId: this.config.contextId,
                    taskId,
                    path: undefined,
                    kind: 'tool-call',
                    toolCallId: pending.toolCallId,
                    toolName: pending.toolName,
                    arguments: pending.toolArguments,
                    timestamp: new Date().toISOString(),
                  };

                  const events = await lastValueFrom(runToolCall(iterCtx, tcEvent).pipe(toArray()));
                  resumeEvents.push(...events);

                  // Persist tool results and detect chained interrupts
                  for (const event of events) {
                    if (isChildTaskEvent(event)) continue;
                    if (event.kind === 'tool-complete') {
                      logger.debug({ event }, 'Saving resumed tool-complete to message store');
                      await this.config.messageStore.append(this.config.contextId, [
                        {
                          role: 'tool',
                          content: JSON.stringify({
                            success: event.success,
                            result: event.result,
                            error: event.error,
                          }),
                          toolCallId: event.toolCallId,
                        },
                      ]);
                    } else if (isToolInputRequiredEvent(event)) {
                      // Tool still needs input — add to next pending batch
                      newPendingInputs.push({
                        inputId: event.inputId,
                        toolCallId: event.toolCallId,
                        toolName: event.toolName,
                        toolArguments: event.toolArguments,
                        taskId,
                        inputType: event.inputType,
                        prompt: event.prompt,
                        schema: event.schema,
                        options: event.options,
                        isLlmRequest: event.toolName === REQUEST_INPUT_TOOL_NAME,
                      });
                    } else if (event.kind === 'internal:tool-message') {
                      await this.config.messageStore.append(this.config.contextId, [event.message]);
                    }
                  }
                }

                // Forward resume events to the subscriber (excluding internal ones)
                for (const event of resumeEvents) {
                  if (!isChildTaskEvent(event) && event.kind !== 'internal:tool-message') {
                    observer.next(event);
                  }
                }

                const stillPending = this._state.pendingToolInputs ?? [];
                const allPending = [...stillPending, ...newPendingInputs];

                if (allPending.length > 0) {
                  // Still waiting — save new pending state and emit waiting-input
                  this._state.pendingToolInputs = allPending;
                  this._state.turnCount++;
                  this._state.lastActivity = new Date();
                  this._state.status = 'waiting-input';
                  await this.persistState();

                  observer.next(
                    createTaskStatusEvent({
                      contextId: this.config.contextId,
                      taskId,
                      status: 'waiting-input',
                      metadata: {
                        pendingInputIds: allPending.map((p) => p.inputId),
                        pendingToolNames: allPending.map((p) => p.toolName),
                      },
                    }),
                  );
                  observer.complete();
                  return;
                }

                // All pending resolved — reload messages (now includes tool results) and run loop
                const updatedMessages = await this.loadMessages();
                this.continueWithLoop(
                  updatedMessages,
                  userMessage, // include any accompanying user message now that the loop can run
                  taskId,
                  authContext,
                  metadata,
                  turnNumber,
                  turnSpan,
                  turnContext,
                  logger,
                  subRef,
                  observer,
                );
                return;
              }

              if (userMessage) {
                // ── CANCEL PATH ────────────────────────────────────────────
                // Consumer sent a new user message while paused.  Inject
                // synthetic cancellation tool-completes so the LLM history
                // stays well-formed, then proceed as a normal new turn.
                logger.info(
                  { pendingCount: pendingToolInputs.length },
                  'Cancelling pending tool inputs, resuming with new user message',
                );

                for (const pending of pendingToolInputs) {
                  const cancelMsg: LLMMessage = {
                    role: 'tool',
                    content: JSON.stringify({
                      success: false,
                      error: 'Cancelled: user provided new input',
                    }),
                    toolCallId: pending.toolCallId,
                  };
                  await this.config.messageStore.append(this.config.contextId, [cancelMsg]);
                  messages.push(cancelMsg);

                  // Surface a visible cancellation event to the subscriber
                  observer.next({
                    contextId: this.config.contextId,
                    taskId,
                    path: undefined,
                    kind: 'tool-complete',
                    toolCallId: pending.toolCallId,
                    toolName: pending.toolName,
                    success: false,
                    error: 'Cancelled: user provided new input',
                    timestamp: new Date().toISOString(),
                  });
                }
                this._state.pendingToolInputs = [];
                // Fall through to normal loop below
              }
            }

            // ----------------------------------------------------------------
            // 3. Normal path — append user message and run loop
            // ----------------------------------------------------------------
            this.continueWithLoop(
              messages,
              userMessage,
              taskId,
              authContext,
              metadata,
              turnNumber,
              turnSpan,
              turnContext,
              logger,
              subRef,
              observer,
            );
          } catch (error) {
            logger.error({ error: serializeError(error) }, 'Failed to prepare turn');

            failAgentTurnSpan(turnSpan, error as Error);
            observer.error(error);
          }
        };

        execute();
        return () => {
          subRef.current?.unsubscribe();
        };
      }).pipe(
        catchError((error) => {
          this._state.status = 'error';
          this._state.error = serializeError(error);
          this.persistStateSafely();

          // Fail the span for any errors caught in the pipeline
          failAgentTurnSpan(turnSpan, error);

          return of(
            createTaskStatusEvent({
              contextId: this.config.contextId,
              taskId,
              status: 'failed',
              message: error.message,
              metadata: { error: error.message },
            }),
          );
        }),
      ),
    );
  }

  /**
   * Appends an optional user message then runs the agent loop, wiring events
   * through to the observer.  Extracted to avoid duplication between the
   * normal path and the resume-all-resolved path.
   */
  private continueWithLoop(
    messages: LLMMessage[],
    userMessage: string | null,
    taskId: string,
    authContext: AuthContext | undefined,
    metadata: Record<string, unknown> | undefined,
    turnNumber: number,
    turnSpan: import('@opentelemetry/api').Span,
    turnContext: import('@opentelemetry/api').Context,
    logger: pino.Logger,
    subRef: { current: Subscription | undefined },
    observer: import('rxjs').Observer<ContextAnyEvent>,
  ): void {
    const run = async () => {
      try {
        // Append user message if provided
        if (userMessage) {
          messages.push({ role: 'user', content: userMessage });
          await this.config.messageStore.append(this.config.contextId, [
            { role: 'user', content: userMessage },
          ]);
        }

        logger.debug({ messageCount: messages.length }, 'Loaded messages for turn');

        // Accumulate tool-input-required events to save as pending state
        const pendingInputEvents: ToolInputRequiredEvent[] = [];

        const turnEvents$ = runLoop(
          {
            agentId: this.config.agentId,
            contextId: this.config.contextId,
            taskId,
            authContext,
            parentContext: turnContext,
            logger: this.config.logger.child({ taskId, turnNumber }),
            plugins: this.config.plugins || [],
            turnNumber,
            metadata,
          },
          {
            filterPlugins: this.config.filterPlugins,
            llmProvider: this.config.llmProvider,
            maxIterations: 5,
            stopOnToolError: false,
          },
          messages,
        ).pipe(
          concatMap(async (event) => {
            if (!isChildTaskEvent(event)) {
              switch (event.kind) {
                case 'content-complete':
                  if (event.content || event.toolCalls) {
                    logger.debug({ event }, 'Saving content-complete to message store');
                    await this.config.messageStore.append(this.config.contextId, [
                      {
                        role: 'assistant',
                        content: event.content,
                        toolCalls: event.toolCalls?.map((toolCall) => ({
                          id: toolCall.id,
                          type: toolCall.type,
                          function: {
                            name: toolCall.function.name,
                            arguments: toolCall.function.arguments || {},
                          },
                        })),
                      },
                    ]);
                  }
                  break;
                case 'tool-complete': {
                  logger.debug({ event }, 'Saving tool-complete to message store');
                  const message: LLMMessage = {
                    role: 'tool',
                    content: JSON.stringify({
                      success: event.success,
                      result: event.result,
                      error: event.error,
                    }),
                    toolCallId: event.toolCallId,
                  };
                  await this.config.messageStore.append(this.config.contextId, [message]);
                  break;
                }
                case 'tool-input-required':
                  // Capture for pending state — do NOT save a tool message yet (no result)
                  pendingInputEvents.push(event);
                  break;
                case 'internal:tool-message':
                  logger.debug({ event }, 'Saving internal:tool-message to message store');
                  await this.config.messageStore.append(this.config.contextId, [event.message]);
                  break;
                default:
                  break;
              }
            }
            return event;
          }),
          filter((event) => event.kind !== 'internal:tool-message'),
        );

        subRef.current = turnEvents$.subscribe({
          next: (event: ContextAnyEvent) => {
            observer.next(event);
          },
          error: (error: Error) => {
            logger.error({ error: serializeError(error) }, 'Turn execution failed');
            failAgentTurnSpan(turnSpan, error);
            observer.error(error);
          },
          complete: async () => {
            try {
              this._state.turnCount++;
              this._state.lastActivity = new Date();

              if (pendingInputEvents.length > 0) {
                // Persist pending tool inputs — turn is paused waiting for input
                this._state.status = 'waiting-input';
                this._state.pendingToolInputs = [
                  ...(this._state.pendingToolInputs ?? []),
                  ...pendingInputEvents.map(
                    (e): PendingToolInput => ({
                      inputId: e.inputId,
                      toolCallId: e.toolCallId,
                      toolName: e.toolName,
                      toolArguments: e.toolArguments,
                      taskId,
                      inputType: e.inputType,
                      prompt: e.prompt,
                      schema: e.schema,
                      options: e.options,
                      isLlmRequest: e.toolName === REQUEST_INPUT_TOOL_NAME,
                    }),
                  ),
                ];
              } else {
                this._state.status = 'idle';
                // Clear any previously resolved pending inputs (should already be empty)
                this._state.pendingToolInputs = undefined;
              }

              await this.persistState();
              setTurnCountAttribute(turnSpan, this._state.turnCount);

              if (this._state.status === 'idle' && this.config.autoCompact) {
                await this.checkAndCompact();
                addMessagesCompactedEvent(turnSpan);
              }

              logger.info(
                { turnCount: this._state.turnCount, status: this._state.status },
                'Turn completed',
              );

              completeAgentTurnSpan(turnSpan);
              observer.complete();
            } catch (error) {
              logger.error({ error: serializeError(error) }, 'Failed to save turn results');
              failAgentTurnSpan(turnSpan, error as Error);
              observer.error(error);
            }
          },
        });
      } catch (error) {
        logger.error({ error: serializeError(error) }, 'Failed to prepare turn');
        failAgentTurnSpan(turnSpan, error as Error);
        observer.error(error);
      }
    };

    run();
  }

  /**
   * Shutdown the agent (save state, cleanup resources)
   */
  async shutdown(): Promise<void> {
    if (this.shutdownComplete) {
      this.logger.debug('Agent already shutdown');
      return;
    }

    if (this.shuttingDown) {
      this.logger.debug('Shutdown already in progress');
      return;
    }

    this.shuttingDown = true;

    this.logger.info('Shutting down agent');

    try {
      this._state.status = 'shutdown';
      this._state.lastActivity = new Date();

      await this.persistState();

      this.shutdownComplete = true;
      this.config.logger.info('Agent shutdown complete');
    } catch (error) {
      this.config.logger.error({ error: serializeError(error) }, 'Failed to shutdown agent');
      throw error;
    } finally {
      this.shuttingDown = false;
    }
  }

  /**
   * Get conversation messages
   */
  async getMessages(options: GetMessagesOptions = {}): Promise<LLMMessage[]> {
    if (options.maxMessages || options.maxTokens) {
      return this.config.messageStore.getRecent(this.config.contextId, options);
    }
    return this.config.messageStore.getAll(this.config.contextId);
  }

  /**
   * Clear conversation history and artifacts
   */
  async clear(): Promise<void> {
    this.logger.info('Clearing agent data');

    try {
      await this.config.messageStore.clear(this.config.contextId);

      this._state.turnCount = 0;
      this._state.lastActivity = new Date();
      await this.persistState();

      this.logger.info('Agent data cleared');
    } catch (error) {
      this.logger.error({ error: serializeError(error) }, 'Failed to clear agent');
      throw error;
    }
  }

  private async persistState(): Promise<void> {
    if (!this.config.agentStore) {
      return;
    }

    const stateToPersist: AgentState = {
      ...this._state,
      lastActivity: new Date(this._state.lastActivity),
      createdAt: new Date(this._state.createdAt),
    };

    await this.config.agentStore.save(this.config.contextId, stateToPersist);
  }

  private persistStateSafely(): void {
    if (!this.config.agentStore) {
      return;
    }

    void this.persistState().catch((error) => {
      this.logger.error({ error: serializeError(error) }, 'Failed to persist agent state');
    });
  }

  private async loadPersistedState(): Promise<boolean> {
    if (!this.config.agentStore) {
      return false;
    }

    const persistedState = await this.config.agentStore.load(this.config.contextId);
    if (!persistedState) {
      return false;
    }

    this._state = {
      ...persistedState,
      lastActivity: new Date(persistedState.lastActivity),
      createdAt: new Date(persistedState.createdAt),
    };

    this.logger.debug(
      { turnCount: this._state.turnCount, status: this._state.status },
      'Loaded agent state from agent store',
    );

    return true;
  }

  /**
   * Load messages for current turn
   */
  private async loadMessages(): Promise<LLMMessage[]> {
    return this.config.messageStore.getRecent(this.config.contextId, {
      maxMessages: this.config.maxMessages,
    });
  }

  /**
   * Check if compaction is needed and perform it
   */
  private async checkAndCompact(): Promise<void> {
    const allMessages = await this.config.messageStore.getAll(this.config.contextId);

    if (allMessages.length > this.config.maxMessages) {
      this.logger.info(
        {
          messageCount: allMessages.length,
          maxMessages: this.config.maxMessages,
        },
        'Auto-compacting message history',
      );

      await this.config.messageStore.compact(this.config.contextId, {
        strategy: 'summarization',
        keepRecent: Math.floor(this.config.maxMessages * 0.5), // Keep 50%
      });
    }
  }
}
