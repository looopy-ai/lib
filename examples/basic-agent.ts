/**
 * Agent Loop Example
 *
 * Demonstrates basic usage of the agent loop with a simple weather assistant.
 *
 * To run: tsx examples/basic-agent.ts
 */

import { type Observable, of } from 'rxjs';
import { AgentLoop } from '../src/core/agent-loop';
import type { LLMProvider, LLMResponse, Message, ToolDefinition } from '../src/core/types';
import { InMemoryArtifactStore } from '../src/stores/artifacts/memory-artifact-store';
import { InMemoryStateStore } from '../src/stores/memory/memory-state-store';
import { localTools } from '../src/tools/local-tools';
import { weatherTool } from './tools';

// Simple LLM Provider that simulates OpenAI-style responses
class SimpleLLMProvider implements LLMProvider {
  call(request: { messages: Message[]; tools?: ToolDefinition[] }): Observable<LLMResponse> {
    const lastMessage = request.messages[request.messages.length - 1];

    console.log('\n🤖 LLM Thinking...');
    console.log('   User:', lastMessage.content);

    // Simulate LLM deciding to use tools
    if (lastMessage.role === 'user' && lastMessage.content.toLowerCase().includes('weather')) {
      // Extract location from message
      const locationMatch = lastMessage.content.match(/in\s+([A-Za-z\s]+)/i);
      const location = locationMatch ? locationMatch[1].trim() : 'San Francisco';

      return of({
        message: {
          role: 'assistant',
          content: `Let me check the weather in ${location}.`,
        },
        toolCalls: [
          {
            id: `call_${Date.now()}`,
            type: 'function',
            function: {
              name: 'get_weather',
              arguments: { location },
            },
          },
        ],
        finished: false,
        finishReason: 'tool_calls',
      });
    }

    // Check if this is after a tool call
    const hasToolResults = request.messages.some((m) => m.role === 'tool');
    if (hasToolResults) {
      const toolMessage = request.messages.filter((m) => m.role === 'tool').pop();

      if (toolMessage) {
        const result = JSON.parse(toolMessage.content);
        return of({
          message: {
            role: 'assistant',
            content: `The weather in ${result.location} is ${result.temperature}°F and ${result.condition}. ${result.condition === 'sunny' ? '☀️' : result.condition === 'rainy' ? '🌧️' : '☁️'}`,
          },
          finished: true,
          finishReason: 'stop',
        });
      }
    }

    // Default response
    return of({
      message: {
        role: 'assistant',
        content: "I'm a weather assistant. Ask me about the weather in any city!",
      },
      finished: true,
      finishReason: 'stop',
    });
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
    stateStore: new InMemoryStateStore(),
    artifactStore: new InMemoryArtifactStore(),
    maxIterations: 10,
    enableCheckpoints: true,
    checkpointInterval: 2,
  });

  // Execute with a weather query
  const prompt = 'What is the weather like in Seattle?';

  console.log('\n📝 User Prompt:', prompt);
  console.log('='.repeat(60));

  const events$ = agentLoop.execute(prompt);

  // Subscribe to events
  events$.subscribe({
    next: (event) => {
      console.log('\n📡 Event:', event.kind);

      switch (event.kind) {
        case 'task':
          console.log('   Task ID:', event.id);
          console.log('   Context ID:', event.contextId);
          console.log('   Status:', event.status.state);
          break;

        case 'status-update':
          console.log('   Task ID:', event.taskId);
          console.log('   Status:', event.status.state);
          if (event.status.message) {
            console.log('   Message:', event.status.message.content);
          }
          if (event.final) {
            console.log('   ✅ FINAL EVENT');
          }
          break;

        case 'artifact-update':
          console.log('   Artifact ID:', event.artifact.artifactId);
          console.log('   Parts:', event.artifact.parts.length);
          console.log('   Append:', event.append);
          console.log('   Last Chunk:', event.lastChunk);
          break;

        default:
          if (event.kind.startsWith('internal:')) {
            console.log('   [Internal event - not sent over A2A]', JSON.stringify(event));
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
