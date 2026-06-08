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
  error?: string;
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

/** Input type for input-required turns */
export type InputType = 'confirmation' | 'clarification' | 'selection' | 'data';

/** Auth type for auth-required turns */
export type AuthType = 'oauth2' | 'api-key' | 'pat' | 'password' | 'custom';

/** Encryption key for encrypting credentials before sending to agent */
export type AuthEncryptionKey = {
  kty: string;
  crv: string;
  x: string;
  y: string;
  kid: string;
  alg?: string;
};

/** Turn representing a pending or answered input request from the agent */
export type InputRequiredTurn = {
  source: 'input-required';
  id: string;
  inputId: string;
  linkedToolCallId?: string;
  requireUser?: boolean;
  inputType: InputType;
  prompt: string;
  options?: unknown[];
  schema?: Record<string, unknown>;
  status: 'pending' | 'answered' | 'completed' | 'cancelled';
  timestamp: string;
};

/** Turn representing a pending or completed authentication request from the agent */
export type AuthRequiredTurn = {
  source: 'auth-required';
  id: string;
  authId: string;
  linkedToolCallId?: string;
  authType: AuthType;
  provider?: string;
  scopes?: string[];
  prompt: string;
  encryptionKey: AuthEncryptionKey;
  /** OAuth2 authorization endpoint */
  authorizationEndpoint?: string;
  /** OAuth2 client ID */
  clientId?: string;
  /** PKCE code challenge */
  codeChallenge?: string;
  codeChallengeMethod?: 'S256';
  /** URL to API key / PAT generation page */
  infoUrl?: string;
  status: 'pending' | 'completed' | 'cancelled';
  timestamp: string;
};

export type Turn = AgentTurn | PromptTurn | InputRequiredTurn | AuthRequiredTurn;

export type Conversation = {
  turns: Map<string, Turn>;
  turnOrder: string[];
  inputReceivedAtById?: Map<string, string>;
  authCompletedAtById?: Map<string, string>;
  toolCallResolutionById?: Map<string, { status: 'completed' | 'cancelled'; timestamp: string }>;
};
