/**
 * Artifact Tool Provider
 *
 * Design: design/artifact-management.md#built-in-artifact-tools
 *
 * Provides tools for agents to create and manage artifacts using the
 * discriminated union API (file, data, dataset).
 */

import { z } from 'zod';
import type { ArtifactStore, StoredArtifact, TaskStateStore, ToolProvider } from '../core/types';
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
export function createArtifactTools(
  artifactStore: ArtifactStore,
  taskStateStore: TaskStateStore,
): ToolProvider {
  return localTools([
    // ============================================================================
    // File Artifact Tools
    // ============================================================================

    tool(
      'create_file_artifact',
      'Create a new file artifact for streaming text or binary content. Use append_file_chunk to add content. Set override=true to replace existing artifact.',
      z.object({
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
      async (params, context) => {
        await artifactStore.createFileArtifact({
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
          artifactId: params.artifactId,
          type: 'file',
          status: 'building',
          message: params.override
            ? 'File artifact reset. Use append_file_chunk to add content.'
            : 'File artifact created. Use append_file_chunk to add content.',
        };
      },
    ),

    tool(
      'append_file_chunk',
      'Append a chunk of content to a file artifact. Call multiple times to stream content.',
      z.object({
        artifactId: z.string().describe('The artifact ID to append to'),
        content_chunk: z.string().describe('Content chunk to append to the file'),
        isLastChunk: z
          .boolean()
          .optional()
          .default(false)
          .describe('Set to true on the final chunk to mark artifact as complete'),
      }),
      async (params, context) => {
        await artifactStore.appendFileChunk(
          context.contextId,
          params.artifactId,
          params.content_chunk,
          {
            isLastChunk: params.isLastChunk,
          },
        );

        return {
          artifactId: params.artifactId,
          chunkAdded: true,
          complete: params.isLastChunk,
          message: params.isLastChunk
            ? 'Final chunk appended. Artifact is complete.'
            : 'Chunk appended successfully.',
        };
      },
    ),

    tool(
      'get_file_content',
      'Get the complete content of a file artifact',
      z.object({
        artifactId: z.string().describe('The artifact ID to retrieve'),
      }),
      async (params, context) => {
        const content = await artifactStore.getFileContent(context.contextId, params.artifactId);
        return {
          artifactId: params.artifactId,
          content,
        };
      },
    ),

    // ============================================================================
    // Data Artifact Tools
    // ============================================================================

    tool(
      'create_data_artifact',
      'Create a data artifact with structured JSON data. Set override=true to replace existing artifact.',
      z.object({
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
      async (params, context) => {
        // Create the artifact
        await artifactStore.createDataArtifact({
          artifactId: params.artifactId,
          taskId: context.taskId,
          contextId: context.contextId,
          name: params.name,
          description: params.description,
          override: params.override,
        });

        // Write the initial data
        await artifactStore.writeData(context.contextId, params.artifactId, params.data);

        // Track in state
        await trackArtifactInState(context.taskId, params.artifactId, taskStateStore);

        return {
          artifactId: params.artifactId,
          type: 'data',
          status: 'complete',
          message: params.override
            ? 'Data artifact reset successfully.'
            : 'Data artifact created successfully.',
        };
      },
    ),

    tool(
      'update_data_artifact',
      'Update the data content of an existing data artifact',
      z.object({
        artifactId: z.string().describe('The artifact ID to update'),
        data: z.record(z.string(), z.unknown()).describe('The new data object'),
      }),
      async (params, context) => {
        await artifactStore.writeData(context.contextId, params.artifactId, params.data);

        return {
          artifactId: params.artifactId,
          type: 'data',
          status: 'complete',
          message: 'Data artifact updated successfully.',
        };
      },
    ),

    tool(
      'get_data_content',
      'Get the content of a data artifact',
      z.object({
        artifactId: z.string().describe('The artifact ID to retrieve'),
      }),
      async (params, context) => {
        const data = await artifactStore.getDataContent(context.contextId, params.artifactId);
        return {
          artifactId: params.artifactId,
          data,
        };
      },
    ),

    tool(
      'get_data_artifact',
      'Get the data content of a data artifact',
      z.object({
        artifactId: z.string().describe('The artifact ID to retrieve'),
      }),
      async (params, context) => {
        const data = await artifactStore.getDataContent(context.contextId, params.artifactId);
        return {
          artifactId: params.artifactId,
          data,
        };
      },
    ),

    // ============================================================================
    // Dataset Artifact Tools
    // ============================================================================

    tool(
      'create_dataset_artifact',
      'Create a dataset artifact for tabular data with a schema. Set override=true to replace existing artifact.',
      z.object({
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
      async (params, context) => {
        await artifactStore.createDatasetArtifact({
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
          artifactId: params.artifactId,
          type: 'dataset',
          status: 'building',
          message: params.override
            ? 'Dataset artifact reset. Use append_dataset_row(s) to add data.'
            : 'Dataset artifact created. Use append_dataset_row(s) to add data.',
        };
      },
    ),

    tool(
      'append_dataset_row',
      'Append a single row to a dataset artifact',
      z.object({
        artifactId: z.string().describe('The dataset artifact ID'),
        row: z.record(z.string(), z.unknown()).describe('Row data matching the dataset schema'),
      }),
      async (params, context) => {
        // Append as a batch of one row
        await artifactStore.appendDatasetBatch(context.contextId, params.artifactId, [params.row]);

        return {
          artifactId: params.artifactId,
          rowAdded: true,
          message: 'Row appended to dataset.',
        };
      },
    ),

    tool(
      'append_dataset_rows',
      'Append multiple rows to a dataset artifact',
      z.object({
        artifactId: z.string().describe('The dataset artifact ID'),
        rows: z.array(z.record(z.string(), z.unknown())).describe('Array of rows to append'),
        isLastBatch: z.boolean().optional().describe('Set to true on the final batch'),
      }),
      async (params, context) => {
        await artifactStore.appendDatasetBatch(context.contextId, params.artifactId, params.rows, {
          isLastBatch: params.isLastBatch,
        });

        return {
          artifactId: params.artifactId,
          rowsAdded: params.rows.length,
          message: `${params.rows.length} rows appended to dataset.`,
        };
      },
    ),

    tool(
      'get_dataset_rows',
      'Get all rows from a dataset artifact',
      z.object({
        artifactId: z.string().describe('The dataset artifact ID'),
      }),
      async (params, context) => {
        const rows = await artifactStore.getDatasetRows(context.contextId, params.artifactId);
        return {
          artifactId: params.artifactId,
          rows,
          totalRows: rows.length,
        };
      },
    ),

    // ============================================================================
    // Common Artifact Tools
    // ============================================================================

    tool(
      'list_artifacts',
      'List all artifacts in the current context, optionally filtered by task',
      z.object({
        taskId: z.string().optional().describe('Filter artifacts by task ID'),
      }),
      async (params, context) => {
        // Use the new listArtifacts method with context scoping
        const artifactIds = await artifactStore.listArtifacts(context.contextId, params.taskId);
        const artifacts = await Promise.all(
          artifactIds.map((id) => artifactStore.getArtifact(context.contextId, id)),
        );

        const validArtifacts = artifacts.filter((a): a is StoredArtifact => a !== null);

        return {
          artifacts: validArtifacts.map((a) => ({
            artifactId: a.artifactId,
            type: a.type,
            name: a.name,
            taskId: a.taskId,
            contextId: a.contextId,
            createdAt: a.createdAt,
          })),
          totalCount: validArtifacts.length,
        };
      },
    ),

    tool(
      'get_artifact',
      'Get metadata for a specific artifact by ID',
      z.object({
        artifactId: z.string().describe('The artifact ID to retrieve'),
      }),
      async (params, context) => {
        const artifact = await artifactStore.getArtifact(context.contextId, params.artifactId);

        if (!artifact) {
          throw new Error(`Artifact not found: ${params.artifactId}`);
        }

        return {
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
        };
      },
    ),

    tool(
      'delete_artifact',
      'Delete an artifact by ID',
      z.object({
        artifactId: z.string().describe('The artifact ID to delete'),
      }),
      async (params, context) => {
        await artifactStore.deleteArtifact(context.contextId, params.artifactId);

        return {
          artifactId: params.artifactId,
          deleted: true,
          message: 'Artifact deleted successfully.',
        };
      },
    ),
  ]);
}
