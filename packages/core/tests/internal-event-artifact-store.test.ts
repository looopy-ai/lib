/**
 * Tests for InternalEventArtifactStore
 */

import { describe, expect, it, vi } from 'vitest';
import {
  InMemoryArtifactStore,
  InternalEventArtifactStore,
  type InternalEventEmitter,
} from '../src/stores/artifacts';
import type { AnyEvent } from '../src/types/event';

describe('InternalEventArtifactStore', () => {
  describe('File Artifacts', () => {
    it('should emit file-write events when appending chunks', async () => {
      const events: AnyEvent[] = [];
      const eventEmitter: InternalEventEmitter = {
        emit: (event) => events.push(event),
      };

      const store = new InternalEventArtifactStore({
        delegate: new InMemoryArtifactStore(),
        eventEmitter,
      });

      // Create file artifact
      const artifactId = await store.createFileArtifact({
        artifactId: 'test-file',
        taskId: 'task-1',
        contextId: 'ctx-1',
        name: 'test.md',
        mimeType: 'text/markdown',
      });

      // Append first chunk
      await store.appendFileChunk('ctx-1', artifactId, '# Hello\n');

      // Should have emitted one file-write event
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        kind: 'file-write',
        artifactId: 'test-file',
        taskId: 'task-1',
        contextId: 'ctx-1',
        data: '# Hello\n',
        index: 0,
        complete: false,
      });

      // Append second chunk
      await store.appendFileChunk('ctx-1', artifactId, '\n## World', { isLastChunk: true });

      // Should have emitted second file-write event
      expect(events).toHaveLength(2);
      expect(events[1]).toMatchObject({
        kind: 'file-write',
        artifactId: 'test-file',
        data: '\n## World',
        index: 1,
        complete: true,
      });
    });

    it('should not emit events when disabled', async () => {
      const events: AnyEvent[] = [];
      const eventEmitter: InternalEventEmitter = {
        emit: (event) => events.push(event),
      };

      const store = new InternalEventArtifactStore({
        delegate: new InMemoryArtifactStore(),
        eventEmitter,
        enableEvents: false, // Disabled
      });

      const artifactId = await store.createFileArtifact({
        artifactId: 'test-file',
        taskId: 'task-1',
        contextId: 'ctx-1',
      });

      await store.appendFileChunk('ctx-1', artifactId, 'test');

      // Should not have emitted any events
      expect(events).toHaveLength(0);
    });
  });

  describe('Data Artifacts', () => {
    it('should emit data-write events when writing data', async () => {
      const events: AnyEvent[] = [];
      const eventEmitter: InternalEventEmitter = {
        emit: (event) => events.push(event),
      };

      const store = new InternalEventArtifactStore({
        delegate: new InMemoryArtifactStore(),
        eventEmitter,
      });

      // Create data artifact
      const artifactId = await store.createDataArtifact({
        artifactId: 'test-data',
        taskId: 'task-1',
        contextId: 'ctx-1',
        name: 'config',
      });

      // Write data
      const testData = { key: 'value', nested: { foo: 'bar' } };
      await store.writeData('ctx-1', artifactId, testData);

      // Should have emitted one data-write event
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        kind: 'data-write',
        artifactId: 'test-data',
        taskId: 'task-1',
        contextId: 'ctx-1',
        data: testData,
      });
    });
  });

  describe('Dataset Artifacts', () => {
    it('should emit dataset-write events when appending batches', async () => {
      const events: AnyEvent[] = [];
      const eventEmitter: InternalEventEmitter = {
        emit: (event) => events.push(event),
      };

      const store = new InternalEventArtifactStore({
        delegate: new InMemoryArtifactStore(),
        eventEmitter,
      });

      // Create dataset artifact
      const artifactId = await store.createDatasetArtifact({
        artifactId: 'test-dataset',
        taskId: 'task-1',
        contextId: 'ctx-1',
        name: 'sales',
        schema: {
          columns: [
            { name: 'date', type: 'date' },
            { name: 'amount', type: 'number' },
          ],
        },
      });

      // Append first batch
      const batch1 = [
        { date: '2024-01-01', amount: 100 },
        { date: '2024-01-02', amount: 200 },
      ];
      await store.appendDatasetBatch('ctx-1', artifactId, batch1);

      // Should have emitted one dataset-write event
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        kind: 'dataset-write',
        artifactId: 'test-dataset',
        taskId: 'task-1',
        contextId: 'ctx-1',
        rows: batch1,
        index: 0,
        complete: false,
      });

      // Append second batch
      const batch2 = [{ date: '2024-01-03', amount: 300 }];
      await store.appendDatasetBatch('ctx-1', artifactId, batch2, { isLastBatch: true });

      // Should have emitted second dataset-write event
      expect(events).toHaveLength(2);
      expect(events[1]).toMatchObject({
        kind: 'dataset-write',
        rows: batch2,
        index: 1,
        complete: true,
      });
    });
  });

  describe('Decorator Pattern', () => {
    it('should delegate all operations to underlying store', async () => {
      const delegate = new InMemoryArtifactStore();
      const store = new InternalEventArtifactStore({
        delegate,
        eventEmitter: { emit: vi.fn() },
      });

      // Create artifact
      const artifactId = await store.createFileArtifact({
        artifactId: 'test',
        taskId: 'task-1',
        contextId: 'ctx-1',
      });

      // Append chunk
      await store.appendFileChunk('ctx-1', artifactId, 'test');

      // Should be retrievable from both stores
      const content1 = await store.getFileContent('ctx-1', artifactId);
      const content2 = await delegate.getFileContent('ctx-1', artifactId);
      expect(content1).toBe('test');
      expect(content2).toBe('test');
    });
  });
});
