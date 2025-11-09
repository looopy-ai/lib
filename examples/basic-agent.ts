/**
 * Agent Loop Example
 *
 * Demonstrates basic usage of the agent loop with a simple weather assistant.
 *
 * To run: tsx examples/basic-agent.ts
 */

import { type Observable, of } from 'rxjs';
import { AgentLoop } from '../src/core/agent-loop';
import type { LLMProvider, Message, ToolDefinition } from '../src/core/types';
import type { AnyEvent, LLMEvent } from '../src/events/types';
import { InMemoryArtifactStore } from '../src/stores/artifacts/memory-artifact-store';
import { InMemoryStateStore } from '../src/stores/memory/memory-state-store';
import { localTools } from '../src/tools/local-tools';
import { weatherTool } from './tools';

// Simple LLM Provider that simulates OpenAI-style responses
class SimpleLLMProvider implements LLMProvider {
  call(request: { messages: Message[]; tools?: ToolDefinition[] }): Observable<LLMEvent<AnyEvent>> {
    const lastMessage = request.messages[request.messages.length - 1];

    console.log('\n🤖 LLM Thinking...');
    console.log('   User:', lastMessage.content);

    // Simulate LLM deciding to use tools
    if (lastMessage.role === 'user' && lastMessage.content.toLowerCase().includes('weather')) {
      // Extract location from message
      const locationMatch = lastMessage.content.match(/in\s+([A-Za-z\s]+)/i);
      const location = locationMatch ? locationMatch[1].trim() : 'San Francisco';

      return of({
        kind: 'content-complete',
        content: `Let me check the weather in ${location}.`,
        toolCalls: [
          {
            id: `call_${Date.now()}`,
            type: 'function',
            function: {
              name: 'get_weather',
              arguments: JSON.stringify({ location }),
            },
          },
        ],
        timestamp: new Date().toISOString(),
      } as LLMEvent<AnyEvent>);
    }

    // Check if this is after a tool call
    const hasToolResults = request.messages.some((m) => m.role === 'tool');
    if (hasToolResults) {
      const toolMessage = request.messages.filter((m) => m.role === 'tool').pop();

      if (toolMessage?.content) {
        try {
          const result = JSON.parse(toolMessage.content);
          if (result?.location) {
            return of({
              kind: 'content-complete',
              content: `The weather in ${result.location} is ${result.temperature}°F and ${result.condition}. ${result.condition === 'sunny' ? '☀️' : result.condition === 'rainy' ? '🌧️' : '☁️'}`,
              timestamp: new Date().toISOString(),
            } as LLMEvent<AnyEvent>);
          }
        } catch (error) {
          console.error('Failed to parse tool result:', error);
        }
      }
    }

    // Default response
    return of({
      kind: 'content-complete',
      content: "I'm a weather assistant. Ask me about the weather in any city!",
      timestamp: new Date().toISOString(),
    } as LLMEvent<AnyEvent>);
  }
}

// Main example function
async function main() {
  console.log('🚀 Agent Loop Example - Weather Assistant\n');
  console.log('='.repeat(60));

  // Create agent loop configuration
  const agentLoop = new AgentLoop({
    agentId: 'weather-assistant',
    llmProvider: new SimpleLLMProvider(),
    toolProviders: [localTools([weatherTool])],
    taskStateStore: new InMemoryStateStore(),
    artifactStore: new InMemoryArtifactStore(),
    maxIterations: 10,
    enableCheckpoints: true,
    checkpointInterval: 2,
  });

  // Execute with a weather query
  const prompt = 'What is the weather like in Seattle?';

  console.log('\n📝 User Prompt:', prompt);
  console.log('='.repeat(60));

  const events$ = agentLoop.execute({
    agentId: 'basic-agent',
    contextId: `ctx_${Date.now()}`,
    messages: [{ role: 'user', content: prompt }],
  });

  // Subscribe to events
  events$.subscribe({
    next: (event) => {
      console.log('\n📡 Event:', event.kind);

      switch (event.kind) {
        case 'task-created':
          console.log('   Task ID:', event.taskId);
          console.log('   Context ID:', event.contextId);
          console.log('   Initiator:', event.initiator);
          break;

        case 'task-status':
          console.log('   Task ID:', event.taskId);
          console.log('   Status:', event.status);
          break;

        case 'task-complete':
          console.log('   Task ID:', event.taskId);
          if (event.content) {
            console.log('   Final Content:', event.content);
          }
          if (event.artifacts && event.artifacts.length > 0) {
            console.log('   Artifacts:', event.artifacts.length);
          }
          console.log('   ✅ TASK COMPLETE');
          break;

        case 'content-delta':
          console.log('   Delta:', event.delta);
          console.log('   Index:', event.index);
          break;

        case 'content-complete':
          console.log('   Content:', event.content);
          if (event.toolCalls && event.toolCalls.length > 0) {
            console.log('   Tool Calls:', event.toolCalls.length);
          }
          break;

        case 'tool-start':
          console.log('   Tool:', event.toolName);
          console.log('   Call ID:', event.toolCallId);
          break;

        case 'tool-complete':
          console.log('   Tool:', event.toolName);
          console.log('   Success:', event.success);
          if (event.result) {
            console.log('   Result:', JSON.stringify(event.result));
          }
          break;

        default:
          if (event.kind.startsWith('internal:')) {
            console.log('   [Internal observability event]');
          }
      }
    },
    error: (error) => {
      console.error('\n❌ Error:', error.message);
    },
    complete: () => {
      console.log(`\n${'='.repeat(60)}`);
      console.log('✅ Agent Loop Completed!');
      console.log('='.repeat(60));
    },
  });
}

// Run the example
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
