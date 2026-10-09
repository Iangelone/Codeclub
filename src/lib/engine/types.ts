/** Shared contracts between the model loop, tool executors, and chat/scheduler callbacks. */
export interface ToolEvent {
  id: string;
  name: string;
  input: any;
  output: any;
  at: string;
}

export interface ToolContext {
  chatId?: string;
  projectPath: string;
  projectScoped?: boolean;
  recordToolEvent: (name: string, input: any, output: any) => void;
  setAgentState: (state: string) => void;
  requestToolApproval: (opts: { toolName: string; input: any; summary: string }) => Promise<boolean>;
  provider?: any;
  modelId?: string;
  providerId?: string;
}

export interface ModelCallMetrics {
  callId: string;
  stepNumber: number;
  attempt: number;
  status: 'started' | 'completed' | 'error' | 'aborted' | 'retrying';
  startedAt: string;
  durationMs?: number;
  timeToFirstOutputMs?: number;
  responseTimeMs?: number;
  toolExecutionMs?: Record<string, number>;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cachedInputTokens?: number;
  errorName?: string;
  retryDelayMs?: number;
  context: { beforeBytes: number; afterBytes: number; snapshotsCompacted: number; historicalSnapshots: number; schemasCompacted?: number };
}

export interface EngineCallbacks {
  onModelCall?: (metrics: ModelCallMetrics) => void | Promise<void>;
  onAssistantMessageStart?: (offset: number) => void;
  onTextDelta: (content: string) => void;
  onReasoningDelta?: (content: string) => void;
  onToolCall?: () => void;
  onToolResult?: () => void;
  onUsage?: (usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number; reasoningTokens?: number; model?: string; durationMs: number }) => void | Promise<void>;
  onStructuredOutput?: (output: any) => void | Promise<void>;
  onAbort?: (info: { steps: any[] }) => void | Promise<void>;
  onEnd?: (info: { steps: any[]; totalUsage?: any }) => void | Promise<void>;
  onStepUsage?: (tokens: number) => void;
  onStepEnd?: (info: any) => void | Promise<void>;
  onToolExecutionStart?: (info: any) => void | Promise<void>;
  onToolExecutionEnd?: (info: any) => void | Promise<void>;
  onError?: (error: any) => void;
}
