'use client';

/** Lists and edits autonomous or scheduled agents; run status and history are authoritative in Electron. */
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { Check, Copy, Play, Plus, Search, Square, X, MessageSquare, Trash2 } from 'lucide-react';
import { getSetting, setSetting } from '../lib/persistence';
import { ORBS_STORAGE_KEY, type OrbDefinition } from '../lib/chat-resources';
import { orbControlTranslations, orbsTranslations, useAppLanguage } from '../lib/i18n';
import { readGlobalChatHistory } from '../lib/projectManager';
import type { ScheduledTask } from '../lib/scheduled-tasks';
import { useSharedSessions } from '../lib/shared-sessions';
import { ORB_PALETTES } from './OrbPaletteProvider';
import FluidOrb from './ui/fluid-orb';
import { models, providers } from '../lib/ai-catalog';
import { credentialKeyFor, modelIdFor, modelMatchesProvider, usesGateway } from '../lib/ai-routing';

type Orb = OrbDefinition;
type CatalogOption = { id: string; label: string; providerId?: string; gatewayId?: string; gatewayOnly?: boolean; gatewayAvailable?: boolean; api?: string; requiresApiKey?: boolean };

const STORAGE_KEY = ORBS_STORAGE_KEY;
const COLORS = ORB_PALETTES.map((palette) => palette.orb);
const LEGACY_COLORS = ['#ff8a3d', '#f5b942', '#40c992', '#42a5f5', '#9b7cff', '#ed6a9b'];
const normalizeColor = (color: string) => {
  const legacyIndex = LEGACY_COLORS.indexOf(color.toLowerCase());
  return legacyIndex >= 0 ? COLORS[[5, 2, 4, 0, 3, 6][legacyIndex]] : COLORS.includes(color as typeof COLORS[number]) ? color : COLORS[0];
};
const selectableProviders = providers.filter((provider) => provider.id !== 'custom') as CatalogOption[];
const defaultProvider = (providers[0]?.id === 'custom' ? selectableProviders[0] : providers[0]) as CatalogOption | undefined;
const defaultModel = (defaultProvider && models.find((model) => modelMatchesProvider(model, defaultProvider)) || models[0]) as CatalogOption | undefined;
const emptyOrb = (): Orb => ({ id: crypto.randomUUID(), name: '', purpose: '', color: COLORS[0], providerId: defaultProvider?.id || '', modelId: defaultModel ? modelIdFor(defaultProvider || {}, defaultModel) : '' });

function CatalogPicker({ id, label, value, items, placeholder, noResults, autoFocus = false, onSelect }: { id: string; label: string; value?: CatalogOption; items: CatalogOption[]; placeholder: string; noResults: string; autoFocus?: boolean; onSelect: (item: CatalogOption) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const options = items.filter((item) => `${item.label} ${item.id}`.toLowerCase().includes(query.trim().toLowerCase()));
  const updateMenuPosition = () => {
    const rect = inputRef.current?.getBoundingClientRect();
    if (!rect) return;
    const maxHeight = Math.min(156, Math.max(64, rect.top - 12));
    setMenuPosition({ top: Math.max(8, rect.top - maxHeight - 4), left: rect.left, width: rect.width, maxHeight });
  };
  const showMenu = () => {
    setOpen(true);
    setQuery('');
    setActiveIndex(0);
    updateMenuPosition();
    requestAnimationFrame(() => searchRef.current?.focus());
  };
  const choose = (item: CatalogOption) => { onSelect(item); setQuery(''); setOpen(false); inputRef.current?.focus(); };
  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!wrapperRef.current?.contains(target) && !menuRef.current?.contains(target)) { setOpen(false); setQuery(''); }
    };
    const reposition = () => updateMenuPosition();
    window.addEventListener('pointerdown', closeOutside);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      window.removeEventListener('pointerdown', closeOutside);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [open]);
  return <div ref={wrapperRef} className="relative min-w-0">
    <label htmlFor={id} className="mb-1 block text-[11px] text-[#aaaaaa]">{label}</label>
    <input ref={inputRef} id={id} autoFocus={autoFocus} role="combobox" aria-autocomplete="none" aria-expanded={open} aria-controls={`${id}-options`} value={value?.label || ''} placeholder={placeholder} readOnly onClick={showMenu} onKeyDown={(event) => {
      if (event.key === 'Escape' && open) { event.preventDefault(); setOpen(false); inputRef.current?.focus(); }
      if (['ArrowDown', 'Enter', ' '].includes(event.key)) { event.preventDefault(); showMenu(); }
    }} className="h-8 w-full cursor-pointer border border-[#2b2b2b] bg-[#101010] px-2.5 text-[12px] text-[#eeeeee] outline-none placeholder:text-[#666666] focus-visible:border-[#8BC7FF] focus-visible:ring-1 focus-visible:ring-[#8BC7FF]" />
    {open && menuPosition && typeof document !== 'undefined' && createPortal(<div ref={menuRef} style={{ position: 'fixed', top: menuPosition.top, left: menuPosition.left, width: menuPosition.width, maxHeight: menuPosition.maxHeight, zIndex: 2147483647 }} className="flex flex-col overflow-hidden border border-[#303030] bg-[#171717] p-1 shadow-xl shadow-black/50">
      <div className="relative mb-1 shrink-0">
        <Search size={13} aria-hidden="true" className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[#777777]" />
        <input ref={searchRef} type="text" role="combobox" aria-label={`${label}: ${placeholder}`} aria-autocomplete="list" aria-expanded="true" aria-controls={`${id}-options`} aria-activedescendant={options[activeIndex] ? `${id}-option-${activeIndex}` : undefined} value={query} placeholder={placeholder} onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); }} onKeyDown={(event) => {
        if (event.key === 'Escape') { event.preventDefault(); setOpen(false); setQuery(''); inputRef.current?.focus(); }
        if (event.key === 'ArrowDown') { event.preventDefault(); setActiveIndex((index) => Math.min(index + 1, options.length - 1)); }
        if (event.key === 'ArrowUp') { event.preventDefault(); setActiveIndex((index) => Math.max(index - 1, 0)); }
        if (event.key === 'Enter' && options[activeIndex]) { event.preventDefault(); choose(options[activeIndex]); }
      }} className="h-7 w-full border-b border-[#303030] bg-transparent pl-7 pr-2 text-[11px] text-[#eeeeee] outline-none placeholder:text-[#777777] focus-visible:border-[#8BC7FF]" />
      </div>
      <div id={`${id}-options`} role="listbox" aria-label={label} className="min-h-0 overflow-y-auto [scrollbar-color:#444444_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-[#444444]">
        {options.length ? options.map((item, index) => <button key={item.gatewayId || item.id} id={`${id}-option-${index}`} type="button" role="option" aria-selected={item.id === value?.id && item.gatewayId === value?.gatewayId} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(item)} onMouseEnter={() => setActiveIndex(index)} className={`block min-h-7 w-full truncate px-2 text-left text-[11px] ${index === activeIndex ? 'bg-[#292929] text-white' : 'text-[#bdbdbd] hover:bg-[#222222]'}`}>{item.label}</button>) : <p role="status" className="m-0 px-2 py-2 text-[11px] text-[#888888]">{noResults}</p>}
      </div>
    </div>, document.body)}
  </div>;
}

export default function OrbsPanel() {
  const language = useAppLanguage();
  const text = orbsTranslations[language];
  const controls = orbControlTranslations[language];
  const sessions = useSharedSessions();
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [pendingActions, setPendingActions] = useState<Record<string, boolean>>({});
  const [copiedOrb, setCopiedOrb] = useState('');
  const [controlError, setControlError] = useState('');
  const [orbs, setOrbs] = useState<Orb[]>([]);
  const [ready, setReady] = useState(false);
  const [draft, setDraft] = useState<Orb | null>(null);
  const [step, setStep] = useState<1 | 2>(1);
  const [error, setError] = useState('');
  const [flowError, setFlowError] = useState('');
  const [saving, setSaving] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [credentialSaved, setCredentialSaved] = useState(false);
  const [credentialLoading, setCredentialLoading] = useState(false);
  const openerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const api = (window as any).codeclub;
    if (!api?.tasksList) return;
    let mounted = true;
    const refresh = () => { void api.tasksList('').then((items: ScheduledTask[]) => { if (mounted) setTasks(items); }).catch(() => { if (mounted) setControlError(controls.actionError); }); };
    refresh();
    // Electron TaskScheduler emits codeclub:scheduled-tasks-changed without payload.
    // This panel reads native run statuses; the preload subscription is removed on cleanup.
    const unsubscribe = api.onTasksChanged(refresh);
    return () => { mounted = false; unsubscribe(); };
  }, [controls.actionError]);

  const controlOrb = async (orb: Orb, action: 'play' | 'stop' | 'copy') => {
    if (pendingActions[orb.id]) return;
    setPendingActions((previous) => ({ ...previous, [orb.id]: true }));
    setControlError('');
    const api = (window as any).codeclub;
    const taskId = `orb_${orb.id}`;
    try {
      if (!api?.tasksList) throw new Error('ORB_RUNTIME_UNAVAILABLE');
      if (action === 'play') {
        await api.tasksSave('', { id: taskId, name: orb.name, prompt: orb.purpose, provider: orb.providerId, model: orb.modelId, autonomous: true, status: 'active', interval: 'Personalizado', every: '30 min', notifications: 'Solo errores', language });
        await api.tasksRun('', taskId);
      } else if (action === 'stop') {
        const currentTasks: ScheduledTask[] = await api.tasksList('');
        const current = currentTasks.find((item) => item.id === taskId);
        if (current) await api.tasksSave('', { ...current, status: 'paused' });
        await api.tasksCancel('', taskId);
      } else {
        const currentTasks: ScheduledTask[] = await api.tasksList('');
        const run = currentTasks.find((task) => task.id === taskId)?.runs.at(-1);
        if (!run) throw new Error('ORB_TRACE_UNAVAILABLE');
        const sessions = await api.sessionList();
        const session = sessions.find((item: { chatId: string }) => item.chatId === run.chatId);
        const messages = session?.messages || await readGlobalChatHistory(run.chatId);
        await navigator.clipboard.writeText(JSON.stringify({ orb: { id: orb.id, name: orb.name, provider: orb.providerId, model: orb.modelId }, run, state: session?.state || run.status, messages }, null, 2));
        setCopiedOrb(orb.id);
      }
      setTasks(await api.tasksList(''));
    } catch {
      setControlError(controls.actionError);
    } finally {
      setPendingActions((previous) => ({ ...previous, [orb.id]: false }));
    }
  };

  const deleteOrb = async (orb: Orb) => {
    if (pendingActions[orb.id]) return;
    setPendingActions(previous => ({ ...previous, [orb.id]: true }));
    setControlError('');
    try {
      const api = (window as any).codeclub;
      const currentTasks: ScheduledTask[] = await api.tasksList('');
      if (currentTasks.some(task => task.id === `orb_${orb.id}`)) {
        await api.tasksDelete('', `orb_${orb.id}`);
      }
      const stored = await getSetting<Orb[]>(STORAGE_KEY, []);
      const next = stored.filter(item => item.id !== orb.id);
      await setSetting(STORAGE_KEY, next);
      setOrbs(next);
      setTasks(await api.tasksList(''));
      window.dispatchEvent(new CustomEvent('codeclub:orbs-changed'));
    } catch {
      setControlError(controls.actionError);
    } finally {
      setPendingActions(previous => ({ ...previous, [orb.id]: false }));
    }
  };

  useEffect(() => {
    if (!copiedOrb) return;
    const timer = setTimeout(() => setCopiedOrb(''), 2000);
    return () => clearTimeout(timer);
  }, [copiedOrb]);

  const openEditor = (orb: Orb) => {
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setError('');
    setFlowError('');
    setStep(1);
    setApiKey('');
    setCredentialSaved(false);
    setCredentialLoading(true);
    setDraft(orb);
  };
  const closeEditor = () => {
    setDraft(null);
    setApiKey('');
    requestAnimationFrame(() => openerRef.current?.focus());
  };

  const selectedProvider = (providers.find((provider) => provider.id === draft?.providerId) || defaultProvider) as CatalogOption | undefined;
  const selectedModel = (draft && selectedProvider ? models.find((model) => modelMatchesProvider(model, selectedProvider) && modelIdFor(selectedProvider, model) === draft.modelId) : null) as CatalogOption | null;
  const requiresCredential = Boolean(selectedProvider && selectedModel && selectedProvider.id !== 'custom' && (usesGateway(selectedProvider, selectedModel) || selectedProvider.requiresApiKey !== false));
  const providerModels = selectedProvider ? models.filter((model) => modelMatchesProvider(model, selectedProvider)) as CatalogOption[] : [];

  useEffect(() => {
    let active = true;
    const refresh = () => { void getSetting<unknown>(STORAGE_KEY, []).then((value) => {
      if (!active) return;
      const saved = Array.isArray(value) ? value.filter((orb): orb is Orb => Boolean(orb && typeof orb.id === 'string' && typeof orb.name === 'string')).map((orb) => {
        const provider = selectableProviders.find((item) => item.id === orb.providerId) || defaultProvider;
        const model = provider && models.find((item) => modelMatchesProvider(item, provider) && modelIdFor(provider, item) === orb.modelId) || (provider && models.find((item) => modelMatchesProvider(item, provider))) || defaultModel;
        return { ...orb, color: normalizeColor(typeof orb.color === 'string' ? orb.color : COLORS[0]), providerId: provider?.id || '', modelId: provider && model ? modelIdFor(provider, model) : '' };
      }) : [];
      setOrbs(saved);
      setReady(true);
    }).catch(() => { if (active) setReady(true); });
    };
    refresh();
    window.addEventListener('codeclub:orbs-changed', refresh);
    return () => { active = false; window.removeEventListener('codeclub:orbs-changed', refresh); };
  }, []);

  useEffect(() => {
    if (!draft || !selectedProvider || !selectedModel || !requiresCredential) { setCredentialSaved(false); setCredentialLoading(false); return; }
    let active = true;
    setCredentialLoading(true);
    void getSetting<string>(credentialKeyFor(selectedProvider, selectedModel), '').then((value) => {
      if (active) setCredentialSaved(Boolean(value && value !== 'dummy-key'));
    }).catch(() => { if (active) setCredentialSaved(false); }).finally(() => { if (active) setCredentialLoading(false); });
    return () => { active = false; };
  }, [draft?.providerId, draft?.modelId, requiresCredential]);

  useEffect(() => {
    if (!draft) return;
    const onDialogKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); closeEditor(); return; }
      if (event.key !== 'Tab') return;
      const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
      if (!dialog) return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), textarea:not([disabled])')].filter((element) => !element.hasAttribute('hidden'));
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    window.addEventListener('keydown', onDialogKeyDown);
    return () => window.removeEventListener('keydown', onDialogKeyDown);
  }, [draft]);

  const saveOrb = async (event: FormEvent) => {
    event.preventDefault();
    if (step !== 2 || saving || !draft?.name.trim() || !draft.purpose.trim()) return;
    setSaving(true);
    setError('');
    const next = orbs.some((orb) => orb.id === draft.id)
      ? orbs.map((orb) => orb.id === draft.id ? { ...draft, name: draft.name.trim(), purpose: draft.purpose.trim() } : orb)
      : [...orbs, { ...draft, name: draft.name.trim(), purpose: draft.purpose.trim() }];
    try {
      await setSetting(STORAGE_KEY, next);
      window.dispatchEvent(new CustomEvent('codeclub:orbs-changed'));
      const task = tasks.find((item) => item.id === `orb_${draft.id}`);
      if (task) await (window as any).codeclub.tasksSave('', { ...task, name: draft.name.trim(), prompt: draft.purpose.trim(), provider: draft.providerId, model: draft.modelId, language });
      setOrbs(next);
      closeEditor();
    } catch {
      setError(text.saveError);
    } finally {
      setSaving(false);
    }
  };

  const continueToDesign = async () => {
    setFlowError('');
    if (!draft || !selectedProvider || !selectedModel) { setFlowError(text.selectProviderModel); return; }
    if (requiresCredential && !credentialSaved && !apiKey.trim()) { setFlowError(text.apiKeyRequired); return; }
    if (apiKey.trim()) {
      const key = credentialKeyFor(selectedProvider, selectedModel);
      const origin = key === 'ai_gateway_api_key' ? 'https://ai-gateway.vercel.sh' : selectedProvider.api;
      if (!origin) { setFlowError(text.providerEndpointMissing); return; }
      try {
        const bridge = (window as any).codeclub;
        if (bridge?.credentialSet) await bridge.credentialSet(key, apiKey.trim(), origin);
        else await setSetting(key, apiKey.trim());
        setCredentialSaved(true);
        setApiKey('');
      } catch {
        setFlowError(text.apiKeySaveError);
        return;
      }
    }
    setDraft({ ...draft, providerId: selectedProvider.id, modelId: modelIdFor(selectedProvider, selectedModel) });
    setStep(2);
  };

  return <section className="h-full min-h-0 overflow-y-auto bg-(--codeclub-center) [scrollbar-color:#444444_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[#444444]" aria-label={text.title}>
    <div className="mx-auto flex min-h-full min-w-0 w-full max-w-[1040px] flex-col px-6 py-7 lg:px-8">
      <header className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="m-0 text-[28px] font-normal tracking-[-0.04em] text-(--codeclub-text-strong)">{text.title}</h1>
          <p className="mt-1.5 text-[14px] text-(--codeclub-text-muted)">{text.description}</p>
        </div>
        <button type="button" onClick={() => openEditor(emptyOrb())} className="inline-flex h-8 shrink-0 items-center gap-2 rounded-lg border border-[#2b2b2b] bg-[#191919] px-3 text-[12px] text-[#dddddd] transition-colors hover:bg-[#222222] focus-visible:outline-2 focus-visible:outline-(--codeclub-accent)" aria-label={text.create} title={text.create}><Plus size={14} aria-hidden="true" /><span>{text.create}</span></button>
      </header>

      {!ready ? <p role="status" className="mt-8 text-[13px] text-[#777777]">{text.loading}</p> : orbs.length === 0 ? <div className="flex flex-1 items-center justify-center px-6 pb-14 text-center">
        <div className="mx-auto max-w-[360px]">
          <h2 className="m-0 text-[15px] font-medium text-[#dddddd]">{text.emptyTitle}</h2>
          <p className="mt-1.5 mb-0 text-[12px] leading-5 text-[#888888]">{text.emptyDescription}</p>
          <button type="button" onClick={() => openEditor(emptyOrb())} className="mt-4 inline-flex h-8 items-center gap-2 rounded-lg px-2 text-[12px] text-[#999999] transition-colors hover:bg-white/[0.04] hover:text-[#eeeeee] focus-visible:outline-2 focus-visible:outline-(--codeclub-accent)"><Plus size={14} aria-hidden="true" />{text.create}</button>
        </div>
      </div> : <div className="mt-7 overflow-hidden rounded-xl border border-[#202020] bg-[#111111]">
        {orbs.map((orb, index) => {
          const task = tasks.find((item) => item.id === `orb_${orb.id}`);
          const active = task?.status === 'active' || Boolean(task?.runs.some((run) => run.status === 'queued' || run.status === 'running'));
          const pending = Boolean(pendingActions[orb.id]);
          const run = task?.runs.at(-1);
          const session = run && sessions.find((item) => item.chatId === run.chatId && item.projectPath === '');
          const toolStatus = session?.tool && controls.tools[session.tool as keyof typeof controls.tools];
          const progress = session?.state === 'verifying' ? controls.verifying
            : run?.status === 'blocked' ? controls.blocked
            : run?.status === 'unverified' ? controls.unverified
            : run?.status === 'failed' ? controls.failed
            : run?.status === 'interrupted' ? controls.interrupted
            : run?.status === 'queued' ? controls.queued
            : run?.status === 'running' ? session?.state === 'connecting' ? controls.connecting
              : session?.state === 'working' ? toolStatus || controls.working : controls.thinking
            : controls.waiting;
          const subtitle = active || ['blocked', 'unverified', 'failed'].includes(run?.status || '') ? progress : orb.purpose || text.noDescription;
          return <div key={orb.id} className={`flex min-h-[62px] w-full items-center gap-2 px-3.5 transition-colors hover:bg-[#191919] ${index < orbs.length - 1 ? 'border-b border-[#202020]' : ''}`}>
          <button type="button" onClick={() => openEditor({ ...orb })} className="flex min-w-0 flex-1 items-center gap-3 py-3 text-left focus-visible:outline-2 focus-visible:outline-(--codeclub-accent)" aria-label={`${text.edit}: ${orb.name}`} title={`${orb.name} · ${active ? controls.active : controls.off}`}>
          <span className={`shrink-0 ${active ? '' : 'grayscale opacity-40'}`}><FluidOrb size={32} color={orb.color} active={active} themeTint={false} aria-hidden="true" /></span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12px] font-medium text-[#eeeeee]">{orb.name}</span>
            <span role={active ? "status" : undefined} aria-live={active ? "polite" : undefined} title={subtitle} className="mt-0.5 block truncate text-[11px] text-[#888888]">{subtitle}</span>
          </span>
          </button>
          <div className="flex shrink-0 items-center gap-1">
            <button type="button" disabled={!run} aria-label={controls.openChat} title={controls.openChat} onClick={() => { if (run) window.dispatchEvent(new CustomEvent('codeclub:open-chat', { detail: { chatId: run.chatId, name: orb.name, customName: true, projectPath: '', projectName: 'Codeclub' } })); }} className="grid h-8 w-8 place-items-center text-[#999999] hover:bg-[#242424] hover:text-white focus-visible:outline-2 focus-visible:outline-(--codeclub-accent) disabled:opacity-30"><MessageSquare size={14} aria-hidden="true" /></button>
            <button type="button" onClick={() => void controlOrb(orb, 'play')} disabled={active || pending} aria-label={controls.play} title={controls.play} className="grid h-8 w-8 place-items-center text-[#999999] hover:bg-[#242424] hover:text-white focus-visible:outline-2 focus-visible:outline-(--codeclub-accent) disabled:opacity-30"><Play size={14} aria-hidden="true" /></button>
            <button type="button" onClick={() => void controlOrb(orb, 'stop')} disabled={!active || pending} aria-label={controls.stop} title={controls.stop} className="grid h-8 w-8 place-items-center text-[#999999] hover:bg-[#242424] hover:text-white focus-visible:outline-2 focus-visible:outline-(--codeclub-accent) disabled:opacity-30"><Square size={13} aria-hidden="true" /></button>
            <button type="button" onClick={() => void controlOrb(orb, 'copy')} disabled={!task?.runs.length || pending} aria-label={copiedOrb === orb.id ? controls.copied : controls.copyTrace} title={copiedOrb === orb.id ? controls.copied : controls.copyTrace} className="grid h-8 w-8 place-items-center text-[#999999] hover:bg-[#242424] hover:text-white focus-visible:outline-2 focus-visible:outline-(--codeclub-accent) disabled:opacity-30">{copiedOrb === orb.id ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}</button>
            <button type="button" disabled={pending || active} onClick={() => void deleteOrb(orb)} aria-label={`${controls.delete}: ${orb.name}`} title={active ? controls.stopBeforeDelete : `${controls.delete}: ${orb.name}`} className="grid h-8 w-8 place-items-center text-[#999999] hover:bg-[#242424] hover:text-red-300 focus-visible:outline-2 focus-visible:outline-(--codeclub-accent) disabled:opacity-30"><Trash2 size={14} aria-hidden="true" /></button>
          </div>
        </div>;
        })}
      </div>}
      {controlError && <p role="alert" className="mt-3 text-[11px] text-red-300">{controlError}</p>}
    </div>

    {draft && typeof document !== 'undefined' && createPortal(<div className="fixed inset-0 z-[2147483647] grid place-items-center bg-black/65 p-4 backdrop-blur-[3px]" onMouseDown={(event) => { if (event.target === event.currentTarget) closeEditor(); }}>
      <form role="dialog" aria-modal="true" aria-label={orbs.some((orb) => orb.id === draft.id) ? text.edit : text.create} onSubmit={(event) => { event.preventDefault(); if (step === 1) { if (!credentialLoading) void continueToDesign(); } else void saveOrb(event); }} className="relative flex max-h-[min(700px,90vh)] w-full max-w-[600px] flex-col overflow-hidden border border-[#303030] bg-[#141414] shadow-2xl shadow-black/60">
        <button type="button" onClick={closeEditor} className="absolute right-3 top-3 z-10 grid h-9 w-9 place-items-center text-[#888888] hover:bg-[#242424] hover:text-[#eeeeee] focus-visible:outline-2 focus-visible:outline-(--codeclub-accent)" aria-label={text.close} title={text.close}><X size={15} aria-hidden="true" /></button>
        <nav aria-label={text.steps} className="flex items-center gap-2 border-b border-[#252525] px-5 py-3 pr-14 sm:px-6">
          <span aria-current={step === 1 ? 'step' : undefined} className={`text-[10px] ${step === 1 ? 'text-[#eeeeee]' : 'text-[#777777]'}`}>01&nbsp; {text.connection}</span>
          <span aria-hidden="true" className="h-px w-7 bg-[#333333]" />
          <span aria-current={step === 2 ? 'step' : undefined} className={`text-[10px] ${step === 2 ? 'text-[#eeeeee]' : 'text-[#777777]'}`}>02&nbsp; {text.design}</span>
        </nav>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4 sm:px-6 [scrollbar-color:#444444_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-[#444444]">
          {step === 1 ? <>
            <CatalogPicker id="orb-provider" label={text.provider} value={selectedProvider} items={selectableProviders} placeholder={text.searchProvider} noResults={text.noResults} autoFocus onSelect={(provider) => {
              const firstModel = models.find((model) => modelMatchesProvider(model, provider)) as CatalogOption | undefined;
              setDraft({ ...draft, providerId: provider.id, modelId: firstModel ? modelIdFor(provider, firstModel) : '' });
              setApiKey(''); setFlowError(''); setCredentialSaved(false); setCredentialLoading(true);
            }} />
            <CatalogPicker id="orb-model" label={text.model} value={selectedModel || undefined} items={providerModels} placeholder={text.searchModel} noResults={text.noResults} onSelect={(model) => { setDraft({ ...draft, modelId: modelIdFor(selectedProvider || {}, model) }); setApiKey(''); setFlowError(''); setCredentialSaved(false); setCredentialLoading(true); }} />
            <label className="block"><span className="mb-1 flex items-center gap-1 text-[11px] text-[#aaaaaa]">{text.apiKey}<span className="text-[#666666]">{requiresCredential ? `· ${text.required}` : `· ${text.optional}`}</span></span><input type="password" autoComplete="new-password" value={apiKey} onChange={(event) => { setApiKey(event.target.value); setFlowError(''); }} placeholder={credentialSaved ? text.credentialSaved : text.apiKeyPlaceholder} className="h-8 w-full border border-[#2b2b2b] bg-[#101010] px-2.5 text-[12px] text-[#eeeeee] outline-none placeholder:text-[#666666] focus-visible:border-[#8BC7FF] focus-visible:ring-1 focus-visible:ring-[#8BC7FF]" /></label>
            {credentialLoading && <p role="status" className="m-0 text-[10px] text-[#777777]">{text.checkingCredential}</p>}
          </> : <>
            <label className="block"><span className="mb-1 block text-[11px] text-[#aaaaaa]">{text.name}</span><input autoFocus maxLength={48} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder={text.namePlaceholder} className="h-8 w-full border border-[#2b2b2b] bg-[#101010] px-2.5 text-[12px] text-[#eeeeee] outline-none placeholder:text-[#666666] focus-visible:border-[#8BC7FF] focus-visible:ring-1 focus-visible:ring-[#8BC7FF]" /></label>
            <label className="block"><span className="mb-1 block text-[11px] text-[#aaaaaa]">{text.purpose}</span><textarea rows={3} maxLength={4000} value={draft.purpose} onChange={(event) => setDraft({ ...draft, purpose: event.target.value })} placeholder={text.purposePlaceholder} className="w-full resize-y border border-[#2b2b2b] bg-[#101010] px-2.5 py-2 text-[12px] leading-4 text-[#eeeeee] outline-none placeholder:text-[#666666] focus-visible:border-[#8BC7FF] focus-visible:ring-1 focus-visible:ring-[#8BC7FF]" /></label>
            <fieldset><legend className="mb-1 text-[11px] text-[#aaaaaa]">{text.color}</legend><div className="flex flex-wrap gap-1.5">{ORB_PALETTES.map((palette) => <label key={palette.id} className="relative grid h-8 w-8 cursor-pointer place-items-center border border-transparent has-[:checked]:border-white has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[#8BC7FF]" title={language === 'es' ? palette.es : palette.en}>
              <input type="radio" name="orb-color" value={palette.orb} checked={draft.color === palette.orb} onChange={() => setDraft({ ...draft, color: palette.orb })} aria-label={language === 'es' ? palette.es : palette.en} className="sr-only" />
              <span aria-hidden="true" className="h-5 w-5" style={{ backgroundColor: palette.orb }} />
            </label>)}</div></fieldset>
          </>}
          {(flowError || error) && <p role="alert" className="m-0 text-[11px] text-red-300">{flowError || error}</p>}
        </div>
        <footer className="flex items-center justify-between gap-3 border-t border-[#252525] px-4 py-2.5 sm:px-5">
          <div className="flex min-w-0 items-center gap-2.5" aria-live="polite" aria-label={`${text.color}: ${language === 'es' ? ORB_PALETTES.find((palette) => palette.orb === draft.color)?.es : ORB_PALETTES.find((palette) => palette.orb === draft.color)?.en}`}>
            <FluidOrb size={42} color={draft.color} active animateOnHover={false} themeTint={false} aria-hidden="true" />
            <span className="truncate text-[11px] text-[#888888]">{draft.name.trim() || (language === 'es' ? 'Vista previa' : 'Preview')}</span>
          </div>
          <div className="flex shrink-0 justify-end gap-2">
            {step === 1 ? <>
              <button type="button" onClick={closeEditor} className="h-8 px-2 text-[11px] text-[#999999] hover:bg-[#222222] hover:text-[#eeeeee] focus-visible:outline-2 focus-visible:outline-(--codeclub-accent)">{text.cancel}</button>
              <button key="orb-continue" type="button" onClick={(event) => { event.preventDefault(); void continueToDesign(); }} disabled={!selectedProvider || !selectedModel || credentialLoading} className="h-8 bg-[#292929] px-3 text-[11px] text-[#eeeeee] hover:bg-[#353535] focus-visible:outline-2 focus-visible:outline-(--codeclub-accent) disabled:cursor-not-allowed disabled:opacity-40">{text.continue}</button>
            </> : <>
              <button type="button" onClick={() => { setFlowError(''); setStep(1); }} className="h-8 px-2 text-[11px] text-[#999999] hover:bg-[#222222] hover:text-[#eeeeee] focus-visible:outline-2 focus-visible:outline-(--codeclub-accent)">{text.back}</button>
              <button key="orb-save" type="submit" disabled={saving || !draft.name.trim() || !draft.purpose.trim()} className="h-8 bg-[#292929] px-3 text-[11px] text-[#eeeeee] hover:bg-[#353535] focus-visible:outline-2 focus-visible:outline-(--codeclub-accent) disabled:cursor-not-allowed disabled:opacity-40">{saving ? text.saving : text.save}</button>
            </>}
          </div>
        </footer>
      </form>
    </div>, document.body)}
  </section>;
}
