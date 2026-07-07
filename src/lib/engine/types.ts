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
}

export interface EngineCallbacks {
  onTextDelta: (content: string) => void;
  onToolCall?: () => void;
  onToolResult?: () => void;
  onError?: (error: any) => void;
}
