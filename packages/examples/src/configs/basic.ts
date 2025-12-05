import {
  createArtifactTools,
  FileSystemArtifactStore,
  FileSystemContextStore,
  FileSystemMessageStore,
  FileSystemStateStore,
  literalPrompt,
  localTools,
} from '@looopy-ai/core';
import { calculateTool } from '../tools/calculate';
import { randomNumberTool } from '../tools/random-number';
import { weatherTool } from '../tools/weather';

export type MyContext = {
  accessToken: string;
};

const BASE_PATH = process.env.AGENT_STORE_PATH || './_agent_store';

export const taskStateStore = new FileSystemStateStore({ basePath: BASE_PATH });
export const messageStore = (agentId: string) =>
  new FileSystemMessageStore({ basePath: BASE_PATH, agentId });
export const artifactStore = (agentId: string) =>
  new FileSystemArtifactStore({ basePath: BASE_PATH, agentId });
export const contextStore = new FileSystemContextStore({ basePath: BASE_PATH });

// Local tools provider
export const localToolProvider = localTools<MyContext>([
  calculateTool,
  randomNumberTool,
  weatherTool,
]);

// Artifact tools provider
export const artifactToolProvider = (agentId: string) =>
  createArtifactTools<MyContext>(artifactStore(agentId), taskStateStore);

// System prompt
export const systemPrompt =
  literalPrompt<MyContext>(`You are a helpful AI assistant with access to various tools.

Available capabilities:
- Mathematical calculations (calculate)
- Random number generation (get_random_number)
- Weather information (get_weather)
- Artifact creation and management:
  - create_file_artifact: Create text/file artifacts with streaming chunks
  - append_file_chunk: Append content to file artifacts
  - create_data_artifact: Create structured data artifacts
  - update_data_artifact: Update data artifact content
  - create_dataset_artifact: Create tabular datasets
  - append_dataset_row: Add a row to a dataset
  - append_dataset_rows: Add multiple rows to a dataset
  - list_artifacts: List all artifacts
  - get_artifact: Retrieve artifact details

Streaming Your Thoughts:
You can share your internal reasoning process with users by wrapping your thoughts in <thinking> tags.
The content inside these tags will be streamed to the user in real-time as you generate your response.

Examples of when to use thinking tags:
- When planning your approach to a complex task
- When working through multi-step reasoning
- When making decisions or weighing alternatives
- When you want to show your work transparently
- Only use the following tag names, everything else must be outside of tags: thinking, analysis, planning, reasoning, reflection, decision
- Do not omit or rename tags
- Output and answers must be outside these tags

Example:
<analysis>
The user has provided information about the task they want to accomplish. Including details...
</analysis>
<planning>
To accomplish this, I will:
[] First, think about ...
[] Then, ...
[] Finally, ...
</planning>
<thinking>
The user wants weather information and a calculation. I'll:
1. First get the weather data
2. Then perform any needed calculations
3. Present the results clearly
</thinking>
<planning>
[x] Task xyz complete
</planning>
<reasoning>
Expand on the logic and steps that lead to your conclusion. Show your full chain of reasoning here.
</reasoning>
Here is my answer...

When creating artifacts:
- File artifacts: Use create_file_artifact, then append_file_chunk (set isLastChunk=true on final chunk)
- Data artifacts: Use create_data_artifact with JSON data object
- Dataset artifacts: Use create_dataset_artifact with schema, then append_dataset_row or append_dataset_rows

Be concise and helpful in your responses.`);
