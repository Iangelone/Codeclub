import { getSetting, setSetting } from './persistence';

export type ProviderConfiguration = {
  name: string;
  origin: 'local' | 'codeclub';
  endpoint: string;
  model: string;
  modelLabel?: string;
  provider: string;
  concurrency: number;
  requestsPerMinute: number;
  queueEnabled: boolean;
  queueCapacity: number;
};

export type MarketProvider = ProviderConfiguration & { id: string; registeredAt: string; connected?: boolean; enabled?: boolean };
const providersKey = 'codeclub_market_providers';

/**
 * Emisores: registerMarketProvider, setMarketProviderConnection setMarketProviderEnabled y removeMarketProvider, después de persistir.
 * Evento: codeclub:market-providers-changed; detail: { providerId: string }.
 * Consumidores: MarketPanel y useMarketCatalog recargan lista y catálogo.
 * Cada consumidor instala y elimina el listener en su useEffect.
 */
export const MARKET_PROVIDERS_CHANGED = 'codeclub:market-providers-changed';

export async function readMarketProviders(): Promise<MarketProvider[]> {
  const saved = await getSetting<MarketProvider[]>(providersKey, []);
  if (!Array.isArray(saved)) throw new Error('MARKET_INVALID_STORAGE');
  return saved;
}

let registrationQueue = Promise.resolve();

export async function registerMarketProvider(configuration: ProviderConfiguration, providerId?: string): Promise<void> {
  // Copiar solo campos conocidos: nunca guardar API keys dentro del registro.
  const config: ProviderConfiguration = {
    name: configuration.name.trim(),
    origin: configuration.origin,
    endpoint: configuration.origin === 'local' ? configuration.endpoint.trim() : '',
    model: configuration.model.trim(),
    modelLabel: configuration.modelLabel?.trim() || configuration.model.trim(),
    provider: configuration.origin === 'codeclub' ? configuration.provider : '',
    concurrency: configuration.concurrency,
    requestsPerMinute: configuration.requestsPerMinute,
    queueEnabled: configuration.queueEnabled,
    queueCapacity: configuration.queueEnabled ? configuration.queueCapacity : 10,
  };
  const operation = registrationQueue.then(async () => {
    const providers = await readMarketProviders();
    if (providerId && !providers.some((item) => item.id === providerId)) throw new Error('MARKET_PROVIDER_NOT_FOUND');
    const existing = providerId ? providers.find((item) => item.id === providerId) : providers.find((item) => item.origin === config.origin && item.model === config.model && item.provider === config.provider && item.endpoint === config.endpoint);
    const provider: MarketProvider = { ...config, id: existing?.id ?? crypto.randomUUID(), registeredAt: existing?.registeredAt ?? new Date().toISOString(), connected: existing?.connected ?? false, enabled: existing?.enabled ?? true };
    await setSetting(providersKey, existing ? providers.map((item) => item.id === existing.id ? provider : item) : [...providers, provider]);
    window.dispatchEvent(new CustomEvent(MARKET_PROVIDERS_CHANGED, { detail: { providerId: provider.id } }));
  });
  registrationQueue = operation.catch(() => undefined);
  return operation;
}

export async function setMarketProviderConnection(providerId: string, connected: boolean): Promise<void> {
  const operation = registrationQueue.then(async () => {
    const providers = await readMarketProviders();
    if (!providers.some((provider) => provider.id === providerId)) throw new Error('MARKET_PROVIDER_NOT_FOUND');
    await setSetting(providersKey, providers.map((provider) => provider.id === providerId ? { ...provider, connected } : provider));
    window.dispatchEvent(new CustomEvent(MARKET_PROVIDERS_CHANGED, { detail: { providerId } }));
  });
  registrationQueue = operation.catch(() => undefined);
  return operation;
}

export async function setMarketProviderEnabled(providerId: string, enabled: boolean): Promise<void> {
  const operation = registrationQueue.then(async () => {
    const providers = await readMarketProviders();
    if (!providers.some((provider) => provider.id === providerId)) throw new Error('MARKET_PROVIDER_NOT_FOUND');
    await setSetting(providersKey, providers.map((provider) => provider.id === providerId ? { ...provider, enabled } : provider));
    window.dispatchEvent(new CustomEvent(MARKET_PROVIDERS_CHANGED, { detail: { providerId } }));
  });
  registrationQueue = operation.catch(() => undefined);
  return operation;
}

export async function removeMarketProvider(providerId: string): Promise<void> {
  const operation = registrationQueue.then(async () => {
    const providers = await readMarketProviders();
    await setSetting(providersKey, providers.filter((provider) => provider.id !== providerId));
    window.dispatchEvent(new CustomEvent(MARKET_PROVIDERS_CHANGED, { detail: { providerId } }));
  });
  registrationQueue = operation.catch(() => undefined);
  return operation;
}
