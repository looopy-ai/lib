/**
 * Artifact Agent Example
 *
 * Demonstrates creating and streaming artifacts with A2A event emission.
 *
 * To run: tsx examples/artifacts-agent.ts
 */

import { type Observable, of, Subject } from 'rxjs';
import { AgentLoop } from '../src/core/agent-loop';
import type {
  AgentEvent,
  ArtifactUpdateEvent,
  LLMProvider,
  LLMResponse,
  Message,
  ToolDefinition,
} from '../src/core/types';
import {
  ArtifactStoreWithEvents,
  SubjectEventEmitter,
} from '../src/stores/artifacts/artifact-store-with-events';
import { InMemoryArtifactStore } from '../src/stores/artifacts/memory-artifact-store';
import { InMemoryStateStore } from '../src/stores/memory/memory-state-store';
import { createArtifactTools } from '../src/tools/artifact-tools';

// Simple LLM Provider that creates artifacts
class ArtifactLLMProvider implements LLMProvider {
  call(request: { messages: Message[]; tools?: ToolDefinition[] }): Observable<LLMResponse> {
    const lastMessage = request.messages[request.messages.length - 1];

    console.log('\n🤖 LLM Thinking...');
    console.log('   User:', lastMessage.content);

    // Simulate LLM deciding to create an artifact
    if (lastMessage.role === 'user' && lastMessage.content.toLowerCase().includes('create')) {
      return of({
        message: {
          role: 'assistant',
          content: 'I will create an artifact for you.',
        },
        toolCalls: [
          {
            id: `call_${Date.now()}`,
            type: 'function',
            function: {
              name: 'artifact_update',
              arguments: {
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
              },
            },
          },
        ],
        finished: false,
        finishReason: 'tool_calls',
      });
    }

    // After creating, check for the artifact tool result (but only on first call)
    const toolMessages = request.messages.filter((m) => m.role === 'tool');
    const hasArtifactTool = toolMessages.some((m) => m.content.includes('artifactId'));

    if (hasArtifactTool && lastMessage.role === 'tool' && toolMessages.length === 1) {
      // Extract the actual artifactId from the tool result
      const toolResult = JSON.parse(lastMessage.content);
      const actualArtifactId = toolResult.artifactId;

      return of({
        message: {
          role: 'assistant',
          content: 'Adding more content to the artifact.',
        },
        toolCalls: [
          {
            id: `call_${Date.now()}_2`,
            type: 'function',
            function: {
              name: 'artifact_update',
              arguments: {
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
              },
            },
          },
        ],
        finished: false,
        finishReason: 'tool_calls',
      });
    }

    // Final response
    return of({
      message: {
        role: 'assistant',
        content: 'I have created the report artifact with sample content.',
      },
      finished: true,
      finishReason: 'stop',
    });
  }
}

async function main() {
  console.log('🚀 Artifact Agent Example\n');

  // Create stores
  const stateStore = new InMemoryStateStore();
  const baseArtifactStore = new InMemoryArtifactStore();

  // Create event emitter for A2A events
  const eventSubject = new Subject<ArtifactUpdateEvent>();
  const artifactStore = new ArtifactStoreWithEvents(
    baseArtifactStore,
    new SubjectEventEmitter(eventSubject)
  );

  // Subscribe to artifact events
  console.log('📡 Listening for artifact-update events...\n');
  eventSubject.subscribe((event) => {
    console.log('\n✨ A2A Event Received:');
    console.log('   Kind:', event.kind);
    console.log('   Task ID:', event.taskId);
    console.log('   Artifact ID:', event.artifact.artifactId);
    console.log('   Artifact Name:', event.artifact.name || '(unnamed)');
    console.log('   Append:', event.append);
    console.log('   Last Chunk:', event.lastChunk);
    console.log('   Parts:', event.artifact.parts.length);

    // Show part content
    for (const part of event.artifact.parts) {
      if (part.kind === 'text') {
        console.log(
          `   Text: "${part.text.substring(0, 50)}${part.text.length > 50 ? '...' : ''}"`
        );
      }
    }
    console.log();
  });

  // Create artifact tools
  const artifactTools = createArtifactTools(artifactStore, stateStore);

  // Create agent with artifact support
  const agent = new AgentLoop({
    stateStore,
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
    messages: [{ role: 'user', content: 'Create a sample report with sections' }],
  });

  // Subscribe to execution events
  return new Promise<void>((resolve, reject) => {
    result$.subscribe({
      next: (event: AgentEvent) => {
        if (event.kind === 'task') {
          console.log('✅ Task started:', event.id);
        } else if (event.kind === 'status-update') {
          console.log('📊 Status:', event.status.state);
          if (event.final) {
            console.log('✅ Task completed!');
          }
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
        console.log('\n🎉 Agent execution complete!\n');

        // Show final artifacts
        console.log('📦 Final Artifacts:');
        const allArtifacts = baseArtifactStore.getAll();
        for (const artifact of allArtifacts) {
          console.log(`\n   Artifact: ${artifact.name || artifact.artifactId}`);
          console.log(`   Status: ${artifact.status}`);
          console.log(`   Parts: ${artifact.totalParts}`);
          console.log(`   Version: ${artifact.version}`);

          // Show content
          baseArtifactStore.getArtifactContent(artifact.artifactId).then((content) => {
            console.log(`   Content:\n${content}\n`);
          });
        }

        setTimeout(resolve, 100); // Wait for async logs
      },
    });
  });
}

// Run example
main().catch(console.error);
