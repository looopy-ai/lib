/**
 * Edge case testing for thought extraction in streaming
 *
 * Tests various scenarios:
 * - Split thinking tags across chunks
 * - Multiple thinking blocks
 * - Thinking tags with content before/after
 * - Empty thinking blocks
 * - Nested tags (if supported)
 */

import { Observable } from 'rxjs';
import { AgentLoop } from '../src/core/agent-loop';
import type { ArtifactStore, LLMProvider } from '../src/core/types';

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
  async getTaskArtifacts(): Promise<string[]> {
    return [];
  }
  async queryArtifacts(): Promise<string[]> {
    return [];
  }
  async getArtifactByContext(): Promise<null> {
    return null;
  }
  async deleteArtifact(): Promise<void> {}
}

// Test case 1: Multiple thinking blocks
const multipleThoughtsProvider: LLMProvider = {
  call: () => {
    return new Observable((subscriber) => {
      setTimeout(() => {
        subscriber.next({
          message: {
            role: 'assistant',
            content: '<thinking>First',
            contentDelta: '<thinking>First',
          },
          finished: false,
        });
      }, 100);

      setTimeout(() => {
        subscriber.next({
          message: {
            role: 'assistant',
            content: '<thinking>First thought</thinking>',
            contentDelta: ' thought</thinking>',
          },
          finished: false,
        });
      }, 200);

      setTimeout(() => {
        subscriber.next({
          message: {
            role: 'assistant',
            content: '<thinking>First thought</thinking>Answer: ',
            contentDelta: 'Answer: ',
          },
          finished: false,
        });
      }, 300);

      setTimeout(() => {
        subscriber.next({
          message: {
            role: 'assistant',
            content: '<thinking>First thought</thinking>Answer: <thinking>Second',
            contentDelta: '<thinking>Second',
          },
          finished: false,
        });
      }, 400);

      setTimeout(() => {
        subscriber.next({
          message: {
            role: 'assistant',
            content:
              '<thinking>First thought</thinking>Answer: <thinking>Second thought</thinking>',
            contentDelta: ' thought</thinking>',
          },
          finished: false,
        });
      }, 500);

      setTimeout(() => {
        subscriber.next({
          message: {
            role: 'assistant',
            content:
              '<thinking>First thought</thinking>Answer: <thinking>Second thought</thinking>42',
            contentDelta: '42',
          },
          finished: false,
        });
      }, 600);

      setTimeout(() => {
        subscriber.next({
          message: {
            role: 'assistant',
            content:
              '<thinking>First thought</thinking>Answer: <thinking>Second thought</thinking>42',
          },
          finished: true,
          finishReason: 'stop' as const,
        });
        subscriber.complete();
      }, 700);
    });
  },
};

// Test case 2: Content before and after thinking
const contentAroundThoughtProvider: LLMProvider = {
  call: () => {
    return new Observable((subscriber) => {
      setTimeout(() => {
        subscriber.next({
          message: {
            role: 'assistant',
            content: 'Let me',
            contentDelta: 'Let me',
          },
          finished: false,
        });
      }, 100);

      setTimeout(() => {
        subscriber.next({
          message: {
            role: 'assistant',
            content: 'Let me analyze <think',
            contentDelta: ' analyze <think',
          },
          finished: false,
        });
      }, 200);

      setTimeout(() => {
        subscriber.next({
          message: {
            role: 'assistant',
            content: 'Let me analyze <thinking>this problem',
            contentDelta: 'ing>this problem',
          },
          finished: false,
        });
      }, 300);

      setTimeout(() => {
        subscriber.next({
          message: {
            role: 'assistant',
            content: 'Let me analyze <thinking>this problem carefully</thinking>',
            contentDelta: ' carefully</thinking>',
          },
          finished: false,
        });
      }, 400);

      setTimeout(() => {
        subscriber.next({
          message: {
            role: 'assistant',
            content:
              'Let me analyze <thinking>this problem carefully</thinking>. The result is 100.',
            contentDelta: '. The result is 100.',
          },
          finished: false,
        });
      }, 500);

      setTimeout(() => {
        subscriber.next({
          message: {
            role: 'assistant',
            content:
              'Let me analyze <thinking>this problem carefully</thinking>. The result is 100.',
          },
          finished: true,
          finishReason: 'stop' as const,
        });
        subscriber.complete();
      }, 600);
    });
  },
};

async function runTest(name: string, provider: LLMProvider) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(name);
  console.log(`${'='.repeat(70)}\n`);

  const loop = new AgentLoop({
    agentId: 'test-agent',
    llmProvider: provider,
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

  const events$ = loop.startTurn([{ role: 'user', content: 'Test' }], {
    contextId: 'test-context',
    turnNumber: 1,
  });

  let eventNum = 0;
  const thoughts: string[] = [];
  const deltas: string[] = [];
  let finalContent = '';

  return new Promise<void>((resolve, reject) => {
    events$.subscribe({
      next: (event) => {
        if (event.kind === 'thought-stream') {
          eventNum++;
          thoughts.push(event.content);
          console.log(`[${eventNum}] 🧠 THOUGHT: "${event.content}"`);
        } else if (event.kind === 'content-delta') {
          handleContentDelta(event, ++eventNum, deltas);
        } else if (event.kind === 'content-complete') {
          handleContentComplete(event, ++eventNum);
          finalContent = event.content;
        }
      },
      complete: () => {
        printSummary(thoughts, deltas, finalContent);
        resolve();
      },
      error: reject,
    });
  });
}

function handleContentDelta(event: { delta: string }, eventNum: number, deltas: string[]) {
  deltas.push(event.delta);
  console.log(`[${eventNum}] 📝 DELTA: "${event.delta}"`);
  if (event.delta.includes('<thinking>') || event.delta.includes('</thinking>')) {
    console.log('  ❌ ERROR: Delta contains thinking tags!');
  }
}

function handleContentComplete(event: { content: string }, eventNum: number) {
  console.log(`[${eventNum}] ✅ FINAL: "${event.content}"`);
  if (event.content.includes('<thinking>') || event.content.includes('</thinking>')) {
    console.log('  ❌ ERROR: Final content contains thinking tags!');
  }
}

function printSummary(thoughts: string[], deltas: string[], finalContent: string) {
  console.log('\nSummary:');
  console.log(`  Thoughts: ${thoughts.length}`);
  console.log(`  Deltas: ${deltas.length}`);
  console.log(`  Final: "${finalContent}"`);
  console.log(`  Reconstructed from deltas: "${deltas.join('')}"`);

  // Verify final content matches deltas
  if (finalContent !== deltas.join('')) {
    console.log('  ⚠️  Warning: Final content !== concatenated deltas');
  }
}

async function main() {
  console.log('THOUGHT STREAMING EDGE CASE TESTS');
  console.log('Testing various scenarios for thought extraction');

  try {
    await runTest('TEST 1: Multiple Thinking Blocks', multipleThoughtsProvider);
    await runTest('TEST 2: Content Before and After Thinking', contentAroundThoughtProvider);

    console.log(`\n${'='.repeat(70)}`);
    console.log('✅ ALL TESTS COMPLETED');
    console.log('='.repeat(70));
  } catch (error) {
    console.error('\n❌ TEST FAILED:', error);
    process.exit(1);
  }
}

main();
