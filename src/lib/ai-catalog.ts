// Live catalog fetched from https://models.dev/catalog.json?type=all
// See https://models.dev/models/ and https://models.dev/providers/ for docs.
// Each provider has a `models` object. Custom and AI Gateway are runtime providers.

let fetchedProviders: any[] = [];
let fetchedModels: any[] = [];

try {
  const providersRes = await fetch("https://models.dev/catalog.json?type=all");
  if (!providersRes.ok) throw new Error(`models.dev catalog: HTTP ${providersRes.status}`);
  const apiData = await providersRes.json() as { providers?: Record<string, any> };
  const providerEntries = Object.entries(apiData.providers || {});

  // Map each provider entry — id, label, api base URL, doc URL, short label for UI.
  fetchedProviders = providerEntries.map(([providerKey, p]: [string, any]) => ({
    id: p.id || providerKey,
    label: p.name || p.id || providerKey,
    api: p.api,
    shortLabel: (p.name || p.id || providerKey).charAt(0),
    doc: p.doc || "",
    env: Array.isArray(p.env) ? p.env : [],
    requiresApiKey: Array.isArray(p.env) ? p.env.length > 0 : true,
    gatewayOnly: false,
  }));

  // Flatten each provider's models into a flat list with providerId ref.
  fetchedModels = providerEntries.flatMap(([providerKey, p]: [string, any]) => {
    if (!p.models) return [];
    const providerId = p.id || providerKey;
    const providerName = p.name || providerId;
    return Object.entries(p.models).map(([modelKey, m]: [string, any]) => ({
      id: m.id || modelKey,
      gatewayId: `${providerId}/${m.id || modelKey}`,
      label: m.name || m.id || modelKey,
      providerId,
      providerName,
      description: m.description || "",
      reasoning: Boolean(m.reasoning),
      toolCall: Boolean(m.tool_call),
      structuredOutput: Boolean(m.structured_output),
      contextWindow: Number(m.limit?.context) || undefined,
      cost: m.cost || null,
    }));
  });

  // Runtime provider for user-defined OpenAI-compatible endpoints.
  fetchedProviders.push({
    id: "custom",
    label: "Custom",
    shortLabel: "C",
    doc: "",
    api: ""
  });
  fetchedProviders.push({
    id: "ai-gateway",
    label: "AI Gateway",
    shortLabel: "A",
    doc: "https://ai-sdk.dev/providers/ai-sdk-providers/ai-gateway",
    api: "",
    gateway: true,
  });
} catch (e) {
  console.error("Error fetching models.dev catalog:", e);
}

try {
  const gatewayResponse = await fetch('https://ai-gateway.vercel.sh/v1/models');
  if (!gatewayResponse.ok) throw new Error(`AI Gateway catalog: HTTP ${gatewayResponse.status}`);
  {
    const gatewayData = await gatewayResponse.json() as { data?: Array<{ id?: string; owned_by?: string; name?: string; description?: string; type?: string; tags?: string[] }> };
    for (const entry of gatewayData.data || []) {
      // The chat engine accepts language models; embedding/image/audio models
      // require other SDK APIs and must not become selectable chat models.
      if (entry.type && entry.type !== 'language') continue;
      const gatewayId = String(entry.id || '').trim();
      const separator = gatewayId.indexOf('/');
      if (separator <= 0 || separator === gatewayId.length - 1) continue;
      const providerId = gatewayId.slice(0, separator);
      const modelId = gatewayId.slice(separator + 1);
      const existingProvider = fetchedProviders.find((provider) => provider.id === providerId);
      const providerName = existingProvider?.label || String(entry.owned_by || providerId);
      if (!fetchedProviders.some((provider) => provider.id === providerId)) {
        fetchedProviders.push({ id: providerId, label: providerName, shortLabel: providerName.charAt(0), doc: '', api: '', env: [], requiresApiKey: true, gatewayOnly: true });
      }
      const existingModel = fetchedModels.find((model) => model.gatewayId === gatewayId);
      if (existingModel) {
        // Preserve the direct route and its metadata; the existing AI Gateway
        // provider can also select this model through its gateway ID.
        existingModel.gatewayAvailable = true;
      } else {
        fetchedModels.push({ id: modelId, gatewayId, label: entry.name || modelId, providerId, providerName, description: entry.description || '', cost: null, gatewayOnly: true, gatewayAvailable: true, reasoning: entry.tags?.includes('reasoning') || false, toolCall: entry.tags?.includes('tool-use') || false, structuredOutput: entry.tags?.includes('structured-output') || false });
      }
    }
  }
} catch (e) {
  console.warn('AI Gateway catalog unavailable:', e);
}

if (!fetchedProviders.some((provider) => provider.id === 'custom')) fetchedProviders.push({ id: 'custom', label: 'Custom', shortLabel: 'C', doc: '', api: '' });
if (!fetchedProviders.some((provider) => provider.id === 'ai-gateway')) fetchedProviders.push({ id: 'ai-gateway', label: 'AI Gateway', shortLabel: 'A', doc: 'https://ai-sdk.dev/providers/ai-sdk-providers/ai-gateway', api: '', gateway: true });

const uniqueById = (items: any[]) => Array.from(new Map(items.filter((item) => item?.id).map((item) => [item.id, item])).values());
const uniqueModels = (items: any[]) => Array.from(new Map(items.filter((item) => item?.id).map((item) => [item.gatewayId || `${item.providerId}/${item.id}`, item])).values());

export const providers = uniqueById(fetchedProviders).sort((a, b) => {
  if (a.id === 'ai-gateway') return 1;
  if (b.id === 'ai-gateway') return -1;
  return String(a.label).localeCompare(String(b.label));
});
export const models = uniqueModels(fetchedModels).sort((a, b) => String(a.label).localeCompare(String(b.label)));
