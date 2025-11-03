/**
 * Artifact Tool Provider
 *
 * Design: design/artifact-management.md#built-in-artifact-tools
 *
 * Provides tools for agents to create and manage artifacts that are
 * streamed to clients via the A2A protocol.
 */

import { z } from 'zod';
import type { ArtifactPart, ArtifactStore, StateStore, ToolProvider } from '../core/types';
import { localTools, tool } from './local-tools';

// Zod schemas matching A2A protocol
const A2APartSchema = z.union([
  z.object({
    kind: z.literal('text'),
    text: z.string(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  }),
  z.object({
    kind: z.literal('file'),
    file: z.object({
      name: z.string().optional(),
      mimeType: z.string().optional(),
      bytes: z.string().optional().describe('Base64 encoded content'),
      uri: z.string().optional(),
    }),
    metadata: z.record(z.string(), z.unknown()).optional(),
  }),
  z.object({
    kind: z.literal('data'),
    data: z.record(z.string(), z.unknown()),
    metadata: z.record(z.string(), z.unknown()).optional(),
  }),
]);

const A2AArtifactSchema = z.object({
  artifactId: z.string(),
  name: z.string().optional(),
  description: z.string().optional(),
  parts: z.array(A2APartSchema),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Helper to track artifacts in state
 */
async function trackArtifactInState(
  taskId: string,
  artifactId: string,
  stateStore: StateStore
): Promise<void> {
  // Load current state
  const state = await stateStore.load(taskId);
  if (!state) return;

  // Add artifact ID if not already present
  if (!state.artifactIds.includes(artifactId)) {
    state.artifactIds.push(artifactId);
    await stateStore.save(taskId, state);
  }
}

/**
 * Create artifact management tool provider
 *
 * @example
 * const artifactTools = createArtifactTools(artifactStore, stateStore);
 * const agentLoop = new AgentLoop({
 *   toolProviders: [artifactTools, ...otherTools],
 *   // ...
 * });
 */
export function createArtifactTools(
  artifactStore: ArtifactStore,
  stateStore: StateStore
): ToolProvider {
  return localTools([
    tool(
      'artifact_update',
      'Create or update an artifact with one or more parts. Use append=false for new artifacts or full replacements, append=true to add parts to existing artifacts.',
      z.object({
        artifact: A2AArtifactSchema.describe('Artifact with parts to create or update'),
        append: z
          .boolean()
          .optional()
          .default(false)
          .describe(
            'If true, append parts to existing artifact. If false, create new or replace all parts.'
          ),
        lastChunk: z
          .boolean()
          .optional()
          .default(false)
          .describe('If true, marks the artifact as complete (no more updates expected)'),
      }),
      async ({ artifact, append, lastChunk }, context) => {
        const { artifactId: requestedArtifactId, name, description, parts } = artifact;

        // Check if artifact exists
        const existing = await artifactStore.getArtifact(requestedArtifactId);

        if (!existing && append) {
          throw new Error(`Cannot append to non-existent artifact: ${requestedArtifactId}`);
        }

        let actualArtifactId: string;

        if (!existing) {
          // Create new artifact - this generates a new UUID
          actualArtifactId = await artifactStore.createArtifact({
            taskId: context.taskId,
            contextId: context.contextId,
            name,
            description,
          });

          // Track in state
          await trackArtifactInState(context.taskId, actualArtifactId, stateStore);
        } else {
          actualArtifactId = requestedArtifactId;
        }

        // Convert A2A parts to internal format and append
        for (const part of parts) {
          const internalPart: Omit<ArtifactPart, 'index'> =
            part.kind === 'text'
              ? { kind: 'text', content: part.text, metadata: part.metadata }
              : part.kind === 'file'
                ? {
                    kind: 'file',
                    content: part.file.bytes,
                    metadata: {
                      fileName: part.file.name,
                      mimeType: part.file.mimeType,
                      uri: part.file.uri,
                      ...part.metadata,
                    },
                  }
                : { kind: 'data', data: part.data, metadata: part.metadata };

          await artifactStore.appendPart(
            actualArtifactId,
            internalPart,
            lastChunk && parts.indexOf(part) === parts.length - 1
          );
        }

        return {
          artifactId: actualArtifactId,
          partsAdded: parts.length,
          complete: lastChunk,
        };
      }
    ),

    tool(
      'list_artifacts',
      'List all artifacts for the current context, optionally filtered by task',
      z.object({
        taskId: z.string().optional().describe('Optional task ID to filter artifacts'),
      }),
      async (params, context) => {
        const artifactIds = await artifactStore.queryArtifacts({
          contextId: context.contextId,
          taskId: params.taskId,
        });

        const artifacts = await Promise.all(
          artifactIds.map((id) => artifactStore.getArtifactByContext(context.contextId, id))
        );

        return {
          artifacts: artifacts
            .filter((a) => a !== null)
            .map((a) => ({
              artifactId: a.artifactId,
              taskId: a.taskId,
              name: a.name,
              description: a.description,
              status: a.status,
              totalParts: a.totalParts,
            })),
        };
      }
    ),

    tool(
      'get_artifact',
      'Get a specific artifact by ID within the current context',
      z.object({
        artifactId: z.string().describe('The artifact ID to retrieve'),
      }),
      async (params, context) => {
        const artifact = await artifactStore.getArtifactByContext(
          context.contextId,
          params.artifactId
        );

        if (!artifact) {
          throw new Error(`Artifact not found: ${params.artifactId}`);
        }

        const parts = await artifactStore.getArtifactParts(params.artifactId, true);

        return {
          artifactId: artifact.artifactId,
          taskId: artifact.taskId,
          name: artifact.name,
          description: artifact.description,
          status: artifact.status,
          parts: parts.map((p) => ({
            index: p.index,
            kind: p.kind,
            content: p.content,
            data: p.data,
            metadata: p.metadata,
          })),
        };
      }
    ),
  ]);
}
