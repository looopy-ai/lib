/**
 * Memory Agent Store
 *
 * Persists AgentState in memory using a Map.
 * Suitable for testing and single-process applications.
 * State is lost when the process terminates.
 */

import type { AgentState, AgentStore } from '../../types/agent';

export class MemoryAgentStore implements AgentStore {
  private readonly store: Map<string, AgentState> = new Map();

  async load(contextId: string): Promise<AgentState | null> {
    const state = this.store.get(contextId);
    return state ?? null;
  }

  async save(contextId: string, state: AgentState): Promise<void> {
    this.store.set(contextId, state);
  }

  async delete(contextId: string): Promise<void> {
    this.store.delete(contextId);
  }

  /**
   * Clear all stored state.
   * Useful for testing and cleanup.
   */
  clear(): void {
    this.store.clear();
  }

  /**
   * Get the number of contexts stored.
   */
  size(): number {
    return this.store.size;
  }

  /**
   * Get all context IDs.
   */
  contextIds(): string[] {
    return Array.from(this.store.keys());
  }
}
