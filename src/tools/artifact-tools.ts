/**
 * Artifact Tool Provider
 *
 * Design: design/artifact-management.md#built-in-artifact-tools
 *
 * Provides tools for agents to create and manage artifacts that are
 * streamed to clients via the A2A protocol.
 */

import { z } from 'zod';
import type { A2APart, ArtifactPart, ArtifactStore, StateStore, ToolProvider } from '../core/types';
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
  z.object({}),
]);

const A2AArtifactSchema = z.object({
  artifactId: z
    .string()
    .describe('Unique identifier for the artifact (e.g., "report-2025", "analysis-results")'),
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
 * Convert A2A part to internal format
 */
function convertA2APartToInternal(part: {
  kind: string;
  text?: string;
  file?: { name?: string; mimeType?: string; bytes?: string; uri?: string };
  data?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}): Omit<ArtifactPart, 'index'> {
  if (part.kind === 'text') {
    return { kind: 'text', content: part.text || '', metadata: part.metadata };
  }
  if (part.kind === 'file' && part.file) {
    return {
      kind: 'file',
      content: part.file.bytes,
      metadata: {
        fileName: part.file.name,
        mimeType: part.file.mimeType,
        uri: part.file.uri,
        ...part.metadata,
      },
    };
  }
  return { kind: 'data', data: part.data || {}, metadata: part.metadata };
}

/**
 * Group parts by kind and concatenate text parts
 */
function groupPartsByKind(
  parts: Array<{
    kind: string;
    text?: string;
    file?: { name?: string; mimeType?: string; bytes?: string; uri?: string };
    data?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  }>
): Map<
  string,
  {
    kind: string;
    text?: string;
    file?: { name?: string; mimeType?: string; bytes?: string; uri?: string };
    data?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  }
> {
  const partsByKind = new Map();

  for (const part of parts) {
    const existing = partsByKind.get(part.kind);
    if (existing && part.kind === 'text' && part.text) {
      // Concatenate text parts
      existing.text = (existing.text || '') + part.text;
    } else {
      // First part of this kind, or non-text part (file/data don't concatenate)
      partsByKind.set(part.kind, { ...part });
    }
  }

  return partsByKind;
}

/**
 * Replace artifact parts (append=false behavior)
 *
 * Groups parts by kind and concatenates them. For each kind present in the new parts,
 * replaces ALL existing parts of that kind with the concatenated result.
 */
async function replaceArtifactParts(
  artifactStore: ArtifactStore,
  artifactId: string,
  parts: Array<{
    kind: string;
    text?: string;
    file?: { name?: string; mimeType?: string; bytes?: string; uri?: string };
    data?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  }>,
  lastChunk: boolean
): Promise<{ partsReplaced: number; partsAdded: number }> {
  const existingParts = await artifactStore.getArtifactParts(artifactId);

  // Group new parts by kind and concatenate using helper
  const partsByKind = groupPartsByKind(parts);

  // Group existing parts by kind
  const existingByKind = new Map<string, ArtifactPart[]>();
  for (const part of existingParts) {
    const list = existingByKind.get(part.kind) || [];
    list.push(part);
    existingByKind.set(part.kind, list);
  }

  let partsReplaced = 0;
  let partsAdded = 0;

  // Build final parts list
  const finalParts: Omit<ArtifactPart, 'index'>[] = [];

  // Add parts from new request (concatenated by kind)
  for (const [kind, part] of partsByKind) {
    const internalPart = convertA2APartToInternal(part);
    finalParts.push(internalPart);

    const existingOfKind = existingByKind.get(kind);
    if (existingOfKind && existingOfKind.length > 0) {
      partsReplaced += existingOfKind.length;
    } else {
      partsAdded++;
    }
  }

  // Add existing parts that weren't in the new request (preserve other kinds)
  for (const [kind, existingOfKind] of existingByKind) {
    if (!partsByKind.has(kind)) {
      for (const part of existingOfKind) {
        const { index: _index, ...partWithoutIndex } = part;
        finalParts.push(partWithoutIndex);
      }
    }
  }

  // Replace all parts with new set
  await artifactStore.replaceParts(artifactId, finalParts, lastChunk);

  return { partsReplaced, partsAdded };
}

/**
 * Append artifact parts (append=true behavior)
 *
 * Groups parts by kind and concatenates them with existing parts of the same kind.
 * For text parts, appends new text to existing text. For other types, adds as new parts.
 */
async function appendArtifactParts(
  artifactStore: ArtifactStore,
  artifactId: string,
  parts: Array<{
    kind: string;
    text?: string;
    file?: { name?: string; mimeType?: string; bytes?: string; uri?: string };
    data?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  }>,
  lastChunk: boolean
): Promise<number> {
  const existingParts = await artifactStore.getArtifactParts(artifactId);

  // Group new parts by kind and concatenate using helper
  const partsByKind = groupPartsByKind(parts);

  // Build final parts list
  const finalParts: Omit<ArtifactPart, 'index'>[] = [];

  // Add all existing parts, concatenating with new parts of same kind
  const processedKinds = new Set<string>();

  for (const part of existingParts) {
    const { index: _index, ...partWithoutIndex } = part;

    const newPart = partsByKind.get(part.kind);
    if (newPart && !processedKinds.has(part.kind)) {
      // Concatenate with new part of same kind
      if (part.kind === 'text' && newPart.text) {
        finalParts.push({
          kind: 'text',
          content: (part.content || '') + newPart.text,
          metadata: part.metadata,
        });
      } else {
        // Non-text: keep existing, will add new as separate part
        finalParts.push(partWithoutIndex);
      }
      processedKinds.add(part.kind);
    } else if (!newPart) {
      // No new part of this kind, keep existing
      finalParts.push(partWithoutIndex);
    }
  }

  // Add new parts that didn't exist before
  for (const [kind, part] of partsByKind) {
    if (!processedKinds.has(kind)) {
      const internalPart = convertA2APartToInternal(part);
      finalParts.push(internalPart);
    }
  }

  // Replace all parts with concatenated set
  await artifactStore.replaceParts(artifactId, finalParts, lastChunk);

  return parts.length;
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
      'Create or update an artifact with one or more parts. Use append=false to replace all parts of an artifact, append=true to append parts to an existing artifact.',
      z.object({
        artifact: A2AArtifactSchema.describe(
          'Artifact with parts to create or update. An artifact may have up to one part of each kind.'
        ),
        append: z
          .boolean()
          .optional()
          .default(false)
          .describe(
            'If true, append parts to existing artifact. If false, replace all parts of the artifact.'
          ),
        lastChunk: z
          .boolean()
          .optional()
          .default(false)
          .describe('If true, marks the artifact as complete (no more updates expected)'),
      }),
      async ({ artifact, append, lastChunk }, context) => {
        const { artifactId: requestedArtifactId, name, description, parts } = artifact;
        const filteredParts = parts.filter(
          (p): p is Exclude<A2APart, Record<string, never>> => 'kind' in p
        ); // Remove empty parts

        // Check if artifact exists
        const existing = await artifactStore.getArtifact(requestedArtifactId);

        let actualArtifactId: string;

        if (!existing) {
          // Create new artifact with the requested ID
          actualArtifactId = await artifactStore.createArtifact({
            artifactId: requestedArtifactId,
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

        // Replace or append parts based on append flag
        if (existing && !append) {
          const { partsReplaced, partsAdded } = await replaceArtifactParts(
            artifactStore,
            actualArtifactId,
            filteredParts,
            lastChunk
          );
          return {
            artifactId: actualArtifactId,
            partsReplaced,
            partsAdded,
            complete: lastChunk,
          };
        }

        // Append parts (new artifact or append=true)
        const partsAdded = await appendArtifactParts(
          artifactStore,
          actualArtifactId,
          filteredParts,
          lastChunk
        );

        return {
          artifactId: actualArtifactId,
          partsAdded,
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
