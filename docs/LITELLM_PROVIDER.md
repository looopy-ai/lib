# LiteLLM Provider

A production-ready LLM provider implementation for the Looopy framework using [LiteLLM](https://docs.litellm.ai/).

## Features

- ✅ **100+ LLM Support** - Works with OpenAI, Anthropic, Cohere, Azure, Bedrock, and more
- ✅ **Unified Interface** - Single API for all providers
- ✅ **Tool Calling** - Full support for function/tool calls
- ✅ **Type-Safe** - Complete TypeScript types
- ✅ **Observable-Based** - RxJS integration
- ✅ **Configurable** - Temperature, max tokens, timeouts, etc.
- ✅ **Factory Methods** - Pre-configured for popular models

## Installation

```bash
pnpm install rxjs
```

## Quick Start

### 1. Start LiteLLM Proxy

**Option A: Using pip**
```bash
pip install litellm
litellm --model gpt-3.5-turbo
```

**Option B: Using Docker**
```bash
docker run -p 4000:4000 -e OPENAI_API_KEY=$OPENAI_API_KEY \
  ghcr.io/berriai/litellm:main-latest
```

**Option C: With config file**
```bash
litellm --config litellm_config.yaml
```

### 2. Use in Your Agent

```typescript
import { AgentLoop } from './src/core/agent-loop';
import { LiteLLM } from './src/providers/litellm-provider';
import { InMemoryStateStore } from './src/stores/memory/memory-state-store';

// Create LLM provider
const llmProvider = LiteLLM.gpt35Turbo('http://localhost:4000');

// Create agent
const agent = new AgentLoop({
  agentId: 'my-agent',
  llmProvider,
  toolProviders: [],
  taskStateStore: new InMemoryStateStore(),
  artifactStore: myArtifactStore,
});

// Execute
const events$ = agent.execute('Hello!');
events$.subscribe({
  next: (event) => console.log('Event:', event.kind),
  complete: () => console.log('Done!'),
});
```

## Factory Methods

Pre-configured providers for popular models:

### OpenAI

```typescript
import { LiteLLM } from './src/providers/litellm-provider';

// GPT-4
const provider = LiteLLM.gpt4('http://localhost:4000', apiKey);

// GPT-4 Turbo
const provider = LiteLLM.gpt4Turbo('http://localhost:4000', apiKey);

// GPT-3.5 Turbo
const provider = LiteLLM.gpt35Turbo('http://localhost:4000', apiKey);
```

### Anthropic Claude

```typescript
// Claude 3 Opus
const provider = LiteLLM.claude3Opus('http://localhost:4000', apiKey);

// Claude 3 Sonnet
const provider = LiteLLM.claude3Sonnet('http://localhost:4000', apiKey);

// Claude 3 Haiku
const provider = LiteLLM.claude3Haiku('http://localhost:4000', apiKey);
```

### Local Models (Ollama)

```typescript
// Llama 2
const provider = LiteLLM.ollama('http://localhost:4000', 'llama2');

// Mistral
const provider = LiteLLM.ollama('http://localhost:4000', 'mistral');

// CodeLlama
const provider = LiteLLM.ollama('http://localhost:4000', 'codellama');
```

## Custom Configuration

For full control, use the `LiteLLMProvider` class directly:

```typescript
import { LiteLLMProvider } from './src/providers/litellm-provider';

const provider = new LiteLLMProvider({
  baseUrl: 'http://localhost:4000',
  model: 'gpt-4',
  apiKey: process.env.OPENAI_API_KEY,
  temperature: 0.7,
  maxTokens: 2000,
  topP: 0.9,
  timeout: 30000, // 30 seconds
  extraParams: {
    // Any additional LiteLLM parameters
    presence_penalty: 0.1,
    frequency_penalty: 0.1,
  },
});
```

## Configuration Options

| Option        | Type     | Default | Description                       |
| ------------- | -------- | ------- | --------------------------------- |
| `baseUrl`     | `string` | -       | LiteLLM proxy URL (required)      |
| `model`       | `string` | -       | Model name (required)             |
| `apiKey`      | `string` | -       | API key (optional if using proxy) |
| `temperature` | `number` | `0.7`   | Sampling temperature (0-2)        |
| `maxTokens`   | `number` | `4096`  | Maximum tokens to generate        |
| `topP`        | `number` | `1.0`   | Top-p sampling                    |
| `timeout`     | `number` | `60000` | Request timeout in milliseconds   |
| `extraParams` | `object` | `{}`    | Additional LiteLLM parameters     |

## Environment Variables

Set environment variables for convenience:

```bash
export LITELLM_URL=http://localhost:4000
export LITELLM_API_KEY=sk-...
```

Then use in code:

```typescript
const provider = LiteLLM.gpt4(
  process.env.LITELLM_URL!,
  process.env.LITELLM_API_KEY
);
```

## Tool Calling

The provider automatically handles tool/function calls:

```typescript
const tools: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'get_weather',
      description: 'Get weather for a location',
      parameters: {
        type: 'object',
        properties: {
          location: { type: 'string' },
        },
        required: ['location'],
      },
    },
  },
];

// The provider will include tools in the request
const response$ = provider.call({
  messages: [{ role: 'user', content: 'What is the weather in NYC?' }],
  tools,
});
```

## Session Tracking

The provider supports passing a session ID for tracking and observability:

```typescript
const response$ = provider.call({
  messages: [{ role: 'user', content: 'Hello!' }],
  sessionId: 'task-123', // Passed to LiteLLM for tracking
});
```

**When using with AgentLoop**, the taskId is automatically passed as the session ID:

```typescript
const agent = new AgentLoop({
  llmProvider: provider,
  // ... other config
});

// This will automatically pass taskId to LiteLLM as session_id
const events$ = agent.execute('Calculate 42 * 58');
```

LiteLLM will include the session ID in its logs and analytics, making it easy to:
- Track requests by task
- Debug issues in production
- Analyze cost per task
- Monitor performance by session

## Error Handling

The provider handles various error scenarios:

```typescript
events$.subscribe({
  next: (event) => {
    // Handle events
  },
  error: (error) => {
    if (error.message.includes('timeout')) {
      console.error('Request timed out');
    } else if (error.message.includes('API error')) {
      console.error('LiteLLM API error:', error.message);
    } else {
      console.error('Unknown error:', error.message);
    }
  },
});
```

## Running the Example

```bash
# Start LiteLLM proxy first
litellm --model gpt-3.5-turbo

# Run the example
pnpm example:litellm
```

## Example Output

```
🚀 LiteLLM Agent Example

======================================================================

📡 LiteLLM URL: http://localhost:4000
🔑 API Key: none

======================================================================

💬 User: Calculate 15 * 23 + 47
======================================================================

[1] 📡 Event: task
    Task ID: task_1730000000000_abc123
    Status: submitted

[2] 📡 Event: status-update
    Status: working

🔧 Executing: calculate
   Arguments: { expression: '15 * 23 + 47' }
   Result: 392

[3] 📡 Event: status-update
    Status: completed
    Message: The result of 15 × 23 + 47 is 392.
    ✅ FINAL EVENT

======================================================================
✅ Completed! Total events: 3
======================================================================
```

## Supported Models

LiteLLM supports 100+ models. Common examples:

**OpenAI**
- `gpt-4`, `gpt-4-turbo-preview`, `gpt-4-32k`
- `gpt-3.5-turbo`, `gpt-3.5-turbo-16k`

**Anthropic**
- `claude-3-opus-20240229`
- `claude-3-sonnet-20240229`
- `claude-3-haiku-20240307`
- `claude-2.1`, `claude-instant-1.2`

**Google**
- `gemini-pro`, `gemini-pro-vision`
- `palm/chat-bison`

**Cohere**
- `command-r-plus`, `command-r`
- `command`, `command-light`

**Local (Ollama)**
- `ollama/llama2`, `ollama/mistral`
- `ollama/codellama`, `ollama/neural-chat`

**Azure OpenAI**
- `azure/gpt-4`, `azure/gpt-35-turbo`

**AWS Bedrock**
- `bedrock/claude-3-opus`
- `bedrock/titan-text-express`

See [LiteLLM docs](https://docs.litellm.ai/docs/providers) for the complete list.

## LiteLLM Configuration File

For production, use a config file:

```yaml
# litellm_config.yaml
model_list:
  - model_name: gpt-4
    litellm_params:
      model: gpt-4
      api_key: sk-...

  - model_name: claude-3-opus
    litellm_params:
      model: claude-3-opus-20240229
      api_key: sk-ant-...

router_settings:
  routing_strategy: simple-shuffle
  num_retries: 3
```

Start with config:
```bash
litellm --config litellm_config.yaml
```

## Advanced Usage

### Dynamic Model Selection

```typescript
const provider = new LiteLLMProvider({
  baseUrl: 'http://localhost:4000',
  model: 'gpt-3.5-turbo',
});

// Switch models at runtime
provider.updateConfig({ model: 'gpt-4' });
```

### Custom Timeout

```typescript
const provider = new LiteLLMProvider({
  baseUrl: 'http://localhost:4000',
  model: 'gpt-4',
  timeout: 120000, // 2 minutes for long responses
});
```

### Lower Temperature for Deterministic Output

```typescript
const provider = new LiteLLMProvider({
  baseUrl: 'http://localhost:4000',
  model: 'gpt-4',
  temperature: 0.1, // More deterministic
});
```

## Observability

The LiteLLM provider automatically includes metadata for observability platforms like Langfuse:

### Model Information

The provider returns the actual model used in the response:
```typescript
{
  message: { role: "assistant", content: "..." },
  model: "gpt-4-0613", // Actual model version from response
  // ...
}
```

This enables:
- **Cost tracking** by exact model version
- **Performance comparison** across model versions
- **Debugging** with precise model identification

### Token Usage

The provider returns detailed token usage:
```typescript
{
  message: { role: "assistant", content: "..." },
  usage: {
    promptTokens: 150,      // Input tokens
    completionTokens: 75,   // Output tokens
    totalTokens: 225        // Total
  }
}
```

This enables:
- **Cost calculation** in Langfuse
- **Usage analytics** and optimization
- **Budget monitoring** per task/agent

### Tracing Integration

When used with OpenTelemetry tracing (see [OBSERVABILITY.md](./OBSERVABILITY.md)), LLM calls are automatically traced with:

- `langfuse.observation.type = "generation"` - Marks as LLM generation in Langfuse
- `gen_ai.system` - Provider name (from model identifier)
- `gen_ai.request.model` - Model requested
- `gen_ai.response.model` - Actual model used
- `gen_ai.prompt` - Full conversation history
- `gen_ai.completion` - LLM response
- Token counts for cost tracking

**Example in Langfuse UI:**
```
agent.execute (span)
└── agent.iteration (span)
    ├── llm.call (generation) ← Shows in "Generations" view
    │   Model: gpt-4-0613
    │   Tokens: 150 → 75 (225 total)
    │   Cost: $0.0068
    └── tool.execute (span)
```

## Troubleshooting

### Connection Refused

```
Error: LiteLLM API error: ECONNREFUSED
```

**Solution**: Ensure LiteLLM proxy is running:
```bash
litellm --model gpt-3.5-turbo --port 4000
```

### Timeout Errors

```
Error: LiteLLM request timeout after 60000ms
```

**Solution**: Increase timeout:
```typescript
const provider = new LiteLLMProvider({
  // ...
  timeout: 120000, // 2 minutes
});
```

### Authentication Errors

```
Error: LiteLLM API error: 401 Unauthorized
```

**Solution**: Set API key:
```typescript
const provider = LiteLLM.gpt4(
  'http://localhost:4000',
  process.env.OPENAI_API_KEY
);
```

## References

- [LiteLLM Documentation](https://docs.litellm.ai/)
- [LiteLLM GitHub](https://github.com/BerriAI/litellm)
- [Supported Providers](https://docs.litellm.ai/docs/providers)
- [Agent Loop Design](../design/agent-loop.md)
