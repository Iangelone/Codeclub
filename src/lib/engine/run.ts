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
}: {
  model: any;
  system: string;
  messages: { role: string; content: string }[];
  tools: Record<string, any>;
  callbacks: EngineCallbacks;
}): Promise<string> {
  let content = '';

  const result = streamText({
    model,
    system,
    messages,
    tools,
    stopWhen: stepCountIs(6),
    timeout: {
      totalMs: 90_000,
      stepMs: 25_000,
      chunkMs: 15_000,
      toolMs: 30_000,
    },
  });

  for await (const part of result.fullStream) {
    if (part.type === 'text-delta') {
      content += part.text;
      callbacks.onTextDelta(content);
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

  return content;
}
