/**
 * Tests for ArtifactScheduler
 *
 * Verifies that operations on the same artifact execute sequentially
 * while operations on different artifacts execute in parallel.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { ArtifactScheduler } from '../src/stores/artifacts/artifact-scheduler';
import { InMemoryArtifactStore } from '../src/stores/artifacts/memory-artifact-store';

describe('ArtifactScheduler', () => {
  let baseStore: InMemoryArtifactStore;
  let scheduler: ArtifactScheduler;

  beforeEach(() => {
    baseStore = new InMemoryArtifactStore();
    scheduler = new ArtifactScheduler(baseStore);
  });

  describe('Sequential execution per artifact', () => {
    it('should execute create followed by append in correct order', async () => {
      const artifactId = 'test-artifact';
      const taskId = 'test-task';
      const contextId = 'test-context';

      // Simulate LLM emitting create + append in parallel
      const createPromise = scheduler.createFileArtifact({
        artifactId,
        taskId,
        contextId,
        name: 'test.txt',
        mimeType: 'text/plain',
      });

      const appendPromise = scheduler.appendFileChunk(contextId, artifactId, 'Hello World', {
        isLastChunk: true,
      });

      // Both should succeed despite parallel execution
      await Promise.all([createPromise, appendPromise]);

      // Verify content
      const content = await scheduler.getFileContent(contextId, artifactId);
      expect(content).toBe('Hello World');
    });

    it('should handle multiple appends in order', async () => {
      const artifactId = 'test-artifact';
      const taskId = 'test-task';
      const contextId = 'test-context';

      // Create + multiple appends all in parallel
      const operations = [
        scheduler.createFileArtifact({
          artifactId,
          taskId,
          contextId,
        }),
        scheduler.appendFileChunk(contextId, artifactId, 'First '),
        scheduler.appendFileChunk(contextId, artifactId, 'Second '),
        scheduler.appendFileChunk(contextId, artifactId, 'Third', { isLastChunk: true }),
      ];

      await Promise.all(operations);

      const content = await scheduler.getFileContent(contextId, artifactId);
      expect(content).toBe('First Second Third');
    });

    it('should handle data artifact create + write in parallel', async () => {
      const artifactId = 'data-artifact';
      const taskId = 'test-task';
      const contextId = 'test-context';

      const data = { key: 'value', count: 42 };

      // Parallel create + write
      await Promise.all([
        scheduler.createDataArtifact({
          artifactId,
          taskId,
          contextId,
        }),
        scheduler.writeData(contextId, artifactId, data),
      ]);

      const retrieved = await scheduler.getDataContent(contextId, artifactId);
      expect(retrieved).toEqual(data);
    });

    it('should handle dataset artifact create + append in parallel', async () => {
      const artifactId = 'dataset-artifact';
      const taskId = 'test-task';
      const contextId = 'test-context';

      const rows = [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
      ];

      // Parallel create + append
      await Promise.all([
        scheduler.createDatasetArtifact({
          artifactId,
          taskId,
          contextId,
        }),
        scheduler.appendDatasetBatch(contextId, artifactId, rows, { isLastBatch: true }),
      ]);

      const retrieved = await scheduler.getDatasetRows(contextId, artifactId);
      expect(retrieved).toEqual(rows);
    });
  });

  describe('Parallel execution across artifacts', () => {
    it('should execute operations on different artifacts in parallel', async () => {
      const artifact1 = 'artifact-1';
      const artifact2 = 'artifact-2';
      const taskId = 'test-task';
      const contextId = 'test-context';

      const startTime = Date.now();

      // Operations on different artifacts should run in parallel
      await Promise.all([
        // Artifact 1 operations
        scheduler.createFileArtifact({
          artifactId: artifact1,
          taskId,
          contextId,
        }),
        scheduler.appendFileChunk(contextId, artifact1, 'Content 1', { isLastChunk: true }),

        // Artifact 2 operations (parallel)
        scheduler.createFileArtifact({
          artifactId: artifact2,
          taskId,
          contextId,
        }),
        scheduler.appendFileChunk(contextId, artifact2, 'Content 2', { isLastChunk: true }),
      ]);

      const endTime = Date.now();
      const duration = endTime - startTime;

      // Should complete quickly since they run in parallel
      expect(duration).toBeLessThan(100);

      const content1 = await scheduler.getFileContent(contextId, artifact1);
      const content2 = await scheduler.getFileContent(contextId, artifact2);

      expect(content1).toBe('Content 1');
      expect(content2).toBe('Content 2');
    });
  });

  describe('Error handling', () => {
    it('should propagate errors from operations', async () => {
      // Try to append without creating first
      await expect(scheduler.appendFileChunk('none', 'nonexistent', 'data')).rejects.toThrow(
        'Artifact not found',
      );
    });

    it('should continue processing queue after error', async () => {
      const fileArtifactId = 'test-artifact';
      const taskId = 'test-task';
      const contextId = 'test-context';

      await scheduler.createFileArtifact({
        artifactId: fileArtifactId,
        taskId,
        contextId,
      });

      // Queue multiple operations, one with wrong type
      const operations = [
        scheduler.appendFileChunk(contextId, fileArtifactId, 'Valid'),
        scheduler.writeData(contextId, fileArtifactId, { data: 'wrong type' }).catch(() => {
          // Expected to fail
        }),
        scheduler.appendFileChunk(contextId, fileArtifactId, ' content', { isLastChunk: true }),
      ];

      await Promise.allSettled(operations);

      // Should still have processed valid operations
      const content = await scheduler.getFileContent(contextId, fileArtifactId);
      expect(content).toBe('Valid content');
    });
  });

  describe('Pass-through methods', () => {
    it('should pass through read-only queries without scheduling', async () => {
      const taskId = 'test-task';
      const contextId = 'test-context';

      // Create some artifacts
      await scheduler.createFileArtifact({
        artifactId: 'artifact-1',
        taskId,
        contextId,
      });

      await scheduler.createFileArtifact({
        artifactId: 'artifact-2',
        taskId,
        contextId,
      });

      const contextArtifacts = await scheduler.listArtifacts(contextId);
      expect(contextArtifacts).toHaveLength(2);
    });
  });

  describe('Real-world scenario', () => {
    it('should handle LLM emitting create + multiple appends in single response', async () => {
      const artifactId = 'llm-output';
      const taskId = 'task-123';
      const contextId = 'ctx-456';

      // Simulate LLM tool calls all executing in parallel:
      // 1. artifact_create_file(id="llm-output", name="response.txt")
      // 2. artifact_append_file(id="llm-output", chunk="Based on ")
      // 3. artifact_append_file(id="llm-output", chunk="the analysis, ")
      // 4. artifact_append_file(id="llm-output", chunk="I recommend...", final=true)

      const toolCalls = [
        scheduler.createFileArtifact({
          artifactId,
          taskId,
          contextId,
          name: 'response.txt',
          mimeType: 'text/plain',
        }),
        scheduler.appendFileChunk(contextId, artifactId, 'Based on '),
        scheduler.appendFileChunk(contextId, artifactId, 'the analysis, '),
        scheduler.appendFileChunk(contextId, artifactId, 'I recommend...', { isLastChunk: true }),
      ];

      // Execute all in parallel (as agent-loop would)
      await Promise.all(toolCalls);

      // Verify correct final content
      const content = await scheduler.getFileContent(contextId, artifactId);
      expect(content).toBe('Based on the analysis, I recommend...');

      // Verify artifact status
      const artifact = await scheduler.getArtifact(contextId, artifactId);
      expect(artifact).not.toBeNull();
      expect(artifact?.status).toBe('complete');
      if (artifact?.type === 'file') {
        expect(artifact.chunks).toHaveLength(3);
      }
    });

    it('should handle empty chunk with isLastChunk=true', async () => {
      const artifactId = 'empty-final';
      const taskId = 'task-123';
      const contextId = 'ctx-456';

      // Simulate LLM finishing with empty final chunk
      await Promise.all([
        scheduler.createFileArtifact({
          artifactId,
          taskId,
          contextId,
          name: 'response.txt',
        }),
        scheduler.appendFileChunk(contextId, artifactId, 'Content here'),
        scheduler.appendFileChunk(contextId, artifactId, '', { isLastChunk: true }), // Empty final chunk
      ]);

      const content = await scheduler.getFileContent(contextId, artifactId);
      expect(content).toBe('Content here');

      const artifact = await scheduler.getArtifact(contextId, artifactId);
      expect(artifact?.status).toBe('complete');
      if (artifact?.type === 'file') {
        expect(artifact.chunks).toHaveLength(1); // Only 1 chunk (empty ignored)
      }
    });

    it('should handle only empty chunks with isLastChunk=true', async () => {
      const artifactId = 'only-empty';
      const taskId = 'task-123';
      const contextId = 'ctx-456';

      // Simulate LLM creating artifact but sending only empty chunks
      await Promise.all([
        scheduler.createFileArtifact({
          artifactId,
          taskId,
          contextId,
          name: 'empty.txt',
        }),
        scheduler.appendFileChunk(contextId, artifactId, '', { isLastChunk: true }),
      ]);

      const content = await scheduler.getFileContent(contextId, artifactId);
      expect(content).toBe('');

      const artifact = await scheduler.getArtifact(contextId, artifactId);
      expect(artifact?.status).toBe('complete');
      if (artifact?.type === 'file') {
        expect(artifact.chunks).toHaveLength(0); // No chunks added
      }
    });

    it('should handle empty dataset batch with isLastBatch=true', async () => {
      const artifactId = 'empty-dataset';
      const taskId = 'task-123';
      const contextId = 'ctx-456';

      await Promise.all([
        scheduler.createDatasetArtifact({
          artifactId,
          taskId,
          contextId,
        }),
        scheduler.appendDatasetBatch(contextId, artifactId, [{ id: 1, name: 'Alice' }]),
        scheduler.appendDatasetBatch(contextId, artifactId, [], { isLastBatch: true }), // Empty final batch
      ]);

      const rows = await scheduler.getDatasetRows(contextId, artifactId);
      expect(rows).toEqual([{ id: 1, name: 'Alice' }]);

      const artifact = await scheduler.getArtifact(contextId, artifactId);
      expect(artifact?.status).toBe('complete');
      if (artifact?.type === 'dataset') {
        expect(artifact.rows).toHaveLength(1);
        expect(artifact.totalChunks).toBe(1); // Only 1 batch (empty ignored)
      }
    });
  });
});
