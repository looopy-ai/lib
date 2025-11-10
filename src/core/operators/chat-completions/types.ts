export type ToolCall = {
  index: number;
  id?: string | null;
  function?: {
    name?: string;
    arguments?: string; // streamed JSON string
  };
  type?: 'function';
};

export type InlineXml = {
  name: string;
  content?: string;
  attributes: Record<string, string | string[]>;
};

export type Choice = {
  delta?: { content?: string; tool_calls?: ToolCall[] };
  index: number;
  finish_reason?: string | null;
  thoughts?: InlineXml[];
};

export type ChatCompletionStreamData = {
  id: string;
  created: string;
  model: string;
  object: string;
  choices: Choice[];
};

// {"completion_tokens":439,"prompt_tokens":2572,"total_tokens":3011,"completion_tokens_details":{"reasoning_tokens":0},"prompt_tokens_details":{"cached_tokens":0,"cache_creation_tokens":0},"cache_creation_input_tokens":0,"cache_read_input_tokens":0}
export type LLMUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  completion_tokens_details?: Record<string, number>;
  prompt_tokens_details?: Record<string, number>;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
};
