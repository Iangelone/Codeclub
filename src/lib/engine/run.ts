import { pruneMessages, smoothStream, stepCountIs, ToolLoopAgent, type ModelMessage } from 'ai';
import { contextBytes, messageContextCost } from '../chat-context';
import type { EngineCallbacks } from './types';

type RunStreamArgs = {
  model: any;
  system: string;
  messages: ModelMessage[];
  tools: Record<string, any>;
  structuredOutput?: any;
  maxOutputTokens?: number;
  contextWindow?: number;
  callbacks: EngineCallbacks;
  signal?: AbortSignal;
};

async function runStreamInternal({ model, system, messages, tools, structuredOutput, maxOutputTokens, contextWindow, callbacks, signal }: RunStreamArgs): Promise<string> {
  let content = '';
  let reasoning = '';
  let streamError: unknown;
  const startedAt = Date.now();
  const agent = new ToolLoopAgent({
    model,
    instructions: system,
    tools,
    // AI SDK 7.0.16 creates a rejected tracing completion in browsers on abort.
    // Our usage/audit callbacks stay enabled; the optional SDK telemetry is off.
    telemetry: { isEnabled: false },
    // Mantiene el loop de tools dentro de AI SDK y limita ejecuciones encadenadas.
    stopWhen: stepCountIs(8),
    prepareStep: ({messages:stepMessages}) => {
      const budget=Math.max(1024,Math.floor((contextWindow||32768)*0.75));
      const overhead=contextBytes(system)+contextBytes(JSON.stringify(Object.entries(tools).map(([name,tool]:[string,any])=>({name,description:tool.description,schema:tool.inputSchema}))))+Math.min(maxOutputTokens||4096,Math.floor(budget/4));
      const cost=(items:ModelMessage[])=>overhead+items.reduce((sum,message)=>sum+messageContextCost(message),0);
      if(cost(stepMessages)<=budget)return;
      const compacted=pruneMessages({messages:stepMessages,reasoning:'all',toolCalls:'before-last-3-messages',emptyMessages:'remove'});
      if(cost(compacted)>budget)throw new Error('CHAT_MESSAGE_TOO_LARGE');
      return {messages:compacted};
    },
    ...(maxOutputTokens ? { maxOutputTokens } : {}),
    ...(structuredOutput ? { output: structuredOutput } : {}),
  });
  const result = await agent.stream({
    messages,
    abortSignal: signal,
    experimental_transform: smoothStream(),
    onEnd: async ({ steps, totalUsage }: any) => {
      await callbacks.onEnd?.({ steps, totalUsage });
    },
    onStepEnd: async (info: any) => {
      await callbacks.onStepEnd?.(info);
    },
    onToolExecutionStart: async (info: any) => {
      await callbacks.onToolExecutionStart?.(info);
    },
    onToolExecutionEnd: async (info: any) => {
      await callbacks.onToolExecutionEnd?.(info);
    },
  });

  // fullStream conserva texto, razonamiento y eventos de tools en un único flujo.
  for await (const chunk of result.fullStream as AsyncIterable<any>) {
      if (chunk.type === 'text-delta') {
        content += chunk.text ?? '';
        if (!structuredOutput) callbacks.onTextDelta(content);
      } else if (chunk.type === 'reasoning-delta') {
        reasoning += chunk.text ?? '';
        callbacks.onReasoningDelta?.(reasoning);
      } else if (chunk.type === 'tool-call' || chunk.type === 'tool-input-start') {
        callbacks.onToolCall?.();
      } else if (chunk.type === 'tool-result') {
        callbacks.onToolResult?.();
      } else if (chunk.type === 'error') {
        streamError ??= chunk.error;
        callbacks.onError?.(chunk.error);
      }
    if (signal?.aborted) {
      const error = new Error('Generación cancelada por el usuario.');
      error.name = 'AbortError';
      throw error;
    }
  }

  if (streamError != null) {
    await Promise.allSettled([result.usage, result.response]);
    throw streamError;
  }

  if (structuredOutput) {
    callbacks.onStructuredOutput?.(await result.output);
  }

  if (signal?.aborted) {
    const error = new Error('Generación cancelada por el usuario.');
    error.name = 'AbortError';
    throw error;
  }

  const [usage, response] = await Promise.all([result.usage, result.response]);
  await callbacks.onUsage?.({
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    reasoningTokens: usage.outputTokenDetails?.reasoningTokens,
    model: response.modelId,
    durationMs: Date.now() - startedAt,
  });

  return content;
}

export async function runStream(args: RunStreamArgs): Promise<string> {
  const controller = new AbortController();
  const forwardAbort = () => {
    if (!controller.signal.aborted) controller.abort(args.signal?.reason);
  };
  args.signal?.addEventListener('abort', forwardAbort, { once: true });
  if(args.signal?.aborted)forwardAbort();

  const streamPromise = runStreamInternal({ ...args, signal: controller.signal });
  try {
    return await streamPromise;
  } finally {
    args.signal?.removeEventListener('abort', forwardAbort);
    if (!controller.signal.aborted) controller.abort();
    void streamPromise.catch(() => undefined);
  }
}
