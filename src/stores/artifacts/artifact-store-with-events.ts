/**
 * Artifact Store with A2A Event Emission
 *
 * Design: design/artifact-management.md#a2a-event-emission
 *
 * Decorator pattern that wraps any ArtifactStore implementation
 * and automatically emits A2A artifact-update events for all mutations.
 */

import type { Subject } from 'rxjs';
import type {
  A2AArtifact,
  A2APart,
  ArtifactPart,
  ArtifactStore,
  ArtifactUpdateEvent,
  StoredArtifact,
} from '../../core/types';

/**
 * Event emitter interface for A2A events
 */
export interface A2AEventEmitter {
  emit(taskId: string, event: ArtifactUpdateEvent): Promise<void>;
}

/**
 * Simple Subject-based event emitter for testing
 */
export class SubjectEventEmitter implements A2AEventEmitter {
  constructor(private subject: Subject<ArtifactUpdateEvent>) {}

  async emit(_taskId: string, event: ArtifactUpdateEvent): Promise<void> {
    this.subject.next(event);
  }
}

/**
 * Artifact store decorator that emits A2A events
 */
export class ArtifactStoreWithEvents implements ArtifactStore {
  constructor(
    private delegate: ArtifactStore,
    private eventEmitter: A2AEventEmitter
  ) {}

  async createArtifact(params: {
    taskId: string;
    contextId: string;
    name?: string;
    description?: string;
  }): Promise<string> {
    // 1. Create in store
    const artifactId = await this.delegate.createArtifact(params);

    // 2. Emit A2A event
    await this.emitArtifactUpdate(
      params.taskId,
      params.contextId,
      artifactId,
      'create',
      false, // append
      false // lastChunk
    );

    return artifactId;
  }

  async appendPart(
    artifactId: string,
    part: Omit<ArtifactPart, 'index'>,
    isLastChunk: boolean = false
  ): Promise<void> {
    // 1. Append to store
    await this.delegate.appendPart(artifactId, part, isLastChunk);

    // 2. Get artifact metadata
    const artifact = await this.delegate.getArtifact(artifactId);
    if (!artifact) throw new Error('Artifact not found');

    // 3. Emit A2A event
    await this.emitArtifactUpdate(
      artifact.taskId,
      artifact.contextId,
      artifactId,
      'append',
      true, // append
      isLastChunk
    );
  }

  async replacePart(
    artifactId: string,
    partIndex: number,
    part: Omit<ArtifactPart, 'index'>
  ): Promise<void> {
    // 1. Replace in store
    await this.delegate.replacePart(artifactId, partIndex, part);

    // 2. Get artifact metadata
    const artifact = await this.delegate.getArtifact(artifactId);
    if (!artifact) throw new Error('Artifact not found');

    // 3. Emit A2A event
    await this.emitArtifactUpdate(
      artifact.taskId,
      artifact.contextId,
      artifactId,
      'replace',
      false, // Not append, full replacement
      false // Replace is never final
    );
  }

  // Delegate read-only methods directly
  async getArtifact(artifactId: string): Promise<StoredArtifact | null> {
    return this.delegate.getArtifact(artifactId);
  }

  async getArtifactParts(artifactId: string, resolveExternal?: boolean): Promise<ArtifactPart[]> {
    return this.delegate.getArtifactParts(artifactId, resolveExternal);
  }

  async getTaskArtifacts(taskId: string): Promise<string[]> {
    return this.delegate.getTaskArtifacts(taskId);
  }

  async queryArtifacts(params: { contextId: string; taskId?: string }): Promise<string[]> {
    return this.delegate.queryArtifacts(params);
  }

  async getArtifactByContext(
    contextId: string,
    artifactId: string
  ): Promise<StoredArtifact | null> {
    return this.delegate.getArtifactByContext(contextId, artifactId);
  }

  async deleteArtifact(artifactId: string): Promise<void> {
    return this.delegate.deleteArtifact(artifactId);
  }

  async getArtifactContent(artifactId: string): Promise<string | object> {
    return this.delegate.getArtifactContent(artifactId);
  }

  /**
   * Emit A2A artifact-update event
   */
  private async emitArtifactUpdate(
    taskId: string,
    contextId: string,
    artifactId: string,
    operation: 'create' | 'append' | 'replace',
    append: boolean,
    lastChunk: boolean
  ): Promise<void> {
    // Get current artifact state
    const artifact = await this.delegate.getArtifact(artifactId);
    if (!artifact) return;

    // Convert to A2A format
    const a2aArtifact = await this.convertToA2AArtifact(artifact, operation);

    // Emit event
    const event: ArtifactUpdateEvent = {
      kind: 'artifact-update',
      taskId,
      contextId,
      artifact: a2aArtifact,
      append,
      lastChunk,
      metadata: {
        operation,
        version: artifact.version,
      },
    };

    await this.eventEmitter.emit(taskId, event);
  }

  /**
   * Convert StoredArtifact to A2A format
   */
  private async convertToA2AArtifact(
    artifact: StoredArtifact,
    operation: 'create' | 'append' | 'replace'
  ): Promise<A2AArtifact> {
    // For append operations, only send the latest part
    // For create/replace, send all parts
    const parts =
      operation === 'append' ? [artifact.parts[artifact.parts.length - 1]] : artifact.parts;

    return {
      artifactId: artifact.artifactId,
      name: artifact.name,
      description: artifact.description,
      parts: await Promise.all(parts.map((p) => this.convertToA2APart(p))),
      metadata: {
        status: artifact.status,
        version: artifact.version,
      },
    };
  }

  /**
   * Convert ArtifactPart to A2A format
   */
  private async convertToA2APart(part: ArtifactPart): Promise<A2APart> {
    if (part.kind === 'text') {
      return {
        kind: 'text',
        text: part.content || '',
        metadata: part.metadata,
      };
    }

    if (part.kind === 'file') {
      // Load from external storage if needed
      const content = part.fileReference
        ? await this.delegate.getArtifactContent(part.fileReference.storageKey)
        : part.content;

      return {
        kind: 'file',
        file: {
          name: part.metadata?.fileName as string | undefined,
          mimeType: part.metadata?.mimeType as string | undefined,
          bytes: typeof content === 'string' ? content : JSON.stringify(content),
        },
        metadata: part.metadata,
      };
    }

    if (part.kind === 'data') {
      return {
        kind: 'data',
        data: part.data || {},
        metadata: part.metadata,
      };
    }

    throw new Error(`Unknown part kind: ${(part as ArtifactPart).kind}`);
  }
}
