/**
 * Artifact Store Tests
 *
 * Tests for InMemoryArtifactStore with discriminated union types
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryArtifactStore } from '../src/stores/artifacts';

describe('InMemoryArtifactStore - File Artifacts', () => {
  let store: InMemoryArtifactStore;

  beforeEach(() => {
    store = new InMemoryArtifactStore();
  });

  describe('createFileArtifact', () => {
    it('should create a file artifact with provided ID', async () => {
      const artifactId = await store.createFileArtifact({
        artifactId: 'file-1',
        taskId: 'task-1',
        contextId: 'ctx-1',
        name: 'Test File',
        description: 'A test file artifact',
      });

      expect(artifactId).toBe('file-1');

      const artifact = await store.getArtifact('ctx-1', artifactId);
      expect(artifact).toBeTruthy();
      expect(artifact?.type).toBe('file');
      expect(artifact?.artifactId).toBe('file-1');
      expect(artifact?.name).toBe('Test File');
      expect(artifact?.description).toBe('A test file artifact');
      expect(artifact?.taskId).toBe('task-1');
      expect(artifact?.contextId).toBe('ctx-1');
      expect(artifact?.status).toBe('building');

      if (artifact?.type === 'file') {
        expect(artifact.chunks).toEqual([]);
        expect(artifact.totalChunks).toBe(0);
        expect(artifact.totalSize).toBe(0);
      }
    });

    it('should track artifact by task ID', async () => {
      const artifactId = await store.createFileArtifact({
        artifactId: 'file-2',
        taskId: 'task-1',
        contextId: 'ctx-1',
      });

      const taskArtifacts = await store.getTaskArtifacts('task-1');
      expect(taskArtifacts).toContain(artifactId);
    });

    it('should track artifact by context ID', async () => {
      const artifactId = await store.createFileArtifact({
        artifactId: 'file-3',
        taskId: 'task-1',
        contextId: 'ctx-1',
      });

      const contextArtifacts = await store.queryArtifacts({ contextId: 'ctx-1' });
      expect(contextArtifacts).toContain(artifactId);
    });
  });

  describe('appendFileChunk', () => {
    it('should append chunks to file artifact', async () => {
      const artifactId = await store.createFileArtifact({
        artifactId: 'file-4',
        taskId: 'task-1',
        contextId: 'ctx-1',
      });

      await store.appendFileChunk('ctx-1', artifactId, 'Hello, ');

      const artifact = await store.getArtifact('ctx-1', artifactId);
      expect(artifact?.type).toBe('file');
      if (artifact?.type === 'file') {
        expect(artifact.chunks).toHaveLength(1);
        expect(artifact.chunks[0].data).toBe('Hello, ');
        expect(artifact.status).toBe('building');
      }
    });

    it('should mark artifact as complete on last chunk', async () => {
      const artifactId = await store.createFileArtifact({
        artifactId: 'file-5',
        taskId: 'task-1',
        contextId: 'ctx-1',
      });

      await store.appendFileChunk('ctx-1', artifactId, 'Final chunk', {
        isLastChunk: true,
      });

      const artifact = await store.getArtifact('ctx-1', artifactId);
      expect(artifact?.status).toBe('complete');
      expect(artifact?.completedAt).toBeTruthy();
    });

    it('should handle multiple chunks', async () => {
      const artifactId = await store.createFileArtifact({
        artifactId: 'file-6',
        taskId: 'task-1',
        contextId: 'ctx-1',
      });

      await store.appendFileChunk('ctx-1', artifactId, 'Part 1');
      await store.appendFileChunk('ctx-1', artifactId, 'Part 2');
      await store.appendFileChunk('ctx-1', artifactId, 'Part 3');

      const artifact = await store.getArtifact('ctx-1', artifactId);
      if (artifact?.type === 'file') {
        expect(artifact.chunks).toHaveLength(3);
        expect(artifact.chunks[0].data).toBe('Part 1');
        expect(artifact.chunks[1].data).toBe('Part 2');
        expect(artifact.chunks[2].data).toBe('Part 3');
      }
    });

    it('should throw error for non-file artifact', async () => {
      const artifactId = await store.createDataArtifact({
        artifactId: 'data-1',
        taskId: 'task-1',
        contextId: 'ctx-1',
      });

      await expect(store.appendFileChunk('ctx-1', artifactId, 'test')).rejects.toThrow();
    });
  });

  describe('getFileContent', () => {
    it('should return combined file content', async () => {
      const artifactId = await store.createFileArtifact({
        artifactId: 'file-7',
        taskId: 'task-1',
        contextId: 'ctx-1',
      });

      await store.appendFileChunk('ctx-1', artifactId, 'Hello, ');
      await store.appendFileChunk('ctx-1', artifactId, 'world!');

      const content = await store.getFileContent('ctx-1', artifactId);
      expect(content).toBe('Hello, world!');
    });

    it('should throw error for non-file artifact', async () => {
      const artifactId = await store.createDataArtifact({
        artifactId: 'data-2',
        taskId: 'task-1',
        contextId: 'ctx-1',
      });

      await expect(store.getFileContent('ctx-1', artifactId)).rejects.toThrow();
    });
  });
});

describe('InMemoryArtifactStore - Data Artifacts', () => {
  let store: InMemoryArtifactStore;

  beforeEach(() => {
    store = new InMemoryArtifactStore();
  });

  describe('createDataArtifact', () => {
    it('should create a data artifact', async () => {
      const artifactId = await store.createDataArtifact({
        artifactId: 'data-3',
        taskId: 'task-1',
        contextId: 'ctx-1',
        name: 'Test Data',
      });

      const artifact = await store.getArtifact('ctx-1', artifactId);
      expect(artifact?.type).toBe('data');
      if (artifact?.type === 'data') {
        expect(artifact.data).toEqual({});
      }
    });
  });

  describe('writeData', () => {
    it('should write data to artifact', async () => {
      const artifactId = await store.createDataArtifact({
        artifactId: 'data-4',
        taskId: 'task-1',
        contextId: 'ctx-1',
      });

      await store.writeData('ctx-1', artifactId, { result: 42, status: 'ok' });

      const artifact = await store.getArtifact('ctx-1', artifactId);
      if (artifact?.type === 'data') {
        expect(artifact.data).toEqual({ result: 42, status: 'ok' });
      }
    });

    it('should replace existing data', async () => {
      const artifactId = await store.createDataArtifact({
        artifactId: 'data-5',
        taskId: 'task-1',
        contextId: 'ctx-1',
      });

      await store.writeData('ctx-1', artifactId, { version: 1 });
      await store.writeData('ctx-1', artifactId, { version: 2, updated: true });

      const content = await store.getDataContent('ctx-1', artifactId);
      expect(content).toEqual({ version: 2, updated: true });
    });

    it('should throw error for non-data artifact', async () => {
      const artifactId = await store.createFileArtifact({
        artifactId: 'file-8',
        taskId: 'task-1',
        contextId: 'ctx-1',
      });

      await expect(store.writeData('ctx-1', artifactId, {})).rejects.toThrow();
    });
  });

  describe('getDataContent', () => {
    it('should return data content', async () => {
      const artifactId = await store.createDataArtifact({
        artifactId: 'data-6',
        taskId: 'task-1',
        contextId: 'ctx-1',
      });

      await store.writeData('ctx-1', artifactId, { value: 123 });

      const content = await store.getDataContent('ctx-1', artifactId);
      expect(content).toEqual({ value: 123 });
    });

    it('should throw error for non-data artifact', async () => {
      const artifactId = await store.createFileArtifact({
        artifactId: 'file-9',
        taskId: 'task-1',
        contextId: 'ctx-1',
      });

      await expect(store.getDataContent('ctx-1', artifactId)).rejects.toThrow();
    });
  });
});

describe('InMemoryArtifactStore - Dataset Artifacts', () => {
  let store: InMemoryArtifactStore;

  beforeEach(() => {
    store = new InMemoryArtifactStore();
  });

  describe('createDatasetArtifact', () => {
    it('should create a dataset artifact', async () => {
      const artifactId = await store.createDatasetArtifact({
        artifactId: 'dataset-1',
        taskId: 'task-1',
        contextId: 'ctx-1',
        name: 'Sales Data',
        schema: {
          columns: [
            { name: 'date', type: 'string' },
            { name: 'amount', type: 'number' },
          ],
        },
      });

      const artifact = await store.getArtifact('ctx-1', artifactId);
      expect(artifact?.type).toBe('dataset');
      if (artifact?.type === 'dataset') {
        expect(artifact.rows).toEqual([]);
        expect(artifact.schema).toBeDefined();
        expect(artifact.schema?.columns).toHaveLength(2);
      }
    });
  });

  describe('appendDatasetBatch', () => {
    it('should append rows to dataset', async () => {
      const artifactId = await store.createDatasetArtifact({
        artifactId: 'dataset-2',
        taskId: 'task-1',
        contextId: 'ctx-1',
      });

      await store.appendDatasetBatch('ctx-1', artifactId, [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
      ]);

      const artifact = await store.getArtifact('ctx-1', artifactId);
      if (artifact?.type === 'dataset') {
        expect(artifact.rows).toHaveLength(2);
        expect(artifact.rows[0]).toEqual({ id: 1, name: 'Alice' });
      }
    });

    it('should handle multiple batches', async () => {
      const artifactId = await store.createDatasetArtifact({
        artifactId: 'dataset-3',
        taskId: 'task-1',
        contextId: 'ctx-1',
      });

      await store.appendDatasetBatch('ctx-1', artifactId, [{ id: 1 }]);
      await store.appendDatasetBatch('ctx-1', artifactId, [{ id: 2 }]);
      await store.appendDatasetBatch('ctx-1', artifactId, [{ id: 3 }, { id: 4 }]);

      const rows = await store.getDatasetRows('ctx-1', artifactId);
      expect(rows).toHaveLength(4);
    });

    it('should mark as complete on last batch', async () => {
      const artifactId = await store.createDatasetArtifact({
        artifactId: 'dataset-4',
        taskId: 'task-1',
        contextId: 'ctx-1',
      });

      await store.appendDatasetBatch('ctx-1', artifactId, [{ final: true }], { isLastBatch: true });

      const artifact = await store.getArtifact('ctx-1', artifactId);
      expect(artifact?.status).toBe('complete');
    });

    it('should throw error for non-dataset artifact', async () => {
      const artifactId = await store.createDataArtifact({
        artifactId: 'data-7',
        taskId: 'task-1',
        contextId: 'ctx-1',
      });

      await expect(store.appendDatasetBatch('ctx-1', artifactId, [])).rejects.toThrow();
    });
  });

  describe('getDatasetRows', () => {
    it('should return dataset rows', async () => {
      const artifactId = await store.createDatasetArtifact({
        artifactId: 'dataset-5',
        taskId: 'task-1',
        contextId: 'ctx-1',
      });

      await store.appendDatasetBatch('ctx-1', artifactId, [
        { x: 1, y: 2 },
        { x: 3, y: 4 },
      ]);

      const rows = await store.getDatasetRows('ctx-1', artifactId);
      expect(rows).toHaveLength(2);
      expect(rows[0]).toEqual({ x: 1, y: 2 });
    });

    it('should throw error for non-dataset artifact', async () => {
      const artifactId = await store.createFileArtifact({
        artifactId: 'file-10',
        taskId: 'task-1',
        contextId: 'ctx-1',
      });

      await expect(store.getDatasetRows('ctx-1', artifactId)).rejects.toThrow();
    });
  });
});

describe('InMemoryArtifactStore - Common Operations', () => {
  let store: InMemoryArtifactStore;

  beforeEach(() => {
    store = new InMemoryArtifactStore();
  });

  describe('queryArtifacts', () => {
    it('should query artifacts by context', async () => {
      const id1 = await store.createFileArtifact({
        artifactId: 'file-11',
        taskId: 'task-1',
        contextId: 'ctx-1',
      });
      const id2 = await store.createDataArtifact({
        artifactId: 'data-8',
        taskId: 'task-2',
        contextId: 'ctx-1',
      });
      await store.createDatasetArtifact({
        artifactId: 'dataset-6',
        taskId: 'task-3',
        contextId: 'ctx-2',
      });

      const artifacts = await store.queryArtifacts({ contextId: 'ctx-1' });
      expect(artifacts).toHaveLength(2);
      expect(artifacts).toContain(id1);
      expect(artifacts).toContain(id2);
    });

    it('should filter by context and task', async () => {
      const id1 = await store.createFileArtifact({
        artifactId: 'file-12',
        taskId: 'task-1',
        contextId: 'ctx-1',
      });
      await store.createDataArtifact({
        artifactId: 'data-9',
        taskId: 'task-2',
        contextId: 'ctx-1',
      });

      const artifacts = await store.queryArtifacts({
        contextId: 'ctx-1',
        taskId: 'task-1',
      });
      expect(artifacts).toHaveLength(1);
      expect(artifacts[0]).toBe(id1);
    });
  });

  describe('deleteArtifact', () => {
    it('should delete artifact and clean up indexes', async () => {
      const artifactId = await store.createFileArtifact({
        artifactId: 'file-13',
        taskId: 'task-1',
        contextId: 'ctx-1',
      });

      await store.deleteArtifact('ctx-1', artifactId);

      const artifact = await store.getArtifact('ctx-1', artifactId);
      expect(artifact).toBeNull();

      const taskArtifacts = await store.getTaskArtifacts('task-1');
      expect(taskArtifacts).not.toContain(artifactId);

      const contextArtifacts = await store.queryArtifacts({ contextId: 'ctx-1' });
      expect(contextArtifacts).not.toContain(artifactId);
    });
  });

  describe('getArtifactByContext', () => {
    it('should return artifact if context matches', async () => {
      const artifactId = await store.createFileArtifact({
        artifactId: 'file-14',
        taskId: 'task-1',
        contextId: 'ctx-1',
        name: 'Test',
      });

      const artifact = await store.getArtifactByContext('ctx-1', artifactId);
      expect(artifact).toBeTruthy();
      expect(artifact?.name).toBe('Test');
    });

    it('should return null if context does not match', async () => {
      const artifactId = await store.createFileArtifact({
        artifactId: 'file-15',
        taskId: 'task-1',
        contextId: 'ctx-1',
      });

      const artifact = await store.getArtifactByContext('ctx-2', artifactId);
      expect(artifact).toBeNull();
    });
  });
});
