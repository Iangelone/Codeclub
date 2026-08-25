'use client';

import { ArrowLeft, ArrowRight, ChevronRight, Download, House, RefreshCw, Search } from 'lucide-react';
import { motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { rightSidebarTranslations, useAppLanguage } from '../lib/i18n';
import { nativeInvoke } from '../lib/runtime';
import { readGlobalChats, readProjectMeta } from '../lib/projectManager';

const controlClass = 'grid h-8 w-8 shrink-0 place-items-center rounded-lg border-0 bg-transparent text-(--codeclub-icon) transition-colors hover:bg-(--codeclub-hover) hover:text-(--codeclub-text-strong) focus-visible:outline-2 focus-visible:outline-(--codeclub-accent)';
type RecentSearchItem = { kind: 'file' | 'chat'; path?: string; id?: string; name: string };

export default function SubTopbar({ activeProject }: { activeProject: { name: string; path?: string } }) {
  const language = useAppLanguage();
  const text = rightSidebarTranslations[language];
  const folders = activeProject.path?.split(/[\\/]/).filter(Boolean) ?? [];
  const breadcrumb = activeProject.path ? [...folders.slice(0, -1), activeProject.name] : ['Inicio'];
  const breadcrumbRef = useRef<HTMLDivElement>(null);
  const fullBreadcrumbRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [updateVersion, setUpdateVersion] = useState('');
  const [updateDownloaded, setUpdateDownloaded] = useState(false);
  const [navigation, setNavigation] = useState({ leftBack: false, leftForward: false, rightBack: false, rightForward: false });
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchLoading, setSearchLoading] = useState(true);
  const [searchFiles, setSearchFiles] = useState<Array<{ path: string; kind: string; modifiedAt?: number }>>([]);
  const [searchChats, setSearchChats] = useState<Array<{ id: string; name: string; projectPath?: string }>>([]);
  const [recentItems, setRecentItems] = useState<RecentSearchItem[]>([]);
  const searchRef = useRef<HTMLDivElement>(null);
  const recentStorageKey = activeProject.path ? `codeclub:search-recents:${activeProject.path}` : 'codeclub:search-recents:global';
  useEffect(() => {
    const update = () => {
      const container = breadcrumbRef.current;
      const full = fullBreadcrumbRef.current;
      if (!container || !full) return;
      setCollapsed(full.getBoundingClientRect().width > container.clientWidth);
    };
    update();
    const observer = new ResizeObserver(update);
    if (breadcrumbRef.current) observer.observe(breadcrumbRef.current);
    return () => observer.disconnect();
  }, [breadcrumb.join('|')]);
  useEffect(() => {
    const updateRightNavigation = (event: Event) => {
      const detail = (event as CustomEvent<{ back?: boolean; forward?: boolean }>).detail;
      setNavigation((current) => ({ ...current, rightBack: Boolean(detail?.back), rightForward: Boolean(detail?.forward) }));
    };
    const updateLeftNavigation = (event: Event) => {
      const detail = (event as CustomEvent<{ back?: boolean; forward?: boolean }>).detail;
      setNavigation((current) => ({ ...current, leftBack: Boolean(detail?.back), leftForward: Boolean(detail?.forward) }));
    };
    window.addEventListener('codeclub:right-panel-navigation-state', updateRightNavigation);
    window.addEventListener('codeclub:left-panel-navigation-state', updateLeftNavigation);
    window.dispatchEvent(new CustomEvent('codeclub:right-panel-navigation-request'));
    window.dispatchEvent(new CustomEvent('codeclub:left-panel-navigation-request'));
    return () => {
      window.removeEventListener('codeclub:right-panel-navigation-state', updateRightNavigation);
      window.removeEventListener('codeclub:left-panel-navigation-state', updateLeftNavigation);
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    const loadSearchIndex = async () => {
      setSearchLoading(true);
      if (!activeProject.path) { setSearchFiles([]); setSearchChats(await readGlobalChats()); setSearchLoading(false); return; }
      try {
        const [files, meta] = await Promise.all([
          nativeInvoke<Array<{ path: string; kind: string; modifiedAt?: number }>>('codeclub_list_files', { projectPath: activeProject.path, maxFiles: 1200 }),
          readProjectMeta(activeProject.path),
        ]);
        if (!cancelled) { setSearchFiles(files.filter((file) => file.kind !== 'directory')); setSearchChats(meta?.chats ?? []); setSearchLoading(false); }
      } catch { if (!cancelled) { setSearchFiles([]); setSearchChats([]); setSearchLoading(false); } }
    };
    void loadSearchIndex();
    return () => { cancelled = true; };
  }, [activeProject.path]);
  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(recentStorageKey) || '[]');
      setRecentItems(Array.isArray(stored) ? stored.slice(0, 3) : []);
    } catch { setRecentItems([]); }
  }, [recentStorageKey]);
  useEffect(() => {
    const closeSearch = (event: MouseEvent) => {
      if (!searchRef.current?.contains(event.target as Node)) setSearchOpen(false);
    };
    document.addEventListener('mousedown', closeSearch);
    return () => document.removeEventListener('mousedown', closeSearch);
  }, []);
  useEffect(() => {
    let cancelled = false;
    const api = (window as any).codeclub;
    const applyState = (state: { state?: string; version?: string }) => {
      if (cancelled) return;
      if (state?.version && (state.state === 'available' || state.state === 'downloading' || state.state === 'downloaded')) setUpdateVersion(state.version);
      setUpdateDownloaded(state?.state === 'downloaded');
    };
    if (typeof api?.onAutoUpdate === 'function') {
      const unsubscribe = api.onAutoUpdate(applyState);
      void api.getAutoUpdateStatus?.().then(applyState).catch(() => undefined);
      return () => { cancelled = true; unsubscribe?.(); };
    }
    return () => { cancelled = true; };
  }, []);
  const visibleBreadcrumb = collapsed && breadcrumb.length > 4 ? breadcrumb.slice(-4) : breadcrumb;
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const visibleFiles = [...searchFiles].sort((left, right) => (right.modifiedAt ?? 0) - (left.modifiedAt ?? 0)).filter((file) => !normalizedQuery || file.path.toLowerCase().includes(normalizedQuery)).slice(0, 3);
  const visibleChats = searchChats.filter((chat) => !normalizedQuery || chat.name.toLowerCase().includes(normalizedQuery)).slice(0, 3);
  const hasSearchResults = visibleFiles.length > 0 || visibleChats.length > 0;
  const fallbackRecentItems: RecentSearchItem[] = [...searchChats.slice(0, 2).map((chat) => ({ kind: 'chat' as const, id: chat.id, name: chat.name })), ...[...searchFiles].sort((left, right) => (right.modifiedAt ?? 0) - (left.modifiedAt ?? 0)).slice(0, 2).map((file) => ({ kind: 'file' as const, path: file.path, name: file.path }))].slice(0, 3);
  const displayedRecentItems = recentItems.length > 0 ? recentItems : fallbackRecentItems;
  const rememberRecent = (item: RecentSearchItem) => {
    setRecentItems((current) => {
      const next = [item, ...current.filter((entry) => !(entry.kind === item.kind && (entry.path || entry.id) === (item.path || item.id)))].slice(0, 3);
      try { localStorage.setItem(recentStorageKey, JSON.stringify(next)); } catch { /* almacenamiento opcional */ }
      return next;
    });
  };
  const openSearchFile = (path: string) => {
    setSearchOpen(false);
    rememberRecent({ kind: 'file', path, name: path });
    window.dispatchEvent(new CustomEvent('codeclub:open-right-sidebar'));
    window.dispatchEvent(new CustomEvent('codeclub:open-right-file', { detail: { path, projectPath: activeProject.path, projectName: activeProject.name } }));
  };
  const openSearchChat = (chat: { id: string; name: string; projectPath?: string }) => {
    setSearchOpen(false);
    rememberRecent({ kind: 'chat', id: chat.id, name: chat.name });
    window.dispatchEvent(new CustomEvent('codeclub:open-chat', { detail: { chatId: chat.id, name: chat.name, projectPath: chat.projectPath || activeProject.path, projectName: activeProject.name } }));
  };
  const openRecent = (item: RecentSearchItem) => item.kind === 'file' && item.path
    ? openSearchFile(item.path)
    : item.id ? openSearchChat({ id: item.id, name: item.name }) : undefined;
  return <div className="codeclub-graphite flex h-11 min-w-0 items-center gap-2 px-3 text-(--codeclub-text) backdrop-blur-xl backdrop-saturate-150" role="toolbar" aria-label={text.rightPanel}>
    <div className="flex shrink-0 items-center gap-1">
      <motion.button type="button" disabled={!navigation.leftBack && !navigation.rightBack} onClick={() => window.dispatchEvent(new CustomEvent('codeclub:right-panel-back'))} className={`${controlClass} disabled:cursor-not-allowed disabled:opacity-35`} whileHover={navigation.leftBack || navigation.rightBack ? { scale: 1.06 } : undefined} whileTap={navigation.leftBack || navigation.rightBack ? { scale: 0.92 } : undefined} transition={{ type: 'spring', stiffness: 420, damping: 26 }} aria-label={text.back} title={text.back}><ArrowLeft size={18} strokeWidth={1.7} /></motion.button>
      <motion.button type="button" disabled={!navigation.leftForward && !navigation.rightForward} onClick={() => window.dispatchEvent(new CustomEvent('codeclub:right-panel-forward'))} className={`${controlClass} disabled:cursor-not-allowed disabled:opacity-35`} whileHover={navigation.leftForward || navigation.rightForward ? { scale: 1.06 } : undefined} whileTap={navigation.leftForward || navigation.rightForward ? { scale: 0.92 } : undefined} transition={{ type: 'spring', stiffness: 420, damping: 26 }} aria-label={text.forward} title={text.forward}><ArrowRight size={18} strokeWidth={1.7} /></motion.button>
      <motion.button type="button" onClick={() => { const api = (window as any).codeclub; if (updateDownloaded) void api?.installUpdate?.(); else void api?.checkForUpdates?.(); }} className={`${controlClass} ${updateVersion ? 'text-white hover:text-white' : ''}`} whileHover={{ scale: 1.06 }} whileTap={{ scale: 0.92 }} transition={{ type: 'spring', stiffness: 420, damping: 26 }} aria-label={updateDownloaded ? `Reiniciar para actualizar a ${updateVersion}` : updateVersion ? `Actualización disponible: ${updateVersion}` : 'Buscar actualizaciones'} title={updateDownloaded ? `Reiniciar para actualizar a ${updateVersion}` : updateVersion ? `Actualización disponible: ${updateVersion}` : 'Buscar actualizaciones'}><Download size={18} strokeWidth={1.7} /></motion.button>
      <motion.button type="button" onClick={() => void (window as any).codeclub?.reloadApp?.()} className={controlClass} whileHover={{ scale: 1.06 }} whileTap={{ scale: 0.92 }} transition={{ type: 'spring', stiffness: 420, damping: 26 }} aria-label={text.reload} title={text.reload}><RefreshCw size={18} strokeWidth={1.7} /></motion.button>
    </div>
    <div ref={breadcrumbRef} className="relative flex h-8 min-w-0 flex-1 items-center gap-1 overflow-hidden rounded-lg bg-(--codeclub-acrylic-active) px-3 text-[13px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <House size={17} strokeWidth={1.7} className="shrink-0 text-(--codeclub-icon)" aria-hidden="true" />
      <ChevronRight size={16} strokeWidth={1.7} className="shrink-0 text-(--codeclub-text-muted)" aria-hidden="true" />
      {collapsed && breadcrumb.length > 4 && <span className="flex h-full shrink-0 items-center px-2 text-(--codeclub-text-muted)" aria-hidden="true">…</span>}
      {visibleBreadcrumb.map((segment, index) => <span key={`${segment}-${index}`} className="flex h-full shrink-0 items-center gap-1 leading-none"><span className="px-2 leading-none text-(--codeclub-text-strong)">{segment}</span>{index < visibleBreadcrumb.length - 1 && <ChevronRight size={16} strokeWidth={1.7} className="shrink-0 text-(--codeclub-text-muted)" aria-hidden="true" />}</span>)}
      <div ref={fullBreadcrumbRef} className="pointer-events-none absolute left-0 top-0 flex h-full w-max items-center gap-1 opacity-0" aria-hidden="true"><House size={17} /><ChevronRight size={16} />{breadcrumb.map((segment, index) => <span key={`${segment}-${index}`} className="flex shrink-0 items-center gap-1"><span className="px-2">{segment}</span>{index < breadcrumb.length - 1 && <ChevronRight size={16} />}</span>)}</div>
    </div>
    <div ref={searchRef} className="relative flex h-8 min-w-[150px] max-w-[360px] flex-[0.42] items-center">
    <label className="flex h-8 w-full items-center gap-2 rounded-lg bg-(--codeclub-acrylic-active) px-3 text-[13px] text-(--codeclub-text-muted)">
      <span className="sr-only">{language === 'en' ? `Search in ${activeProject.name}` : `Buscar en ${activeProject.name}`}</span>
      <input value={searchQuery} onChange={(event) => { setSearchQuery(event.target.value); setSearchOpen(true); }} onFocus={() => setSearchOpen(true)} onKeyDown={(event) => { if (event.key === 'Escape') { setSearchOpen(false); setSearchQuery(''); } }} className="min-w-0 flex-1 bg-transparent text-(--codeclub-text-strong) outline-none placeholder:text-(--codeclub-text-muted)" placeholder={language === 'en' ? `Search in ${activeProject.name}` : `Buscar en ${activeProject.name}`} aria-label={language === 'en' ? `Search in ${activeProject.name}` : `Buscar en ${activeProject.name}`} />
      <Search size={16} strokeWidth={1.8} className="shrink-0" aria-hidden="true" />
    </label>
    {searchOpen && <div className="absolute right-0 top-10 z-50 w-[min(360px,calc(100vw-24px))] overflow-hidden rounded-xl border border-(--codeclub-border-soft) bg-(--codeclub-surface-raised) p-1.5 shadow-2xl">
      {searchLoading ? <p className="px-2.5 py-2 text-[12px] text-(--codeclub-text-muted)">{language === 'en' ? 'Loading recent files...' : 'Cargando archivos recientes...'}</p> : !normalizedQuery && displayedRecentItems.length > 0 ? <>
        <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-(--codeclub-text-muted)">{language === 'en' ? 'Recents' : 'Recientes'}</p>
        {displayedRecentItems.map((item) => <button key={`${item.kind}-${item.path || item.id}`} type="button" onClick={() => openRecent(item)} className="flex w-full items-center rounded-lg px-2 py-1.5 text-left text-[12px] text-(--codeclub-text) hover:bg-(--codeclub-hover)"><span className="mr-2 text-[10px] uppercase text-(--codeclub-text-muted)">{item.kind === 'file' ? (language === 'en' ? 'File' : 'Archivo') : 'Chat'}</span><span className="min-w-0 flex-1 truncate">{item.name}</span></button>)}
      </> : hasSearchResults ? <>
        {visibleFiles.length > 0 && <><p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-(--codeclub-text-muted)">{language === 'en' ? 'Files' : 'Archivos'}</p>{visibleFiles.map((file) => <button key={`file-${file.path}`} type="button" onClick={() => openSearchFile(file.path)} className="flex w-full items-center rounded-lg px-2 py-1.5 text-left text-[12px] text-(--codeclub-text) hover:bg-(--codeclub-hover)"><span className="min-w-0 flex-1 truncate">{file.path}</span></button>)}</>}
        {visibleChats.length > 0 && <><p className="mt-1 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-(--codeclub-text-muted)">{language === 'en' ? 'Chats' : 'Chats'}</p>{visibleChats.map((chat) => <button key={`chat-${chat.id}`} type="button" onClick={() => openSearchChat(chat)} className="flex w-full items-center rounded-lg px-2 py-1.5 text-left text-[12px] text-(--codeclub-text) hover:bg-(--codeclub-hover)"><span className="min-w-0 flex-1 truncate">{chat.name}</span></button>)}</>}
      </> : <p className="px-2.5 py-2 text-[12px] text-(--codeclub-text-muted)">{language === 'en' ? 'No matches found.' : 'No se encontraron coincidencias.'}</p>}
    </div>}
    </div>
  </div>;
}
