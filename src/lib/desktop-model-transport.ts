/** Native model transport, custom XML tool formatting and provider error presentation. */
import { nativeInvoke as invoke } from './runtime';
import { credentialKeyFor } from './ai-routing';
import { activityTranslations, chatHistoryTranslations, providerErrorTranslations, type AppLanguage } from './i18n';

export type ModelFetchDebug = { method: string; url: string; requestBody?: string; status?: number; statusText?: string; responseHeaders?: unknown; responseBody?: unknown; transportError?: string };
type TransportOptions = {
  currentProvider: { id?: string; gatewayOnly?: boolean } | null;
  currentModel: { id?: string; gatewayOnly?: boolean } | null;
  customToolsFormat: string;
  lastModelFetchRef: { current: ModelFetchDebug | null };
};

export function createDesktopModelTransport({ currentProvider, currentModel, customToolsFormat, lastModelFetchRef }: TransportOptions) {
  const escapeXml = (value: unknown) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

  const toolsAsXml = (tools: unknown) => {
    const items = Array.isArray(tools) ? tools : [];
    return `<tools>${items.map((item) => {
      const fn = item?.function || item || {};
      const parameters = typeof fn.parameters === 'string' ? fn.parameters : JSON.stringify(fn.parameters || {});
      return `<tool name="${escapeXml(fn.name)}" type="${escapeXml(item?.type || 'function')}"><description>${escapeXml(fn.description)}</description><parameters>${escapeXml(parameters)}</parameters></tool>`;
    }).join('')}</tools>`;
  };

  const clipDebug = (value: unknown, max = 20000) => {
    const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    if (!text) return '';
    return text.length > max ? `${text.slice(0, max)}\n...[truncated ${text.length - max} chars]` : text;
  };

  const errorChain = (error: unknown) => {
    const lines = [];
    let current: any = error;
    let depth = 0;
    while (current && depth < 5) {
      const name = current?.name || typeof current;
      const message = current?.message || String(current);
      lines.push(`${depth === 0 ? 'Error' : `Cause ${depth}`}: ${name}: ${message}`);
      current = current?.cause;
      depth += 1;
    }
    return lines.join('\n');
  };

  const formatDebugError = (error: unknown) => {
    const fetch = lastModelFetchRef.current;
    const sections = [errorChain(error)];

    if (fetch) {
      sections.push([
        'Fetch:',
        `${fetch.method} ${fetch.url}`,
        fetch.requestBody ? `Request body:\n${clipDebug(fetch.requestBody)}` : 'Request body: <empty>',
        fetch.status ? `Status: ${fetch.status} ${fetch.statusText || ''}`.trim() : null,
        fetch.responseHeaders ? `Response headers:\n${clipDebug(fetch.responseHeaders)}` : null,
        fetch.responseBody ? `Response body:\n${clipDebug(fetch.responseBody)}` : null,
        fetch.transportError ? `Transport error:\n${fetch.transportError}` : null,
      ].filter(Boolean).join('\n'));
    }

    return sections.filter(Boolean).join('\n\n');
  };

  const userFacingProviderError = (error: unknown, language: AppLanguage) => {
    const rawMessage = error instanceof Error ? error.message : String(error);
    if (rawMessage.includes('CHAT_MESSAGE_TOO_LARGE')) return chatHistoryTranslations[language].tooLarge;
    if (rawMessage.includes('CHAT_HISTORY_CONFLICT')) return chatHistoryTranslations[language].conflict;
    const fetch = lastModelFetchRef.current;
    let providerMessage = '';
    if (fetch?.responseBody) {
      try {
        const payload = JSON.parse(String(fetch.responseBody)) as { error?: { message?: string }; message?: string };
        providerMessage = payload?.error?.message || payload?.message || '';
      } catch {
        providerMessage = '';
      }
    }
    const detail = String(providerMessage || rawMessage).replace(/^Error from provider[^:]*:\s*/i, '').trim();
    const normalized = detail.toLowerCase();
    if (/credit card|payment method/.test(normalized)) return activityTranslations[language].paymentRequired;
    if (/active .*subscription|subscription is required/.test(normalized)) return activityTranslations[language].subscriptionRequired;
    if (/only be used from within/.test(normalized)) return activityTranslations[language].clientRestricted;
    if (normalized.includes('model is unavailable') || normalized.includes('model unavailable')) {
      return language === 'en'
        ? 'The provider is not making this model available right now. Choose another model or try again later.'
        : 'El proveedor no tiene disponible este modelo ahora. Elegí otro modelo o probá de nuevo más tarde.';
    }
    if (fetch?.status === 401 || fetch?.status === 403 || normalized.includes('invalid api key') || normalized.includes('unauthorized')) {
      return language === 'en'
        ? 'The provider rejected the API key. Check the key and the selected provider.'
        : 'El proveedor rechazó la API key. Revisá la clave y el proveedor seleccionado.';
    }
    if (fetch?.status === 429 || normalized.includes('rate limit') || normalized.includes('too many requests')) {
      return language === 'en'
        ? 'The provider reached its request limit. Wait a moment and try again.'
        : 'El proveedor alcanzó el límite de solicitudes. Esperá un momento y probá de nuevo.';
    }
    if ([500, 502, 503, 504].includes(fetch?.status ?? 0) || /service temporarily unavailable/.test(normalized)) {
      return providerErrorTranslations[language].temporarilyUnavailable;
    }
    if (/network|fetch failed|enotfound|timeout|timed out|connection/i.test(normalized)) {
      return language === 'en'
        ? 'The provider could not be reached. Check the connection and try again.'
        : 'No se pudo conectar con el proveedor. Revisá la conexión y probá de nuevo.';
    }
    const cleanDetail = detail.replace(/\s+/g, ' ').slice(0, 220);
    return language === 'en'
      ? `The provider could not generate a response${cleanDetail ? `: ${cleanDetail}` : '.'}`
      : `El proveedor no pudo generar una respuesta${cleanDetail ? `: ${cleanDetail}` : '.'}`;
  };

  const desktopModelFetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const request = input instanceof Request ? new Request(input, init) : new Request(input, init);
    let requestBody = ['GET', 'HEAD'].includes(request.method) ? undefined : await request.clone().text();
    if (requestBody && currentProvider?.id === 'custom' && customToolsFormat === 'xml') {
      try {
        const payload = JSON.parse(requestBody);
        if (Array.isArray(payload.tools)) {
          payload.tools = toolsAsXml(payload.tools);
          requestBody = JSON.stringify(payload);
        }
      } catch {
        // Pass non-JSON response bodies through unchanged.
      }
    }
    const fetchDebug = {
      method: request.method,
      url: request.url,
      requestBody,
    };
    lastModelFetchRef.current = fetchDebug;
    const requestId=crypto.randomUUID();
    const cancelRequest=()=>{void invoke('codeclub_http_abort',{requestId}).catch(()=>undefined);};
    if(request.signal.aborted)throw request.signal.reason || new DOMException('Cancelled','AbortError');
    request.signal.addEventListener('abort',cancelRequest,{once:true});

    try {
      const response = await invoke<{ body: string; status: number; status_text?: string; headers?: Array<{ name: string; value: string }> }>('codeclub_http_fetch', {
        request: {
          url: request.url,
          method: request.method,
          headers: Array.from(request.headers.entries()).map(([name, value]) => ({ name, value })),
          body: requestBody || null,
          requestId,
          credentialKey: (window as any).codeclub?.credentialPresent && currentProvider ? credentialKeyFor(currentProvider,currentModel) : undefined,
        },
      });
      const headers = new Headers((response.headers || []).map((header) => [header.name, header.value] as [string, string]));
      lastModelFetchRef.current = {
        ...fetchDebug,
        status: response.status,
        statusText: response.status_text,
        responseHeaders: response.headers,
        responseBody: response.body,
      };
      return new Response(response.body, {
        status: response.status,
        statusText: response.status_text,
        headers,
      });
    } catch (error) {
      lastModelFetchRef.current = {
        ...fetchDebug,
        transportError: error instanceof Error ? error.message : String(error),
      };
      throw error;
    } finally {request.signal.removeEventListener('abort',cancelRequest);}
  };

  return { desktopModelFetch, formatDebugError, userFacingProviderError };
}
