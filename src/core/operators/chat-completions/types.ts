export type ToolCall = {
  index: number;
  id: string | null;
  function: {
    name: string;
    arguments: string; // streamed JSON string
  };
  type: 'function';
};

export type Choice = {
  delta?: { content?: string; tool_calls?: ToolCall[] };
  index: number;
  finish_reason?: string | null;
};

export type ChatCompletionStreamData = {
  id: string;
  created: string;
  model: string;
  object: string;
  choices: Choice[];
};
