'use client';

import { useEffect, useRef, useState } from 'react';
import { Bolt, CircleHelp, CirclePlus, Clock, Grid2X2, PanelLeft, PanelRight, Pencil } from 'lucide-react';
import { motion } from 'motion/react';
import ChatPanel from './ChatPanel';
import { readGlobalChats, readProjectMeta, writeGlobalChats, writeProjectMeta } from '../lib/projectManager';

const MIN_WIDTH = 220;
const MAX_WIDTH = 420;
const DEFAULT_LEFT = 280;
const DEFAULT_RIGHT = 300;

type Side = 'left' | 'right';
type RecentChat = { id: string; title: string; customName?: boolean; projectPath?: string; projectName?: string };
type SidebarSection = 'new-chat' | 'projects' | 'scheduled' | 'extensions';
type ChatContextMenu = { chat: RecentChat; x: number; y: number };

function ResizeHandle({ side, onStart }: { side: Side; onStart: (event: React.PointerEvent<HTMLDivElement>) => void }) {
  const isLeft = side === 'left';
  return <div
    role="separator"
    aria-orientation="vertical"
    aria-label={`Redimensionar sidebar ${isLeft ? 'izquierda' : 'derecha'}`}
    tabIndex={0}
    onPointerDown={onStart}
    className={`group relative z-10 w-1 shrink-0 cursor-col-resize bg-transparent focus-visible:outline-2 focus-visible:outline-(--codeclub-accent) ${isLeft ? '-mr-1' : '-ml-1'}`}
  >
    <motion.span initial={{ opacity: 0 }} whileHover={{ opacity: 1 }} className="codeclub-resize-indicator absolute top-1/2 left-1/2 h-[65%] w-px -translate-x-1/2 -translate-y-1/2 rounded-full" />
  </div>;
}

export default function WorkspaceLayout({ leftOpen, rightOpen }: { leftOpen: boolean; rightOpen: boolean }) {
  const [activeProjectId, setActiveProjectId] = useState('home');
  const [activeProjectName, setActiveProjectName] = useState('Codeclub');
  const [activeProjectPath, setActiveProjectPath] = useState<string | undefined>();
  const [editingProjectName, setEditingProjectName] = useState(false);
  const [projectNameDraft, setProjectNameDraft] = useState('Codeclub');
  const [chatsByProject, setChatsByProject] = useState<Record<string, RecentChat[]>>({});
  const [activeSection, setActiveSection] = useState<SidebarSection>('new-chat');
  const [activeChatId, setActiveChatId] = useState<string | undefined>();
  const [chatContextMenu, setChatContextMenu] = useState<ChatContextMenu | null>(null);
  const chatContextMenuRef = useRef<HTMLDivElement | null>(null);
  const [leftWidth, setLeftWidth] = useState(DEFAULT_LEFT);
  const [rightWidth, setRightWidth] = useState(DEFAULT_RIGHT);
  const [resizing, setResizing] = useState<Side | null>(null);
  const [sizesReady, setSizesReady] = useState(false);
  const resizeRef = useRef<{ side: Side; startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('codeclub:sidebar-sizes') ?? '{}') as { left?: number; right?: number };
      if (typeof saved.left === 'number') setLeftWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, saved.left)));
      if (typeof saved.right === 'number') setRightWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, saved.right)));
    } catch { /* Usa los tamaños iniciales si no hay preferencias válidas. */ }
    setSizesReady(true);
  }, []);

  useEffect(() => { if (sizesReady) localStorage.setItem('codeclub:sidebar-sizes', JSON.stringify({ left: leftWidth, right: rightWidth })); }, [leftWidth, rightWidth, sizesReady]);

  useEffect(() => {
    if (!resizing) return undefined;
    const handleMove = (event: PointerEvent) => {
      const drag = resizeRef.current;
      if (!drag) return;
      const delta = drag.side === 'left' ? event.clientX - drag.startX : drag.startX - event.clientX;
      const nextWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, drag.startWidth + delta));
      if (drag.side === 'left') setLeftWidth(nextWidth); else setRightWidth(nextWidth);
    };
    const handleEnd = () => { resizeRef.current = null; setResizing(null); };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleEnd, { once: true });
    return () => { window.removeEventListener('pointermove', handleMove); window.removeEventListener('pointerup', handleEnd); };
  }, [resizing]);

  useEffect(() => {
    const handleProjectSwitch = (event: Event) => {
      const project = (event as CustomEvent<{ id?: string; name?: string; path?: string }>).detail;
      if (!project?.id) return;
      setActiveProjectId(project.id);
      setActiveProjectPath(project.path);
      const nextName = project.name ?? (project.id === 'home' ? 'Codeclub' : activeProjectName);
      setActiveProjectName(nextName);
      setProjectNameDraft(nextName);
      setEditingProjectName(false);
      setChatsByProject((current) => current[project.id] ? current : { ...current, [project.id]: [] });
      if (project.path) window.localStorage.setItem('codeclub:active-project', JSON.stringify({ id: project.id, name: nextName, path: project.path }));
      else window.localStorage.removeItem('codeclub:active-project');
    };
    window.addEventListener('codeclub:project-switch', handleProjectSwitch);
    return () => window.removeEventListener('codeclub:project-switch', handleProjectSwitch);
  }, []);

  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem('codeclub:active-project') || 'null') as { id?: string; name?: string; path?: string } | null;
      if (!saved?.id || !saved.path) return;
      setActiveProjectId(saved.id);
      setActiveProjectPath(saved.path);
      setActiveProjectName(saved.name || 'Proyecto');
      setProjectNameDraft(saved.name || 'Proyecto');
      setChatsByProject((current) => current[saved.id!] ? current : { ...current, [saved.id!]: [] });
      window.setTimeout(() => {
        window.dispatchEvent(new CustomEvent('codeclub:project-selection-changed', { detail: { selected: true, projectPath: saved.path, projectName: saved.name || 'Proyecto' } }));
        window.dispatchEvent(new CustomEvent('codeclub:active-project', { detail: { projectPath: saved.path, projectName: saved.name || 'Proyecto' } }));
      }, 0);
    } catch { /* Si no hay proyecto guardado, inicia en Codeclub. */ }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadRecentChats = async () => {
      try {
        const chats = activeProjectPath
          ? ((await readProjectMeta(activeProjectPath))?.chats || []).map((chat) => ({ id: chat.id, title: chat.name, customName: chat.customName, projectPath: activeProjectPath, projectName: activeProjectName }))
          : (await readGlobalChats()).map((chat) => ({ id: chat.id, title: chat.name, customName: chat.customName, projectPath: '', projectName: 'Sin proyecto' }));
        if (!cancelled) setChatsByProject((current) => ({ ...current, [activeProjectId]: chats }));
      } catch (error) { console.warn('No se pudieron cargar los chats recientes', error); }
    };
    void loadRecentChats();
    const refresh = () => void loadRecentChats();
    window.addEventListener('codeclub:global-chat-changed', refresh);
    window.addEventListener('codeclub:project-meta-changed', refresh);
    return () => {
      cancelled = true;
      window.removeEventListener('codeclub:global-chat-changed', refresh);
      window.removeEventListener('codeclub:project-meta-changed', refresh);
    };
  }, [activeProjectId, activeProjectName, activeProjectPath]);

  useEffect(() => {
    const handleChatRename = async (event: Event) => {
      const detail = (event as CustomEvent<{ chatId?: string; newName?: string; projectPath?: string; automatic?: boolean }>).detail;
      if (!detail?.chatId || !detail.newName?.trim()) return;
      const nextName = detail.newName.trim().slice(0, 120);
      if (!detail.projectPath) {
        const chats = await readGlobalChats();
        const chat = chats.find((item) => item.id === detail.chatId);
        if (!chat || (detail.automatic && chat.customName)) return;
        chat.name = nextName;
        if (!detail.automatic) chat.customName = true;
        await writeGlobalChats(chats);
        window.dispatchEvent(new CustomEvent('codeclub:global-chat-changed'));
        return;
      }
      const meta = await readProjectMeta(detail.projectPath);
      const chat = meta?.chats.find((item) => item.id === detail.chatId);
      if (!meta || !chat || (detail.automatic && chat.customName)) return;
      chat.name = nextName;
      if (!detail.automatic) chat.customName = true;
      await writeProjectMeta(detail.projectPath, meta);
      window.dispatchEvent(new CustomEvent('codeclub:project-meta-changed', { detail: { projectPath: detail.projectPath } }));
    };
    window.addEventListener('codeclub:rename-chat', handleChatRename);
    return () => window.removeEventListener('codeclub:rename-chat', handleChatRename);
  }, []);

  useEffect(() => {
    if (!chatContextMenu) return;
    const close = (event: PointerEvent) => { if (!chatContextMenuRef.current?.contains(event.target as Node)) setChatContextMenu(null); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setChatContextMenu(null); };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', escape);
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('keydown', escape); };
  }, [chatContextMenu]);

  useEffect(() => {
    const showChat = (event: Event) => {
      setActiveSection('new-chat');
      setActiveChatId((event as CustomEvent<{ chatId?: string }>).detail?.chatId);
    };
    const showEmptyChat = () => { setActiveSection('new-chat'); setActiveChatId(undefined); };
    window.addEventListener('codeclub:open-chat', showChat);
    window.addEventListener('codeclub:open-empty-chat', showEmptyChat);
    return () => {
      window.removeEventListener('codeclub:open-chat', showChat);
      window.removeEventListener('codeclub:open-empty-chat', showEmptyChat);
    };
  }, []);

  const recentChats = chatsByProject[activeProjectId] ?? [];

  const selectSidebarSection = (section: SidebarSection) => {
    setActiveSection(section);
    setActiveChatId(undefined);
    if (section === 'new-chat') window.dispatchEvent(new CustomEvent('codeclub:open-empty-chat'));
  };

  const renameFromContextMenu = () => {
    if (!chatContextMenu) return;
    const nextName = window.prompt('Nombre del chat', chatContextMenu.chat.title)?.trim();
    if (nextName) window.dispatchEvent(new CustomEvent('codeclub:rename-chat', { detail: { chatId: chatContextMenu.chat.id, newName: nextName, projectPath: chatContextMenu.chat.projectPath, automatic: false } }));
    setChatContextMenu(null);
  };

  const deleteFromContextMenu = async () => {
    const chat = chatContextMenu?.chat;
    if (!chat) return;
    setChatContextMenu(null);
    if (!window.confirm('¿Eliminar este chat?')) return;
    if (chat.projectPath) {
      const meta = await readProjectMeta(chat.projectPath);
      if (!meta) return;
      meta.chats = meta.chats.filter((item) => item.id !== chat.id);
      await writeProjectMeta(chat.projectPath, meta);
      window.dispatchEvent(new CustomEvent('codeclub:project-meta-changed', { detail: { projectPath: chat.projectPath } }));
    } else {
      const chats = await readGlobalChats();
      await writeGlobalChats(chats.filter((item) => item.id !== chat.id));
      window.dispatchEvent(new CustomEvent('codeclub:global-chat-changed'));
    }
  };

  const startResize = (side: Side) => (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    resizeRef.current = { side, startX: event.clientX, startWidth: side === 'left' ? leftWidth : rightWidth };
    setResizing(side);
  };

  const commitProjectName = async () => {
    const nextName = projectNameDraft.trim();
    if (!nextName || activeProjectId === 'home') { setProjectNameDraft(activeProjectName); setEditingProjectName(false); return; }
    try {
      const project = await (window as any).codeclub?.renameProject?.(activeProjectId, nextName);
      const savedName = project?.name ?? nextName;
      setActiveProjectName(savedName);
      setProjectNameDraft(savedName);
      window.dispatchEvent(new CustomEvent('codeclub:project-renamed', { detail: { id: activeProjectId, name: savedName, path: project?.path } }));
    } catch (error) { console.error('No se pudo renombrar el proyecto', error); setProjectNameDraft(activeProjectName); }
    setEditingProjectName(false);
  };

  return <section className="codeclub-graphite grid min-h-0 min-w-0 flex-1 grid-cols-[minmax(0,1fr)] overflow-hidden" aria-label="Espacio de trabajo">
    <div className="flex min-h-0 min-w-0 overflow-hidden">
      <motion.aside animate={{ width: leftOpen ? leftWidth : 0, opacity: leftOpen ? 1 : 0 }} transition={resizing ? { type: 'spring', stiffness: 900, damping: 58, mass: 0.22 } : { type: 'spring', stiffness: 340, damping: 30 }} className="codeclub-graphite flex min-h-0 shrink-0 flex-col overflow-hidden" aria-label="Sidebar izquierda" aria-hidden={!leftOpen}>
        <div className="flex min-h-0 flex-1 flex-col px-2.5 py-2.5 text-(--codeclub-text)">
          <div className="flex items-center gap-1 px-1.5">{editingProjectName ? <input autoFocus value={projectNameDraft} onChange={(event) => setProjectNameDraft(event.target.value)} onBlur={() => void commitProjectName()} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void commitProjectName(); } if (event.key === 'Escape') { setProjectNameDraft(activeProjectName); setEditingProjectName(false); } }} className="min-w-0 flex-1 rounded-md border border-(--codeclub-border-soft) bg-(--codeclub-surface-raised) px-1.5 py-0.5 text-[15px] font-semibold tracking-tight text-(--codeclub-text-strong) outline-none" aria-label="Nombre del proyecto" /> : <span className="min-w-0 truncate text-[15px] font-semibold tracking-tight text-(--codeclub-text-strong)">{activeProjectName}</span>}{activeProjectId !== 'home' && !editingProjectName && <button type="button" onClick={() => setEditingProjectName(true)} className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-(--codeclub-text-muted) hover:bg-(--codeclub-hover) hover:text-(--codeclub-text-strong) focus-visible:outline-2 focus-visible:outline-(--codeclub-accent)" aria-label="Cambiar nombre del proyecto" title="Cambiar nombre"><Pencil size={13} aria-hidden="true" /></button>}</div>
          <nav className="mt-4 space-y-0.5" aria-label="Navegación principal">
            <SidebarItem active={activeSection === 'new-chat' && !activeChatId} icon={<CirclePlus />} label="Nuevo chat" onClick={() => selectSidebarSection('new-chat')} />
            <SidebarItem active={activeSection === 'scheduled'} icon={<Clock />} label="Programadas" onClick={() => selectSidebarSection('scheduled')} />
            <SidebarItem active={activeSection === 'extensions'} icon={<Grid2X2 />} label="Extensiones" onClick={() => selectSidebarSection('extensions')} />
            <SidebarItem active={activeSection === 'projects'} icon={<Bolt />} label="Synapse" onClick={() => selectSidebarSection('projects')} />
          </nav>
          <div className="mt-5 min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {recentChats.length > 0 && <div className="pb-3"><p className="px-1.5 text-[13px] font-semibold text-(--codeclub-text-muted)">Recientes</p><div className="mt-2 space-y-1">{recentChats.map((chat) => <button key={chat.id} type="button" onContextMenu={(event) => { if (!chat.customName) return; event.preventDefault(); setChatContextMenu({ chat, x: event.clientX, y: event.clientY }); }} onClick={() => window.dispatchEvent(new CustomEvent('codeclub:open-chat', { detail: { chatId: chat.id, name: chat.title, customName: chat.customName, projectId: activeProjectId, projectPath: chat.projectPath ?? activeProjectPath, projectName: chat.projectName ?? activeProjectName } }))} className={`flex w-full min-w-0 items-center justify-between rounded-lg px-2.5 py-2 text-left text-[13px] text-(--codeclub-text-strong) ${activeChatId === chat.id ? 'bg-(--codeclub-acrylic-active)' : 'bg-transparent hover:bg-(--codeclub-hover)'}`}><span className="min-w-0 truncate">{chat.title}</span></button>)}</div></div>}
          </div>
          <div className="mt-auto flex items-center justify-between border-t border-(--codeclub-border-soft) px-1.5 pt-3"><div className="flex items-center gap-2"><span className="grid h-6 w-6 place-items-center rounded-full bg-[#9b59b6] text-[9px] font-medium text-white">MA</span><span className="text-[13px] text-(--codeclub-text-strong)">Matecore</span></div><CircleHelp size={16} className="text-(--codeclub-text-muted)" /></div>
        </div>
      </motion.aside>
      {chatContextMenu && <div ref={chatContextMenuRef} className="fixed z-[100] grid w-40 gap-0.5 rounded-lg border border-(--codeclub-border-soft) bg-(--codeclub-surface-raised) p-1 shadow-2xl" style={{ left: chatContextMenu.x, top: chatContextMenu.y }} role="menu" aria-label="Menú del chat"><button type="button" onClick={renameFromContextMenu} className="rounded-md px-2.5 py-2 text-left text-xs text-(--codeclub-text) hover:bg-(--codeclub-hover) hover:text-(--codeclub-text-strong)" role="menuitem">Renombrar chat</button><button type="button" onClick={() => void deleteFromContextMenu()} className="rounded-md px-2.5 py-2 text-left text-xs text-(--codeclub-text) hover:bg-(--codeclub-hover) hover:text-(--codeclub-text-strong)" role="menuitem">Eliminar chat</button></div>}
      {leftOpen && <ResizeHandle side="left" onStart={startResize('left')} />}

      <PanelManager activeSection={activeSection} />

      {rightOpen && <ResizeHandle side="right" onStart={startResize('right')} />}
      <motion.aside animate={{ width: rightOpen ? rightWidth : 0, opacity: rightOpen ? 1 : 0 }} transition={resizing ? { type: 'spring', stiffness: 900, damping: 58, mass: 0.22 } : { type: 'spring', stiffness: 340, damping: 30 }} className="codeclub-panel-edge flex min-h-0 shrink-0 flex-col overflow-hidden bg-(--codeclub-center)" aria-label="Sidebar derecha" aria-hidden={!rightOpen}>
        <div className="flex h-10 shrink-0 items-center justify-end gap-2 border-b border-(--codeclub-border-soft) px-3 text-xs font-medium text-(--codeclub-text-muted)">Sidebar derecha <PanelRight size={14} /></div>
        <div className="flex-1 p-3"><div className="h-20 rounded-lg border border-(--codeclub-border-soft) bg-(--codeclub-surface)" /></div>
      </motion.aside>
    </div>
  </section>;
}

function PanelManager({ activeSection }: { activeSection: SidebarSection }) {
  const chatVisible = activeSection === 'new-chat';
  return <main className="codeclub-graphite relative min-h-0 min-w-0 flex-1 overflow-hidden backdrop-blur-xl" aria-label="Gestor de paneles">
    <div className="codeclub-panel-shell h-full w-full overflow-hidden bg-(--codeclub-center)">
      <div className={`h-full min-h-0 min-w-0 ${chatVisible ? 'block' : 'hidden'}`} aria-hidden={!chatVisible}><ChatPanel /></div>
      {!chatVisible && <div className="grid h-full min-h-0 place-items-center bg-(--codeclub-center) px-6 text-center"><div><p className="text-sm font-medium text-(--codeclub-text-strong)">Panel sin contenido</p><p className="mt-1 text-xs text-(--codeclub-text-muted)">Este espacio se adaptará cuando agreguemos esta sección.</p></div></div>}
    </div>
  </main>;
}

function SidebarItem({ icon, label, active, onClick }: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void }) {
  return <button type="button" aria-current={active ? 'page' : undefined} onClick={onClick} className={`flex h-8 w-full items-center gap-3 rounded-lg px-1.5 text-left text-[13px] transition-colors hover:bg-(--codeclub-hover) hover:text-(--codeclub-text-strong) ${active ? 'bg-(--codeclub-acrylic-active) text-(--codeclub-text-strong)' : 'text-(--codeclub-text)'}`}><span className={`grid h-4 w-4 shrink-0 place-items-center [&>svg]:size-4 ${active ? 'text-(--codeclub-text-strong)' : 'text-(--codeclub-text-muted)'}`}>{icon}</span><span>{label}</span></button>;
}
