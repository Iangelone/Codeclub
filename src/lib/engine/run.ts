import { smoothStream, streamText } from 'ai';
import type { EngineCallbacks } from './types';

type RunStreamArgs = {
  model: any;
  system: string;
  messages: { role: string; content: any }[];
  tools: Record<string, any>;
  structuredOutput?: any;
  callbacks: EngineCallbacks;
  signal?: AbortSignal;
};

async function runStreamInternal({ model, system, messages, tools, structuredOutput, callbacks, signal }: RunStreamArgs): Promise<string> {
  let content = '';
  let reasoning = '';
  const startedAt = Date.now();
  const styleInstruction = '\n\nUse clear, concise language and respond in the user\'s language. Avoid emojis unless the user explicitly asks for them.';

  const result = streamText({
    model,
    system: `${system}${styleInstruction}`,
    messages,
    tools,
    experimental_transform: smoothStream(),
    // Sin límite fijo: después de una tool el modelo puede continuar hasta
    // responder. La cancelación sigue bajo control del usuario/watchdog.
    stopWhen: () => false,
    ...(structuredOutput ? { output: structuredOutput } : {}),
    abortSignal: signal,
    onAbort: async ({ steps }: any) => {
      await callbacks.onAbort?.({ steps });
    },
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
    timeout: {
      stepMs: 120_000,
      chunkMs: 30_000,
      toolMs: 60_000,
    },
    onChunk: ({ chunk }: any) => {
      if (chunk.type === 'reasoning-delta') {
        reasoning += chunk.text ?? '';
        callbacks.onReasoningDelta?.(reasoning);
      } else if (chunk.type === 'tool-call' || chunk.type === 'tool-input-start') {
        callbacks.onToolCall?.();
      } else if (chunk.type === 'tool-result') {
        callbacks.onToolResult?.();
      } else if (chunk.type === 'error') {
        callbacks.onError?.(chunk.error);
      }
    },
  });

  // textStream es la ruta simple del AI SDK para una UI incremental.
  // También consume internamente los pasos de tools hasta cerrar el stream.
  for await (const delta of result.textStream) {
    if (signal?.aborted) {
      const error = new Error('Generación cancelada por el usuario.');
      error.name = 'AbortError';
      throw error;
    }
    if (delta) {
      content += delta;
      if (!structuredOutput) callbacks.onTextDelta(content);
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
    model: response.model,
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
