/**
 * Example: Using streaming pipelines to simplify LLM response handling
 *
 * This demonstrates how the new chat-completion operators can be composed
 * together to handle complex streaming scenarios with minimal code.
 */

import { from } from 'rxjs';
import {
  collectStreams,
  createStreamPipeline,
  observeStreams,
  streamContentWithThoughts,
  streamToolCalls,
} from '../src/core/operators/chat-completions/pipelines';
import type { Choice } from '../src/core/operators/chat-completions/types';

// ============================================================================
// Example 1: Full Pipeline - Content, Thoughts, and Tool Calls
// ============================================================================

async function fullPipelineExample() {
  console.log('='.repeat(70));
  console.log('Example 1: Full Pipeline - Content + Thoughts + Tool Calls');
  console.log('='.repeat(70));

  const streamingChunks: Choice[] = [
    {
      index: 0,
      delta: { content: 'Let me help you with that. ' },
      finish_reason: null,
    },
    {
      index: 0,
      delta: { content: '<thinking>I need to check the weather first</thinking>' },
      finish_reason: null,
    },
    {
      index: 0,
      delta: { content: 'I will check the weather for you.' },
      finish_reason: null,
    },
    {
      index: 0,
      delta: {
        tool_calls: [
          {
            index: 0,
            id: 'call_weather_1',
            type: 'function',
            function: { name: 'get_weather', arguments: '' },
          },
        ],
      },
      finish_reason: null,
    },
    {
      index: 0,
      delta: {
        tool_calls: [
          {
            index: 0,
            id: null,
            type: 'function',
            function: { name: '', arguments: '{"location":"' },
          },
        ],
      },
      finish_reason: null,
    },
    {
      index: 0,
      delta: {
        tool_calls: [
          {
            index: 0,
            id: null,
            type: 'function',
            function: { name: '', arguments: 'San Francisco"}' },
          },
        ],
      },
      finish_reason: 'tool_calls',
    },
  ];

  // Create the pipeline - automatically splits into all stream types
  const pipeline = createStreamPipeline(from(streamingChunks));

  console.log('\n📝 Content chunks (cleaned):');
  pipeline.content.subscribe((chunk) => console.log(`  "${chunk}"`));

  console.log('\n💭 Thoughts extracted:');
  pipeline.tags.subscribe((tag) => {
    if (tag.name === 'thinking') {
      console.log(`  [${tag.name}] ${tag.content}`);
    }
  });

  console.log('\n🔧 Tool calls assembled:');
  pipeline.toolCalls.subscribe((call) => {
    console.log(`  ${call.function.name}(${call.function.arguments})`);
  });

  console.log('\n✅ Final aggregated response:');
  const final = await pipeline.aggregated.toPromise();
  console.log(JSON.stringify(final, null, 2));
}

// ============================================================================
// Example 2: Content-Only Pipeline (No Tool Calls)
// ============================================================================

async function contentOnlyExample() {
  console.log(`\n\n${'='.repeat(70)}`);
  console.log('Example 2: Content-Only Pipeline');
  console.log('='.repeat(70));

  const streamingChunks: Choice[] = [
    {
      index: 0,
      delta: { content: 'The capital of France is Paris. ' },
      finish_reason: null,
    },
    {
      index: 0,
      delta: {
        content: '<thinking>This is a straightforward question</thinking>',
      },
      finish_reason: null,
    },
    {
      index: 0,
      delta: { content: 'It is known for the Eiffel Tower.' },
      finish_reason: 'stop',
    },
  ];

  const { content, thoughts, aggregated } = streamContentWithThoughts(from(streamingChunks));

  console.log('\n📝 Content stream:');
  content.subscribe((chunk) => console.log(`  "${chunk}"`));

  console.log('\n💭 Extracted thoughts:');
  thoughts.subscribe((thought) => console.log(`  ${thought.content}`));

  const final = await aggregated.toPromise();
  console.log('\n✅ Final content:', final?.delta?.content);
}

// ============================================================================
// Example 3: Tool Calls Only
// ============================================================================

async function toolCallsOnlyExample() {
  console.log(`\n\n${'='.repeat(70)}`);
  console.log('Example 3: Tool Calls Only Pipeline');
  console.log('='.repeat(70));

  const streamingChunks: Choice[] = [
    {
      index: 0,
      delta: {
        tool_calls: [
          {
            index: 0,
            id: 'call_1',
            type: 'function',
            function: { name: 'search', arguments: '{"q":"' },
          },
          {
            index: 1,
            id: 'call_2',
            type: 'function',
            function: { name: 'calculate', arguments: '{"expr":"' },
          },
        ],
      },
      finish_reason: null,
    },
    {
      index: 0,
      delta: {
        tool_calls: [
          {
            index: 0,
            id: null,
            type: 'function',
            function: { name: '', arguments: 'typescript"}' },
          },
          {
            index: 1,
            id: null,
            type: 'function',
            function: { name: '', arguments: '2+2"}' },
          },
        ],
      },
      finish_reason: 'tool_calls',
    },
  ];

  const { toolCalls, aggregated } = streamToolCalls(from(streamingChunks));

  console.log('\n🔧 Tool calls as they arrive:');
  toolCalls.subscribe((call) => {
    console.log(`  [${call.id}] ${call.function.name}(${call.function.arguments})`);
  });

  const final = await aggregated.toPromise();
  console.log('\n✅ Total tool calls:', final?.delta?.tool_calls?.length);
}

// ============================================================================
// Example 4: Observable Pattern with Callbacks
// ============================================================================

async function observableCallbacksExample() {
  console.log(`\n\n${'='.repeat(70)}`);
  console.log('Example 4: Observable Pattern with Callbacks');
  console.log('='.repeat(70));

  const streamingChunks: Choice[] = [
    { index: 0, delta: { content: 'Processing ' }, finish_reason: null },
    { index: 0, delta: { content: '<thinking>Step 1</thinking>' }, finish_reason: null },
    { index: 0, delta: { content: 'your request...' }, finish_reason: null },
    {
      index: 0,
      delta: {
        tool_calls: [
          {
            index: 0,
            id: 'call_x',
            type: 'function',
            function: { name: 'process', arguments: '{}' },
          },
        ],
      },
      finish_reason: 'tool_calls',
    },
  ];

  console.log('\n📊 Observing all streams with callbacks:');

  const result$ = observeStreams(from(streamingChunks), {
    onContent: (chunk) => console.log(`  [CONTENT] "${chunk}"`),
    onThought: (thought) => console.log(`  [THOUGHT] ${thought.content}`),
    onToolCall: (call) => console.log(`  [TOOL] ${call.function.name}()`),
  });

  const final = await result$.toPromise();
  console.log('\n✅ Completed:', final?.finish_reason);
}

// ============================================================================
// Example 5: Collect All Streams for Testing
// ============================================================================

async function collectStreamsExample() {
  console.log(`\n\n${'='.repeat(70)}`);
  console.log('Example 5: Collect All Streams (Testing Pattern)');
  console.log('='.repeat(70));

  const streamingChunks: Choice[] = [
    { index: 0, delta: { content: 'Hello ' }, finish_reason: null },
    { index: 0, delta: { content: '<thinking>greeting</thinking>' }, finish_reason: null },
    { index: 0, delta: { content: 'World!' }, finish_reason: null },
    {
      index: 0,
      delta: {
        tool_calls: [
          {
            index: 0,
            id: 'call_1',
            type: 'function',
            function: { name: 'greet', arguments: '{}' },
          },
        ],
      },
      finish_reason: 'tool_calls',
    },
  ];

  const collected = await collectStreams(from(streamingChunks));

  console.log('\n📦 Collected Results:');
  console.log('  Content chunks:', collected.contentChunks);
  console.log(
    '  Thoughts:',
    collected.thoughts.map((t) => t.content)
  );
  console.log(
    '  Tool calls:',
    collected.toolCalls.map((t) => t.function.name)
  );
  console.log('  Final state:', collected.final.finish_reason);
}

// ============================================================================
// Example 6: Real-Time UI Update Pattern
// ============================================================================

async function realTimeUIExample() {
  console.log(`\n\n${'='.repeat(70)}`);
  console.log('Example 6: Real-Time UI Update Pattern');
  console.log('='.repeat(70));

  const streamingChunks: Choice[] = [
    { index: 0, delta: { content: 'Analyzing ' }, finish_reason: null },
    { index: 0, delta: { content: 'your data' }, finish_reason: null },
    {
      index: 0,
      delta: {
        content: '<thinking verbosity="high">Need to aggregate sales by region</thinking>',
      },
      finish_reason: null,
    },
    { index: 0, delta: { content: '...' }, finish_reason: null },
    {
      index: 0,
      delta: {
        tool_calls: [
          {
            index: 0,
            id: 'call_analyze',
            type: 'function',
            function: { name: 'analyze_data', arguments: '{"dataset":"sales"}' },
          },
        ],
      },
      finish_reason: 'tool_calls',
    },
  ];

  const pipeline = createStreamPipeline(from(streamingChunks));

  console.log('\n🖥️  Simulating real-time UI updates:');

  let displayedContent = '';

  // Update UI with content as it arrives
  pipeline.content.subscribe((chunk) => {
    displayedContent += chunk;
    console.log(`  [UI UPDATE] Display: "${displayedContent}"`);
  });

  // Show thoughts in debug panel
  pipeline.tags.subscribe((tag) => {
    if (tag.name === 'thinking') {
      const verbosity = tag.attributes.verbosity || 'normal';
      console.log(`  [DEBUG PANEL] [${verbosity}] ${tag.content}`);
    }
  });

  // Execute tools as they arrive
  pipeline.toolCalls.subscribe((call) => {
    console.log(`  [TOOL EXECUTOR] Running ${call.function.name}...`);
  });

  // Handle completion
  const final = await pipeline.aggregated.toPromise();
  console.log(`\n✅ Response complete: ${final?.finish_reason}`);
}

// ============================================================================
// Run All Examples
// ============================================================================

async function main() {
  await fullPipelineExample();
  await contentOnlyExample();
  await toolCallsOnlyExample();
  await observableCallbacksExample();
  await collectStreamsExample();
  await realTimeUIExample();

  console.log(`\n${'='.repeat(70)}`);
  console.log('All examples completed!');
  console.log('='.repeat(70));
}

main().catch(console.error);
