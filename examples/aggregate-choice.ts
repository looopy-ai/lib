/**
 * Example: Using aggregateChoice operator
 *
 * This example demonstrates how to use the aggregateChoice operator to
 * aggregate streaming LLM response chunks into a single complete Choice object.
 */

import { from } from 'rxjs';
import { aggregateChoice } from '../src/core/operators/chat-completions/aggregate';
import type { Choice } from '../src/core/operators/chat-completions/types';

// Example 1: Aggregating content chunks
async function aggregateContentExample() {
  console.log('Example 1: Aggregating content chunks\n');

  // Simulated streaming chunks from LLM
  const contentChunks: Choice[] = [
    { index: 0, delta: { content: 'The weather ' }, finish_reason: null },
    { index: 0, delta: { content: 'in San Francisco ' }, finish_reason: null },
    { index: 0, delta: { content: 'is sunny.' }, finish_reason: 'stop' },
  ];

  const aggregated = await from(contentChunks).pipe(aggregateChoice()).toPromise();

  console.log('Aggregated result:', JSON.stringify(aggregated, null, 2));
  // Output:
  // {
  //   "index": 0,
  //   "delta": {
  //     "content": "The weather in San Francisco is sunny."
  //   },
  //   "finish_reason": "stop"
  // }
}

// Example 2: Aggregating tool calls
async function aggregateToolCallsExample() {
  console.log('\n\nExample 2: Aggregating tool calls\n');

  // Simulated streaming chunks with tool calls
  const toolCallChunks: Choice[] = [
    {
      index: 0,
      delta: {
        tool_calls: [
          {
            index: 0,
            id: 'call_abc123',
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
            function: { name: '', arguments: '{"location":' },
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
            function: { name: '', arguments: '"San Francisco",' },
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
            function: { name: '', arguments: '"unit":"celsius"}' },
          },
        ],
      },
      finish_reason: 'tool_calls',
    },
  ];

  const aggregated = await from(toolCallChunks).pipe(aggregateChoice()).toPromise();

  console.log('Aggregated result:', JSON.stringify(aggregated, null, 2));
  // Output:
  // {
  //   "index": 0,
  //   "delta": {
  //     "tool_calls": [
  //       {
  //         "index": 0,
  //         "id": "call_abc123",
  //         "type": "function",
  //         "function": {
  //           "name": "get_weather",
  //           "arguments": "{\"location\":\"San Francisco\",\"unit\":\"celsius\"}"
  //         }
  //       }
  //     ]
  //   },
  //   "finish_reason": "tool_calls"
  // }
}

// Example 3: Multiple tool calls
async function multipleToolCallsExample() {
  console.log('\n\nExample 3: Multiple tool calls\n');

  const chunks: Choice[] = [
    {
      index: 0,
      delta: {
        tool_calls: [
          {
            index: 0,
            id: 'call_1',
            type: 'function',
            function: { name: 'get_weather', arguments: '{"loc' },
          },
          {
            index: 1,
            id: 'call_2',
            type: 'function',
            function: { name: 'get_time', arguments: '{"tz' },
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
            function: { name: '', arguments: 'ation":"NYC"}' },
          },
          {
            index: 1,
            id: null,
            type: 'function',
            function: { name: '', arguments: '":"America/New_York"}' },
          },
        ],
      },
      finish_reason: 'tool_calls',
    },
  ];

  const aggregated = await from(chunks).pipe(aggregateChoice()).toPromise();

  console.log('Aggregated result:', JSON.stringify(aggregated, null, 2));
  // Both tool calls are fully assembled
}

// Run all examples
async function main() {
  await aggregateContentExample();
  await aggregateToolCallsExample();
  await multipleToolCallsExample();
}

main().catch(console.error);
