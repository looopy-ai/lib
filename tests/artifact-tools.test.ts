/**
 * Artifact Tools Tests
 *
 * Tests for the artifact_update tool to ensure:
 * 1. Artifacts can be created with a specific ID
 * 2. Subsequent updates use the same ID
 * 3. append=true creates artifact if it doesn't exist
 * 4. append=false replaces parts
 */

import { beforeEach, describe, expect, it } from 'vitest';
import type { ExecutionContext as ToolExecutionContext } from '../src/core/types';
import { InMemoryArtifactStore } from '../src/stores/artifacts/memory-artifact-store';
import { InMemoryStateStore } from '../src/stores/memory/memory-state-store';
import { createArtifactTools } from '../src/tools/artifact-tools';

describe('Artifact Tools', () => {
  let artifactStore: InMemoryArtifactStore;
  let stateStore: InMemoryStateStore;
  let toolProvider: ReturnType<typeof createArtifactTools>;
  let context: ToolExecutionContext;

  beforeEach(async () => {
    artifactStore = new InMemoryArtifactStore();
    stateStore = new InMemoryStateStore();
    toolProvider = createArtifactTools(artifactStore, stateStore);

    context = {
      taskId: 'test-task-123',
      agentId: 'test-agent',
      contextId: 'test-context-456',
    };

    // Create initial state for the task
    await stateStore.save('test-task-123', {
      taskId: 'test-task-123',
      agentId: 'test-agent',
      contextId: 'test-context-456',
      messages: [],
      systemPrompt: '',
      iteration: 0,
      completed: false,
      availableTools: [],
      pendingToolCalls: [],
      completedToolCalls: {},
      artifactIds: [],
      activeSubAgents: [],
      lastActivity: new Date().toISOString(),
      resumeFrom: 'llm-call',
    });
  });

  describe('artifact_update tool', () => {
    it('should create artifact with requested ID on first call', async () => {
      const result = await toolProvider.execute(
        {
          id: 'call-1',
          type: 'function',
          function: {
            name: 'artifact_update',
            arguments: {
              artifact: {
                artifactId: 'my-custom-artifact-id',
                name: 'Test Artifact',
                description: 'A test artifact',
                parts: [
                  {
                    kind: 'text',
                    text: 'First part',
                  },
                ],
              },
              append: false,
              lastChunk: false,
            },
          },
        },
        context
      );

      expect(result.success).toBe(true);
      expect(result.result).toMatchObject({
        artifactId: 'my-custom-artifact-id',
        partsAdded: 1,
        complete: false,
      });

      // Verify artifact exists with correct ID
      const artifact = await artifactStore.getArtifact('my-custom-artifact-id');
      expect(artifact).toBeDefined();
      expect(artifact?.artifactId).toBe('my-custom-artifact-id');
      expect(artifact?.name).toBe('Test Artifact');
    });

    it('should append to existing artifact with append=true', async () => {
      // First call - create artifact
      await toolProvider.execute(
        {
          id: 'call-1',
          type: 'function',
          function: {
            name: 'artifact_update',
            arguments: {
              artifact: {
                artifactId: 'facts-about-number-69',
                name: 'Number Facts',
                parts: [{ kind: 'text', text: 'Fact 1: ' }],
              },
              append: false,
              lastChunk: false,
            },
          },
        },
        context
      );

      // Second call - append more content
      const result = await toolProvider.execute(
        {
          id: 'call-2',
          type: 'function',
          function: {
            name: 'artifact_update',
            arguments: {
              artifact: {
                artifactId: 'facts-about-number-69',
                parts: [{ kind: 'text', text: 'Fact 2: ' }],
              },
              append: true,
              lastChunk: false,
            },
          },
        },
        context
      );

      expect(result.success).toBe(true);
      expect(result.result).toMatchObject({
        artifactId: 'facts-about-number-69',
        partsAdded: 1,
      });

      // Verify artifact has 1 part (text parts are concatenated)
      const parts = await artifactStore.getArtifactParts('facts-about-number-69');
      expect(parts).toHaveLength(1);
      expect(parts[0].content).toBe('Fact 1: Fact 2: ');
      expect(parts[0].kind).toBe('text');
    });

    it('should create artifact if it does not exist when append=true', async () => {
      // Call with append=true on non-existent artifact - should create it
      const result = await toolProvider.execute(
        {
          id: 'call-1',
          type: 'function',
          function: {
            name: 'artifact_update',
            arguments: {
              artifact: {
                artifactId: 'new-artifact-via-append',
                name: 'Created via Append',
                parts: [{ kind: 'text', text: 'First part' }],
              },
              append: true,
              lastChunk: false,
            },
          },
        },
        context
      );

      expect(result.success).toBe(true);
      expect(result.result).toMatchObject({
        artifactId: 'new-artifact-via-append',
        partsAdded: 1,
      });

      // Verify artifact was created
      const artifact = await artifactStore.getArtifact('new-artifact-via-append');
      expect(artifact).toBeDefined();
      expect(artifact?.name).toBe('Created via Append');
    });

    it('should replace parts when append=false on existing artifact', async () => {
      // Create artifact with initial content
      await toolProvider.execute(
        {
          id: 'call-1',
          type: 'function',
          function: {
            name: 'artifact_update',
            arguments: {
              artifact: {
                artifactId: 'report-to-replace',
                name: 'Report',
                parts: [
                  { kind: 'text', text: 'Old content part 1' },
                  { kind: 'text', text: 'Old content part 2' },
                ],
              },
              append: false,
              lastChunk: false,
            },
          },
        },
        context
      );

      // Replace with new content
      const result = await toolProvider.execute(
        {
          id: 'call-2',
          type: 'function',
          function: {
            name: 'artifact_update',
            arguments: {
              artifact: {
                artifactId: 'report-to-replace',
                parts: [{ kind: 'text', text: 'New content part 1' }],
              },
              append: false,
              lastChunk: false,
            },
          },
        },
        context
      );

      expect(result.success).toBe(true);
      expect(result.result).toMatchObject({
        artifactId: 'report-to-replace',
        partsReplaced: 1, // Replaced 1 text part (which was concatenated from the original 2)
        partsAdded: 0,
      });

      // Verify parts were replaced (text parts are concatenated by kind)
      const parts = await artifactStore.getArtifactParts('report-to-replace');
      expect(parts).toHaveLength(1); // Only 1 text part now
      expect(parts[0].content).toBe('New content part 1'); // New content
      expect(parts[0].kind).toBe('text');
    });

    it('should mark artifact complete with lastChunk=true', async () => {
      await toolProvider.execute(
        {
          id: 'call-1',
          type: 'function',
          function: {
            name: 'artifact_update',
            arguments: {
              artifact: {
                artifactId: 'final-artifact',
                name: 'Final',
                parts: [{ kind: 'text', text: 'Complete content' }],
              },
              append: false,
              lastChunk: true,
            },
          },
        },
        context
      );

      const artifact = await artifactStore.getArtifact('final-artifact');
      expect(artifact?.status).toBe('complete');
      expect(artifact?.isLastChunk).toBe(true);
    });

    it('should handle multiple sequential appends', async () => {
      const artifactId = 'multi-append-test';

      // Create
      await toolProvider.execute(
        {
          id: 'call-1',
          type: 'function',
          function: {
            name: 'artifact_update',
            arguments: {
              artifact: {
                artifactId,
                parts: [{ kind: 'text', text: 'Part 1' }],
              },
              append: false,
              lastChunk: false,
            },
          },
        },
        context
      );

      // Append 1
      await toolProvider.execute(
        {
          id: 'call-2',
          type: 'function',
          function: {
            name: 'artifact_update',
            arguments: {
              artifact: { artifactId, parts: [{ kind: 'text', text: 'Part 2' }] },
              append: true,
              lastChunk: false,
            },
          },
        },
        context
      );

      // Append 2
      await toolProvider.execute(
        {
          id: 'call-3',
          type: 'function',
          function: {
            name: 'artifact_update',
            arguments: {
              artifact: { artifactId, parts: [{ kind: 'text', text: 'Part 3' }] },
              append: true,
              lastChunk: true,
            },
          },
        },
        context
      );

      const parts = await artifactStore.getArtifactParts(artifactId);
      expect(parts).toHaveLength(1); // All text parts concatenated into one
      expect(parts[0].content).toBe('Part 1Part 2Part 3'); // All parts concatenated
      expect(parts[0].kind).toBe('text');

      const artifact = await artifactStore.getArtifact(artifactId);
      expect(artifact?.status).toBe('complete');
    });

    it('should handle different part types', async () => {
      await toolProvider.execute(
        {
          id: 'call-1',
          type: 'function',
          function: {
            name: 'artifact_update',
            arguments: {
              artifact: {
                artifactId: 'multi-type-artifact',
                parts: [
                  { kind: 'text', text: 'Text content' },
                  { kind: 'data', data: { key: 'value', count: 42 } },
                ],
              },
              append: false,
              lastChunk: false,
            },
          },
        },
        context
      );

      const parts = await artifactStore.getArtifactParts('multi-type-artifact');
      expect(parts).toHaveLength(2);
      expect(parts[0].kind).toBe('text');
      expect(parts[0].content).toBe('Text content');
      expect(parts[1].kind).toBe('data');
      expect(parts[1].data).toEqual({ key: 'value', count: 42 });
    });
  });

  describe('list_artifacts tool', () => {
    it('should list artifacts for current context', async () => {
      // Create multiple artifacts
      await artifactStore.createArtifact({
        artifactId: 'artifact-1',
        taskId: context.taskId,
        contextId: context.contextId,
        name: 'First',
      });

      await artifactStore.createArtifact({
        artifactId: 'artifact-2',
        taskId: context.taskId,
        contextId: context.contextId,
        name: 'Second',
      });

      const result = await toolProvider.execute(
        {
          id: 'call-1',
          type: 'function',
          function: {
            name: 'list_artifacts',
            arguments: {},
          },
        },
        context
      );

      expect(result.success).toBe(true);
      const artifacts = (result.result as { artifacts: unknown[] }).artifacts;
      expect(artifacts).toHaveLength(2);
    });
  });

  describe('get_artifact tool', () => {
    it('should retrieve artifact by ID', async () => {
      await artifactStore.createArtifact({
        artifactId: 'get-test',
        taskId: context.taskId,
        contextId: context.contextId,
        name: 'Get Test',
      });

      await artifactStore.appendPart('get-test', {
        kind: 'text',
        content: 'Test content',
      });

      const result = await toolProvider.execute(
        {
          id: 'call-1',
          type: 'function',
          function: {
            name: 'get_artifact',
            arguments: {
              artifactId: 'get-test',
            },
          },
        },
        context
      );

      expect(result.success).toBe(true);
      expect(result.result).toMatchObject({
        artifactId: 'get-test',
        name: 'Get Test',
      });
    });

    it('should throw error for non-existent artifact', async () => {
      const result = await toolProvider.execute(
        {
          id: 'call-1',
          type: 'function',
          function: {
            name: 'get_artifact',
            arguments: {
              artifactId: 'does-not-exist',
            },
          },
        },
        context
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Artifact not found');
    });
  });
});
