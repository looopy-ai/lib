/**
 * Artifact Scheduler Example
 *
 * Demonstrates how the ArtifactScheduler solves the problem of parallel
 * tool execution when LLM emits create + append/write operations in the
 * same response.
 *
 * Problem:
 * --------
 * LLM emits tool calls like this in a single response:
 *   1. artifact_create_file(id="report")
 *   2. artifact_append_file(id="report", chunk="...")
 *   3. artifact_append_file(id="report", chunk="...")
 *
 * These execute in parallel, causing (2) and (3) to fail because (1)
 * hasn't finished creating the artifact yet.
 *
 * Solution:
 * ---------
 * ArtifactScheduler partitions operations by artifactId and executes
 * them sequentially per partition, while allowing parallel execution
 * across different artifacts.
 *
 * Usage:
 * ------
 * The Agent class automatically wraps the artifactStore with ArtifactScheduler,
 * so no changes are needed to user code!
 */

import { ArtifactScheduler } from '../src/stores/artifacts/artifact-scheduler';
import { InMemoryArtifactStore } from '../src/stores/artifacts/memory-artifact-store';

/**
 * Example: Direct usage of ArtifactScheduler
 *
 * Note: Agent class already wraps artifactStore with ArtifactScheduler,
 * so you typically don't need to do this manually.
 */
async function exampleDirectUsage() {
  // Create base store
  const baseStore = new InMemoryArtifactStore();

  // Wrap with scheduler
  const scheduler = new ArtifactScheduler(baseStore);

  // Simulate parallel tool execution
  // (what happens when LLM emits create + append in same response)
  const artifactId = 'report-123';
  const taskId = 'task-456';
  const contextId = 'ctx-789';

  // These all execute immediately (in parallel)
  const operations = [
    scheduler.createFileArtifact({
      artifactId,
      taskId,
      contextId,
      name: 'report.txt',
    }),
    scheduler.appendFileChunk(contextId, artifactId, 'First chunk\n'),
    scheduler.appendFileChunk(contextId, artifactId, 'Second chunk\n'),
    scheduler.appendFileChunk(contextId, artifactId, 'Final chunk', { isLastChunk: true }),
  ];

  // Wait for all operations (scheduler ensures correct order)
  await Promise.all(operations);

  // Retrieve content
  const content = await scheduler.getFileContent(contextId, artifactId);
  console.log('Content:', content);
  // Output: "First chunk\nSecond chunk\nFinal chunk"
}

/**
 * Example: Agent usage (automatic)
 *
 * ```typescript
 * import { Agent } from '../src/core/agent';
 * import { InMemoryArtifactStore } from '../src/stores/artifacts/memory-artifact-store';
 *
 * const agent = new Agent({
 *   contextId: 'my-context',
 *   llmProvider: myLLM,
 *   toolProviders: [myTools],
 *   messageStore: myMessageStore,
 *   artifactStore: new InMemoryArtifactStore(), // Automatically wrapped!
 * });
 *
 * // LLM can emit create + append tool calls in parallel
 * // ArtifactScheduler ensures they execute in correct order
 * const events$ = await agent.startTurn('Create a report...');
 * ```
 */

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  exampleDirectUsage().catch(console.error);
}
