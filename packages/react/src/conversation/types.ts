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

export type TaskEvent = Thought | ToolCall;

export type TaskState = {
  id: string;
  status: string;
  content: string[];
  stream: string;
  events: TaskEvent[];
};

export type ConversationState = {
  tasks: Map<string, TaskState>;
  taskOrder: string[];
  count: number;
};
