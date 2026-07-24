export interface ToolEvent {
  id: string;
  name: string;
  input: any;
  output: any;
  at: string;
}

export interface ToolContext {
  projectPath: string;
  recordToolEvent: (name: string, input: any, output: any) => void;
  setAgentState: (state: string) => void;
  requestToolApproval: (opts: { toolName: string; input: any; summary: string }) => Promise<boolean>;
  provider?: any;
  modelId?: string;
}

export interface EngineCallbacks {
  onTextDelta: (content: string) => void;
  onReasoningDelta?: (content: string) => void;
  onToolCall?: () => void;
  onToolResult?: () => void;
  onUsage?: (usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number; reasoningTokens?: number; model?: string; durationMs: number }) => void | Promise<void>;
  onError?: (error: any) => void;
}
