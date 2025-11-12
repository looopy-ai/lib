/**
 * Manual test to verify thought extraction behavior
 *
 * Run this to see the order of events and verify:
 * 1. Thinking tags are removed from content-delta
 * 2. Thoughts are emitted before content-delta
 */

import { context } from '@opentelemetry/api';
import { Observable } from 'rxjs';
import { AgentLoop } from '../src/core/agent-loop';
import type { ArtifactStore, LLMProvider } from '../src/core/types';
import type { AnyEvent, LLMEvent } from '../src/events/types';

// Mock ArtifactStore
class MockArtifactStore implements ArtifactStore {
  async createFileArtifact(): Promise<string> {
    return 'artifact-1';
  }
  async createDataArtifact(): Promise<string> {
    return 'artifact-1';
  }
  async createDatasetArtifact(): Promise<string> {
    return 'artifact-1';
  }
  async appendFileChunk(): Promise<void> {}
  async writeData(): Promise<void> {}
  async appendDatasetBatch(): Promise<void> {}
  async getArtifact(): Promise<null> {
    return null;
  }
  async getFileContent(): Promise<string> {
    return '';
  }
  async getDataContent(): Promise<Record<string, unknown>> {
    return {};
  }
  async getDatasetRows(): Promise<Record<string, unknown>[]> {
    return [];
  }
  async listArtifacts(): Promise<string[]> {
    return [];
  }
  async deleteArtifact(): Promise<void> {}
}

// Mock LLM provider that emits thinking tags
const mockLLMProvider: LLMProvider = {
  call: () => {
    return new Observable((subscriber) => {
      console.log('🚀 Starting LLM streaming...\n');

      // Chunk 1: Opening thinking tag
      setTimeout(() => {
        console.log('📤 LLM emits chunk 1: "<thinking>Let me think about"');
        subscriber.next({
          kind: 'content-delta',
          delta: '<thinking>Let me think about',
          index: 0,
          timestamp: new Date().toISOString(),
        } as LLMEvent<AnyEvent>);
      }, 100);

      // Chunk 2: Closing thinking tag
      setTimeout(() => {
        console.log('📤 LLM emits chunk 2: " this problem</thinking>"');
        subscriber.next({
          kind: 'content-delta',
          delta: ' this problem</thinking>',
          index: 1,
          timestamp: new Date().toISOString(),
        } as LLMEvent<AnyEvent>);
      }, 200);

      // Chunk 3: Regular content
      setTimeout(() => {
        console.log('📤 LLM emits chunk 3: "The answer"');
        subscriber.next({
          kind: 'content-delta',
          delta: 'The answer',
          index: 2,
          timestamp: new Date().toISOString(),
        } as LLMEvent<AnyEvent>);
      }, 300);

      // Chunk 4: More content
      setTimeout(() => {
        console.log('📤 LLM emits chunk 4: " is 42"');
        subscriber.next({
          kind: 'content-delta',
          delta: ' is 42',
          index: 3,
          timestamp: new Date().toISOString(),
        } as LLMEvent<AnyEvent>);
      }, 400);

      // Final
      setTimeout(() => {
        console.log('📤 LLM emits final response');
        subscriber.next({
          kind: 'content-complete',
          content: '<thinking>Let me think about this problem</thinking>The answer is 42',
          timestamp: new Date().toISOString(),
        } as LLMEvent<AnyEvent>);
        subscriber.complete();
      }, 500);
    });
  },
};

async function main() {
  console.log('='.repeat(60));
  console.log('THOUGHT EXTRACTION TEST');
  console.log('='.repeat(60));
  console.log();

  const loop = new AgentLoop({
    agentId: 'test-agent',
    llmProvider: mockLLMProvider,
    toolProviders: [],
    taskStateStore: {
      save: async () => {},
      load: async () => null,
      delete: async () => {},
      exists: async () => false,
      listTasks: async () => [],
      setTTL: async () => {},
    },
    artifactStore: new MockArtifactStore(),
  });

  const events$ = loop.startTurnLoop([{ role: 'user', content: 'What is 6 * 7?' }], {
    contextId: 'test-context',
    taskId: 'test-task',
    turnNumber: 1,
    parentContext: context.active(),
  });

  let eventCount = 0;
  console.log(`\n${'='.repeat(60)}`);
  console.log('EVENTS RECEIVED:');
  console.log(`${'='.repeat(60)}\n`);

  events$.subscribe({
    next: (event) => {
      eventCount++;

      if (event.kind === 'thought-stream') {
        console.log(`\n[Event ${eventCount}] 🧠 THOUGHT-STREAM:`);
        console.log(`  Content: "${event.content}"`);
        console.log(`  Type: ${event.thoughtType}`);
      } else if (event.kind === 'content-delta') {
        console.log(`\n[Event ${eventCount}] 📝 CONTENT-DELTA:`);
        console.log(`  Delta: "${event.delta}"`);
        console.log(`  Contains <thinking>: ${event.delta.includes('<thinking>')}`);
      } else if (event.kind === 'content-complete') {
        console.log(`\n[Event ${eventCount}] ✅ CONTENT-COMPLETE:`);
        console.log(`  Content: "${event.content}"`);
        console.log(`  Contains <thinking>: ${event.content.includes('<thinking>')}`);
      } else {
        console.log(`\n[Event ${eventCount}] ${event.kind}`);
      }
    },
    complete: () => {
      console.log(`\n${'='.repeat(60)}`);
      console.log(`Total events: ${eventCount}`);
      console.log('='.repeat(60));
      console.log('\n✅ Test completed!\n');
    },
    error: (err) => {
      console.error('\n❌ Error:', err);
    },
  });
}

main().catch(console.error);
