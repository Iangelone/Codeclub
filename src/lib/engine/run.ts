import { streamText, stepCountIs } from 'ai';
import type { EngineCallbacks } from './types';

// Data from https://models.dev/api.json — live catalog fetched at runtime.
// Providers and models are documented in src/lib/ai-catalog.ts.
// The engine uses AI SDK 7's streamText for multi-step agent execution.

export async function runStream({
  model,
  system,
  messages,
  tools,
  callbacks,
  signal,
}: {
  model: any;
  system: string;
  messages: { role: string; content: string }[];
  tools: Record<string, any>;
  callbacks: EngineCallbacks;
  signal?: AbortSignal;
}): Promise<string> {
  let content = '';
  let reasoning = '';
  const startedAt = Date.now();

  const result = streamText({
    model,
    system,
    messages,
    tools,
    abortSignal: signal,
    stopWhen: stepCountIs(6),
    timeout: {
      totalMs: 90_000,
      stepMs: 25_000,
      chunkMs: 15_000,
      toolMs: 30_000,
    },
  });

  for await (const part of result.fullStream) {
    const streamPart = part as any;

    if (streamPart.type === 'reasoning-delta') {
      const delta = streamPart.text ?? streamPart.delta ?? '';
      if (delta) {
        reasoning += delta;
        callbacks.onReasoningDelta?.(reasoning);
      }
      continue;
    }

    if (streamPart.type === 'text-delta') {
      const delta = streamPart.text ?? streamPart.delta ?? streamPart.textDelta ?? '';
      if (delta) {
        content += delta;
        callbacks.onTextDelta(content);
      }
      continue;
    }

    if (part.type === 'tool-call' || part.type === 'tool-input-start') {
      callbacks.onToolCall?.();
      continue;
    }

    if (part.type === 'tool-result') {
      callbacks.onToolResult?.();
      continue;
    }

    if (part.type === 'error') {
      if (callbacks.onError) {
        callbacks.onError(part.error);
      } else {
        throw part.error;
      }
    }
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
