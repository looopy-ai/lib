/**
 * LiteLLM Artifact Agent Example
 *
 * Demonstrates creating and streaming artifacts with A2A event emission using a real LLM.
 *
 * Prerequisites:
 * 1. Start LiteLLM proxy: `litellm --model gpt-3.5-turbo`
 * 2. Or use docker: `docker run -p 4000:4000 ghcr.io/berriai/litellm:main-latest`
 *
 * To run: tsx examples/litellm-artifacts-agent.ts
 */

import * as dotenv from 'dotenv';
import { Subject } from 'rxjs';
import { AgentLoop } from '../src/core/agent-loop';
import { createLogger } from '../src/core/logger';
import type { AgentEvent, ArtifactUpdateEvent } from '../src/core/types';
import { initializeTracing, shutdownTracing } from '../src/observability/tracing';
import { LiteLLM } from '../src/providers/litellm-provider';
import {
  ArtifactStoreWithEvents,
  SubjectEventEmitter,
} from '../src/stores/artifacts/artifact-store-with-events';
import { InMemoryArtifactStore } from '../src/stores/artifacts/memory-artifact-store';
import { InMemoryStateStore } from '../src/stores/memory/memory-state-store';
import { createArtifactTools } from '../src/tools/artifact-tools';
import { localTools } from '../src/tools/local-tools';
import { calculateTool, randomNumberTool } from './tools';

dotenv.config();

// Initialize OpenTelemetry tracing (optional - only if OTEL_ENABLED=true)
if (process.env.OTEL_ENABLED === 'true') {
  initializeTracing({
    serviceName: 'litellm-artifacts-agent-example',
    serviceVersion: '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    enabled: true,
  });
  console.log('✅ OpenTelemetry tracing enabled');
}

// Create logger for the example
const logger = createLogger({
  level: 'debug',
  pretty: true,
});

async function main() {
  console.log('🚀 LiteLLM Artifact Agent Example\n');
  console.log('='.repeat(70));

  // Configuration
  const LITELLM_URL = process.env.LITELLM_URL || 'http://localhost:4000';
  const LITELLM_API_KEY = process.env.LITELLM_API_KEY;

  console.log(`\n📡 LiteLLM URL: ${LITELLM_URL}`);
  console.log(`🔑 API Key: ${LITELLM_API_KEY ? '***' : 'none'}\n`);
  console.log('='.repeat(70));

  // Create LLM provider using factory
  const llmProvider = LiteLLM.novaLite(LITELLM_URL, LITELLM_API_KEY);

  // Or create custom provider for a more capable model:
  // const llmProvider = new LiteLLMProvider({
  //   baseUrl: LITELLM_URL,
  //   model: 'gpt-4',
  //   apiKey: LITELLM_API_KEY,
  //   temperature: 0.7,
  //   maxTokens: 2000,
  // });

  // Create stores
  const stateStore = new InMemoryStateStore();
  const baseArtifactStore = new InMemoryArtifactStore();

  // Create event emitter for A2A artifact events
  const artifactEventSubject = new Subject<ArtifactUpdateEvent>();
  const artifactStore = new ArtifactStoreWithEvents(
    baseArtifactStore,
    new SubjectEventEmitter(artifactEventSubject)
  );

  // Create tool providers
  const mathTools = localTools([calculateTool, randomNumberTool]);
  const artifactTools = createArtifactTools(artifactStore, stateStore);

  // Subscribe to artifact events
  console.log('📡 Listening for artifact-update events...\n');
  let artifactEventCount = 0;
  artifactEventSubject.subscribe((event) => {
    artifactEventCount++;
    console.log(`\n[Artifact ${artifactEventCount}] ✨ A2A Artifact Event:`);
    console.log(`    Kind: ${event.kind}`);
    console.log(`    Task ID: ${event.taskId}`);
    console.log(`    Artifact ID: ${event.artifact.artifactId}`);
    console.log(`    Artifact Name: ${event.artifact.name || '(unnamed)'}`);
    console.log(`    Append: ${event.append}`);
    console.log(`    Last Chunk: ${event.lastChunk}`);
    console.log(`    Parts: ${event.artifact.parts.length}`);

    // Show part content
    for (const part of event.artifact.parts) {
      if (part.kind === 'text') {
        const preview = part.text.length > 60 ? `${part.text.substring(0, 60)}...` : part.text;
        console.log(`    Text: "${preview}"`);
      }
    }
  });

  // Create agent with artifact support
  const agentLoop = new AgentLoop({
    agentId: 'artifact-assistant',
    llmProvider,
    toolProviders: [mathTools, artifactTools],
    stateStore,
    artifactStore,
    maxIterations: 10,
    systemPrompt: `You are a helpful assistant that can create and manage artifacts.

When the user asks you to create content like reports, documents, or data, use the artifact_update tool to create artifacts.
An artifact may have up to one part of each kind. Artifacts must not contain any commentary, they are for storing raw deliverables only.
Larger artifacts can be written in multiple chunks using append=true.

Available artifact tools:
- artifact_update: Create or update an artifact with content
- artifact_get: Retrieve an existing artifact
- artifact_list: List all artifacts

Artifacts can contain:
- Text content (markdown, code, etc.)
- File data (with MIME types)
- Structured data (JSON)

When creating artifacts:
1. ALWAYS use a unique, meaningful artifactId (e.g., "report-2025", "analysis-results", "facts-about-42")
2. Use the SAME artifactId when making multiple updates to the same artifact
3. Provide a descriptive name and description
4. Set append=false to replace all parts of an artifact; append=true to append parts to existing artifact
5. Set lastChunk=true on the final update

You also have math tools available: calculate and randomNumber.

You must perform any computations before writing results to an artifact.
`,
    logger,
  });

  // Example prompts to try
  const prompts = [
    'Create a markdown report about the benefits of reactive programming. Include sections for Introduction, Key Benefits, and Use Cases.',
    'Generate a random number and create an artifact containing a list of 5 facts about that number.',
    'Create a JSON artifact with the results of calculating 123 * 456 + 789.',
    'Write a typescript file that is a script that adds two numbers that are passed as arguments. Use the `commander` library to parse the arguments.',
  ];

  const selectedPrompt = prompts[Math.floor(Math.random() * prompts.length)];

  console.log(`\n💬 User: ${selectedPrompt}`);
  console.log('='.repeat(70));

  // Execute
  const events$ = agentLoop.execute(selectedPrompt);

  // Track events
  let eventCount = 0;

  // Helper functions to handle different event types
  function handleTaskEvent(event: { id: string; status: { state: string } }) {
    console.log(`    Task ID: ${event.id}`);
    console.log(`    Status: ${event.status.state}`);
  }

  function handleStatusUpdate(event: {
    status: { state: string; message?: { content: string } };
    final?: boolean;
  }) {
    console.log(`    Status: ${event.status.state}`);
    if (event.status.message) {
      const content =
        event.status.message.content.length > 100
          ? `${event.status.message.content.substring(0, 100)}...`
          : event.status.message.content;
      console.log(`    Message: ${content}`);
    }
    if (event.final) {
      console.log(`    ✅ FINAL EVENT`);
    }
  }

  function handleArtifactUpdate(event: {
    artifact: {
      artifactId: string;
      name?: string;
      parts: Array<{ kind: string; text?: string }>;
    };
  }) {
    console.log(`    Artifact: ${event.artifact.artifactId}`);
    console.log(`    Name: ${event.artifact.name || '(unnamed)'}`);
    if (event.artifact.parts.length > 0) {
      const part = event.artifact.parts[0];
      if (part.kind === 'text' && part.text) {
        const preview = part.text.length > 60 ? `${part.text.substring(0, 60)}...` : part.text;
        console.log(`    Content: ${preview}`);
      }
    }
  }

  function handleEvent(event: AgentEvent) {
    eventCount++;
    console.log(`\n[${eventCount}] 📡 Event: ${event.kind}`);

    if (event.kind === 'task') {
      handleTaskEvent(event);
    } else if (event.kind === 'status-update') {
      handleStatusUpdate(event);
    } else if (event.kind === 'artifact-update') {
      handleArtifactUpdate(event);
    } else if (event.kind.startsWith('internal:')) {
      console.log(`    [Internal - not sent over A2A]`);
    }
  }

  events$.subscribe({
    next: handleEvent,

    error: (error: Error) => {
      console.error('\n❌ Error:', error.message);
      console.error('\nTroubleshooting:');
      console.error('1. Is LiteLLM proxy running on', LITELLM_URL, '?');
      console.error('2. Start it with: litellm --model gpt-3.5-turbo');
      console.error('3. Or check your API key configuration');

      // Shutdown tracing if enabled
      if (process.env.OTEL_ENABLED === 'true') {
        shutdownTracing().catch((err) => console.error('Error shutting down tracing:', err));
      }
    },

    complete: () => {
      console.log(`\n${'='.repeat(70)}`);
      console.log(`✅ Completed! Total events: ${eventCount}`);
      console.log(`✨ Artifact events: ${artifactEventCount}`);
      console.log('='.repeat(70));

      // Show final artifacts
      console.log('\n📦 Final Artifacts:');
      const allArtifacts = baseArtifactStore.getAll();

      if (allArtifacts.length === 0) {
        console.log('   (No artifacts created)');
      } else {
        showArtifacts(allArtifacts, baseArtifactStore);
      }

      // Shutdown tracing if enabled
      if (process.env.OTEL_ENABLED === 'true') {
        setTimeout(() => {
          shutdownTracing()
            .then(() => console.log('✅ Tracing shutdown complete'))
            .catch((err) => console.error('Error shutting down tracing:', err));
        }, 500);
      }
    },
  });
}

// Helper function to display artifacts
function showArtifacts(
  artifacts: Array<{
    artifactId: string;
    name?: string;
    status: string;
    totalParts: number;
    version: number;
  }>,
  store: InMemoryArtifactStore
) {
  for (const artifact of artifacts) {
    console.log(`\n   📄 Artifact: ${artifact.name || artifact.artifactId}`);
    console.log(`      ID: ${artifact.artifactId}`);
    console.log(`      Status: ${artifact.status}`);
    console.log(`      Parts: ${artifact.totalParts}`);
    console.log(`      Version: ${artifact.version}`);

    // Show content
    showArtifactContent(store, artifact.artifactId);
  }
}

// Helper function to display artifact content
function showArtifactContent(store: InMemoryArtifactStore, artifactId: string) {
  store
    .getArtifactContent(artifactId)
    .then((content) => {
      if (!content) return;

      const contentStr = typeof content === 'string' ? content : JSON.stringify(content);
      console.log(`      Content:\n${contentStr}\n`);
    })
    .catch((err) => console.error('Error getting artifact content:', err));
}

// Run the example
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
