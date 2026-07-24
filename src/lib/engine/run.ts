import { streamText, stepCountIs } from 'ai';
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

const GENERATION_TIMEOUT_MS = 60_000;

async function runStreamInternal({ model, system, messages, tools, structuredOutput, callbacks, signal }: RunStreamArgs): Promise<string> {
  let content = '';
  let reasoning = '';
  const startedAt = Date.now();
  const styleInstruction = '\n\nRegla de estilo: respondé en español, con tono sobrio y profesional. No uses emojis salvo que el usuario los pida explícitamente.';

  const result = streamText({
    model,
    system: `${system}${styleInstruction}`,
    messages,
    tools,
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
    stopWhen: stepCountIs(structuredOutput ? 7 : 6),
    timeout: {
      totalMs: 90_000,
      stepMs: 25_000,
      chunkMs: 15_000,
      toolMs: 30_000,
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
  let timedOut = false;
  let timeoutId: number | undefined;
  const forwardAbort = () => controller.abort();
  args.signal?.addEventListener('abort', forwardAbort, { once: true });

  const streamPromise = runStreamInternal({ ...args, signal: controller.signal });
  const timeoutPromise = new Promise<string>((_, reject) => {
    timeoutId = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
      const error = new Error('La generación superó el límite de 60 segundos.');
      error.name = 'TimeoutError';
      reject(error);
    }, GENERATION_TIMEOUT_MS);
  });

  try {
    return await Promise.race([streamPromise, timeoutPromise]);
  } catch (error) {
    if (timedOut) {
      const timeoutError = new Error('La generación superó el límite de 60 segundos.');
      timeoutError.name = 'TimeoutError';
      throw timeoutError;
    }
    throw error;
  } finally {
    if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    args.signal?.removeEventListener('abort', forwardAbort);
    controller.abort();
    void streamPromise.catch(() => undefined);
  }
}
