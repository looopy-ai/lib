/**
 * Example: LiteLLM Provider with New Aggregation Pipeline
 *
 * This demonstrates how the LiteLLM provider now uses the
 * aggregateChoice operator internally, making the code cleaner
 * and more maintainable.
 */

import { LiteLLMProvider } from '../src/providers/litellm-provider';

// Before: Manual accumulation (100+ lines of complex logic)
// - Manual content concatenation
// - Manual tool call assembly by index
// - Manual state tracking
// - Error-prone edge cases

// After: Using aggregateChoice operator
// - ~40 lines total
// - Declarative RxJS pipeline
// - All complexity handled by tested operator
// - Clean separation of concerns

async function example() {
  const provider = new LiteLLMProvider({
    baseUrl: 'http://localhost:4000',
    model: 'gpt-4',
  });

  // The streaming implementation is now much simpler:
  // 1. createSSEStream() - parses SSE events
  // 2. map() - converts LiteLLM format to Choice format
  // 3. aggregateChoice() - handles all accumulation logic
  // 4. map() - converts to LLMResponse format

  const response$ = provider.call({
    messages: [
      {
        role: 'user',
        content: 'What is the weather in San Francisco?',
      },
    ],
    tools: [
      {
        name: 'get_weather',
        description: 'Get the weather for a location',
        parameters: {
          type: 'object',
          properties: {
            location: { type: 'string' },
          },
          required: ['location'],
        },
      },
    ],
    stream: true,
  });

  response$.subscribe({
    next: (response) => {
      if (response.finished) {
        console.log('Final response:', response.message);
        console.log('Tool calls:', response.toolCalls);
      }
    },
    complete: () => console.log('Stream complete'),
    error: (err) => console.error('Error:', err),
  });
}

// Run if executed directly
if (require.main === module) {
  example().catch(console.error);
}
