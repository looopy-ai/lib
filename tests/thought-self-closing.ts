/**
 * Test thought extraction with self-closing tag format
 *
 * This tests the self-closing format:
 * <thinking thought="content" thought_type="type" confidence="0.7" />
 */

import { of } from 'rxjs';
import type { LoopEventEmitter } from '../src/core/operators/event-emitter';
import { extractThoughtsFromStream } from '../src/core/operators/thought-stream';
import type { LLMResponse } from '../src/core/types';

interface CapturedEvent {
  type: 'content-delta' | 'thought';
  content: string;
  metadata?: Record<string, unknown>;
}

const events: CapturedEvent[] = [];

const mockEmitter = {
  events$: of(),
  emitTaskStatus: () => {},
  emitContentDelta: (_taskId: string, _contextId: string, content: string, _chunkIndex: number) => {
    events.push({ type: 'content-delta', content });
  },
  emitThought: (
    _taskId: string,
    _contextId: string,
    _type: string,
    content: string,
    metadata: Record<string, unknown>
  ) => {
    events.push({ type: 'thought', content, metadata });
  },
  emitContentComplete: () => {},
  emitLLMCall: () => {},
  emitToolStart: () => {},
  emitToolComplete: () => {},
  emitCheckpoint: () => {},
  complete: () => {},
} as unknown as LoopEventEmitter;

async function testSelfClosingFormat() {
  console.log('============================================================');
  console.log('SELF-CLOSING THOUGHT TAG TEST');
  console.log('============================================================\n');

  events.length = 0;

  // Simulate streaming chunks with self-closing thinking tags
  const chunks: LLMResponse[] = [
    {
      message: {
        role: 'assistant',
        content:
          'Analyzing... <thinking thought="Need to verify the calculation" thought_type="verification" confidence="0.9" />',
      },
      finished: false,
    },
    {
      message: {
        role: 'assistant',
        content:
          'Analyzing... <thinking thought="Need to verify the calculation" thought_type="verification" confidence="0.9" /> The result',
      },
      finished: false,
    },
    {
      message: {
        role: 'assistant',
        content:
          'Analyzing... <thinking thought="Need to verify the calculation" thought_type="verification" confidence="0.9" /> The result is correct.',
      },
      finished: true,
    },
  ];

  const source$ = of(...chunks);
  const operator = extractThoughtsFromStream('task-1', 'context-1', mockEmitter);

  await new Promise<void>((resolve) => {
    operator(source$).subscribe({
      complete: resolve,
    });
  });

  console.log('Events captured:', events.length);
  console.log('');

  let thoughtCount = 0;
  let deltaCount = 0;

  for (const event of events) {
    if (event.type === 'thought') {
      thoughtCount++;
      console.log(`[Thought ${thoughtCount}]`);
      console.log(`  Content: "${event.content}"`);
      console.log(`  Metadata:`, event.metadata);

      if (!event.content.includes('verify the calculation')) {
        console.log('  ❌ FAIL: Expected thought about verification');
        process.exit(1);
      }

      if (!event.metadata?.thoughtType || event.metadata.thoughtType !== 'verification') {
        console.log('  ❌ FAIL: Expected thought_type="verification"');
        process.exit(1);
      }

      if (!event.metadata?.confidence || event.metadata.confidence !== 0.9) {
        console.log('  ❌ FAIL: Expected confidence=0.9');
        process.exit(1);
      }

      console.log('  ✅ PASS: Thought extracted with correct metadata');
    } else {
      deltaCount++;
      console.log(`[Delta ${deltaCount}]: "${event.content}"`);

      if (event.content.includes('<thinking')) {
        console.log(`  ❌ FAIL: Delta contains <thinking> tag`);
        process.exit(1);
      }
    }
  }

  console.log('');
  console.log('============================================================');
  console.log('Summary:');
  console.log(`  Thoughts extracted: ${thoughtCount}`);
  console.log(`  Content deltas: ${deltaCount}`);
  console.log('============================================================');

  if (thoughtCount !== 1) {
    console.log('❌ FAIL: Expected exactly 1 thought (deduplicated)');
    process.exit(1);
  }

  if (deltaCount === 0) {
    console.log('❌ FAIL: Expected content deltas');
    process.exit(1);
  }

  const finalContent = events
    .filter((e) => e.type === 'content-delta')
    .map((e) => e.content)
    .join('');
  console.log('');
  console.log('Final content:', `"${finalContent}"`);

  if (finalContent.includes('<thinking')) {
    console.log('❌ FAIL: Final content contains <thinking> tag');
    process.exit(1);
  }

  if (!finalContent.includes('The result is correct')) {
    console.log('❌ FAIL: Expected content to include "The result is correct"');
    process.exit(1);
  }

  console.log('✅ ALL TESTS PASSED');
}

testSelfClosingFormat().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
