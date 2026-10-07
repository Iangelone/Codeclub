import { useEffect, useMemo, useState } from 'react';
import { models, providers } from './ai-catalog';
import { modelIdFor, modelMatchesProvider, usesGateway } from './ai-routing';
import { MARKET_PROVIDERS_CHANGED, readMarketProviders, readMarketConnections, type MarketProvider } from './market-providers';

import { marketClient, readPublishedProviders } from './market-cloud';

type CatalogItem = { id: string; type?: string; [key: string]: any };

export function useMarketCatalog(baseCatalog: CatalogItem[]): { catalog: CatalogItem[]; ready: boolean } {
  const [offers, setOffers] = useState<MarketProvider[]>([]);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let active = true;
    let revision = 0;
    const refresh = async () => {
      if (!active) return;
      const currentRevision = ++revision;
      try {
        const { data: { session } } = await marketClient().auth.getSession();
        const saved = await readMarketProviders();
        const ids = session ? await readMarketConnections(session.user.id) : [];
        const online = session ? await readPublishedProviders() : [];
        const selected = online.filter(offer => ids.includes(offer.id)).map(offer => ({ ...offer, connected: true }));
        const local = saved.filter(offer => !offer.remoteId && !offer.ownerId);
        const available = [...local, ...selected];
        if (active && currentRevision === revision) setOffers(available.filter((offer) => offer.connected && offer.enabled !== false));
      } catch { if (active && currentRevision === revision) setOffers([]); }
      finally { if (active && currentRevision === revision) setReady(true); }
    };
    void refresh();
    const changed = () => { void refresh(); };
    window.addEventListener(MARKET_PROVIDERS_CHANGED, changed);
    const { data: { subscription } } = marketClient().auth.onAuthStateChange(() => { setOffers([]); window.setTimeout(changed, 0); });
    const timer = window.setInterval(changed, 15000);
    return () => { subscription.unsubscribe(); window.clearInterval(timer); active = false; window.removeEventListener(MARKET_PROVIDERS_CHANGED, changed); };
  }, []);
  const catalog = useMemo(() => {
    const additions: CatalogItem[] = [];
    for (const offer of offers) {
      if (offer.remote) {
        const id = `market-${offer.id}`;
        additions.push({ id, type: 'provider', label: offer.name, shortLabel: offer.name.charAt(0), marketProviderId: offer.id, marketRemote: true, requiresApiKey: false, api: '' });
        additions.push({ id: `${id}-model`, type: 'model', label: offer.modelLabel || offer.model, providerId: id, providerName: offer.name, marketProviderId: offer.id, marketRemote: true });
        continue;
      }
      const source = offer.origin === 'codeclub' ? providers.find((provider) => provider.id === offer.provider) : null;
      const sourceModel = source ? models.find((model) => model.id === offer.model && modelMatchesProvider(model, source)) : null;
      if (offer.origin === 'codeclub' && (!source || !sourceModel)) continue;
      const id = `market-${offer.id}`;
      const gateway = !!source && usesGateway(source, sourceModel);
      additions.push({ ...source, id, type: 'provider', label: offer.name, shortLabel: offer.name.charAt(0), marketProviderId: offer.id, sourceProviderId: source?.id || 'custom', api: source?.api || offer.endpoint, gatewayOnly: gateway, requiresApiKey: source ? gateway || source.requiresApiKey !== false : false });
      additions.push({ ...sourceModel, id: `${id}-model`, type: 'model', label: offer.modelLabel || offer.model, providerId: id, providerName: offer.name, marketProviderId: offer.id, gatewayId: undefined, gatewayOnly: gateway, gatewayAvailable: false, sourceModelId: source && sourceModel ? modelIdFor(source, sourceModel) : offer.model });
    }
    return [...baseCatalog, ...additions];
  }, [baseCatalog, offers]);
  return { catalog, ready };
}
