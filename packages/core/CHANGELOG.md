# @looopy-ai/core

## 2.1.8

### Patch Changes

- 1ed6956: export types

## 2.1.7

### Patch Changes

- d27c2f6: update getSystemPrompt to accept loopContext parameter
- 511c29f: update prompt validation to include metadata in agent turn options

## 2.1.6

### Patch Changes

- bf90de4: change child session id format

## 2.1.5

### Patch Changes

- 7768fa4: Prevent child agent events from being added to parent loop message history when invoking agent tools.

## 2.1.4

### Patch Changes

- 550de13: Add unit tests for AgentToolProvider to cover parent task propagation and message store skipping for child agent content.
- d6f0be6: Alter nesting contextId

## 2.1.3

### Patch Changes

- 0425814: debug logging
- ec4598a: add OpenTelemetry tracing for agent invocation updates

## 2.1.2

### Patch Changes

- 72917ec: add child task event detection and update event handling across components

## 2.1.1

### Patch Changes

- f48e29a: enhance logging in AgentToolProvider for better context and error handling
- 5682e29: Update packages

## 2.1.0

### Minor Changes

- a8b8a1a: Change AuthContext to a type param

## 2.0.1

### Patch Changes

- 6c69075: Pass card to getHeaders()
- aca1813: Allow undefined value in headers

## 2.0.0

### Major Changes

- 01ca093: Make base AnyEvent definitions contextless and add ContextEvent for stamping contextId and taskId onto emitted events.

### Minor Changes

- c17f059: Make tool execution emit `AnyEvent` observables by updating `ToolProvider.execute` and provider implementations to stream tool-complete events.

### Patch Changes

- 166b667: Fix AgentToolProvider.execute to return a single observable that streams SSE events correctly.

## 1.2.1

### Patch Changes

- dc033a0: replace skillPrompts with skillRegistry in iteration logic
- 07de4c9: Add skills tool icon
- 1d66f86: add tools parameter to LLM call span and iteration logic

## 1.2.0

### Minor Changes

- 838b2e7: This commit introduces a new skill-learning feature for agents. It allows agents to learn new skills from a registry and use them in conversation.

## 1.1.6

### Patch Changes

- 699164d: change version type from string to number in SystemPrompt

## 1.1.5

### Patch Changes

- 30c4609: Bump

## 1.1.4

### Patch Changes

- 2f95cac: Refresh documentation to match the current core runtime APIs, tool definition helpers, and system prompt utilities.
- ff2bf63: export prompt utilities from utils module
- cd6518d: add systemPrompt to Agent context and update type definition

## 1.1.3

### Patch Changes

- 1235817: update tool definition structure to use a single object parameter for name, description, schema, and handler
- ab4d215: introduce SystemPrompt type and update agent and iteration logic to utilize it

## 1.1.2

### Patch Changes

- 29dccbc: streamline imports and enhance logging in tools; add recursiveMerge utility

## 1.1.1

### Patch Changes

- 6dc8058: Change shutdown handling

## 1.1.0

### Minor Changes

- 6bd8b8b: Updates to tool provider and tool execution

## 1.0.4

### Patch Changes

- cbc7225: export LocalToolDefinition

## 1.0.3

### Patch Changes

- 70efbd2: include necessary deps

## 1.0.2

### Patch Changes

- 4861e1e: Add memory-agent-store

## 1.0.1

### Patch Changes

- 92025c2: Initial release
