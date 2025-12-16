export type Thought = {
  type: 'thought';
  id: string;
  thoughtType: string;
  content: string;
  timestamp: string;
};

export type ToolCall = {
  type: 'tool-call';
  id: string;
  toolName: string;
  icon?: string;
  status: 'started' | 'completed';
  success?: boolean;
  arguments: Record<string, unknown>;
  result?: Record<string, unknown>;
  timestamp: string;
};

export type Content = {
  type: 'content';
  id: string;
  content: string;
  timestamp: string;
};

export type SubTask = {
  type: 'sub-task';
  id: string;
  timestamp: string;
};

export type PromptTurn = {
  source: 'client';
  id: string;
  prompt: string;
};

export type TaskEvent = Thought | ToolCall | Content | SubTask;

export type AgentTurn = {
  source: 'agent';
  id: string;
  status: string;
  content: string[];
  stream: string;
  events: TaskEvent[];
};

export type Turn = AgentTurn | PromptTurn;

export type Conversation = {
  turns: Map<string, Turn>;
  turnOrder: string[];
};
