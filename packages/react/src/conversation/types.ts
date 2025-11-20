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
  status: 'started' | 'completed';
  success?: boolean;
  arguments: Record<string, unknown>;
  result?: Record<string, unknown>;
  timestamp: string;
};

type Event = Thought | ToolCall;

export type TaskState = {
  id: string;
  status: string;
  content: string;
  events: Event[];
};

export type ConversationState = {
  tasks: Map<string, TaskState>;
  taskOrder: string[];
  count: number;
};
