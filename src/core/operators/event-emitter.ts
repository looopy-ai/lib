/**
 * Event Emission Integration for AgentLoop
 *
 * This module provides a clean integration layer for emitting internal events
 * during AgentLoop execution without disrupting the existing Observable flow.
 *
 * Design: design/internal-event-protocol.md
 */

import { Subject } from 'rxjs';
import type { AnyEvent, TaskStatus } from '../../events';
import {
  createContentCompleteEvent,
  createContentDeltaEvent,
  createInternalCheckpointEvent,
  createTaskStatusEvent,
  createThoughtStreamEvent,
} from '../../events';
import type { FinishReason } from '../../events/types';
import type { Message, ToolCall, ToolResult } from '../types';
import { emitLLMCallEvent } from './llm-event-operators';
import { emitToolCompleteEvent, emitToolStartEvent } from './tool-operators';

/**
 * Event emitter for AgentLoop internal events
 *
 * This class manages event emission during execution and provides
 * methods to emit events at different stages of the loop.
 */
export class LoopEventEmitter {
  private eventSubject = new Subject<AnyEvent>();
  private eventBuffer: AnyEvent[] = [];
  private thoughtIndex = 0;

  /**
   * Get the event stream
   */
  get events$() {
    return this.eventSubject.asObservable();
  }

  /**
   * Emit task status change
   */
  emitTaskStatus(taskId: string, contextId: string, status: TaskStatus, message?: string): void {
    const event = createTaskStatusEvent({
      contextId,
      taskId,
      status,
      message,
      metadata: {},
    });
    this.eventSubject.next(event);
  }

  /**
   * Emit LLM call event (internal debug)
   */
  emitLLMCall(
    taskId: string,
    contextId: string,
    iteration: number,
    messages: Message[],
    toolCount: number,
  ): void {
    emitLLMCallEvent(taskId, contextId, iteration, messages, toolCount, this.eventBuffer);
    this.flushBuffer();
  }

  /**
   * Emit content streaming delta
   */
  emitContentDelta(taskId: string, contextId: string, delta: string, index: number): void {
    const event = createContentDeltaEvent({
      contextId,
      taskId,
      delta,
      index,
    });
    this.eventSubject.next(event);
  }

  /**
   * Emit content streaming complete
   */
  emitContentComplete(
    taskId: string,
    contextId: string,
    content: string,
    finishReason: FinishReason,
  ): void {
    const event = createContentCompleteEvent({
      contextId,
      taskId,
      content,
      finishReason,
    });
    this.eventSubject.next(event);
  }

  /**
   * Emit thought stream event
   */
  emitThought(
    taskId: string,
    contextId: string,
    thoughtType: import('../../events/types').ThoughtType,
    content: string,
    options?: {
      thoughtId?: string; // Optional: LLM-provided ID or will generate
      verbosity?: import('../../events/types').ThoughtVerbosity;
      confidence?: number;
      relatedTo?: string;
      alternatives?: string[];
      metadata?: Record<string, unknown>;
    },
  ): void {
    const event = createThoughtStreamEvent({
      contextId,
      taskId,
      thoughtId:
        options?.thoughtId || `thought-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
      thoughtType,
      verbosity: options?.verbosity || 'normal',
      content,
      index: this.thoughtIndex++,
      metadata: {
        confidence: options?.confidence,
        relatedTo: options?.relatedTo,
        alternatives: options?.alternatives,
        ...options?.metadata,
      },
    });
    this.eventSubject.next(event);
  }

  /**
   * Emit tool execution start
   */
  emitToolStart(taskId: string, contextId: string, toolCall: ToolCall): void {
    emitToolStartEvent(taskId, contextId, toolCall, this.eventBuffer);
    this.flushBuffer();
  }

  /**
   * Emit tool execution complete
   */
  emitToolComplete(taskId: string, contextId: string, result: ToolResult): void {
    emitToolCompleteEvent(taskId, contextId, result, this.eventBuffer);
    this.flushBuffer();
  }

  /**
   * Emit checkpoint event (internal debug)
   */
  emitCheckpoint(taskId: string, contextId: string, iteration: number): void {
    const event = createInternalCheckpointEvent({
      contextId,
      taskId,
      iteration,
    });
    this.eventSubject.next(event);
  }

  /**
   * Flush buffered events
   */
  private flushBuffer(): void {
    for (const event of this.eventBuffer) {
      this.eventSubject.next(event);
    }
    this.eventBuffer = [];
  }

  /**
   * Complete the event stream
   */
  complete(): void {
    this.flushBuffer();
    this.eventSubject.complete();
  }

  /**
   * Emit error
   */
  error(err: Error): void {
    this.eventSubject.error(err);
  }
}
