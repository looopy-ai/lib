# Client Tool Provider

The `ClientToolProvider` validates and manages tools provided by clients in A2A requests. It ensures tool definitions are valid and delegates execution back to the client via the "input-required" mechanism.

## Features

- ✅ **Zod-based validation** - Strict validation of tool definitions using Zod schemas
- ✅ **JSON Schema support** - Full JSON Schema property types with recursion
- ✅ **Type checking** - Validates tool arguments match parameter schemas
- ✅ **Duplicate detection** - Prevents duplicate tool names
- ✅ **Name validation** - Ensures tool names use valid characters (alphanumeric, hyphens, underscores)
- ✅ **Input-required flow** - Delegates tool execution to client via A2A protocol

## Usage

### Basic Example

```typescript
import { ClientToolProvider } from 'looopy/tools';

// Client-provided tools (from A2A request)
const clientTools = [
  {
    name: 'search_database',
    description: 'Search the client database',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query',
        },
        limit: {
          type: 'integer',
          description: 'Max results',
          minimum: 1,
          maximum: 100,
        },
      },
      required: ['query'],
    },
  },
];

// Create provider with input-required callback
const provider = new ClientToolProvider({
  tools: clientTools,
  onInputRequired: async (toolCall, context) => {
    // Emit A2A status-update with state="input-required"
    await a2aServer.emit(context.taskId, {
      kind: 'status-update',
      taskId: context.taskId,
      contextId: context.contextId,
      status: {
        state: 'input-required',
        message: {
          role: 'assistant',
          content: '',
          toolCalls: [toolCall],
        },
      },
      final: false,
    });

    // Wait for client to provide result
    return await waitForClientResponse(toolCall.id);
  },
});

// Use in agent loop
const tools = await provider.getTools();
console.log(tools); // Validated tool definitions
```

### Validation Example

```typescript
import { validateToolDefinitions, safeValidateToolDefinitions } from 'looopy/tools';

// Validate and throw on error
try {
  const tools = validateToolDefinitions(clientProvidedTools);
  console.log('Valid tools:', tools);
} catch (error) {
  console.error('Invalid tools:', error.message);
}

// Safe validation (returns result object)
const result = safeValidateToolDefinitions(clientProvidedTools);
if (result.success) {
  console.log('Valid tools:', result.data);
} else {
  console.error('Validation errors:', result.errors);
}
```

### Argument Validation

```typescript
const provider = new ClientToolProvider({
  tools: clientTools,
  onInputRequired: handleInputRequired,
});

// Validate tool call arguments before execution
const toolCall = {
  id: 'call-123',
  type: 'function',
  function: {
    name: 'search_database',
    arguments: JSON.stringify({
      query: 'test',
      limit: 10,
    }),
  },
};

const validation = provider.validateToolArguments(toolCall);
if (!validation.valid) {
  console.error('Invalid arguments:', validation.errors);
} else {
  // Execute tool
  const result = await provider.execute(toolCall, context);
}
```

## Tool Definition Schema

**Note**: Tool definitions use a simplified format. The LLM provider wraps these in provider-specific formats when needed (e.g., OpenAI's `{ type: 'function', function: {...} }`).

### Full JSON Schema Support

```typescript
{
  name: 'my_tool',           // alphanumeric, hyphens, underscores only
  description: 'Description', // 1-1024 characters
  parameters: {
    type: 'object',
    properties: {
      // String property
      name: {
        type: 'string',
        description: 'Name',
        minLength: 1,
        maxLength: 100,
        pattern: '^[a-z]+$',
        format: 'email',      // email, uri, date-time, etc.
      },
      // Integer property
      age: {
        type: 'integer',
        description: 'Age',
        minimum: 0,
        maximum: 150,
      },
      // Number property
      price: {
        type: 'number',
        minimum: 0.01,
        multipleOf: 0.01,
      },
      // Enum property
      status: {
        type: 'string',
        enum: ['active', 'inactive'],
      },
      // Array property
      tags: {
        type: 'array',
        items: { type: 'string' },
        minItems: 1,
        maxItems: 10,
      },
      // Nested object
      address: {
        type: 'object',
        properties: {
          street: { type: 'string' },
          city: { type: 'string' },
        },
          required: ['city'],
        },
      },
      required: ['name', 'age'],
      additionalProperties: false, // Reject unknown properties
    },
  },
}
```

### Supported JSON Schema Types

- `string` - Text values with optional constraints (minLength, maxLength, pattern, format)
- `number` - Numeric values (including decimals)
- `integer` - Whole numbers only
- `boolean` - True/false values
- `array` - Lists with optional item type and length constraints
- `object` - Nested objects with properties
- `null` - Null values

### Validation Rules

1. **Tool name**: 1-64 characters, alphanumeric + hyphens + underscores only
2. **Description**: 1-1024 characters
3. **Parameters**: Must be object type with properties
4. **Required parameters**: Must exist in arguments
5. **Type checking**: Arguments must match declared types
6. **Integer validation**: Rejects non-integer numbers for integer type
7. **Additional properties**: Allowed by default, can be disabled

## A2A Integration

### Input-Required Flow

```typescript
// 1. Client provides tools in A2A request
POST /a2a/message/stream
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "message/stream",
  "params": {
    "message": {
      "role": "user",
      "parts": [{ "kind": "text", "text": "Search for users" }],
      "contextId": "ctx-123"
    },
    "tools": [
      {
        "type": "function",
        "function": {
          "name": "search_users",
          "description": "Search users in client system",
          "parameters": { ... }
        }
      }
    ]
  }
}

// 2. Agent validates tools and creates provider
const provider = new ClientToolProvider({
  tools: params.tools,
  onInputRequired: async (toolCall, context) => {
    // 3. LLM decides to call the tool
    // 4. Agent emits input-required event
    res.write(`data: ${JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      result: {
        kind: "status-update",
        taskId: context.taskId,
        contextId: context.contextId,
        status: {
          state: "input-required",
          message: {
            role: "assistant",
            content: "",
            toolCalls: [toolCall]
          }
        },
        final: false
      }
    })}\n\n`);

    // 5. Wait for client to execute tool and send result
    return await waitForToolResult(toolCall.id);
  }
});

// 6. Client receives input-required, executes tool, sends result
POST /a2a/tasks/resume
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tasks/resume",
  "params": {
    "taskId": "task-123",
    "toolResults": [
      {
        "toolCallId": "call-456",
        "toolName": "search_users",
        "success": true,
        "result": { "users": [...] }
      }
    ]
  }
}

// 7. Agent continues with tool result
```

## Error Handling

```typescript
// Invalid tool definitions
try {
  const provider = new ClientToolProvider({
    tools: invalidTools,
    onInputRequired: handler,
  });
} catch (error) {
  // error.message: "Invalid client tool definitions: ..."
}

// Tool execution errors
const result = await provider.execute(toolCall, context);
if (!result.success) {
  console.error('Tool failed:', result.error);
  // Possible errors:
  // - "Tool xyz not found in client tools"
  // - "Invalid tool arguments JSON: ..."
  // - Client callback error message
}

// Argument validation errors
const validation = provider.validateToolArguments(toolCall);
if (!validation.valid) {
  validation.errors.forEach(err => console.error(err));
  // Possible errors:
  // - "Missing required parameter: xyz"
  // - "Unknown parameter: abc"
  // - "Parameter xyz has wrong type: expected string, got number"
  // - "Parameter xyz must be an integer, got: 2.5"
}
```

## Type Safety

```typescript
import type {
  ToolDefinition,
  ToolCall,
  ToolResult,
  FunctionParameters,
  JsonSchemaProperty,
} from 'looopy/tools';

// All types are properly typed and exported
const tool: ToolDefinition = {
  type: 'function',
  function: {
    name: 'test',
    description: 'Test tool',
    parameters: {
      type: 'object',
      properties: {
        param: { type: 'string' },
      },
    },
  },
};

// Zod schemas are also exported for runtime validation
import { ToolDefinitionSchema } from 'looopy/tools';
const validated = ToolDefinitionSchema.parse(tool);
```

## Testing

See `tests/client-tool-provider.test.ts` for comprehensive test examples covering:

- ✅ Valid tool definition validation
- ✅ Invalid tool rejection (empty names, invalid characters)
- ✅ Duplicate tool name detection
- ✅ Tool execution flow
- ✅ Argument validation (missing required, wrong types, integers)
- ✅ Additional properties handling
- ✅ Error handling for unknown tools and invalid JSON
- ✅ Client callback error handling

## Implementation Notes

### Why Client Tools?

Client tools enable:

1. **Secure execution** - Tools run on client side with client permissions
2. **Proprietary systems** - Client can integrate private APIs without exposing them
3. **Dynamic capabilities** - Each client can provide different tools
4. **A2A protocol compliance** - Supports the input-required flow

### Performance Considerations

- Tool validation happens once at provider construction
- Tool name lookup uses `Set` for O(1) performance
- Argument validation is optional (only when needed)
- Validation caches are not needed (validation is fast)

### Security Considerations

1. **Strict validation** - All tool definitions are validated with Zod
2. **Name sanitization** - Only safe characters allowed in tool names
3. **Size limits** - Names max 64 chars, descriptions max 1024 chars
4. **No code execution** - Tools don't execute on server, only on client
5. **JSON parsing** - Safe JSON parsing with try/catch

### Future Enhancements

Potential improvements:

- Full JSON Schema validation (using ajv or similar)
- Schema versioning support
- Tool deprecation warnings
- Usage analytics/metrics
- Tool execution timeout configuration
- Batch tool execution support
