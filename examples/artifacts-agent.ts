/**
 * Artifact Agent Example
 *
 * Demonstrates creating and streaming artifacts with A2A event emission.
 *
 * To run: tsx examples/artifacts-agent.ts
 */

import { context } from '@opentelemetry/api';
import { type Observable, of } from 'rxjs';
import { AgentLoop } from '../src/core/agent-loop';
import type { LLMProvider, Message, ToolDefinition } from '../src/core/types';
import type { AnyEvent, LLMEvent } from '../src/events/types';
import { InMemoryArtifactStore } from '../src/stores/artifacts/memory-artifact-store';
import { InMemoryStateStore } from '../src/stores/memory/memory-state-store';
import { createArtifactTools } from '../src/tools/artifact-tools';

// Simple LLM Provider that creates artifacts
class ArtifactLLMProvider implements LLMProvider {
  call(request: { messages: Message[]; tools?: ToolDefinition[] }): Observable<LLMEvent<AnyEvent>> {
    const lastMessage = request.messages[request.messages.length - 1];

    console.log('\n🤖 LLM Thinking...');
    console.log('   User:', lastMessage.content);

    // Simulate LLM deciding to create an artifact
    if (lastMessage.role === 'user' && lastMessage.content.toLowerCase().includes('create')) {
      return of({
        kind: 'content-complete',
        content: 'I will create an artifact for you.',
        toolCalls: [
          {
            id: `call_${Date.now()}`,
            type: 'function',
            function: {
              name: 'artifact_update',
              arguments: JSON.stringify({
                artifact: {
                  artifactId: 'report-1',
                  name: 'Sample Report',
                  description: 'A sample report with multiple parts',
                  parts: [
                    {
                      kind: 'text',
                      text: '# Sample Report\n\n',
                    },
                  ],
                },
                append: false,
                lastChunk: false,
              }),
            },
          },
        ],
        timestamp: new Date().toISOString(),
      } as LLMEvent<AnyEvent>);
    }

    // After creating, check for the artifact tool result (but only on first call)
    const toolMessages = request.messages.filter((m) => m.role === 'tool');
    const hasArtifactTool = toolMessages.some((m) => m.content.includes('artifactId'));

    if (hasArtifactTool && lastMessage.role === 'tool' && toolMessages.length === 1) {
      // Extract the actual artifactId from the tool result
      const toolResult = JSON.parse(lastMessage.content);
      const actualArtifactId = toolResult.artifactId;

      return of({
        kind: 'content-complete',
        content: 'Adding more content to the artifact.',
        toolCalls: [
          {
            id: `call_${Date.now()}_2`,
            type: 'function',
            function: {
              name: 'artifact_update',
              arguments: JSON.stringify({
                artifact: {
                  artifactId: actualArtifactId,
                  parts: [
                    {
                      kind: 'text',
                      text: '## Summary\n\nThis is a sample report created by the agent.\n\n',
                    },
                  ],
                },
                append: true,
                lastChunk: true,
              }),
            },
          },
        ],
        timestamp: new Date().toISOString(),
      } as LLMEvent<AnyEvent>);
    }

    // Final response
    return of({
      kind: 'content-complete',
      content: 'I have created the report artifact with sample content.',
      timestamp: new Date().toISOString(),
    } as LLMEvent<AnyEvent>);
  }
}

async function main() {
  console.log('🚀 Artifact Agent Example\n');

  // Create stores
  const taskStateStore = new InMemoryStateStore();
  const artifactStore = new InMemoryArtifactStore();

  // Create artifact tools
  const artifactTools = createArtifactTools(artifactStore, taskStateStore);

  // Create agent with artifact support
  const agent = new AgentLoop({
    taskStateStore,
    artifactStore,
    llmProvider: new ArtifactLLMProvider(),
    toolProviders: [artifactTools],
    agentId: 'artifact-agent',
    systemPrompt: 'You are a helpful assistant that creates artifacts.',
    maxIterations: 5,
  });

  // Execute agent
  console.log('📝 Task: Create a sample report\n');
  const result$ = agent.execute({
    agentId: 'artifact-agent',
    contextId: 'example-context',
    taskId: `task_${Date.now()}`,
    messages: [{ role: 'user', content: 'Create a sample report with sections' }],
    parentContext: context.active(),
  });

  // Subscribe to execution events
  return new Promise<void>((resolve, reject) => {
    result$.subscribe({
      next: (event: AnyEvent) => {
        if (event.kind === 'task-created') {
          console.log('✅ Task started:', event.taskId);
        } else if (event.kind === 'task-status') {
          console.log('📊 Status:', event.status);
        } else if (event.kind === 'task-complete') {
          console.log('✅ Task completed!');
        } else if (event.kind === 'content-complete') {
          console.log('📝 Content:', `${event.content.substring(0, 60)}...`);
        } else if (event.kind === 'tool-complete') {
          console.log(`🔧 Tool "${event.toolName}" completed:`, event.success ? '✓' : '✗');
        } else if (event.kind.startsWith('internal:')) {
          // Log internal events
          console.log(`🔍 ${event.kind}`);
        }
      },
      error: (err: Error) => {
        console.error('❌ Error:', err);
        reject(err);
      },
      complete: () => {
        console.log('\n🎉 Agent execution complete!');
        console.log('\n📦 Artifacts created during execution');
        console.log('   (Use artifact store methods to retrieve artifacts)');
        setTimeout(resolve, 100); // Wait for async logs
      },
    });
  });
}

// Run example
main().catch(console.error);
