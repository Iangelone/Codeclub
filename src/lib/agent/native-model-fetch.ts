/** Shared HTTP adapter. Electron owns credentials, network requests and cancellation. */
import { nativeInvoke } from '../runtime';

export type ModelFetchDebug = { method: string; url: string; requestBody?: string; status?: number; statusText?: string; responseHeaders?: unknown; responseBody?: unknown; transportError?: string };
type NativeResponse = { body: string; status: number; status_text?: string; headers?: Array<{ name: string; value: string }> };
type NativeModelFetchOptions = {
  credentialKey: () => string | undefined;
  prepareBody?: (body: string | undefined) => string | undefined;
  onFetch?: (debug: ModelFetchDebug) => void;
  cancelledError?: (signal: AbortSignal) => unknown;
  invoke?: typeof nativeInvoke;
};

export function createNativeModelFetch({ credentialKey, prepareBody, onFetch, cancelledError, invoke = nativeInvoke }: NativeModelFetchOptions): typeof fetch {
  return async (input, init = {}) => {
    const request = new Request(input, init);
    const body = ['GET', 'HEAD'].includes(request.method) ? undefined : await request.clone().text();
    const requestBody = prepareBody ? prepareBody(body) : body;
    const debug = { method: request.method, url: request.url, requestBody };
    onFetch?.(debug);
    const requestId = crypto.randomUUID();
    const cancel = () => { void invoke('codeclub_http_abort', { requestId }).catch(() => undefined); };
    if (request.signal.aborted) throw cancelledError?.(request.signal) || request.signal.reason || new DOMException('Cancelled', 'AbortError');
    request.signal.addEventListener('abort', cancel, { once: true });
    try {
      const response = await invoke<NativeResponse>('codeclub_http_fetch', { request: {
        url: request.url, method: request.method,
        headers: [...request.headers].map(([name, value]) => ({ name, value })),
        body: requestBody || null, requestId, credentialKey: credentialKey(),
      } });
      onFetch?.({ ...debug, status: response.status, statusText: response.status_text, responseHeaders: response.headers, responseBody: response.body });
      return new Response(response.body, { status: response.status, statusText: response.status_text, headers: (response.headers || []).map(header => [header.name, header.value] as [string, string]) });
    } catch (error) {
      onFetch?.({ ...debug, transportError: error instanceof Error ? error.message : String(error) });
      throw error;
    } finally { request.signal.removeEventListener('abort', cancel); }
  };
}
