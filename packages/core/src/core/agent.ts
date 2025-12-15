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
import { catchError, concat, filter, Observable, of, tap } from 'rxjs';
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
import type { MessageStore } from '../stores/messages/interfaces';
import type { AgentState, AgentStore } from '../types/agent';
import type { Plugin } from '../types/core';
import type { ContextAnyEvent } from '../types/event';
import type { LLMProvider } from '../types/llm';
import type { LLMMessage } from '../types/message';
import { serializeError } from '../utils/error';
import { getLogger } from './logger';
import { runLoop } from './loop';

/**
 * Agent configuration
 */
export interface AgentConfig<AuthContext> {
  /** Agent ID for tracing */
  agentId: string;

  /** Unique identifier for this agent/session */
  contextId: string;

  /** LLM provider for generating responses */
  llmProvider: LLMProvider;

  /** Message store for conversation history */
  messageStore: MessageStore;

  /** Agent store for persisting AgentState */
  agentStore?: AgentStore;

  /** Auto-compact messages when exceeding limit (default: false) */
  autoCompact?: boolean;

  /** Maximum messages to keep before compaction warning */
  maxMessages?: number;

  /** Plugins */
  plugins?: Plugin<AuthContext>[];

  /** Logger */
  logger?: import('pino').Logger;
}

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
    if (this._state.status !== 'created') {
      return; // Already initialized
    }

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

      this._state.status = 'idle';
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
      // Auto-initialize on first turn (will be nested within this span)
      if (this._state.status === 'created') {
        await this.initialize(rootContext);
      }

      // Validate state
      if (this._state.status === 'shutdown') {
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

      if (this._state.status === 'error') {
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

      if (this._state.status === 'busy') {
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

      logger.info({ userMessage }, 'Starting turn');

      this._state.status = 'busy';
      this._state.lastActivity = new Date();
      await this.persistState();

      // Load conversation history and execute turn
      return this.executeInternal(
        userMessage,
        taskId,
        options?.authContext,
        options?.metadata,
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
   * @param turnSpan - Parent span created in startTurn()
   * @param turnContext - Parent context for tracing
   */
  private executeInternal(
    userMessage: string | null,
    taskId: string,
    authContext: AuthContext | undefined,
    metadata: Record<string, unknown> | undefined,
    turnSpan: import('@opentelemetry/api').Span,
    turnContext: import('@opentelemetry/api').Context,
    logger: pino.Logger,
  ): Observable<ContextAnyEvent> {
    const turnNumber = this._state.turnCount + 1;

    return concat(
      // Load messages, execute turn, save results
      new Observable<ContextAnyEvent>((observer) => {
        const execute = async () => {
          try {
            // 1. Load conversation history
            const messages = await this.loadMessages();
            addMessagesLoadedEvent(turnSpan, messages.length);

            // 2. Append user message if provided
            if (userMessage) {
              messages.push({
                role: 'user',
                content: userMessage,
              });

              // Save user message immediately if
              await this.config.messageStore.append(this.config.contextId, [
                { role: 'user', content: userMessage },
              ]);
            }

            logger.debug(
              {
                messageCount: messages.length,
              },
              'Loaded messages for turn',
            );

            // 3. Execute turn via AgentLoop with trace context
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
                llmProvider: this.config.llmProvider,
                maxIterations: 5,
                stopOnToolError: false,
              },
              messages,
            ).pipe(
              tap(async (event) => {
                if (isChildTaskEvent(event)) return;
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
                  case 'internal:tool-message':
                    logger.debug({ event }, 'Saving internal:tool-message to message store');
                    await this.config.messageStore.append(this.config.contextId, [event.message]);
                    break;
                  default:
                    break;
                }
              }),
              filter((event) => event.kind !== 'internal:tool-message'),
            );

            // Subscribe to turn events
            turnEvents$.subscribe({
              next: (event: ContextAnyEvent) => {
                // Forward events to observer
                observer.next(event);
              },
              error: (error: Error) => {
                logger.error({ error }, 'Turn execution failed');

                failAgentTurnSpan(turnSpan, error);
                observer.error(error);
              },
              complete: async () => {
                try {
                  // Update agent state
                  this._state.turnCount++;
                  this._state.lastActivity = new Date();
                  this._state.status = 'idle';
                  await this.persistState();

                  setTurnCountAttribute(turnSpan, this._state.turnCount);

                  // Check if compaction needed
                  if (this.config.autoCompact) {
                    await this.checkAndCompact();
                    addMessagesCompactedEvent(turnSpan);
                  }

                  logger.info({ turnCount: this._state.turnCount }, 'Turn completed');

                  completeAgentTurnSpan(turnSpan);
                  observer.complete();
                } catch (error) {
                  logger.error({ error }, 'Failed to save turn results');

                  failAgentTurnSpan(turnSpan, error as Error);
                  observer.error(error);
                }
              },
            });
          } catch (error) {
            logger.error({ error }, 'Failed to prepare turn');

            failAgentTurnSpan(turnSpan, error as Error);
            observer.error(error);
          }
        };

        execute();
      }).pipe(
        catchError((error) => {
          this._state.status = 'error';
          this._state.error = error;
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
      this.config.logger.error({ error }, 'Failed to shutdown agent');
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
      this.logger.error({ error }, 'Failed to clear agent');
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
      this.logger.error({ error }, 'Failed to persist agent state');
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
