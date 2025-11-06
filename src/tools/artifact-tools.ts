/**
 * Artifact Tool Provider
 *
 * Design: design/artifact-management.md#built-in-artifact-tools
 *
 * Provides tools for agents to create and manage artifacts using the
 * discriminated union API (file, data, dataset).
 */

import { z } from 'zod';
import type { ArtifactStore, StateStore, ToolProvider } from '../core/types';
import { localTools, tool } from './local-tools';

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
 * Provides type-specific tools for file, data, and dataset artifacts.
 *
 * @example
 * const artifactTools = createArtifactTools(artifactStore, stateStore);
 * const agent = new Agent({
 *   toolProviders: [artifactTools, ...otherTools],
 *   // ...
 * });
 */
export function createArtifactTools(
  artifactStore: ArtifactStore,
  stateStore: StateStore
): ToolProvider {
  return localTools([
    // ============================================================================
    // File Artifact Tools
    // ============================================================================

    tool(
      'create_file_artifact',
      'Create a new file artifact for streaming text or binary content. Use append_file_chunk to add content.',
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
      }),
      async (params, context) => {
        // Check if artifact already exists
        const existing = await artifactStore.getArtifact(params.artifactId);
        if (existing) {
          throw new Error(`Artifact already exists: ${params.artifactId}`);
        }

        await artifactStore.createFileArtifact({
          artifactId: params.artifactId,
          taskId: context.taskId,
          contextId: context.contextId,
          name: params.name,
          description: params.description,
          mimeType: params.mimeType,
          encoding: params.encoding,
        });

        // Track in state
        await trackArtifactInState(context.taskId, params.artifactId, stateStore);

        return {
          artifactId: params.artifactId,
          type: 'file',
          status: 'building',
          message: 'File artifact created. Use append_file_chunk to add content.',
        };
      }
    ),

    tool(
      'append_file_chunk',
      'Append a chunk of content to a file artifact. Call multiple times to stream content.',
      z.object({
        artifactId: z.string().describe('The artifact ID to append to'),
        chunk: z.string().describe('Content chunk to append'),
        isLastChunk: z
          .boolean()
          .optional()
          .default(false)
          .describe('Set to true on the final chunk to mark artifact as complete'),
      }),
      async (params, _context) => {
        await artifactStore.appendFileChunk(params.artifactId, params.chunk, {
          isLastChunk: params.isLastChunk,
        });

        return {
          artifactId: params.artifactId,
          chunkAdded: true,
          complete: params.isLastChunk,
          message: params.isLastChunk
            ? 'Final chunk appended. Artifact is complete.'
            : 'Chunk appended successfully.',
        };
      }
    ),

    tool(
      'get_file_content',
      'Get the complete content of a file artifact',
      z.object({
        artifactId: z.string().describe('The artifact ID to retrieve'),
      }),
      async (params, _context) => {
        const content = await artifactStore.getFileContent(params.artifactId);
        return {
          artifactId: params.artifactId,
          content,
        };
      }
    ),

    // ============================================================================
    // Data Artifact Tools
    // ============================================================================

    tool(
      'create_data_artifact',
      'Create a data artifact with structured JSON data',
      z.object({
        artifactId: z.string().describe('Unique identifier for the artifact'),
        name: z.string().optional().describe('Human-readable name'),
        description: z.string().optional().describe('Description of the data'),
        data: z.record(z.string(), z.unknown()).describe('The structured data object'),
      }),
      async (params, context) => {
        // Check if artifact already exists
        const existing = await artifactStore.getArtifact(params.artifactId);
        if (existing) {
          throw new Error(`Artifact already exists: ${params.artifactId}`);
        }

        // Create the artifact
        await artifactStore.createDataArtifact({
          artifactId: params.artifactId,
          taskId: context.taskId,
          contextId: context.contextId,
          name: params.name,
          description: params.description,
        });

        // Write the initial data
        await artifactStore.writeData(params.artifactId, params.data);

        // Track in state
        await trackArtifactInState(context.taskId, params.artifactId, stateStore);

        return {
          artifactId: params.artifactId,
          type: 'data',
          status: 'complete',
          message: 'Data artifact created successfully.',
        };
      }
    ),

    tool(
      'update_data_artifact',
      'Update the data content of an existing data artifact',
      z.object({
        artifactId: z.string().describe('The artifact ID to update'),
        data: z.record(z.string(), z.unknown()).describe('The new data object'),
      }),
      async (params, _context) => {
        await artifactStore.writeData(params.artifactId, params.data);

        return {
          artifactId: params.artifactId,
          updated: true,
          message: 'Data artifact updated successfully.',
        };
      }
    ),

    tool(
      'get_data_artifact',
      'Get the data content of a data artifact',
      z.object({
        artifactId: z.string().describe('The artifact ID to retrieve'),
      }),
      async (params, _context) => {
        const data = await artifactStore.getDataContent(params.artifactId);
        return {
          artifactId: params.artifactId,
          data,
        };
      }
    ),

    // ============================================================================
    // Dataset Artifact Tools
    // ============================================================================

    tool(
      'create_dataset_artifact',
      'Create a dataset artifact for tabular data with a schema',
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
            })
          ),
        }),
      }),
      async (params, context) => {
        // Check if artifact already exists
        const existing = await artifactStore.getArtifact(params.artifactId);
        if (existing) {
          throw new Error(`Artifact already exists: ${params.artifactId}`);
        }

        await artifactStore.createDatasetArtifact({
          artifactId: params.artifactId,
          taskId: context.taskId,
          contextId: context.contextId,
          name: params.name,
          description: params.description,
          schema: params.schema,
        });

        // Track in state
        await trackArtifactInState(context.taskId, params.artifactId, stateStore);

        return {
          artifactId: params.artifactId,
          type: 'dataset',
          status: 'building',
          message: 'Dataset artifact created. Use append_dataset_row(s) to add data.',
        };
      }
    ),

    tool(
      'append_dataset_row',
      'Append a single row to a dataset artifact',
      z.object({
        artifactId: z.string().describe('The dataset artifact ID'),
        row: z.record(z.string(), z.unknown()).describe('Row data matching the dataset schema'),
      }),
      async (params, _context) => {
        // Append as a batch of one row
        await artifactStore.appendDatasetBatch(params.artifactId, [params.row]);

        return {
          artifactId: params.artifactId,
          rowAdded: true,
          message: 'Row appended to dataset.',
        };
      }
    ),

    tool(
      'append_dataset_rows',
      'Append multiple rows to a dataset artifact',
      z.object({
        artifactId: z.string().describe('The dataset artifact ID'),
        rows: z.array(z.record(z.string(), z.unknown())).describe('Array of rows to append'),
        isLastBatch: z.boolean().optional().describe('Set to true on the final batch'),
      }),
      async (params, _context) => {
        await artifactStore.appendDatasetBatch(params.artifactId, params.rows, {
          isLastBatch: params.isLastBatch,
        });

        return {
          artifactId: params.artifactId,
          rowsAdded: params.rows.length,
          message: `${params.rows.length} rows appended to dataset.`,
        };
      }
    ),

    tool(
      'get_dataset_rows',
      'Get all rows from a dataset artifact',
      z.object({
        artifactId: z.string().describe('The dataset artifact ID'),
      }),
      async (params, _context) => {
        const rows = await artifactStore.getDatasetRows(params.artifactId);
        return {
          artifactId: params.artifactId,
          rows,
          totalRows: rows.length,
        };
      }
    ),

    // ============================================================================
    // Common Artifact Tools
    // ============================================================================

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
          artifactIds.map((id) => artifactStore.getArtifact(id))
        );

        return {
          artifacts: artifacts
            .filter((a) => a !== null)
            .map((a) => ({
              artifactId: a.artifactId,
              type: a.type,
              taskId: a.taskId,
              name: a.name,
              description: a.description,
              status: a.status,
              createdAt: a.createdAt,
              updatedAt: a.updatedAt,
            })),
          totalCount: artifacts.length,
        };
      }
    ),

    tool(
      'get_artifact',
      'Get metadata for a specific artifact by ID',
      z.object({
        artifactId: z.string().describe('The artifact ID to retrieve'),
      }),
      async (params, _context) => {
        const artifact = await artifactStore.getArtifact(params.artifactId);

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
      }
    ),

    tool(
      'delete_artifact',
      'Delete an artifact by ID',
      z.object({
        artifactId: z.string().describe('The artifact ID to delete'),
      }),
      async (params, _context) => {
        await artifactStore.deleteArtifact(params.artifactId);

        return {
          artifactId: params.artifactId,
          deleted: true,
          message: 'Artifact deleted successfully.',
        };
      }
    ),
  ]);
}
