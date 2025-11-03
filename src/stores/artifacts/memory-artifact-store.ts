/**
 * In-Memory Artifact Store Implementation
 *
 * Design: design/artifact-management.md
 *
 * Provides lightweight artifact storage for testing and development.
 * All artifacts are stored in memory and lost when process exits.
 */

import { randomUUID } from 'node:crypto';
import type { ArtifactPart, ArtifactStore, StoredArtifact } from '../../core/types';

export class InMemoryArtifactStore implements ArtifactStore {
  private artifacts = new Map<string, StoredArtifact>();
  private taskArtifacts = new Map<string, Set<string>>();
  private contextArtifacts = new Map<string, Set<string>>();

  async createArtifact(params: {
    artifactId: string;
    taskId: string;
    contextId: string;
    name?: string;
    description?: string;
  }): Promise<string> {
    const artifactId = params.artifactId;
    const now = new Date().toISOString();

    // Check if artifact with this ID already exists
    if (this.artifacts.has(artifactId)) {
      throw new Error(`Artifact already exists: ${artifactId}`);
    }

    const artifact: StoredArtifact = {
      artifactId,
      taskId: params.taskId,
      contextId: params.contextId,
      name: params.name,
      description: params.description,
      parts: [],
      totalParts: 0,
      version: 1,
      operations: [
        {
          operationId: randomUUID(),
          type: 'create',
          timestamp: now,
        },
      ],
      status: 'building',
      createdAt: now,
      updatedAt: now,
      lastChunkIndex: -1,
      isLastChunk: false,
    };

    this.artifacts.set(artifactId, artifact);

    // Track by task
    if (!this.taskArtifacts.has(params.taskId)) {
      this.taskArtifacts.set(params.taskId, new Set());
    }
    const taskSet = this.taskArtifacts.get(params.taskId);
    if (taskSet) taskSet.add(artifactId);

    // Track by context
    if (!this.contextArtifacts.has(params.contextId)) {
      this.contextArtifacts.set(params.contextId, new Set());
    }
    const contextSet = this.contextArtifacts.get(params.contextId);
    if (contextSet) contextSet.add(artifactId);

    return artifactId;
  }

  async appendPart(
    artifactId: string,
    part: Omit<ArtifactPart, 'index'>,
    isLastChunk: boolean = false
  ): Promise<void> {
    const artifact = this.artifacts.get(artifactId);
    if (!artifact) {
      throw new Error(`Artifact not found: ${artifactId}`);
    }

    const index = artifact.parts.length;
    const fullPart: ArtifactPart = { ...part, index };

    artifact.parts.push(fullPart);
    artifact.totalParts = artifact.parts.length;
    artifact.version++;
    artifact.updatedAt = new Date().toISOString();
    artifact.lastChunkIndex = index;
    artifact.isLastChunk = isLastChunk;

    if (isLastChunk) {
      artifact.status = 'complete';
      artifact.completedAt = artifact.updatedAt;
    }

    artifact.operations.push({
      operationId: randomUUID(),
      type: isLastChunk ? 'complete' : 'append',
      timestamp: artifact.updatedAt,
      partIndex: index,
    });
  }

  async replacePart(
    artifactId: string,
    partIndex: number,
    part: Omit<ArtifactPart, 'index'>
  ): Promise<void> {
    const artifact = this.artifacts.get(artifactId);
    if (!artifact) {
      throw new Error(`Artifact not found: ${artifactId}`);
    }

    if (partIndex < 0 || partIndex >= artifact.parts.length) {
      throw new Error(`Invalid part index: ${partIndex}`);
    }

    const fullPart: ArtifactPart = { ...part, index: partIndex };
    artifact.parts[partIndex] = fullPart;
    artifact.version++;
    artifact.updatedAt = new Date().toISOString();

    artifact.operations.push({
      operationId: randomUUID(),
      type: 'replace',
      timestamp: artifact.updatedAt,
      partIndex,
      replacedPartIndexes: [partIndex],
    });
  }

  async replaceParts(
    artifactId: string,
    parts: Omit<ArtifactPart, 'index'>[],
    isLastChunk: boolean = false
  ): Promise<void> {
    const artifact = this.artifacts.get(artifactId);
    if (!artifact) {
      throw new Error(`Artifact not found: ${artifactId}`);
    }

    const now = new Date().toISOString();

    // Replace all parts with new set, re-indexing
    artifact.parts = parts.map((part, index) => ({
      ...part,
      index,
    }));

    artifact.totalParts = artifact.parts.length;
    artifact.version++;
    artifact.updatedAt = now;
    artifact.lastChunkIndex = artifact.parts.length - 1;
    artifact.isLastChunk = isLastChunk;

    if (isLastChunk) {
      artifact.status = 'complete';
      artifact.completedAt = now;
    }

    artifact.operations.push({
      operationId: randomUUID(),
      type: isLastChunk ? 'complete' : 'replace',
      timestamp: now,
      replacedPartIndexes: artifact.parts.map((_, i) => i),
    });
  }

  async getArtifact(artifactId: string): Promise<StoredArtifact | null> {
    const artifact = this.artifacts.get(artifactId);
    return artifact ? { ...artifact } : null;
  }

  async getArtifactParts(
    artifactId: string,
    _resolveExternal: boolean = false
  ): Promise<ArtifactPart[]> {
    const artifact = this.artifacts.get(artifactId);
    if (!artifact) {
      throw new Error(`Artifact not found: ${artifactId}`);
    }

    // In memory store doesn't have external references
    // Just return the parts as-is
    return artifact.parts.map((p) => ({ ...p }));
  }

  async getTaskArtifacts(taskId: string): Promise<string[]> {
    const artifactIds = this.taskArtifacts.get(taskId);
    return artifactIds ? Array.from(artifactIds) : [];
  }

  async queryArtifacts(params: { contextId: string; taskId?: string }): Promise<string[]> {
    const contextIds = this.contextArtifacts.get(params.contextId);
    if (!contextIds) return [];

    if (params.taskId) {
      // Filter by both context and task
      const taskIds = this.taskArtifacts.get(params.taskId);
      if (!taskIds) return [];

      return Array.from(contextIds).filter((id) => taskIds.has(id));
    }

    return Array.from(contextIds);
  }

  async getArtifactByContext(
    contextId: string,
    artifactId: string
  ): Promise<StoredArtifact | null> {
    const artifact = this.artifacts.get(artifactId);
    if (!artifact) return null;

    // Verify artifact belongs to this context
    if (artifact.contextId !== contextId) {
      return null;
    }

    return { ...artifact };
  }

  async deleteArtifact(artifactId: string): Promise<void> {
    const artifact = this.artifacts.get(artifactId);
    if (!artifact) return;

    // Remove from task index
    const taskSet = this.taskArtifacts.get(artifact.taskId);
    if (taskSet) {
      taskSet.delete(artifactId);
      if (taskSet.size === 0) {
        this.taskArtifacts.delete(artifact.taskId);
      }
    }

    // Remove from context index
    const contextSet = this.contextArtifacts.get(artifact.contextId);
    if (contextSet) {
      contextSet.delete(artifactId);
      if (contextSet.size === 0) {
        this.contextArtifacts.delete(artifact.contextId);
      }
    }

    // Remove artifact
    this.artifacts.delete(artifactId);
  }

  async getArtifactContent(artifactId: string): Promise<string | object> {
    const artifact = this.artifacts.get(artifactId);
    if (!artifact) {
      throw new Error(`Artifact not found: ${artifactId}`);
    }

    // Combine all parts into single content
    if (artifact.parts.length === 0) {
      return '';
    }

    if (artifact.parts.length === 1) {
      const part = artifact.parts[0];
      if (part.kind === 'text') return part.content || '';
      if (part.kind === 'data') return part.data || {};
      if (part.kind === 'file') return part.content || '';
    }

    // Multi-part: combine text parts, return array for mixed
    const hasOnlyText = artifact.parts.every((p) => p.kind === 'text');
    if (hasOnlyText) {
      return artifact.parts.map((p) => p.content).join('');
    }

    // Return structured representation
    return {
      parts: artifact.parts.map((p) => ({
        index: p.index,
        kind: p.kind,
        content: p.content,
        data: p.data,
        metadata: p.metadata,
      })),
    };
  }

  /**
   * Clear all artifacts (for testing)
   */
  clear(): void {
    this.artifacts.clear();
    this.taskArtifacts.clear();
    this.contextArtifacts.clear();
  }

  /**
   * Get all artifacts (for testing)
   */
  getAll(): StoredArtifact[] {
    return Array.from(this.artifacts.values()).map((a) => ({ ...a }));
  }
}
