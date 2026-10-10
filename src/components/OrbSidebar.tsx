'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Blocks, CheckCircle2, ChevronRight, Circle, Laptop, Globe, MoreHorizontal, BrushCleaning, Wrench, LoaderCircle, Pencil, X } from 'lucide-react';
import type { OrbDefinition } from '../lib/chat-resources';
import type { ScheduledTask } from '../lib/scheduled-tasks';
import { orbSidebarTranslations, useAppLanguage } from '../lib/i18n';
import { models, providers } from '../lib/ai-catalog';
import { credentialKeyFor, modelIdFor, modelMatchesProvider, usesGateway } from '../lib/ai-routing';
import { readGlobalChatHistory, writeGlobalChatHistory } from '../lib/projectManager';
import { useSharedSessions } from '../lib/shared-sessions';
import { usePopupKeyboard } from './ui/use-accessible-overlay';
import FluidOrb from './ui/fluid-orb';
import { getSetting, setSetting } from '../lib/persistence';
import { ORBS_STORAGE_KEY } from '../lib/chat-resources';

/** Show real orb configuration and native run activity; never synthesize connections or tasks. */
export default function OrbSidebar({ orb, onClose }: { orb?: OrbDefinition; onClose?: () => void }) {
  const language = useAppLanguage();
  const text = orbSidebarTranslations[language];
  const sessions = useSharedSessions();
  const [task, setTask] = useState<ScheduledTask>();
  const [activity, setActivity] = useState<ScheduledTask['runs']>([]);
  const [credential, setCredential] = useState(false);
  const [history, setHistory] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [menu, setMenu] = useState(false);
  const [showActivity, setShowActivity] = useState(false);
  const [activityPosition, setActivityPosition] = useState({ left: 0, top: 0 });
  const showActivityTooltip = (element: HTMLElement) => { const bounds = element.getBoundingClientRect(); setActivityPosition({ left: Math.max(8, Math.min(bounds.left, window.innerWidth - 248)), top: bounds.top - 8 }); setShowActivity(true); };
  const [clearedAt, setClearedAt] = useState(0);
  const menuRef = useRef<HTMLDivElement>(null);
  usePopupKeyboard(menuRef, menu, () => setMenu(false));
  const provider = providers.find(item => item.id === orb?.providerId);
  const model = provider && models.find(item => modelMatchesProvider(item, provider) && modelIdFor(provider, item) === orb?.modelId);
  const configure = () => { if (orb) window.dispatchEvent(new CustomEvent('codeclub:configure-orb', { detail: { orbId: orb.id } })); };
  useEffect(() => {
    let active = true;
    const refresh = () => { void (window as any).codeclub?.tasksList?.('')?.then((items: ScheduledTask[]) => { if (active) { setTask(items.find(item => item.id === `orb_${orb?.id}`)); setActivity(items.filter(item => item.id === `orb_${orb?.id}` || item.id === `orb_proactive_${orb?.id}`).flatMap(item => item.runs).sort((a, b) => a.startedAt.localeCompare(b.startedAt))); setError(''); } }).catch(() => { if (active) setError(text.activityError); }); };
    setTask(undefined); setActivity([]); refresh();
    const unsubscribe = (window as any).codeclub?.onTasksChanged?.(refresh);
    return () => { active = false; unsubscribe?.(); };
  }, [orb?.id, text.activityError]);
  useEffect(() => {
    let active = true;
    setCredential(false);
    if (provider && model) {
      const needsKey = provider.id !== 'custom' && (usesGateway(provider, model) || provider.requiresApiKey !== false);
      void (needsKey ? (window as any).codeclub?.credentialPresent(credentialKeyFor(provider, model)) : Promise.resolve(true))?.then((present: boolean) => { if (active) setCredential(Boolean(present)); }).catch(() => { if (active) setCredential(false); });
    }
    return () => { active = false; };
  }, [orb, provider, model]);
  useEffect(() => {
    if (!menu) return;
    const close = (event: PointerEvent) => { if (!menuRef.current?.contains(event.target as Node)) setMenu(false); };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [menu]);
  const run = async () => {
    if (!orb || pending) return;
    setMenu(false); setPending(true); setError('');
    try {
      const api = (window as any).codeclub;
      if (task?.status === 'active') {
        await api.tasksSave('', { ...task, status: 'paused' });
        await api.tasksCancel('', task.id);
      } else {
        const history = await readGlobalChatHistory(orb.chatId || `orb-chat-${orb.id}`);
        const prompt = orb.purpose || [...history].reverse().find(message => message.role === 'user')?.content;
        if (!prompt) throw new Error('ORB_NO_OBJECTIVE');
        await api.tasksSave('', { id: `orb_${orb.id}`, name: orb.name, prompt, provider: orb.providerId, model: orb.modelId, allowComputer: orb.allowComputer !== false, maximumAutonomy: orb.maximumAutonomy !== false, requiresAdministrator: orb.requiresAdministrator === true, autonomous: true, status: 'active', interval: 'Personalizado', every: '30 min', notifications: 'Solo errores', language });
        await api.tasksRun('', `orb_${orb.id}`);
      }
    } catch (error) { setError(String(error).includes('ORB_NO_OBJECTIVE') ? text.noObjective : text.activityError); }
    finally { setPending(false); }
  };
  const currentSession = sessions.find(session => session.chatId === (orb?.chatId || `orb-chat-${orb?.id}`));
  const chatId = orb?.chatId || `orb-chat-${orb?.id}`;
  useEffect(() => {
    let active = true;
    const refresh = () => { if (orb) void readGlobalChatHistory(chatId).then(messages => { if (active) setHistory(messages); }).catch(() => undefined); };
    setHistory([]); setClearedAt(0); setShowActivity(false); refresh();
    const unsubscribe = (window as any).codeclub?.onSessions?.((items: { chatId: string; busy: boolean }[]) => { if (items.some(item => item.chatId === chatId && !item.busy)) refresh(); });
    return () => { active = false; unsubscribe?.(); };
  }, [chatId, orb?.id]);
  const messages = currentSession?.messages?.length && (!clearedAt || currentSession.updatedAt > clearedAt) ? currentSession.messages : history;
  const tools = messages.flatMap(message => message.tools || []).map(tool => tool.name === 'executeTool' ? { ...tool, name: tool.input?.name || tool.name, input: tool.input?.input || tool.input } : tool);
  const requests = tools.filter(tool => tool.name === 'askUser' && tool.output?.status === 'awaiting_user' && !tool.answer);
  const browserUsed = tools.some(tool => ['openBrowser', 'getBrowserState', 'browserAction', 'externalBrowserState', 'externalBrowserAction'].includes(tool.name));
  const pcUsed = tools.some(tool => String(tool.name).startsWith('computer') || ['runCommand', 'readFile', 'writeFile', 'listFiles', 'searchText'].includes(tool.name));
  const progress = messages.filter(message => message.role === 'assistant').flatMap(message => (message.timeline || []).filter((event: any) => event.type === 'progress')).slice(-8).reverse();
  const openChat = () => window.dispatchEvent(new CustomEvent('codeclub:orb-agent:open-chat', { detail: { chatId, projectPath: '', name: orb?.name, customName: true } }));
  const activityDetail = progress[0]?.text || text.working;
  const clearChat = async () => {
    if (!orb || currentSession?.busy || pending || task?.status === 'active') return;
    setPending(true); setError('');
    try {
      await writeGlobalChatHistory(chatId, []);
      setHistory([]); setClearedAt(Date.now());
      // Emitted here after persistence; Orb ChatInterface clears its visible history.
      window.dispatchEvent(new CustomEvent('codeclub:orb-agent:history-cleared', { detail: { chatId } }));
    } catch { setError(text.clearError); }
    finally { setPending(false); }
  };
  const activeOrb = Boolean(currentSession?.busy || task?.status === 'active' || orb?.maximumAutonomy);
  const toggleAutonomy = async () => {
    if (!orb || pending) return;
    setMenu(false); setPending(true);
    try {
      const saved = await getSetting<OrbDefinition[]>(ORBS_STORAGE_KEY, []);
      await setSetting(ORBS_STORAGE_KEY, saved.map(item => item.id === orb.id ? { ...item, maximumAutonomy: item.maximumAutonomy !== true } : item));
      window.dispatchEvent(new CustomEvent('codeclub:orbs-changed'));
    } catch { setError(text.activityError); }
    finally { setPending(false); }
  };
  const iconButton = 'grid h-7 w-7 place-items-center rounded-full text-[#999999] hover:bg-[#1e1e1e] hover:text-[#eeeeee] disabled:opacity-35 focus-visible:outline-2 focus-visible:outline-(--codeclub-accent)';
  const row = 'flex min-h-9 w-full items-center gap-2 border-b border-[#202020] px-2 text-left hover:bg-[#191919] focus-visible:outline-2 focus-visible:outline-(--codeclub-accent)';
  return <section className="relative flex h-full min-h-0 flex-col overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden bg-(--codeclub-center) px-4 py-5 text-[11px] text-[#cccccc]" aria-label={text.sidebar}>
    {onClose && <button type="button" onClick={onClose} aria-label={text.close} title={text.close} className={`${iconButton} absolute right-2 top-2`}><X size={13} aria-hidden="true" /></button>}
    <header className="mb-7 flex flex-col items-center pt-2">
      <div className="relative"><FluidOrb size={56} color={orb?.color} active={activeOrb} animateOnHover={false} themeTint={false} aria-hidden="true" /><button type="button" onClick={configure} disabled={!orb} title={text.configure} aria-label={text.configure} className={`${iconButton} absolute -bottom-1 -right-2 h-5 w-5 bg-(--codeclub-center)`}><Pencil size={10} aria-hidden="true" /></button></div>
      <h1 className="mb-0 mt-3 max-w-full truncate text-[17px] font-medium text-[#eeeeee]">{orb?.name || text.orb}</h1>
      <p className="mb-0 mt-0.5 text-[11px] text-[#999999]">{currentSession?.busy ? text.working : activeOrb ? text.active : text.idle}</p>
      <div className="mt-4 flex justify-center gap-5"><button type="button" onClick={configure} disabled={!orb} className={iconButton} title={text.settings} aria-label={text.settings}><Wrench size={15} aria-hidden="true" /></button><button type="button" onClick={() => window.dispatchEvent(new CustomEvent('codeclub:open-extensions'))} className={iconButton} title={text.integrations} aria-label={text.integrations}><Blocks size={15} aria-hidden="true" /></button><button type="button" onClick={() => void clearChat()} disabled={!orb || pending || currentSession?.busy || task?.status === 'active'} className={iconButton} title={text.clearChat} aria-label={text.clearChat}><BrushCleaning size={16} aria-hidden="true" /></button></div>
    </header>
    <section className="mb-6" aria-label={text.configure}>
      <h2 className="mb-2 mt-0 text-[11px] font-normal text-[#888888]">{text.configure}</h2>
      <div className="overflow-hidden rounded-xl border border-[#202020]">
        {!model && <button type="button" onClick={configure} disabled={!orb} className={row}><Circle size={13} aria-hidden="true" /><span>{text.chooseModel}</span></button>}
        <button type="button" onClick={configure} disabled={!orb} className={row}>{credential ? <CheckCircle2 size={13} aria-hidden="true" className="text-[#777777]" /> : <Circle size={13} aria-hidden="true" />}<span className={`min-w-0 truncate ${credential ? 'text-[#777777] line-through' : ''}`}>{text.apiKey}</span><span className="sr-only">{credential ? text.configured : text.pending}</span></button>
        {requests.map((request, index) => <button type="button" key={request.id || index} onClick={openChat} className={row} title={request.output.question || request.input?.question}><Circle size={13} className="shrink-0" aria-hidden="true" /><span className="min-w-0 flex-1 truncate">{request.output.question || request.input?.question}</span><ChevronRight size={12} aria-hidden="true" /></button>)}
      </div>
    </section>
    <section className="mb-6" aria-label={text.devices}>
      <h2 className="mb-2 mt-0 text-[11px] font-normal text-[#888888]">{text.devices}</h2>
      {pcUsed || browserUsed ? <div className="overflow-hidden rounded-xl border border-[#202020]">
        {pcUsed && <div className="flex h-9 min-w-0 items-center gap-2 px-2 last:border-b-0 border-b border-[#202020]"><Laptop size={14} aria-hidden="true" className="shrink-0 text-[#999999]" /><span className="min-w-0 flex-1 truncate text-[#eeeeee]">{text.thisComputer}</span><span className="shrink-0 text-[10px] text-[#888888]">{text.used}</span></div>}
        {browserUsed && <div className="flex h-9 min-w-0 items-center gap-2 px-2"><Globe size={14} aria-hidden="true" className="shrink-0 text-[#999999]" /><span className="min-w-0 flex-1 truncate text-[#eeeeee]">{text.browser}</span><span className="shrink-0 text-[10px] text-[#888888]">{text.used}</span></div>}
      </div> : <p className="my-2 px-2 text-[10px] text-[#888888]">{text.noDevices}</p>}
    </section>
    <section aria-label={text.activity}>
      <div ref={menuRef} className="relative mb-2 flex items-center justify-between"><h2 className="m-0 text-[11px] font-normal text-[#888888]">{text.activity}</h2><button type="button" disabled={!orb || pending} onClick={() => setMenu(value => !value)} aria-label={text.actions} title={text.actions} aria-haspopup="menu" aria-expanded={menu} className={iconButton}><MoreHorizontal size={13} aria-hidden="true" /></button>
        {menu && <div role="menu" aria-label={text.actions} className="absolute right-0 top-7 z-10 rounded-xl border border-[#2b2b2b] bg-[#191919] p-1 shadow-lg"><button type="button" role="menuitem" onClick={() => void run()} className="block h-7 w-full rounded-lg px-3 text-left hover:bg-[#242424]">{task?.status === 'active' ? text.pause : text.run}</button><button type="button" role="menuitem" onClick={() => void toggleAutonomy()} className="block h-7 w-full rounded-lg px-3 text-left hover:bg-[#242424]">{orb?.maximumAutonomy ? text.pauseAutonomy : text.resumeAutonomy}</button></div>}
      </div>
      <div className="overflow-hidden rounded-xl border border-[#202020]">
        {currentSession?.busy && <div className="relative"><button type="button" onClick={event => showActivityTooltip(event.currentTarget)} onMouseEnter={event => showActivityTooltip(event.currentTarget)} onMouseLeave={() => setShowActivity(false)} onFocus={event => showActivityTooltip(event.currentTarget)} onBlur={() => setShowActivity(false)} onKeyDown={event => { if (event.key === 'Escape') setShowActivity(false); }} aria-describedby={showActivity ? 'orb-current-activity' : undefined} className={row}><LoaderCircle size={13} className="shrink-0 motion-safe:animate-spin" aria-hidden="true" /><span className="truncate">{text.working}</span><ChevronRight size={12} className="ml-auto" aria-hidden="true" /></button>{showActivity && createPortal(<div id="orb-current-activity" role="tooltip" style={{ left: activityPosition.left, top: activityPosition.top, transform: 'translateY(-100%)' }} className="pointer-events-none fixed z-[2147483647] w-60 max-w-[calc(100vw-16px)] rounded-xl border border-[#2b2b2b] bg-[#1E1E1E] px-3 py-2.5 text-[11px] leading-4 text-[#cccccc] shadow-lg shadow-black/30 [overflow-wrap:anywhere]">{activityDetail}</div>, document.body)}</div>}
        {progress.map((event: any, index: number) => <button type="button" key={event.id || index} onClick={openChat} className={row} title={event.text}><CheckCircle2 size={13} className="shrink-0 text-[#777777]" aria-hidden="true" /><span className="min-w-0 flex-1 truncate">{event.text}</span><ChevronRight size={12} aria-hidden="true" /></button>)}
        {[...activity].reverse().slice(0, 8).map(run => <button type="button" key={run.id} onClick={() => window.dispatchEvent(new CustomEvent('codeclub:orb-agent:open-chat', { detail: { chatId: run.chatId, projectPath: '', name: orb?.name, customName: true } }))} className={row}><CheckCircle2 size={13} className="text-[#777777]" aria-hidden="true" /><span className="min-w-0 flex-1 truncate">{text.status[run.status]}</span><ChevronRight size={12} aria-hidden="true" /></button>)}
        {!currentSession?.busy && !progress.length && !activity.length && <p className="my-2 px-2 text-[10px] text-[#888888]">{text.noActivity}</p>}
      </div>
    </section>
    {error && <p role="alert" className="mt-3 text-[10px] leading-4 text-[#ffb4b4]">{error}</p>}
  </section>;
}
