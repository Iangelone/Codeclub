'use client';

import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { getSetting, setSetting } from '../lib/persistence';
import { providerRegistrationTranslations, useAppLanguage } from '../lib/i18n';
import { useOrbPalette } from './OrbPaletteProvider';
import ScheduledSelect from './ui/ScheduledSelect';
import { models, providers } from '../lib/ai-catalog';
import { credentialKeyFor, modelMatchesProvider, usesGateway } from '../lib/ai-routing';
import { registerMarketProvider, type ProviderConfiguration, type MarketProvider } from '../lib/market-providers';

type ProviderDraft = ProviderConfiguration;
const draftKey = 'codeclub_market_provider_draft';
const initialDraft: ProviderDraft = { name: '', origin: 'local', endpoint: 'http://localhost:11434/v1', model: '', provider: '', concurrency: 1, requestsPerMinute: 0, queueEnabled: false, queueCapacity: 10 };
const inputClass = 'mt-2 h-9 w-full rounded-none border border-[#2B2B2B] bg-[#161616] px-3 text-[13px] text-[#eeeeee] outline-none placeholder:text-[#777777] focus:border-(--codeclub-accent)';

export default function ProviderRegistrationModal({ onClose, provider }: { onClose: () => void; provider?: MarketProvider }) {
  const { palette } = useOrbPalette();
  const language = useAppLanguage();
  const text = providerRegistrationTranslations[language];
  const [draft, setDraft] = useState(initialDraft);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<keyof typeof text | ''>('');
  const [apiKey, setApiKey] = useState('');
  const [hasCredential, setHasCredential] = useState(false);
  const [credentialReady, setCredentialReady] = useState(false);
  const catalogProviders = providers.filter((provider) => provider.id !== 'custom');
  const selectedProvider = catalogProviders.find((provider) => provider.id === draft.provider);
  const providerModels = selectedProvider ? models.filter((model) => modelMatchesProvider(model, selectedProvider)) : [];
  const selectedModel = providerModels.find((model) => model.id === draft.model);
  const credentialKey = selectedProvider ? credentialKeyFor(selectedProvider, selectedModel) : '';
  const requiresCredential = !!selectedProvider && (usesGateway(selectedProvider, selectedModel) || selectedProvider.requiresApiKey !== false);
  const optionLabel = (item: { label?: string; id: string }) => `${item.label || item.id} (${item.id})`;
  const dialogRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (provider) { setDraft(provider); setReady(true); return; }
    let active = true;
    void getSetting<ProviderDraft | null>(draftKey, null).then((saved) => {
      if (!active) return;
      if (saved) setDraft({ name: typeof saved.name === 'string' ? saved.name : '', origin: saved.origin === 'codeclub' ? 'codeclub' : 'local', endpoint: typeof saved.endpoint === 'string' ? saved.endpoint : initialDraft.endpoint, model: typeof saved.model === 'string' ? saved.model : '', modelLabel: typeof saved.modelLabel === 'string' ? saved.modelLabel : '', provider: typeof saved.provider === 'string' ? saved.provider : '', concurrency: Number.isInteger(saved.concurrency) ? Math.min(32, Math.max(1, saved.concurrency)) : 1, requestsPerMinute: Number.isInteger(saved.requestsPerMinute) ? Math.min(100000, Math.max(0, saved.requestsPerMinute)) : 0, queueEnabled: saved.queueEnabled === true, queueCapacity: Number.isInteger(saved.queueCapacity) ? Math.min(1000, Math.max(1, saved.queueCapacity)) : 10 });
      setReady(true);
    }).catch(() => { if (active) setError('loadError'); });
    return () => { active = false; };
  }, [provider]);

  useEffect(() => {
    let active = true;
    setApiKey('');
    setHasCredential(false);
    setCredentialReady(false);
    if (draft.origin !== 'codeclub' || !credentialKey || !requiresCredential) { setCredentialReady(true); return; }
    void getSetting(credentialKey, '').then((credential) => { if (active) { setHasCredential(Boolean(credential)); setCredentialReady(true); } }).catch(() => { if (active) { setError('error'); setCredentialReady(true); } });
    return () => { active = false; };
  }, [draft.origin, credentialKey, requiresCredential]);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onCloseRef.current(); }
      if (event.key !== 'Tab') return;
      const elements = dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"]');
      if (!elements?.length) return;
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialogRef.current)) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', handleKey, true);
    return () => { document.removeEventListener('keydown', handleKey, true); previousFocus?.focus(); };
  }, []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!ready || saving) return;
    setError('');
    if (!Number.isInteger(draft.concurrency) || draft.concurrency < 1 || draft.concurrency > 32 || !Number.isInteger(draft.requestsPerMinute) || draft.requestsPerMinute < 0 || draft.requestsPerMinute > 100000 || (draft.queueEnabled && (!Number.isInteger(draft.queueCapacity) || draft.queueCapacity < 1 || draft.queueCapacity > 1000))) { setError('invalidLimits'); return; }
    if (draft.origin === 'local') try {
      const endpoint = new URL(draft.endpoint.trim());
      if (!['http:', 'https:'].includes(endpoint.protocol) || !endpoint.hostname || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new Error();
    } catch { setError('invalidEndpoint'); return; }
    setSaving(true);
    try {
      if (draft.origin === 'codeclub') {
        if (!selectedProvider || !selectedModel || !credentialReady || (requiresCredential && !hasCredential && !apiKey.trim())) throw new Error();
        if (apiKey.trim() && requiresCredential) {
          const credentialOrigin = usesGateway(selectedProvider, selectedModel) ? 'https://ai-gateway.vercel.sh' : selectedProvider.api;
          const bridge = (window as any).codeclub;
          if (!bridge?.credentialSet || !credentialOrigin) throw new Error();
          await bridge.credentialSet(credentialKey, apiKey.trim(), credentialOrigin);
        }
      }
      const configuration = { ...draft, name: draft.name.trim(), endpoint: draft.endpoint.trim(), model: draft.model.trim(), modelLabel: draft.modelLabel?.trim() || selectedModel?.label || draft.model.trim(), queueCapacity: draft.queueEnabled ? draft.queueCapacity : 10 };
      await setSetting(draftKey, configuration);
      await registerMarketProvider(configuration, provider?.id);
      onClose();
    } catch { setError('error'); }
    finally { setSaving(false); }
  };

  return createPortal(<div style={{ '--codeclub-accent': palette.accent, '--codeclub-accent-bright': palette.bright } as CSSProperties} className="fixed inset-0 z-[2147483647] flex items-center justify-center bg-black/65 p-4 backdrop-blur-[3px]" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}>
    <section ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="provider-registration-title" aria-describedby="provider-registration-description" className="flex max-h-[85vh] w-[min(620px,92vw)] flex-col overflow-hidden rounded-none border border-[#252525] bg-[#111111] text-[#dddddd] shadow-2xl shadow-black/60 outline-none">
      <header className="flex items-start justify-between gap-4 border-b border-[#202020] p-5">
        <div><h2 id="provider-registration-title" className="m-0 text-[18px] font-medium text-[#eeeeee]">{provider ? text.editTitle : text.title}</h2><p id="provider-registration-description" className="mb-0 mt-1.5 text-[12px] text-[#888888]">{text.description}</p></div>
        <button type="button" disabled={saving} onClick={onClose} title={text.close} aria-label={text.close} className="grid h-7 w-7 shrink-0 place-items-center text-[#888888] hover:bg-[#202020] hover:text-white focus-visible:outline-2 focus-visible:outline-(--codeclub-accent)"><X size={16} aria-hidden="true" /></button>
      </header>
      <form onSubmit={submit} className="project-files-modal-scroll min-h-0 overflow-y-auto p-5">
        {!ready && !error && <p role="status" className="text-[12px] text-[#888888]">{text.loading}</p>}
        <fieldset disabled={!ready || saving} className="m-0 grid min-w-0 gap-5 border-0 p-0 disabled:opacity-50">
          <label className="text-[12px]">{text.name}<input required maxLength={80} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder={text.namePlaceholder} className={inputClass} /></label>
          <fieldset className="m-0 min-w-0 border-0 p-0"><legend className="mb-2 text-[12px]">{text.origin}</legend><div className="grid grid-cols-2 gap-2">{(['local', 'codeclub'] as const).map((origin) => <label key={origin} className={`flex cursor-pointer items-center gap-2 border px-3 py-3 text-[12px] ${draft.origin === origin ? 'border-(--codeclub-accent) bg-[#191919]' : 'border-[#2B2B2B] bg-[#161616]'}`}><input type="radio" name="provider-origin" value={origin} checked={draft.origin === origin} onChange={() => setDraft({ ...draft, origin })} className="accent-(--codeclub-accent)" />{text[origin]}</label>)}</div><p className="mb-0 mt-2 text-[11px] leading-5 text-[#888888]">{draft.origin === 'local' ? text.localNote : text.codeclubNote}</p></fieldset>
          {draft.origin === 'codeclub' && <div className="grid min-w-0 gap-4">
            <div><p className="mb-2 mt-0 text-[12px]">{text.provider}</p><ScheduledSelect variant="modal" value={selectedProvider ? optionLabel(selectedProvider) : text.selectProvider} options={catalogProviders.map(optionLabel)} label={text.provider} searchable onChange={(value) => { const provider = catalogProviders.find((item) => optionLabel(item) === value); if (provider) setDraft({ ...draft, provider: provider.id, model: '' }); }} /></div>
            <div><p className="mb-2 mt-0 text-[12px]">{text.model}</p><ScheduledSelect variant="modal" value={selectedModel ? optionLabel(selectedModel) : text.selectModel} options={providerModels.map(optionLabel)} label={text.model} searchable onChange={(value) => { const model = providerModels.find((item) => optionLabel(item) === value); if (model) setDraft({ ...draft, model: model.id }); }} /></div>
            {selectedProvider && requiresCredential && <label className="text-[12px]">{text.apiKey}<input type="password" autoComplete="new-password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={hasCredential ? text.keepCredential : text.enterKey} className={inputClass} /><span className="mt-2 block text-[11px] text-[#888888]">{text.keyNote}</span></label>}
          </div>}
          {draft.origin === 'local' && <label className="text-[12px]">{text.endpoint}<input required type="url" value={draft.endpoint} onChange={(event) => setDraft({ ...draft, endpoint: event.target.value })} placeholder="http://192.168.1.20:1234/v1" aria-describedby="provider-endpoint-note" className={inputClass} /><span id="provider-endpoint-note" className="mt-2 block text-[11px] leading-5 text-[#888888]">{text.endpointNote}</span></label>}
          {draft.origin === 'local' && <label className="text-[12px]">{text.model}<input required maxLength={200} value={draft.model} onChange={(event) => setDraft({ ...draft, model: event.target.value })} placeholder={text.modelPlaceholder} className={inputClass} /></label>}
          <label className="text-[12px]">{text.modelLabel}<input maxLength={100} value={draft.modelLabel || ''} onChange={(event) => setDraft({ ...draft, modelLabel: event.target.value })} placeholder={selectedModel?.label || draft.model || text.modelLabelPlaceholder} className={inputClass} /></label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-[12px]">{text.requestLimit}<input required type="number" min={0} max={100000} step={1} value={Number.isFinite(draft.requestsPerMinute) ? draft.requestsPerMinute : ''} onChange={(event) => setDraft({ ...draft, requestsPerMinute: event.target.valueAsNumber })} aria-describedby="provider-rate-note" className={inputClass} /><span id="provider-rate-note" className="mt-2 block text-[11px] text-[#888888]">{text.requestLimitNote}</span></label>
            <label className="text-[12px]">{text.concurrency}<input required type="number" min={1} max={32} step={1} value={Number.isFinite(draft.concurrency) ? draft.concurrency : ''} onChange={(event) => setDraft({ ...draft, concurrency: event.target.valueAsNumber })} className={inputClass} /></label>
          </div>
          <div className="border border-[#2B2B2B] bg-[#161616] p-3">
            <label className="flex cursor-pointer items-center gap-2 text-[12px]"><input type="checkbox" checked={draft.queueEnabled} onChange={(event) => setDraft({ ...draft, queueEnabled: event.target.checked })} className="accent-(--codeclub-accent)" />{text.queue}</label>
            <p className="mb-0 mt-2 text-[11px] leading-5 text-[#888888]">{draft.queueEnabled ? text.queueNote : text.noQueueNote}</p>
            {draft.queueEnabled && <label className="mt-3 block text-[12px]">{text.queueCapacity}<input required type="number" min={1} max={1000} step={1} value={Number.isFinite(draft.queueCapacity) ? draft.queueCapacity : ''} onChange={(event) => setDraft({ ...draft, queueCapacity: event.target.valueAsNumber })} className={inputClass} /></label>}
          </div>
        </fieldset>
        <p className="mb-0 mt-5 border-t border-[#202020] pt-4 text-[11px] leading-5 text-[#888888]">{text.draftNote}</p>
        {error && <p role="alert" className="mt-3 text-[12px] text-red-300">{text[error]}</p>}
        <footer className="mt-5 flex justify-end gap-2"><button type="button" disabled={saving} onClick={onClose} className="rounded-lg px-3 py-2 text-[12px] hover:bg-[#202020] focus-visible:outline-2 focus-visible:outline-(--codeclub-accent)">{text.cancel}</button><button type="submit" disabled={!ready || saving || !draft.name.trim() || !draft.model.trim() || (draft.origin === 'codeclub' && (!selectedProvider || !selectedModel || !credentialReady || (requiresCredential && !hasCredential && !apiKey.trim())))} className="rounded-lg bg-white px-3 py-2 text-[12px] font-medium text-[#111111] hover:bg-[#e5e5e5] focus-visible:outline-2 focus-visible:outline-(--codeclub-accent) disabled:cursor-not-allowed disabled:opacity-40">{saving ? text.saving : provider ? text.saveChanges : text.save}</button></footer>
      </form>
    </section>
  </div>, document.body);
}
