'use client';

import { useEffect, useState } from 'react';
import { Search, Scale, Pencil, Trash2, Play, Pause } from 'lucide-react';
import { marketTranslations, useAppLanguage } from '../lib/i18n';
import ProviderRegistrationModal from './ProviderRegistrationModal';
import { MARKET_PROVIDERS_CHANGED, readMarketProviders, setMarketProviderConnection, setMarketProviderEnabled, removeMarketProvider, type MarketProvider } from '../lib/market-providers';
import { providers as catalogProviders } from '../lib/ai-catalog';

export default function MarketPanel() {
  const language = useAppLanguage();
  const text = marketTranslations[language];
  const [tab, setTab] = useState<'providers' | 'status'>('providers');
  const [query, setQuery] = useState('');
  const [editingProvider, setEditingProvider] = useState<MarketProvider | undefined>();
  const [registrationOpen, setRegistrationOpen] = useState(false);
  const [providers, setProviders] = useState<MarketProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reload, setReload] = useState(0);
  const [pendingConnections, setPendingConnections] = useState<string[]>([]);
  const [connectionFailed, setConnectionFailed] = useState(false);
  const toggleConnection = async (provider: MarketProvider) => {
    setPendingConnections((pending) => [...pending, provider.id]);
    setConnectionFailed(false);
    try {
      if (tab === 'status') await setMarketProviderEnabled(provider.id, provider.enabled === false);
      else await setMarketProviderConnection(provider.id, !provider.connected);
    }
    catch { setConnectionFailed(true); }
    finally { setPendingConnections((pending) => pending.filter((id) => id !== provider.id)); }
  };
  const removeProvider = async (provider: MarketProvider) => {
    setPendingConnections((pending) => [...pending, provider.id]);
    setConnectionFailed(false);
    try { await removeMarketProvider(provider.id); }
    catch { setConnectionFailed(true); }
    finally { setPendingConnections((pending) => pending.filter((id) => id !== provider.id)); }
  };
  useEffect(() => {
    let active = true;
    let revision = 0;
    const refresh = async () => {
      const currentRevision = ++revision;
      try {
        const saved = await readMarketProviders();
        if (active && currentRevision === revision) { setProviders(saved); setLoadFailed(false); }
      } catch { if (active && currentRevision === revision) setLoadFailed(true); }
      finally { if (active && currentRevision === revision) setLoading(false); }
    };
    void refresh();
    const changed = () => { void refresh(); };
    window.addEventListener(MARKET_PROVIDERS_CHANGED, changed);
    return () => { active = false; window.removeEventListener(MARKET_PROVIDERS_CHANGED, changed); };
  }, [reload]);
  const visibleProviders = providers.filter((provider) => (tab === 'status' || provider.enabled !== false) && `${provider.name} ${provider.modelLabel || ''} ${provider.model} ${provider.provider}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));

  return <section id="codeclub-market-panel" className="h-full min-h-0 overflow-y-auto bg-(--codeclub-center) [scrollbar-color:#444444_transparent] [scrollbar-width:thin]" aria-label={text.title}>
    <div className="mx-auto min-w-0 w-full max-w-[1040px] px-6 py-7 lg:px-8">
      <header className="mb-6">
        <h1 className="m-0 text-[28px] font-normal tracking-[-0.04em] text-(--codeclub-text-strong)">{text.title}</h1>
        <p className="mt-1.5 text-[14px] text-(--codeclub-text-muted)">{text.description}</p>
      </header>
      <div className="relative flex h-9 items-center rounded-full border border-[#454545] bg-[#292929] px-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] focus-within:border-[#666666]">
        <Search size={17} className="mr-2 shrink-0 text-[#999999]" aria-hidden="true" />
        <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={text.search} aria-label={text.search} className="min-w-0 flex-1 bg-transparent text-[14px] text-(--codeclub-text-strong) outline-none placeholder:text-[#929292]" />
      </div>
      <div className="mt-8 flex items-center justify-between gap-3 border-b border-white/[0.06] pb-3">
        <div className="flex items-center gap-1" role="group" aria-label={text.title}>
          {(['providers', 'status'] as const).map((item) => <button key={item} type="button" aria-pressed={tab === item} onClick={() => setTab(item)} className={`rounded-md px-3 py-1.5 text-[13px] font-normal focus-visible:outline-2 focus-visible:outline-(--codeclub-accent) ${tab === item ? 'bg-(--codeclub-hover) text-(--codeclub-text-strong)' : 'text-(--codeclub-text-muted) hover:text-(--codeclub-text)'}`}>{item === 'providers' ? text.available : text.status}</button>)}
        </div>
        <button type="button" onClick={() => { setEditingProvider(undefined); setRegistrationOpen(true); }} className="shrink-0 rounded-lg bg-white px-3 py-1.5 text-[12px] font-medium text-[#111111] transition-colors hover:bg-[#e5e5e5] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--codeclub-accent)">{text.becomeProvider}</button>
      </div>
      {tab === 'status' && <p className="mt-3 px-2 text-[11px] text-(--codeclub-text-muted)">{text.statusNote}</p>}
      {loading && <p role="status" className="mt-8 px-2 text-[13px] text-(--codeclub-text-muted)">{text.loading}</p>}
      {connectionFailed && <p role="alert" className="mt-3 px-2 text-[12px] text-red-300">{text.actionError}</p>}
      {loadFailed && <div role="alert" className="mt-8 px-2 text-[13px] text-red-300">{text.loadError}<button type="button" onClick={() => { setLoading(true); setReload((value) => value + 1); }} className="ml-3 rounded-md px-2 py-1 text-(--codeclub-text) hover:bg-(--codeclub-hover) focus-visible:outline-2 focus-visible:outline-(--codeclub-accent)">{text.retry}</button></div>}
      {!loading && !loadFailed && visibleProviders.length === 0 && <p role="status" className="mt-8 px-2 text-[13px] text-(--codeclub-text-muted)">{query.trim() ? text.noResults : text.empty}</p>}
      {!loading && !loadFailed && visibleProviders.length > 0 && <ul className="m-0 mt-3 list-none divide-y divide-[#202020] p-0">
        {visibleProviders.map((provider) => <li key={provider.id} className="flex min-w-0 items-center gap-2.5 px-2 py-2.5" title={`${text.localRegistration} · ${text.concurrent}: ${provider.concurrency} · ${text.rate}: ${provider.requestsPerMinute || text.unlimited} · ${text.queue}: ${provider.queueEnabled ? provider.queueCapacity : text.disabled}`}>
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-[#2B2B2B] bg-[#161616] text-(--codeclub-text-muted)"><Scale size={14} aria-hidden="true" /></span>
          <div className="min-w-0 flex-1"><h3 className="m-0 truncate text-[13px] font-medium text-(--codeclub-text-strong)">{provider.name}</h3>
            <p className="mb-0 mt-0.5 truncate text-[11px] text-(--codeclub-text-muted)">{provider.modelLabel || provider.model} · {provider.origin === 'codeclub' ? catalogProviders.find((item) => item.id === provider.provider)?.label || provider.provider : text.localModel}</p>
          </div>
          {tab === 'status' && <span className="text-[11px] text-(--codeclub-text-muted)">{provider.enabled === false ? text.paused : text.active}</span>}
          <button type="button" disabled={pendingConnections.includes(provider.id)} title={tab === 'status' ? (provider.enabled === false ? text.activate : text.pause) : (provider.connected ? text.disconnect : text.connect)} aria-pressed={tab === 'status' ? provider.enabled !== false : !!provider.connected} aria-label={`${tab === 'status' ? (provider.enabled === false ? text.activate : text.pause) : (provider.connected ? text.disconnect : text.connect)} ${provider.name}`} onClick={() => { void toggleConnection(provider); }} className="shrink-0 rounded-md border border-[#2B2B2B] px-2.5 py-1 text-[11px] text-(--codeclub-text) hover:bg-(--codeclub-hover) focus-visible:outline-2 focus-visible:outline-(--codeclub-accent) disabled:opacity-40">{tab === 'status' ? (provider.enabled === false ? <Play size={13} aria-hidden="true" /> : <Pause size={13} aria-hidden="true" />) : (provider.connected ? text.disconnect : text.connect)}</button>
          {tab === 'status' && <>
            <button type="button" disabled={pendingConnections.includes(provider.id)} title={text.edit} aria-label={`${text.edit}: ${provider.name}`} onClick={() => { setEditingProvider(provider); setRegistrationOpen(true); }} className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-(--codeclub-text-muted) hover:bg-(--codeclub-hover) hover:text-(--codeclub-text-strong) focus-visible:outline-2 focus-visible:outline-(--codeclub-accent) disabled:opacity-40"><Pencil size={13} aria-hidden="true" /></button>
            <button type="button" disabled={pendingConnections.includes(provider.id)} title={text.remove} aria-label={`${text.remove}: ${provider.name}`} onClick={() => { void removeProvider(provider); }} className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-(--codeclub-text-muted) hover:bg-(--codeclub-hover) hover:text-red-300 focus-visible:outline-2 focus-visible:outline-(--codeclub-accent) disabled:opacity-40"><Trash2 size={13} aria-hidden="true" /></button>
          </>}
        </li>)}
      </ul>}
    </div>
    {registrationOpen && <ProviderRegistrationModal provider={editingProvider} onClose={() => setRegistrationOpen(false)} />}
  </section>;
}
