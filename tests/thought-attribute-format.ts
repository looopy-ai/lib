/**
 * Test thought extraction with attribute-based format
 *
 * This tests the newer format where thoughts are specified as XML attributes:
 * <thinking thought="content" thought_type="type" confidence="0.7"></thinking>
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

// Create a mock event emitter that captures events
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

function verifyThought(event: CapturedEvent) {
  if (!event.content.includes('date calculation')) {
    console.log('  ❌ FAIL: Expected thought about date calculation');
    process.exit(1);
  }

  if (!event.metadata?.thoughtType || event.metadata.thoughtType !== 'reflection') {
    console.log('  ❌ FAIL: Expected thought_type="reflection"');
    process.exit(1);
  }

  if (!event.metadata?.confidence || event.metadata.confidence !== 0.7) {
    console.log('  ❌ FAIL: Expected confidence=0.7');
    process.exit(1);
  }

  console.log('  ✅ PASS: Thought extracted with correct metadata');
}

function verifyDelta(content: string) {
  if (content.includes('<thinking>')) {
    console.log(`  ❌ FAIL: Delta contains <thinking> tag`);
    process.exit(1);
  }
}

async function testAttributeFormat() {
  console.log('============================================================');
  console.log('ATTRIBUTE-BASED THOUGHT EXTRACTION TEST');
  console.log('============================================================\n');

  events.length = 0;

  // Simulate streaming chunks with attribute-based thinking tags
  const chunks: LLMResponse[] = [
    {
      message: {
        role: 'assistant',
        content:
          'Let me analyze this. <thinking thought_id="date_calculation_failure" thought="It seems there is still an issue with the date calculation. The datetime function may not be available either. I will need to use a different approach or inform the user." thought_type="reflection" confidence="0.7"></thinking>',
      },
      finished: false,
    },
    {
      message: {
        role: 'assistant',
        content:
          'Let me analyze this. <thinking thought_id="date_calculation_failure" thought="It seems there is still an issue with the date calculation. The datetime function may not be available either. I will need to use a different approach or inform the user." thought_type="reflection" confidence="0.7"></thinking> I apologize',
      },
      finished: false,
    },
    {
      message: {
        role: 'assistant',
        content:
          'Let me analyze this. <thinking thought_id="date_calculation_failure" thought="It seems there is still an issue with the date calculation. The datetime function may not be available either. I will need to use a different approach or inform the user." thought_type="reflection" confidence="0.7"></thinking> I apologize, but',
      },
      finished: false,
    },
    {
      message: {
        role: 'assistant',
        content:
          'Let me analyze this. <thinking thought_id="date_calculation_failure" thought="It seems there is still an issue with the date calculation. The datetime function may not be available either. I will need to use a different approach or inform the user." thought_type="reflection" confidence="0.7"></thinking> I apologize, but I am unable to calculate dates.',
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
      verifyThought(event);
    } else {
      deltaCount++;
      console.log(`[Delta ${deltaCount}]: "${event.content}"`);
      verifyDelta(event.content);
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

  // Check final assembled content
  const finalContent = events
    .filter((e) => e.type === 'content-delta')
    .map((e) => e.content)
    .join('');
  console.log('');
  console.log('Final content:', `"${finalContent}"`);

  if (finalContent.includes('<thinking>')) {
    console.log('❌ FAIL: Final content contains <thinking> tag');
    process.exit(1);
  }

  if (!finalContent.includes('I apologize')) {
    console.log('❌ FAIL: Expected content to include "I apologize"');
    process.exit(1);
  }

  console.log('✅ ALL TESTS PASSED');
}

testAttributeFormat().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
