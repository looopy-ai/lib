/**
 * Agent - Stateful Multi-turn Conversation Manager
 *
 * Manages lifecycle, persistence, and state for multi-turn agent conversations.
 * Coordinates with AgentLoop for single-turn execution.
 *
 * Design Reference: design/agent-lifecycle.md
 */

import { catchError, concat, Observable, of } from 'rxjs';
import {
  addMessagesCompactedEvent,
  addMessagesLoadedEvent,
  addMessagesSavedEvent,
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
  StateStore,
  ToolProvider,
} from './types';

/**
 * No-op state store for Agent (doesn't use old checkpoint system)
 */
class NoopStateStore implements StateStore {
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
      stateStore: new NoopStateStore(), // Agent handles state, not AgentLoop
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
   * @param parentSpan - Optional parent span to nest the initialization span within
   */
  private async initialize(parentSpan?: import('@opentelemetry/api').Span): Promise<void> {
    if (this._state.status !== 'created') {
      return; // Already initialized
    }

    const span = startAgentInitializeSpan({
      agentId: this.config.agentId,
      contextId: this.config.contextId,
      parentSpan,
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
    const span = startAgentTurnSpan({
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
        await this.initialize(span);
      }

      // Validate state
      if (this._state.status === 'shutdown') {
        const error = new Error('Cannot execute turn: Agent has been shutdown');
        this.config.logger.error({ contextId: this.config.contextId }, error.message);

        failAgentTurnSpan(span, error);

        return of({
          kind: 'status-update',
          taskId,
          contextId: this.config.contextId,
          status: {
            state: 'failed',
            timestamp: new Date().toISOString(),
          },
          final: true,
          metadata: { error: error.message },
        } as AgentEvent);
      }

      if (this._state.status === 'error') {
        const error = new Error(
          `Cannot execute turn: Agent is in error state: ${this._state.error?.message}`
        );
        this.config.logger.error({ contextId: this.config.contextId }, error.message);

        failAgentTurnSpan(span, error);

        return of({
          kind: 'status-update',
          taskId,
          contextId: this.config.contextId,
          status: {
            state: 'failed',
            timestamp: new Date().toISOString(),
          },
          final: true,
          metadata: { error: error.message },
        } as AgentEvent);
      }

      if (this._state.status === 'busy') {
        const error = new Error('Cannot execute turn: Agent is already executing a turn');
        this.config.logger.error({ contextId: this.config.contextId }, error.message);

        failAgentTurnSpan(span, error);

        return of({
          kind: 'status-update',
          taskId,
          contextId: this.config.contextId,
          status: {
            state: 'failed',
            timestamp: new Date().toISOString(),
          },
          final: true,
          metadata: { error: error.message },
        } as AgentEvent);
      }

      this.config.logger.info(
        { contextId: this.config.contextId, taskId, userMessage },
        'Executing turn'
      );

      this._state.status = 'busy';
      this._state.lastActivity = new Date();

      // Load conversation history and execute turn
      return this.executeInternal(userMessage, taskId, options?.authContext, span);
    } catch (error) {
      const err = error as Error;
      this.config.logger.error(
        { contextId: this.config.contextId, error: err },
        'Failed to start turn'
      );

      failAgentTurnSpan(span, err);

      return of({
        kind: 'status-update',
        taskId,
        contextId: this.config.contextId,
        status: {
          state: 'failed',
          timestamp: new Date().toISOString(),
        },
        final: true,
        metadata: { error: err.message },
      } as AgentEvent);
    }
  }

  /**
   * Internal turn execution with full error handling
   *
   * @param userMessage - User's message (or null for continuation)
   * @param taskId - Task ID for this turn
   * @param authContext - Authentication context (refreshed token, user credentials)
   * @param span - Parent span created in startTurn()
   */
  private executeInternal(
    userMessage: string | null,
    taskId: string,
    authContext: import('./types').AuthContext | undefined,
    span: import('@opentelemetry/api').Span
  ): Observable<AgentEvent> {
    const turnNumber = this._state.turnCount + 1;

    // Extract trace context from the span for propagation to AgentLoop
    const spanContext = span.spanContext();
    const traceContext = {
      traceId: spanContext.traceId,
      spanId: spanContext.spanId,
      traceFlags: spanContext.traceFlags,
    };

    return concat(
      // Load messages, execute turn, save results
      new Observable<AgentEvent>((observer) => {
        const execute = async () => {
          try {
            // 1. Load conversation history
            const messages = await this.loadMessages();
            addMessagesLoadedEvent(span, messages.length);

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
            const turnEvents$ = this.agentLoop.startTurn(messages, {
              contextId: this.config.contextId,
              taskId,
              turnNumber,
              artifacts: await this.getArtifacts(),
              authContext,
              traceContext, // Propagate trace context for nested spans
            });

            // Collect assistant messages during turn
            const assistantMessages: Message[] = [];

            // Subscribe to turn events
            turnEvents$.subscribe({
              next: (event: AgentEvent) => {
                // Forward events to observer
                observer.next(event);

                // Collect assistant messages
                if (event.kind === 'status-update' && event.status.message) {
                  const msg = event.status.message;
                  if (msg.role === 'assistant' || msg.role === 'tool') {
                    assistantMessages.push(msg);
                  }
                }
              },
              error: (error: Error) => {
                this.config.logger.error(
                  { contextId: this.config.contextId, error },
                  'Turn execution failed'
                );

                failAgentTurnSpan(span, error);
                observer.error(error);
              },
              complete: async () => {
                try {
                  // 4. Save assistant messages if autoSave
                  if (this.config.autoSave && assistantMessages.length > 0) {
                    await this.config.messageStore.append(this.config.contextId, assistantMessages);
                    addMessagesSavedEvent(span, assistantMessages.length);

                    this.config.logger.debug(
                      {
                        contextId: this.config.contextId,
                        messageCount: assistantMessages.length,
                      },
                      'Saved assistant messages'
                    );
                  }

                  // Add output to span (final assistant message)
                  const finalAssistantMessage = assistantMessages.find(
                    (m) => m.role === 'assistant'
                  );
                  if (finalAssistantMessage) {
                    const messageContent =
                      typeof finalAssistantMessage.content === 'string'
                        ? finalAssistantMessage.content
                        : JSON.stringify(finalAssistantMessage.content);

                    setTurnOutputAttribute(span, messageContent);

                    this.config.logger.trace(
                      { messageContent },
                      `Added assistant message output to agent.turn[${this.config.agentId}] span`
                    );
                  }

                  // 5. Update agent state
                  this._state.turnCount++;
                  this._state.lastActivity = new Date();
                  this._state.status = 'ready';

                  setTurnCountAttribute(span, this._state.turnCount);

                  // 6. Check if compaction needed
                  if (this.config.autoCompact) {
                    await this.checkAndCompact();
                    addMessagesCompactedEvent(span);
                  }

                  this.config.logger.info(
                    { contextId: this.config.contextId, turnCount: this._state.turnCount },
                    'Turn completed'
                  );

                  completeAgentTurnSpan(span);
                  observer.complete();
                } catch (error) {
                  this.config.logger.error(
                    { contextId: this.config.contextId, error },
                    'Failed to save turn results'
                  );

                  failAgentTurnSpan(span, error as Error);
                  observer.error(error);
                }
              },
            });
          } catch (error) {
            this.config.logger.error(
              { contextId: this.config.contextId, error },
              'Failed to prepare turn'
            );

            failAgentTurnSpan(span, error as Error);
            observer.error(error);
          }
        };

        execute();
      }).pipe(
        catchError((error) => {
          this._state.status = 'error';
          this._state.error = error;

          // Fail the span for any errors caught in the pipeline
          failAgentTurnSpan(span, error);

          return of({
            kind: 'status-update',
            taskId,
            contextId: this.config.contextId,
            status: {
              state: 'failed',
              timestamp: new Date().toISOString(),
            },
            final: true,
            metadata: { error: error.message },
          } as AgentEvent);
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
      // Save any pending state
      if (!this.config.autoSave) {
        await this.save();
      }

      this._state.status = 'shutdown';
      this._state.lastActivity = new Date();

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
      artifactIds.map(async (id: string) => ({
        id,
        content: await this.config.artifactStore.getArtifactContent(id),
      }))
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
