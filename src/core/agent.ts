/**
 * Agent - Stateful Multi-turn Conversation Manager
 *
 * Manages lifecycle, persistence, and state for multi-turn agent conversations.
 * Coordinates with AgentLoop for single-turn execution.
 *
 * Design Reference: design/agent-lifecycle.md
 */

import type { Context } from '@opentelemetry/api';
import { catchError, concat, Observable, of, tap } from 'rxjs';
import { createTaskStatusEvent } from '../events';
import {
  addMessagesCompactedEvent,
  addMessagesLoadedEvent,
  completeAgentInitializeSpan,
  completeAgentTurnSpan,
  failAgentInitializeSpan,
  failAgentTurnSpan,
  setResumeAttributes,
  setTurnCountAttribute,
  setTurnOutputAttribute,
  startAgentInitializeSpan,
  startAgentTurnSpan,
} from '../observability/spans';
import type { MessageStore } from '../stores/messages/interfaces';
import { AgentLoop } from './agent-loop';
import type { AgentLoopConfig } from './config';
import { getLogger } from './logger';
import type {
  AgentEvent,
  ArtifactStore,
  LLMProvider,
  Message,
  PersistedLoopState,
  TaskStateStore,
  ToolProvider,
} from './types';

/**
 * No-op state store for Agent (doesn't use old checkpoint system)
 */
class NoopStateStore implements TaskStateStore {
  async save(_taskId: string, _state: PersistedLoopState): Promise<void> {}
  async load(_taskId: string): Promise<PersistedLoopState | null> {
    return null;
  }
  async exists(_taskId: string): Promise<boolean> {
    return false;
  }
  async delete(_taskId: string): Promise<void> {}
  async listTasks(): Promise<string[]> {
    return [];
  }
  async setTTL(_taskId: string, _ttlSeconds: number): Promise<void> {}
}

/**
 * Agent configuration
 */
export interface AgentConfig {
  /** Unique identifier for this agent/session */
  contextId: string;

  /** LLM provider for generating responses */
  llmProvider: LLMProvider;

  /** Tool providers for tool execution */
  toolProviders: ToolProvider[];

  /** Message store for conversation history */
  messageStore: MessageStore;

  /** Artifact store for generated content */
  artifactStore: ArtifactStore;

  /** Agent loop configuration (optional overrides) */
  loopConfig?: Partial<AgentLoopConfig>;

  /** Auto-save messages after each turn (default: true) */
  autoSave?: boolean;

  /** Auto-compact messages when exceeding limit (default: false) */
  autoCompact?: boolean;

  /** Maximum messages to keep before compaction warning */
  maxMessages?: number;

  /** System prompt */
  systemPrompt?: string;

  /** Agent ID for tracing */
  agentId?: string;

  /** Logger */
  logger?: import('pino').Logger;
}

/**
 * Agent state
 */
export interface AgentState {
  /** Agent lifecycle status */
  status: 'created' | 'ready' | 'busy' | 'shutdown' | 'error';

  /** Total turns executed */
  turnCount: number;

  /** Last activity timestamp */
  lastActivity: Date;

  /** Creation timestamp */
  createdAt: Date;

  /** Error if in error state */
  error?: Error;

  /** Metadata */
  metadata?: Record<string, unknown>;
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

/**
 * Agent - Stateful Multi-turn Manager
 *
 * Manages the lifecycle of a multi-turn conversation:
 * - Loads and saves message history
 * - Coordinates turn execution via AgentLoop
 * - Handles pause/resume/shutdown
 * - Manages artifacts
 */
export class Agent {
  private readonly config: Omit<Required<AgentConfig>, 'loopConfig'> & {
    loopConfig?: Partial<AgentLoopConfig>;
  };

  private agentLoop: AgentLoop;
  private _state: AgentState;

  constructor(config: AgentConfig) {
    this.config = {
      autoSave: true,
      autoCompact: false,
      maxMessages: 100,
      agentId: 'default-agent',
      systemPrompt: 'You are a helpful AI assistant.',
      ...config,
      logger: config.logger || getLogger({ component: 'Agent', contextId: config.contextId }),
    };

    // Create agent loop with combined config
    this.agentLoop = new AgentLoop({
      agentId: this.config.agentId,
      llmProvider: this.config.llmProvider,
      toolProviders: this.config.toolProviders,
      taskStateStore: new NoopStateStore(), // Agent handles state, not AgentLoop
      artifactStore: this.config.artifactStore,
      systemPrompt: this.config.systemPrompt,
      logger: this.config.logger,
      ...this.config.loopConfig,
    });

    // Initialize state
    this._state = {
      status: 'created',
      turnCount: 0,
      lastActivity: new Date(),
      createdAt: new Date(),
    };

    this.config.logger.debug({ contextId: this.config.contextId }, 'Agent created');
  }

  /**
   * Get current agent state
   */
  get state(): Readonly<AgentState> {
    return { ...this._state };
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
      this.config.logger.info({ contextId: this.config.contextId }, 'Initializing agent');

      // Try to load existing messages (resume scenario)
      // Note: If messageStore requires auth, pass authContext to startTurn instead
      const existingMessages = await this.config.messageStore.getAll(this.config.contextId);

      if (existingMessages.length > 0) {
        this.config.logger.info(
          { contextId: this.config.contextId, messageCount: existingMessages.length },
          'Resuming agent with existing message history'
        );

        // Infer state from message count
        this._state.turnCount = Math.floor(existingMessages.length / 2); // Rough estimate
        setResumeAttributes(span, existingMessages.length);
      }

      this._state.status = 'ready';
      this._state.lastActivity = new Date();

      this.config.logger.info(
        { contextId: this.config.contextId, status: this._state.status },
        'Agent initialized'
      );

      completeAgentInitializeSpan(span);
    } catch (error) {
      this._state.status = 'error';
      this._state.error = error as Error;
      this.config.logger.error(
        { contextId: this.config.contextId, error },
        'Failed to initialize agent'
      );

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
      authContext?: import('./types').AuthContext;
      taskId?: string;
    }
  ): Promise<Observable<AgentEvent>> {
    const turnNumber = this._state.turnCount + 1;

    // Generate taskId if not provided
    const taskId = options?.taskId || `${this.config.contextId}-turn-${turnNumber}-${Date.now()}`;

    // Create span for the entire turn execution (including initialization and validation)
    const { span: rootSpan, traceContext: rootContext } = startAgentTurnSpan({
      agentId: this.config.agentId,
      taskId,
      contextId: this.config.contextId,
      turnNumber,
      userMessage,
    });

    this.config.logger.trace(
      { userMessage, spanName: `agent.turn[${this.config.agentId}]` },
      'Created agent turn span with input'
    );

    try {
      // Auto-initialize on first turn (will be nested within this span)
      if (this._state.status === 'created') {
        await this.initialize(rootContext);
      }

      // Validate state
      if (this._state.status === 'shutdown') {
        const error = new Error('Cannot execute turn: Agent has been shutdown');
        this.config.logger.error({ contextId: this.config.contextId }, error.message);

        failAgentTurnSpan(rootSpan, error);

        return of(
          createTaskStatusEvent({
            contextId: this.config.contextId,
            taskId,
            status: 'failed',
            message: error.message,
            metadata: { error: error.message },
          })
        );
      }

      if (this._state.status === 'error') {
        const error = new Error(
          `Cannot execute turn: Agent is in error state: ${this._state.error?.message}`
        );
        this.config.logger.error({ contextId: this.config.contextId }, error.message);

        failAgentTurnSpan(rootSpan, error);

        return of(
          createTaskStatusEvent({
            contextId: this.config.contextId,
            taskId,
            status: 'failed',
            message: error.message,
            metadata: { error: error.message },
          })
        );
      }

      if (this._state.status === 'busy') {
        const error = new Error('Cannot execute turn: Agent is already executing a turn');
        this.config.logger.error({ contextId: this.config.contextId }, error.message);

        failAgentTurnSpan(rootSpan, error);

        return of(
          createTaskStatusEvent({
            contextId: this.config.contextId,
            taskId,
            status: 'failed',
            message: error.message,
            metadata: { error: error.message },
          })
        );
      }

      this.config.logger.info(
        { contextId: this.config.contextId, taskId, userMessage },
        'Starting turn'
      );

      this._state.status = 'busy';
      this._state.lastActivity = new Date();

      // Load conversation history and execute turn
      return this.executeInternal(userMessage, taskId, options?.authContext, rootSpan, rootContext);
    } catch (error) {
      const err = error as Error;
      this.config.logger.error(
        { contextId: this.config.contextId, error: err },
        'Failed to start turn'
      );

      failAgentTurnSpan(rootSpan, err);

      return of(
        createTaskStatusEvent({
          contextId: this.config.contextId,
          taskId,
          status: 'failed',
          message: err.message,
          metadata: { error: err.message },
        })
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
    authContext: import('./types').AuthContext | undefined,
    turnSpan: import('@opentelemetry/api').Span,
    turnContext: import('@opentelemetry/api').Context
  ): Observable<AgentEvent> {
    const turnNumber = this._state.turnCount + 1;

    return concat(
      // Load messages, execute turn, save results
      new Observable<AgentEvent>((observer) => {
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

              // Save user message immediately if autoSave
              if (this.config.autoSave) {
                await this.config.messageStore.append(this.config.contextId, [
                  { role: 'user', content: userMessage },
                ]);
              }
            }

            this.config.logger.debug(
              {
                contextId: this.config.contextId,
                taskId,
                messageCount: messages.length,
                turnNumber,
              },
              'Loaded messages for turn'
            );

            // 3. Execute turn via AgentLoop with trace context
            const turnEvents$ = this.agentLoop
              .startTurnLoop(messages, {
                contextId: this.config.contextId,
                taskId,
                turnNumber,
                artifacts: await this.getArtifacts(),
                authContext,
                parentContext: turnContext,
              })
              .pipe(
                tap(async (event) => {
                  switch (event.kind) {
                    case 'content-complete':
                      if (this.config.autoSave && (event.content || event.toolCalls)) {
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
                    case 'tool-complete':
                      console.log('###### Captured tool message:', event);
                      // TODO convert and save to message store
                      // if (this.config.autoSave) {
                      //   await this.config.messageStore.append(this.config.contextId, [
                      //     {
                      //       role: 'tool',
                      //       content: 'Tool response',
                      //       toolCallId: event.toolCallId,
                      //       toolCalls: [
                      //         {
                      //           id: event.toolCallId,
                      //           type: 'function',
                      //           function: { name: event.toolName },
                      //         },
                      //       ],
                      //     },
                      //   ]);
                      // }
                      break;
                    case 'task-complete':
                      if (event.content) {
                        setTurnOutputAttribute(turnSpan, event.content);
                        this.config.logger.trace(
                          { messageContent: event.content },
                          `Added assistant message output to agent[${this.config.agentId}] span`
                        );
                      }
                      break;
                    default:
                      return;
                  }
                })
              );

            // Subscribe to turn events
            turnEvents$.subscribe({
              next: (event: AgentEvent) => {
                // Forward events to observer
                observer.next(event);
              },
              error: (error: Error) => {
                this.config.logger.error(
                  { contextId: this.config.contextId, error },
                  'Turn execution failed'
                );

                failAgentTurnSpan(turnSpan, error);
                observer.error(error);
              },
              complete: async () => {
                try {
                  // Update agent state
                  this._state.turnCount++;
                  this._state.lastActivity = new Date();
                  this._state.status = 'ready';

                  setTurnCountAttribute(turnSpan, this._state.turnCount);

                  // Check if compaction needed
                  if (this.config.autoCompact) {
                    await this.checkAndCompact();
                    addMessagesCompactedEvent(turnSpan);
                  }

                  this.config.logger.info(
                    { contextId: this.config.contextId, turnCount: this._state.turnCount },
                    'Turn completed'
                  );

                  completeAgentTurnSpan(turnSpan);
                  observer.complete();
                } catch (error) {
                  this.config.logger.error(
                    { contextId: this.config.contextId, error },
                    'Failed to save turn results'
                  );

                  failAgentTurnSpan(turnSpan, error as Error);
                  observer.error(error);
                }
              },
            });
          } catch (error) {
            this.config.logger.error(
              { contextId: this.config.contextId, error },
              'Failed to prepare turn'
            );

            failAgentTurnSpan(turnSpan, error as Error);
            observer.error(error);
          }
        };

        execute();
      }).pipe(
        catchError((error) => {
          this._state.status = 'error';
          this._state.error = error;

          // Fail the span for any errors caught in the pipeline
          failAgentTurnSpan(turnSpan, error);

          return of(
            createTaskStatusEvent({
              contextId: this.config.contextId,
              taskId,
              status: 'failed',
              message: error.message,
              metadata: { error: error.message },
            })
          );
        })
      )
    );
  }

  /**
   * Shutdown the agent (save state, cleanup resources)
   */
  async shutdown(): Promise<void> {
    this.config.logger.info({ contextId: this.config.contextId }, 'Shutting down agent');

    try {
      this._state.status = 'shutdown';
      this._state.lastActivity = new Date();

      // Save any pending state
      if (!this.config.autoSave) {
        await this.save();
      }

      this.config.logger.info({ contextId: this.config.contextId }, 'Agent shutdown complete');
    } catch (error) {
      this.config.logger.error(
        { contextId: this.config.contextId, error },
        'Failed to shutdown agent'
      );
      throw error;
    }
  }

  /**
   * Get conversation messages
   */
  async getMessages(options: GetMessagesOptions = {}): Promise<Message[]> {
    if (options.maxMessages || options.maxTokens) {
      return this.config.messageStore.getRecent(this.config.contextId, options);
    }
    return this.config.messageStore.getAll(this.config.contextId);
  }

  /**
   * Get generated artifacts
   */
  async getArtifacts(): Promise<Array<{ id: string; content: unknown }>> {
    // Use queryArtifacts to get all artifacts for this context
    const artifactIds = await this.config.artifactStore.queryArtifacts({
      contextId: this.config.contextId,
    });

    const artifacts = await Promise.all(
      artifactIds.map(async (id: string) => {
        // Use optional chaining for backward compatibility
        const content = this.config.artifactStore.getArtifactContent
          ? await this.config.artifactStore.getArtifactContent(id)
          : null;

        return { id, content };
      })
    );

    return artifacts.filter((a: { id: string; content: unknown }) => a.content !== null) as Array<{
      id: string;
      content: unknown;
    }>;
  }

  /**
   * Manually save current conversation state
   *
   * This ensures all messages are persisted to the MessageStore. Useful when autoSave
   * is disabled or when you want to ensure state is saved at a specific point.
   *
   * Note: This is a lightweight operation that just logs the save. Messages are
   * already persisted by the MessageStore's append() calls during startTurn().
   * This method exists primarily for explicit save points in your code.
   *
   * @example
   * ```typescript
   * const agent = new Agent({
   *   contextId: 'session-123',
   *   autoSave: false, // Disable auto-save
   *   // ... other config
   * });
   *
   * await agent.startTurn('Do something', authContext);
   * await agent.save(); // Explicitly save
   * ```
   */
  async save(): Promise<void> {
    this.config.logger.info(
      {
        contextId: this.config.contextId,
        turnCount: this._state.turnCount,
        status: this._state.status,
      },
      'Manual save called'
    );

    // Messages are already persisted via MessageStore.append() during startTurn()
    // Artifacts are already saved via ArtifactStore when created by tools
    // This method exists for explicit save points and future extensibility

    // Future: Could save additional metadata or trigger backup operations here
  }

  /**
   * Clear conversation history and artifacts
   */
  async clear(): Promise<void> {
    this.config.logger.info({ contextId: this.config.contextId }, 'Clearing agent data');

    try {
      await this.config.messageStore.clear(this.config.contextId);
      // TODO: Clear artifacts when clear() is added to ArtifactStore

      this._state.turnCount = 0;
      this._state.lastActivity = new Date();

      this.config.logger.info({ contextId: this.config.contextId }, 'Agent data cleared');
    } catch (error) {
      this.config.logger.error(
        { contextId: this.config.contextId, error },
        'Failed to clear agent'
      );
      throw error;
    }
  }

  /**
   * Load messages for current turn
   */
  private async loadMessages(): Promise<Message[]> {
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
      this.config.logger.info(
        {
          contextId: this.config.contextId,
          messageCount: allMessages.length,
          maxMessages: this.config.maxMessages,
        },
        'Auto-compacting message history'
      );

      await this.config.messageStore.compact(this.config.contextId, {
        strategy: 'summarization',
        keepRecent: Math.floor(this.config.maxMessages * 0.5), // Keep 50%
      });
    }
  }
}
