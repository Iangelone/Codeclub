import { getDesktopBridge } from './runtime';
/** Native model transport, custom XML tool formatting and provider error presentation. */
import { createNativeModelFetch, type ModelFetchDebug } from './agent/native-model-fetch';
import { credentialKeyFor } from './ai-routing';
import { type AppLanguage, translate, getMessages } from './i18n';

export type { ModelFetchDebug } from './agent/native-model-fetch';
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
    if (rawMessage.includes('CHAT_MESSAGE_TOO_LARGE')) return getMessages('chatHistory', language).tooLarge;
    if (rawMessage.includes('CHAT_HISTORY_CONFLICT')) return getMessages('chatHistory', language).conflict;
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
    if (/credit card|payment method/.test(normalized)) return getMessages('activity', language).paymentRequired;
    if (/active .*subscription|subscription is required/.test(normalized)) return getMessages('activity', language).subscriptionRequired;
    if (/only be used from within/.test(normalized)) return getMessages('activity', language).clientRestricted;
    if (normalized.includes('model is unavailable') || normalized.includes('model unavailable')) {
      return translate('desktopModelTransport.theProviderIsNotMakingThisModel', language);
    }
    if (fetch?.status === 401 || fetch?.status === 403 || normalized.includes('invalid api key') || normalized.includes('unauthorized')) {
      return translate('desktopModelTransport.theProviderRejectedTheAPIKeyCheck', language);
    }
    if (fetch?.status === 429 || normalized.includes('rate limit') || normalized.includes('too many requests')) {
      return translate('desktopModelTransport.theProviderReachedItsRequestLimitWait', language);
    }
    if ([500, 502, 503, 504].includes(fetch?.status ?? 0) || /service temporarily unavailable/.test(normalized)) {
      return getMessages('providerError', language).temporarilyUnavailable;
    }
    if (/network|fetch failed|enotfound|timeout|timed out|connection/i.test(normalized)) {
      return translate('desktopModelTransport.theProviderCouldNotBeReachedCheck', language);
    }
    const cleanDetail = detail.replace(/\s+/g, ' ').slice(0, 220);
    return translate('desktopModelTransport.theProviderCouldNotGenerateAResponseValue', language, { value1: cleanDetail ? `: ${cleanDetail}` : '.' });
  };

  const desktopModelFetch = createNativeModelFetch({
    credentialKey: () => getDesktopBridge()?.credentialPresent && currentProvider ? credentialKeyFor(currentProvider, currentModel) : undefined,
    onFetch: debug => { lastModelFetchRef.current = debug; },
    prepareBody: body => {
      if (body && currentProvider?.id === 'custom' && customToolsFormat === 'xml') {
        try {
          const payload = JSON.parse(body);
          if (Array.isArray(payload.tools)) { payload.tools = toolsAsXml(payload.tools); return JSON.stringify(payload); }
        } catch { /* Non-JSON bodies pass through unchanged. */ }
      }
      return body;
    },
  });

  return { desktopModelFetch, formatDebugError, userFacingProviderError };
}
