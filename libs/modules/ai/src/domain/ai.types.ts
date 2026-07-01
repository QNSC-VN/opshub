export type MessageRole = 'user' | 'assistant';

export interface ChatMessage {
  role: MessageRole;
  content: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  /** Caller's employee ID — scopes tool access to their own data where relevant */
  actorId: string;
  actorRole: string;
}

export interface ChatResponse {
  message: string;
  /** Structured data surfaced by a tool call, to be rendered in the UI */
  data?: {
    type: 'table' | 'stat' | 'list';
    payload: unknown;
  };
}
