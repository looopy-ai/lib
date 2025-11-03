# Running Tests and Examples

## Setup

Install dependencies:

```bash
pnpm install
```

## Running Tests

Run all tests:
```bash
pnpm test
```

Run tests in watch mode:
```bash
pnpm test:watch
```

Run tests with coverage:
```bash
pnpm test:coverage
```

## Running the Example

Run the basic agent example:
```bash
pnpm example
```

This will run a simple weather assistant that demonstrates:
- LLM interaction
- Tool calling (weather API)
- Event streaming
- A2A protocol-compliant events

## Test Coverage

The test suite covers:

### Basic Execution
- ✅ Simple completion without tools
- ✅ A2A-compliant event emission
- ✅ Event structure validation

### Tool Execution
- ✅ Single tool call execution
- ✅ Multiple tool calls
- ✅ Tool error handling

### Checkpointing
- ✅ Periodic state checkpointing
- ✅ Resume from checkpoint
- ✅ Resume completed tasks

### Error Handling
- ✅ LLM execution errors
- ✅ Max iteration limits
- ✅ Error event emission

### Context Propagation
- ✅ Trace context propagation
- ✅ Auth context propagation

## Example Output

When you run `pnpm example`, you'll see output like:

```
🚀 Agent Loop Example - Weather Assistant

============================================================

📝 User Prompt: What is the weather like in Seattle?
============================================================

🤖 LLM Thinking...
   User: What is the weather like in Seattle?

📡 Event: task
   Task ID: task_1730000000000_abc123
   Context ID: ctx_1730000000000
   Status: submitted

📡 Event: status-update
   Task ID: task_1730000000000_abc123
   Status: working

🔧 Tool Executing: get_weather
   Arguments: { location: 'Seattle' }
   Result: { location: 'Seattle', temperature: 55, condition: 'rainy', ... }

📡 Event: status-update
   Task ID: task_1730000000000_abc123
   Status: completed
   Message: The weather in Seattle is 55°F and rainy. 🌧️
   ✅ FINAL EVENT

============================================================
✅ Agent Loop Completed!
============================================================
```

## Test Structure

Tests are organized by functionality:

```
tests/
└── agent-loop.test.ts
    ├── Basic Execution
    │   ├── simple completion without tools
    │   └── A2A-compliant events
    ├── Tool Execution
    │   ├── single tool call
    │   ├── multiple tool calls
    │   └── error handling
    ├── Checkpointing
    │   ├── periodic checkpoints
    │   ├── resume from checkpoint
    │   └── resume completed task
    ├── Error Handling
    │   ├── execution errors
    │   └── max iterations
    └── Context Propagation
        ├── trace context
        └── auth context
```

## Example Structure

The example demonstrates:

1. **LLM Provider Implementation** - `SimpleLLMProvider`
   - Simulates OpenAI-style responses
   - Decides when to use tools
   - Generates final responses

2. **Tool Provider Implementation** - `WeatherToolProvider`
   - Provides weather tool definition
   - Simulates weather API calls
   - Returns structured results

3. **Agent Loop Configuration**
   - Sets up providers
   - Configures state storage
   - Enables checkpointing

4. **Event Handling**
   - Subscribes to event stream
   - Logs A2A-compliant events
   - Shows internal events

## Next Steps

After running tests and examples:

1. Review `A2A_ALIGNMENT.md` for event structure details
2. Check `AGENT_LOOP_PROGRESS.md` for implementation status
3. See `PROJECT.md` for design/implementation guidelines
4. Read `design/agent-loop.md` for architecture overview
