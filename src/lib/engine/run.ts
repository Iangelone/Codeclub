import { smoothStream, stepCountIs, ToolLoopAgent, type ModelMessage } from 'ai';
import type { EngineCallbacks } from './types';

type RunStreamArgs = {
  model: any;
  system: string;
  messages: ModelMessage[];
  tools: Record<string, any>;
  structuredOutput?: any;
  maxOutputTokens?: number;
  callbacks: EngineCallbacks;
  signal?: AbortSignal;
};

async function runStreamInternal({ model, system, messages, tools, structuredOutput, maxOutputTokens, callbacks, signal }: RunStreamArgs): Promise<string> {
  let content = '';
  let reasoning = '';
  const startedAt = Date.now();
  const agent = new ToolLoopAgent({
    model,
    instructions: system,
    tools,
    // Mantiene el loop de tools dentro de AI SDK y limita ejecuciones encadenadas.
    stopWhen: stepCountIs(8),
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
        callbacks.onError?.(chunk.error);
      }
    if (signal?.aborted) {
      const error = new Error('Generación cancelada por el usuario.');
      error.name = 'AbortError';
      throw error;
    }
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

  const streamPromise = runStreamInternal({ ...args, signal: controller.signal });
  try {
    return await streamPromise;
  } finally {
    args.signal?.removeEventListener('abort', forwardAbort);
    if (!controller.signal.aborted) controller.abort();
    void streamPromise.catch(() => undefined);
  }
}
