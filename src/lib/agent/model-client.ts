/** Provider construction and headers belong to the application layer, never to UI components. */
import { createGateway } from 'ai';
import { createGoogle } from '@ai-sdk/google';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { usesGateway } from '../ai-routing';

export type ModelProvider = { id: string; api?: string; label?: string; gatewayOnly?: boolean; requiresApiKey?: boolean };
export type SelectedModel = { id: string; label?: string; providerId?: string; gatewayId?: string; gatewayOnly?: boolean; contextWindow?: number; cost?: { input?: number; output?: number } };

export function providerRequestHeaders(configured: Record<string, unknown>, chatId: string, initial: Record<string, string> = {}): Record<string, string> {
  const headers: Record<string, string> = { ...initial, 'x-codeclub-session': chatId };
  for (const [name, value] of Object.entries(configured)) {
    if (typeof value === 'string' && /^[a-z0-9-]+$/i.test(name) && !['authorization', 'cookie', 'host'].includes(name.toLowerCase())) headers[name] = value.replaceAll('${chatId}', chatId);
  }
  return headers;
}

export function createModelClient({ provider, model, apiKey, headers, fetch, baseURL = provider.api }: {
  provider: ModelProvider; model: SelectedModel; apiKey?: string; headers: Record<string, string>; fetch: typeof globalThis.fetch; baseURL?: string;
}) {
  if (usesGateway(provider, model)) return createGateway({ apiKey: apiKey || undefined, fetch });
  if (!baseURL) throw new Error('MODEL_ENDPOINT_MISSING');
  return provider.id === 'google'
    ? createGoogle({ name: 'google', baseURL, apiKey, headers, fetch })
    : createOpenAICompatible({ name: provider.id, baseURL, apiKey, headers, fetch });
}
