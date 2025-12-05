/**
 * Artifact Tool Provider
 *
 * Design: design/artifact-management.md#built-in-artifact-tools
 *
 * Provides tools for agents to create and manage artifacts using the
 * discriminated union API (file, data, dataset).
 */

import { z } from 'zod';
import { ArtifactScheduler } from '../stores';
import type { ArtifactStore, StoredArtifact } from '../types/artifact';
import type { Plugin } from '../types/core';
import type { TaskStateStore } from '../types/state';
import { localTools, tool } from './local-tools';

/**
 * Helper to track artifacts in state
 */
async function trackArtifactInState(
  taskId: string,
  artifactId: string,
  taskStateStore: TaskStateStore,
): Promise<void> {
  // Load current state
  const state = await taskStateStore.load(taskId);
  if (!state) return;

  // Add artifact ID if not already present
  if (!state.artifactIds.includes(artifactId)) {
    state.artifactIds.push(artifactId);
    await taskStateStore.save(taskId, state);
  }
}

/**
 * Create artifact management tool provider
 *
 * Provides type-specific tools for file, data, and dataset artifacts.
 *
 * @example
 * const artifactTools = createArtifactTools(artifactStore, taskStateStore);
 * const agent = new Agent({
 *   toolProviders: [artifactTools, ...otherTools],
 *   // ...
 * });
 */
export function createArtifactTools<AuthContext>(
  artifactStore: ArtifactStore,
  taskStateStore: TaskStateStore,
): Plugin<AuthContext> {
  const scheduledStore = new ArtifactScheduler(artifactStore);
  return localTools([
    // ============================================================================
    // File Artifact Tools
    // ============================================================================

    tool({
      id: 'create_file_artifact',
      description:
        'Create a new file artifact for streaming text or binary content. Use append_file_chunk to add content. Set override=true to replace existing artifact.',
      schema: z.object({
        artifactId: z
          .string()
          .describe('Unique identifier for the artifact (e.g., "report-2025", "analysis-results")'),
        name: z.string().optional().describe('Human-readable name for the artifact'),
        description: z.string().optional().describe('Description of the artifact content'),
        mimeType: z
          .string()
          .optional()
          .default('text/plain')
          .describe('MIME type of the content (e.g., "text/plain", "text/markdown")'),
        encoding: z
          .enum(['utf-8', 'base64'])
          .optional()
          .default('utf-8')
          .describe('Content encoding'),
        override: z
          .boolean()
          .optional()
          .default(false)
          .describe('Set to true to replace an existing artifact with the same ID'),
      }),
      handler: async (params, context) => {
        await scheduledStore.createFileArtifact({
          artifactId: params.artifactId,
          taskId: context.taskId,
          contextId: context.contextId,
          name: params.name,
          description: params.description,
          mimeType: params.mimeType,
          encoding: params.encoding,
          override: params.override,
        });

        // Track in state
        await trackArtifactInState(context.taskId, params.artifactId, taskStateStore);

        return {
          success: true,
          result: {
            artifactId: params.artifactId,
            type: 'file',
            status: 'building',
            message: params.override
              ? 'File artifact reset. Use append_file_chunk to add content.'
              : 'File artifact created. Use append_file_chunk to add content.',
          },
        };
      },
    }),

    tool({
      id: 'append_file_chunk',
      description:
        'Append a chunk of content to a file artifact. Call multiple times to stream content.',
      schema: z.object({
        artifactId: z.string().describe('The artifact ID to append to'),
        content_chunk: z.string().describe('Content chunk to append to the file'),
        isLastChunk: z
          .boolean()
          .optional()
          .default(false)
          .describe('Set to true on the final chunk to mark artifact as complete'),
      }),
      handler: async (params, context) => {
        await scheduledStore.appendFileChunk(
          context.contextId,
          params.artifactId,
          params.content_chunk,
          {
            isLastChunk: params.isLastChunk,
          },
        );

        return {
          success: true,
          result: {
            artifactId: params.artifactId,
            chunkAdded: true,
            complete: params.isLastChunk,
            message: params.isLastChunk
              ? 'Final chunk appended. Artifact is complete.'
              : 'Chunk appended successfully.',
          },
        };
      },
    }),

    tool({
      id: 'get_file_content',
      description: 'Get the complete content of a file artifact',
      schema: z.object({
        artifactId: z.string().describe('The artifact ID to retrieve'),
      }),
      handler: async (params, context) => {
        const content = await scheduledStore.getFileContent(context.contextId, params.artifactId);
        return {
          success: true,
          result: {
            artifactId: params.artifactId,
            content,
          },
        };
      },
    }),

    // ============================================================================
    // Data Artifact Tools
    // ============================================================================

    tool({
      id: 'create_data_artifact',
      description:
        'Create a data artifact with structured JSON data. Set override=true to replace existing artifact.',
      schema: z.object({
        artifactId: z.string().describe('Unique identifier for the artifact'),
        name: z.string().optional().describe('Human-readable name'),
        description: z.string().optional().describe('Description of the data'),
        data: z.record(z.string(), z.unknown()).describe('The structured data object'),
        override: z
          .boolean()
          .optional()
          .default(false)
          .describe('Set to true to replace an existing artifact with the same ID'),
      }),
      handler: async (params, context) => {
        // Create the artifact
        await scheduledStore.createDataArtifact({
          artifactId: params.artifactId,
          taskId: context.taskId,
          contextId: context.contextId,
          name: params.name,
          description: params.description,
          override: params.override,
        });

        // Write the initial data
        await scheduledStore.writeData(context.contextId, params.artifactId, params.data);

        // Track in state
        await trackArtifactInState(context.taskId, params.artifactId, taskStateStore);

        return {
          success: true,
          result: {
            artifactId: params.artifactId,
            type: 'data',
            status: 'complete',
            message: params.override
              ? 'Data artifact reset successfully.'
              : 'Data artifact created successfully.',
          },
        };
      },
    }),

    tool({
      id: 'update_data_artifact',
      description: 'Update the data content of an existing data artifact',
      schema: z.object({
        artifactId: z.string().describe('The artifact ID to update'),
        data: z.record(z.string(), z.unknown()).describe('The new data object'),
      }),
      handler: async (params, context) => {
        await scheduledStore.writeData(context.contextId, params.artifactId, params.data);

        return {
          success: true,
          result: {
            artifactId: params.artifactId,
            type: 'data',
            status: 'complete',
            message: 'Data artifact updated successfully.',
          },
        };
      },
    }),

    tool({
      id: 'get_data_content',
      description: 'Get the content of a data artifact',
      schema: z.object({
        artifactId: z.string().describe('The artifact ID to retrieve'),
      }),
      handler: async (params, context) => {
        const data = await scheduledStore.getDataContent(context.contextId, params.artifactId);
        return {
          success: true,
          result: {
            artifactId: params.artifactId,
            data,
          },
        };
      },
    }),

    tool({
      id: 'get_data_artifact',
      description: 'Get the data content of a data artifact',
      schema: z.object({
        artifactId: z.string().describe('The artifact ID to retrieve'),
      }),
      handler: async (params, context) => {
        const data = await scheduledStore.getDataContent(context.contextId, params.artifactId);
        return {
          success: true,
          result: {
            artifactId: params.artifactId,
            data,
          },
        };
      },
    }),

    // ============================================================================
    // Dataset Artifact Tools
    // ============================================================================

    tool({
      id: 'create_dataset_artifact',
      description:
        'Create a dataset artifact for tabular data with a schema. Set override=true to replace existing artifact.',
      schema: z.object({
        artifactId: z.string().describe('Unique identifier for the dataset'),
        name: z.string().optional().describe('Human-readable name'),
        description: z.string().optional().describe('Description of the dataset'),
        schema: z.object({
          columns: z.array(
            z.object({
              name: z.string(),
              type: z.enum(['string', 'number', 'boolean', 'date', 'json']),
              description: z.string().optional(),
            }),
          ),
        }),
        override: z
          .boolean()
          .optional()
          .default(false)
          .describe('Set to true to replace an existing artifact with the same ID'),
      }),
      handler: async (params, context) => {
        await scheduledStore.createDatasetArtifact({
          artifactId: params.artifactId,
          taskId: context.taskId,
          contextId: context.contextId,
          name: params.name,
          description: params.description,
          schema: params.schema,
          override: params.override,
        });

        // Track in state
        await trackArtifactInState(context.taskId, params.artifactId, taskStateStore);

        return {
          success: true,
          result: {
            artifactId: params.artifactId,
            type: 'dataset',
            status: 'building',
            message: params.override
              ? 'Dataset artifact reset. Use append_dataset_row(s) to add data.'
              : 'Dataset artifact created. Use append_dataset_row(s) to add data.',
          },
        };
      },
    }),

    tool({
      id: 'append_dataset_row',
      description: 'Append a single row to a dataset artifact',
      schema: z.object({
        artifactId: z.string().describe('The dataset artifact ID'),
        row: z.record(z.string(), z.unknown()).describe('Row data matching the dataset schema'),
      }),
      handler: async (params, context) => {
        // Append as a batch of one row
        await scheduledStore.appendDatasetBatch(context.contextId, params.artifactId, [params.row]);

        return {
          success: true,
          result: {
            artifactId: params.artifactId,
            rowAdded: true,
            message: 'Row appended to dataset.',
          },
        };
      },
    }),

    tool({
      id: 'append_dataset_rows',
      description: 'Append multiple rows to a dataset artifact',
      schema: z.object({
        artifactId: z.string().describe('The dataset artifact ID'),
        rows: z.array(z.record(z.string(), z.unknown())).describe('Array of rows to append'),
        isLastBatch: z.boolean().optional().describe('Set to true on the final batch'),
      }),
      handler: async (params, context) => {
        await scheduledStore.appendDatasetBatch(context.contextId, params.artifactId, params.rows, {
          isLastBatch: params.isLastBatch,
        });

        return {
          success: true,
          result: {
            artifactId: params.artifactId,
            rowsAdded: params.rows.length,
            message: `${params.rows.length} rows appended to dataset.`,
          },
        };
      },
    }),

    tool({
      id: 'get_dataset_rows',
      description: 'Get all rows from a dataset artifact',
      schema: z.object({
        artifactId: z.string().describe('The dataset artifact ID'),
      }),
      handler: async (params, context) => {
        const rows = await scheduledStore.getDatasetRows(context.contextId, params.artifactId);
        return {
          success: true,
          result: {
            artifactId: params.artifactId,
            rows,
            totalRows: rows.length,
          },
        };
      },
    }),

    // ============================================================================
    // Common Artifact Tools
    // ============================================================================

    tool({
      id: 'list_artifacts',
      description: 'List all artifacts in the current context, optionally filtered by task',
      schema: z.object({
        taskId: z.string().optional().describe('Filter artifacts by task ID'),
      }),
      handler: async (params, context) => {
        // Use the new listArtifacts method with context scoping
        const artifactIds = await scheduledStore.listArtifacts(context.contextId, params.taskId);
        const artifacts = await Promise.all(
          artifactIds.map((id) => scheduledStore.getArtifact(context.contextId, id)),
        );

        const validArtifacts = artifacts.filter((a): a is StoredArtifact => a !== null);

        return {
          success: true,
          result: {
            artifacts: validArtifacts.map((a) => ({
              artifactId: a.artifactId,
              type: a.type,
              name: a.name,
              taskId: a.taskId,
              contextId: a.contextId,
              createdAt: a.createdAt,
            })),
            totalCount: validArtifacts.length,
          },
        };
      },
    }),

    tool({
      id: 'get_artifact',
      description: 'Get metadata for a specific artifact by ID',
      schema: z.object({
        artifactId: z.string().describe('The artifact ID to retrieve'),
      }),
      handler: async (params, context) => {
        const artifact = await scheduledStore.getArtifact(context.contextId, params.artifactId);

        if (!artifact) {
          throw new Error(`Artifact not found: ${params.artifactId}`);
        }

        return {
          success: true,
          result: {
            artifactId: artifact.artifactId,
            type: artifact.type,
            taskId: artifact.taskId,
            contextId: artifact.contextId,
            name: artifact.name,
            description: artifact.description,
            status: artifact.status,
            createdAt: artifact.createdAt,
            updatedAt: artifact.updatedAt,
            ...(artifact.type === 'file' && {
              mimeType: artifact.mimeType,
              encoding: artifact.encoding,
              totalChunks: artifact.totalChunks,
              totalSize: artifact.totalSize,
            }),
            ...(artifact.type === 'dataset' && {
              totalRows: artifact.totalSize,
              schema: artifact.schema,
            }),
          },
        };
      },
    }),

    tool({
      id: 'delete_artifact',
      description: 'Delete an artifact by ID',
      schema: z.object({
        artifactId: z.string().describe('The artifact ID to delete'),
      }),
      handler: async (params, context) => {
        await scheduledStore.deleteArtifact(context.contextId, params.artifactId);

        return {
          success: true,
          result: {
            artifactId: params.artifactId,
            deleted: true,
            message: 'Artifact deleted successfully.',
          },
        };
      },
    }),
  ]);
}
