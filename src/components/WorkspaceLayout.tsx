'use client';

import { createElement, useEffect, useRef, useState, type FormEvent } from 'react';
import { AppWindowMac, ArrowLeft, ArrowRight, ArrowRightToLine, Bolt, CircleHelp, CirclePlus, Clock, CopyX, EllipsisVertical, FileWarning, FolderOpen, FolderPen, FolderTree, GitBranch, GitCompare, Globe, Grid2X2, ListTodo, MessageCircle, PanelLeft, PanelRight, Pencil, RotateCw, SquareTerminal, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import ChatPanel from './ChatPanel';
import { ProjectPanelView } from './ChatInterface';
import { readGlobalChats, readProjectMeta, writeGlobalChats, writeProjectMeta } from '../lib/projectManager';
import { readAgentState, writeAgentState, type AgentState, type TaskStatus } from '../lib/engine/planning';
import { nativeInvoke } from '../lib/runtime';

const MIN_WIDTH = 220;
const MAX_WIDTH = 420;
const DEFAULT_LEFT = 280;
const DEFAULT_RIGHT = 300;

type Side = 'left' | 'right';
type RecentChat = { id: string; title: string; customName?: boolean; projectPath?: string; projectName?: string };
type SidebarSection = 'new-chat' | 'projects' | 'scheduled' | 'extensions';
type ChatContextMenu = { chat: RecentChat; x: number; y: number };
type RightPanelTab = 'files' | 'review' | 'browser' | 'artifacts' | 'terminals';
type RightPanelInstance = { instanceId: string; tab: RightPanelTab; label: string };
type RightPanelContextMenu = { panel: RightPanelInstance; x: number; y: number };

const rightPanelTabs: Array<{ id: RightPanelTab; label: string; icon: typeof FolderTree }> = [
  { id: 'files', label: 'Archivos', icon: FolderPen },
  { id: 'review', label: 'Revisar', icon: GitCompare },
  { id: 'browser', label: 'Navegador', icon: AppWindowMac },
  { id: 'artifacts', label: 'Artifacts', icon: ListTodo },
  { id: 'terminals', label: 'Terminales', icon: SquareTerminal },
];

function ResizeHandle({ side, value, onStart, onKeyboardResize }: { side: Side; value: number; onStart: (event: React.PointerEvent<HTMLDivElement>) => void; onKeyboardResize: (value: number) => void }) {
  const isLeft = side === 'left';
  const resizeWithKeyboard = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const direction = isLeft ? 1 : -1;
    let next = value;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next += 16 * direction;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next -= 16 * direction;
    else if (event.key === 'Home') next = MIN_WIDTH;
    else if (event.key === 'End') next = MAX_WIDTH;
    else return;
    event.preventDefault();
    onKeyboardResize(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, next)));
  };
  return <div
    role="separator"
    aria-orientation="vertical"
    aria-label={`Redimensionar sidebar ${isLeft ? 'izquierda' : 'derecha'}`}
    aria-valuemin={MIN_WIDTH}
    aria-valuemax={MAX_WIDTH}
    aria-valuenow={value}
    tabIndex={0}
    onPointerDown={onStart}
    onKeyDown={resizeWithKeyboard}
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
  const [rightPanels, setRightPanels] = useState<RightPanelInstance[]>([{ instanceId: 'files', tab: 'files', label: 'Archivos' }]);
  const [activeRightPanelId, setActiveRightPanelId] = useState('files');
  const [filesTreeVisible, setFilesTreeVisible] = useState(true);
  const [reviewChangesVisible, setReviewChangesVisible] = useState(true);
  const [rightMenuOpen, setRightMenuOpen] = useState(false);
  const rightMenuRef = useRef<HTMLDivElement | null>(null);
  const [rightContextMenu, setRightContextMenu] = useState<RightPanelContextMenu | null>(null);
  const rightContextMenuRef = useRef<HTMLDivElement | null>(null);
  const rightPanelSequence = useRef(0);
  const [resizing, setResizing] = useState<Side | null>(null);
  const [sizesReady, setSizesReady] = useState(false);
  const resizeRef = useRef<{ side: Side; startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    const root = document.getElementById('codeclub-right-sidebar');
    if (!root) return undefined;
    const repairEncoding = () => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      while ((node = walker.nextNode())) {
        if (!node.nodeValue) continue;
        const normalized = node.nodeValue
          .replaceAll(String.fromCodePoint(0xEF, 0xBF, 0xBD), String.fromCodePoint(0xE1))
          .replaceAll(String.fromCodePoint(0xC3, 0xAF, 0xC2, 0xBF, 0xC2, 0xBD), String.fromCodePoint(0xE1))
          .replaceAll(String.fromCodePoint(0xFFFD), String.fromCodePoint(0xE1));
        if (normalized !== node.nodeValue) node.nodeValue = normalized;
        continue;
        const repaired = node.nodeValue.replaceAll('ï¿½', 'á').replaceAll('�', 'á');
        if (repaired !== node.nodeValue) node.nodeValue = repaired;
      }
    };
    repairEncoding();
    const observer = new MutationObserver(repairEncoding);
    observer.observe(root, { childList: true, characterData: true, subtree: true });
    return () => observer.disconnect();
  }, []);

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
    if (!rightMenuOpen) return undefined;
    const closeMenu = (event: PointerEvent) => {
      if (!rightMenuRef.current?.contains(event.target as Node)) setRightMenuOpen(false);
    };
    const closeWithEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setRightMenuOpen(false); };
    window.addEventListener('pointerdown', closeMenu);
    window.addEventListener('keydown', closeWithEscape);
    return () => {
      window.removeEventListener('pointerdown', closeMenu);
      window.removeEventListener('keydown', closeWithEscape);
    };
  }, [rightMenuOpen]);

  useEffect(() => {
    if (!rightContextMenu) return undefined;
    rightContextMenuRef.current?.setAttribute('aria-label', `Menú de ${rightContextMenu.panel.label}`);
    const closeMenu = (event: PointerEvent) => { if (!rightContextMenuRef.current?.contains(event.target as Node)) setRightContextMenu(null); };
    const closeWithEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setRightContextMenu(null); };
    window.addEventListener('pointerdown', closeMenu);
    window.addEventListener('keydown', closeWithEscape);
    return () => {
      window.removeEventListener('pointerdown', closeMenu);
      window.removeEventListener('keydown', closeWithEscape);
    };
  }, [rightContextMenu]);

  useEffect(() => {
    const root = document.getElementById('codeclub-right-sidebar');
    if (!root) return undefined;
    const tabList = root.querySelector<HTMLElement>('[role="tablist"]');
    if (tabList) {
      tabList.setAttribute('aria-orientation', 'horizontal');
      const tabs = Array.from(tabList.querySelectorAll<HTMLButtonElement>('button[role="tab"]'));
      tabs.forEach((tab, index) => {
        tab.tabIndex = tab.getAttribute('aria-selected') === 'true' ? 0 : -1;
        tab.setAttribute('aria-posinset', String(index + 1));
        tab.setAttribute('aria-setsize', String(tabs.length));
        const move = (event: KeyboardEvent) => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
          tabs[nextIndex]?.focus();
          tabs[nextIndex]?.click();
        };
        tab.addEventListener('keydown', move);
        tab.dataset.codeclubTabKeyboard = 'true';
        (tab as HTMLButtonElement & { codeclubMove?: (event: KeyboardEvent) => void }).codeclubMove = move;
      });
      root.querySelectorAll<HTMLElement>('[role="tablist"] > div').forEach((item) => item.setAttribute('role', 'presentation'));
      const panelMenu = root.querySelector<HTMLElement>('[role="menu"]');
      panelMenu?.setAttribute('aria-label', 'Paneles de la sidebar derecha');
      const treeToggle = root.querySelector<HTMLButtonElement>('button[aria-pressed]');
      if (treeToggle) {
        const label = filesTreeVisible ? 'Ocultar árbol de archivos' : 'Mostrar árbol de archivos';
        treeToggle.setAttribute('aria-label', label);
        treeToggle.setAttribute('title', label);
      }
      const fileTree = root.querySelector<HTMLElement>('aside');
      if (fileTree) {
        fileTree.setAttribute('role', 'tree');
        fileTree.setAttribute('aria-label', 'Árbol de archivos del proyecto');
        fileTree.querySelectorAll<HTMLButtonElement>('button').forEach((item) => {
          item.setAttribute('role', 'treeitem');
          item.setAttribute('aria-label', item.textContent?.trim() || 'Elemento del proyecto');
        });
      }
      return () => tabs.forEach((tab) => {
        const move = (tab as HTMLButtonElement & { codeclubMove?: (event: KeyboardEvent) => void }).codeclubMove;
        if (move) tab.removeEventListener('keydown', move);
      });
    }
    return undefined;
  }, [rightPanels, activeRightPanelId, filesTreeVisible]);

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

  const openRightPanel = (tab: RightPanelTab) => {
    const existing = rightPanels.find((panel) => panel.tab === tab && tab !== 'browser' && tab !== 'terminals');
    if (existing) {
      setActiveRightPanelId(existing.instanceId);
      setRightMenuOpen(false);
      return;
    }
    const base = rightPanelTabs.find((item) => item.id === tab)?.label ?? tab;
    const count = rightPanels.filter((panel) => panel.tab === tab).length + 1;
    rightPanelSequence.current += 1;
    const panel = { instanceId: `${tab}-${rightPanelSequence.current}`, tab, label: tab === 'browser' || tab === 'terminals' ? `${base} ${count}` : base };
    setRightPanels((current) => [...current, panel]);
    setActiveRightPanelId(panel.instanceId);
    setRightMenuOpen(false);
  };

  useEffect(() => {
    const openArtifacts = (event: Event) => {
      const detail = (event as CustomEvent<{ projectPath?: string }>).detail;
      if (detail?.projectPath && detail.projectPath !== activeProjectPath) return;
      const existing = rightPanels.find((panel) => panel.tab === 'artifacts');
      if (existing) {
        setActiveRightPanelId(existing.instanceId);
        return;
      }
      rightPanelSequence.current += 1;
      const panel = { instanceId: `artifacts-${rightPanelSequence.current}`, tab: 'artifacts' as const, label: 'Artifacts' };
      setRightPanels((current) => [...current, panel]);
      setActiveRightPanelId(panel.instanceId);
    };
    const openBrowser = () => {
      const existing = rightPanels.find((panel) => panel.tab === 'browser');
      if (existing) {
        setActiveRightPanelId(existing.instanceId);
        return;
      }
      rightPanelSequence.current += 1;
      const panel = { instanceId: `browser-${rightPanelSequence.current}`, tab: 'browser' as const, label: 'Navegador' };
      setRightPanels((current) => [...current, panel]);
      setActiveRightPanelId(panel.instanceId);
    };
    window.addEventListener('codeclub:open-artifacts', openArtifacts);
    window.addEventListener('codeclub:open-right-panel', openBrowser);
    return () => {
      window.removeEventListener('codeclub:open-artifacts', openArtifacts);
      window.removeEventListener('codeclub:open-right-panel', openBrowser);
    };
  }, [activeProjectPath, rightPanels]);

  const closeRightPanel = (instanceId: string) => {
    if (rightPanels.length === 1) return;
    const index = rightPanels.findIndex((panel) => panel.instanceId === instanceId);
    const next = rightPanels.filter((panel) => panel.instanceId !== instanceId);
    setRightPanels(next);
    if (activeRightPanelId === instanceId) setActiveRightPanelId(next[Math.min(index, next.length - 1)].instanceId);
    setRightContextMenu(null);
  };

  const closeOtherRightPanels = (instanceId: string) => {
    setRightPanels((current) => current.filter((panel) => panel.instanceId === instanceId));
    setActiveRightPanelId(instanceId);
    setRightContextMenu(null);
  };

  const closeRightPanelsToRight = (instanceId: string) => {
    const index = rightPanels.findIndex((panel) => panel.instanceId === instanceId);
    if (index < 0) return;
    const remaining = rightPanels.slice(0, index + 1);
    setRightPanels(remaining);
    if (!remaining.some((panel) => panel.instanceId === activeRightPanelId)) setActiveRightPanelId(instanceId);
    setRightContextMenu(null);
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
      <motion.aside id="codeclub-left-sidebar" animate={{ width: leftOpen ? leftWidth : 0, opacity: leftOpen ? 1 : 0 }} transition={resizing ? { type: 'spring', stiffness: 900, damping: 58, mass: 0.22 } : { type: 'spring', stiffness: 340, damping: 30 }} className="codeclub-graphite flex min-h-0 shrink-0 flex-col overflow-hidden" aria-label="Sidebar izquierda" aria-hidden={!leftOpen}>
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
      {rightContextMenu && <div ref={rightContextMenuRef} className="fixed z-[100] grid w-52 gap-0.5 rounded-xl border border-white/[0.08] bg-[#2C2C2C]/90 p-1 shadow-2xl backdrop-blur-xl" style={{ left: rightContextMenu.x, top: rightContextMenu.y }} role="menu" aria-label={`Menú de ${rightContextMenu.panel.label}`}><button type="button" onClick={() => closeRightPanel(rightContextMenu.panel.instanceId)} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-(--codeclub-text) hover:bg-(--codeclub-hover) hover:text-(--codeclub-text-strong)" role="menuitem"><X size={14} aria-hidden="true" />Cerrar</button><button type="button" onClick={() => closeOtherRightPanels(rightContextMenu.panel.instanceId)} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-(--codeclub-text) hover:bg-(--codeclub-hover) hover:text-(--codeclub-text-strong)" role="menuitem"><CopyX size={14} aria-hidden="true" />Cerrar otras pestañas</button><button type="button" onClick={() => closeRightPanelsToRight(rightContextMenu.panel.instanceId)} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-(--codeclub-text) hover:bg-(--codeclub-hover) hover:text-(--codeclub-text-strong)" role="menuitem"><ArrowRightToLine size={14} aria-hidden="true" />Cerrar a la derecha</button></div>}
      {leftOpen && <ResizeHandle side="left" value={leftWidth} onStart={startResize('left')} onKeyboardResize={setLeftWidth} />}

      <PanelManager activeSection={activeSection} />

      {rightOpen && <ResizeHandle side="right" value={rightWidth} onStart={startResize('right')} onKeyboardResize={setRightWidth} />}
      <motion.aside id="codeclub-right-sidebar" animate={{ width: rightOpen ? rightWidth : 0, opacity: rightOpen ? 1 : 0 }} transition={resizing ? { type: 'spring', stiffness: 900, damping: 58, mass: 0.22 } : { type: 'spring', stiffness: 340, damping: 30 }} className="codeclub-panel-edge flex min-h-0 shrink-0 flex-col overflow-visible bg-(--codeclub-center)" aria-label="Sidebar derecha" aria-hidden={!rightOpen}>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div ref={rightMenuRef} className="relative flex h-11 min-w-0 shrink-0 items-center gap-2 px-2">
            <div role="tablist" aria-label="Paneles abiertos" className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {rightPanels.map((panel) => { const item = rightPanelTabs.find((candidate) => candidate.id === panel.tab) ?? rightPanelTabs[0]; const Icon = item.icon; const active = activeRightPanelId === panel.instanceId; return <div key={panel.instanceId} className={`group flex h-8 min-w-0 shrink-0 items-center rounded-lg transition-colors ${active ? 'bg-white/[0.08] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-md hover:bg-white/[0.12]' : 'hover:bg-white/[0.06]'}`}><button type="button" role="tab" aria-selected={active} aria-controls={`right-panel-${panel.instanceId}`} onClick={() => setActiveRightPanelId(panel.instanceId)} onContextMenu={(event) => { event.preventDefault(); setRightMenuOpen(false); setRightContextMenu({ panel, x: event.clientX, y: event.clientY }); }} className={`flex h-full min-w-0 items-center gap-2 rounded-lg px-2.5 text-[12px] font-medium focus-visible:outline-2 focus-visible:outline-(--codeclub-accent) ${active ? 'text-(--codeclub-text-strong)' : 'text-(--codeclub-text-muted)'}`}><Icon size={15} strokeWidth={1.8} aria-hidden="true" /><span className="max-w-[150px] truncate">{panel.label}</span></button><button type="button" onClick={() => closeRightPanel(panel.instanceId)} className={`mr-1 grid h-5 w-5 shrink-0 place-items-center rounded-md transition-opacity hover:bg-white/[0.1] hover:text-(--codeclub-text-strong) focus-visible:outline-2 focus-visible:outline-(--codeclub-accent) ${active ? 'text-(--codeclub-text-strong) opacity-100' : 'text-(--codeclub-text-muted) opacity-0 group-hover:opacity-100'}`} aria-label={`Cerrar ${panel.label}`}><X size={12} strokeWidth={2} aria-hidden="true" /></button></div>; })}
              <button type="button" onClick={() => setRightMenuOpen((open) => !open)} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-transparent text-(--codeclub-text-strong) transition-colors hover:bg-white/[0.08] focus-visible:outline-2 focus-visible:outline-(--codeclub-accent)" aria-label="Abrir paneles de la sidebar derecha" aria-haspopup="menu" aria-expanded={rightMenuOpen}><CirclePlus size={17} strokeWidth={1.8} aria-hidden="true" /></button>
            </div>
            <AnimatePresence>
              {rightMenuOpen && <motion.div initial={{ opacity: 0, y: -5, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -5, scale: 0.98 }} transition={{ duration: 0.14, ease: 'easeOut' }} className="absolute top-[42px] left-2 z-30 w-[220px] max-w-[calc(100vw-24px)] rounded-xl border border-white/[0.08] bg-[#2C2C2C]/90 p-1 shadow-2xl backdrop-blur-xl" role="menu" aria-label="Paneles de la sidebar derecha">
                {rightPanelTabs.map(({ id, label, icon: Icon }) => { const selected = rightPanels.some((panel) => panel.tab === id); const canOpenMultiple = id === 'browser' || id === 'terminals'; const disabled = selected && !canOpenMultiple; return <button key={id} type="button" role="menuitemradio" aria-checked={selected} aria-disabled={disabled} disabled={disabled} onClick={() => openRightPanel(id)} className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[12px] transition-colors focus-visible:outline-2 focus-visible:outline-(--codeclub-accent) ${disabled ? 'cursor-not-allowed text-(--codeclub-text-muted) opacity-40' : selected ? 'bg-[#2B2B2B] text-(--codeclub-text-strong)' : 'text-(--codeclub-text) hover:bg-(--codeclub-hover) hover:text-(--codeclub-text-strong)'}`}><Icon size={15} strokeWidth={1.8} aria-hidden="true" /><span className="min-w-0 truncate">{label}</span></button>; })}
              </motion.div>}
            </AnimatePresence>
            {rightPanels.find((panel) => panel.instanceId === activeRightPanelId)?.tab === 'files' && <button type="button" onClick={() => setFilesTreeVisible((visible) => !visible)} className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-transparent transition-colors hover:bg-white/[0.08] focus-visible:outline-2 focus-visible:outline-(--codeclub-accent) ${filesTreeVisible ? 'text-(--codeclub-text-strong)' : 'text-(--codeclub-text-muted)'}`} aria-label={filesTreeVisible ? 'Ocultar árbol de archivos' : 'Mostrar árbol de archivos'} aria-pressed={filesTreeVisible} title={filesTreeVisible ? 'Ocultar árbol de archivos' : 'Mostrar árbol de archivos'}><FolderOpen size={16} strokeWidth={1.8} aria-hidden="true" /></button>}
            {rightPanels.find((panel) => panel.instanceId === activeRightPanelId)?.tab === 'review' && <button type="button" onClick={() => setReviewChangesVisible((visible) => !visible)} className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-transparent transition-colors hover:bg-white/[0.08] focus-visible:outline-2 focus-visible:outline-(--codeclub-accent) ${reviewChangesVisible ? 'text-(--codeclub-text-strong)' : 'text-(--codeclub-text-muted)'}`} aria-label={reviewChangesVisible ? 'Ocultar cambios' : 'Mostrar cambios'} aria-pressed={reviewChangesVisible} title={reviewChangesVisible ? 'Ocultar cambios' : 'Mostrar cambios'}><FolderOpen size={16} strokeWidth={1.8} aria-hidden="true" /></button>}
          </div>
          {rightPanels.map((panel) => <div key={panel.instanceId} className={`min-h-0 flex-1 ${activeRightPanelId === panel.instanceId ? 'block' : 'hidden'}`}><RightSidebarContent panel={panel} projectName={activeProjectName} projectPath={activeProjectPath} filesTreeVisible={filesTreeVisible} onToggleFilesTree={() => setFilesTreeVisible((visible) => !visible)} reviewChangesVisible={reviewChangesVisible} /></div>)}
        </div>
      </motion.aside>
    </div>
  </section>;
}

function PanelManager({ activeSection }: { activeSection: SidebarSection }) {
  const chatVisible = activeSection === 'new-chat';
  return <section role="region" className="codeclub-graphite relative min-h-0 min-w-0 flex-1 overflow-hidden backdrop-blur-xl" aria-label="Gestor de paneles" aria-live="polite">
    <div className="codeclub-panel-shell h-full w-full overflow-hidden bg-(--codeclub-center)">
      <div className={`h-full min-h-0 min-w-0 ${chatVisible ? 'block' : 'hidden'}`} aria-hidden={!chatVisible}><ChatPanel /></div>
      {!chatVisible && <div className="grid h-full min-h-0 place-items-center bg-(--codeclub-center) px-6 text-center"><div><p className="text-sm font-medium text-(--codeclub-text-strong)">Panel sin contenido</p><p className="mt-1 text-xs text-(--codeclub-text-muted)">Este espacio se adaptará cuando agreguemos esta sección.</p></div></div>}
    </div>
  </section>;
}

type ReviewFile = { path: string; status: string; additions: number; deletions: number };

function ReviewPanel({ projectPath, visible }: { projectPath?: string; visible: boolean }) {
  const [files, setFiles] = useState<ReviewFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [branch, setBranch] = useState('Sin rama');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadReview = async () => {
    if (!projectPath) return;
    setLoading(true);
    setError('');
    try {
      const [statusResult, diffResult, branchResult] = await Promise.all([
        nativeInvoke<{ stdout?: string; stderr?: string; code?: number }>('codeclub_run_command', { projectPath, request: { command: 'git', args: ['status', '--short', '--untracked-files=all'] } }),
        nativeInvoke<{ stdout?: string; stderr?: string; code?: number }>('codeclub_run_command', { projectPath, request: { command: 'git', args: ['diff', 'HEAD', '--numstat', '--'] } }),
        nativeInvoke<{ stdout?: string; stderr?: string; code?: number }>('codeclub_run_command', { projectPath, request: { command: 'git', args: ['branch', '--show-current'] } }),
      ]);
      if (statusResult.code && statusResult.code !== 0) throw new Error('Esta carpeta todavía no tiene un repositorio Git.');
      const statusLines = String(statusResult.stdout || '').split(/\r?\n/).filter(Boolean);
      const diffByPath = new Map<string, { additions: number; deletions: number }>();
      String(diffResult.stdout || '').split(/\r?\n/).filter(Boolean).forEach((line) => {
        const [added, removed, ...pathParts] = line.split('\t');
        const path = pathParts.join('\t').trim();
        if (!path) return;
        diffByPath.set(path, { additions: added === '-' ? 0 : Number(added) || 0, deletions: removed === '-' ? 0 : Number(removed) || 0 });
      });
      const nextFiles = statusLines.map((line) => {
        const code = line.slice(0, 2);
        const path = line.slice(3).trim();
        const delta = diffByPath.get(path) || { additions: 0, deletions: 0 };
        return { path, status: code === '??' ? 'A' : code.trim() || 'M', ...delta };
      });
      diffByPath.forEach((delta, path) => { if (!nextFiles.some((file) => file.path === path)) nextFiles.push({ path, status: 'M', ...delta }); });
      setFiles(nextFiles);
      setBranch(String(branchResult.stdout || '').trim() || 'Sin rama');
    } catch (caught) {
      setFiles([]);
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadReview(); }, [projectPath]);
  useEffect(() => {
    const refresh = (event: Event) => {
      const detail = (event as CustomEvent<{ projectPath?: string }>).detail;
      if (!detail?.projectPath || detail.projectPath === projectPath) void loadReview();
    };
    window.addEventListener('codeclub:workspace-changed', refresh);
    return () => window.removeEventListener('codeclub:workspace-changed', refresh);
  }, [projectPath]);

  if (!projectPath) return <div className="flex h-full flex-col items-center justify-start px-5 pt-10 text-center"><div><GitCompare size={28} strokeWidth={1.3} className="mx-auto text-(--codeclub-text-muted)" aria-hidden="true" /><p className="mt-3 mb-0 text-[12px] text-(--codeclub-text-strong)">Sin proyecto activo</p><p className="mt-1 mb-0 text-[11px] leading-5 text-(--codeclub-text-muted)">Vinculá una carpeta para revisar sus cambios.</p></div></div>;

  const additions = files.reduce((total, file) => total + file.additions, 0);
  const deletions = files.reduce((total, file) => total + file.deletions, 0);
  const selected = files.find((file) => file.path === selectedFile);
  return <section className="flex h-full min-h-0" aria-label="Cambios del proyecto">
    <main className="flex min-w-0 flex-1 flex-col px-3 py-3">
      {selected ? <div className="pt-2"><div className="flex items-center gap-2 text-[12px] text-(--codeclub-text-strong)"><GitCompare size={15} aria-hidden="true" /><span className="truncate">{selected.path}</span></div><p className="mt-3 mb-0 text-[11px] text-(--codeclub-text-muted)">Este archivo tiene <span className="text-[#8BC7FF]">+{selected.additions}</span> líneas agregadas y <span className="text-(--codeclub-text-strong)">-{selected.deletions}</span> eliminadas.</p></div> : <div className="flex flex-1 flex-col items-center justify-start pt-10 text-center"><GitCompare size={28} strokeWidth={1.3} className="text-(--codeclub-text-muted)" aria-hidden="true" /><p className="mt-3 mb-0 text-[12px] text-(--codeclub-text-strong)">Revisión del workspace</p><p className="mt-1 mb-0 max-w-[220px] text-[11px] leading-5 text-(--codeclub-text-muted)">Abrí la carpeta para ver y seleccionar todos los cambios.</p></div>}
    </main>
    {visible && <aside className="flex w-[230px] shrink-0 flex-col border-l border-(--codeclub-border-soft) px-2.5 py-3" aria-label="Archivos con cambios"><div className="flex items-center gap-1.5 px-1 pb-2 text-[11px] text-(--codeclub-text-muted)"><GitBranch size={12} aria-hidden="true" /><span className="min-w-0 truncate">{branch}</span><span className="ml-auto shrink-0"><span className="text-[#8BC7FF]">+{additions}</span> <span>-{deletions}</span></span></div><div className="min-h-0 flex-1 overflow-y-auto border-t border-(--codeclub-border-soft) pt-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">{loading && <p className="m-0 px-1 py-3 text-[11px] text-(--codeclub-text-muted)">Cargando cambios...</p>}{!loading && error && <div className="flex items-start gap-2 px-1 py-3 text-[11px] text-(--codeclub-text-muted)"><FileWarning size={14} className="mt-0.5 shrink-0 text-[#8BC7FF]" aria-hidden="true" /><span>{error}</span></div>}{!loading && !error && files.length === 0 && <p className="m-0 px-1 py-3 text-[11px] text-(--codeclub-text-muted)">No hay cambios pendientes.</p>}{!loading && !error && files.map((file) => <button key={`${file.status}-${file.path}`} type="button" onClick={() => setSelectedFile(file.path)} className={`flex w-full min-w-0 items-center gap-2 rounded-md px-1.5 py-2 text-left text-[11px] transition-colors hover:bg-(--codeclub-hover) ${selectedFile === file.path ? 'bg-(--codeclub-acrylic-active)' : ''}`}><span className={`grid h-5 w-5 shrink-0 place-items-center rounded-md text-[10px] font-semibold ${file.status === 'A' ? 'bg-[#8BC7FF]/10 text-[#8BC7FF]' : file.status === 'D' ? 'bg-white/[0.08] text-[#bdbdbd]' : 'bg-[#2B2B2B] text-(--codeclub-text-strong)'}`} aria-label={file.status === 'A' ? 'Agregado' : file.status === 'D' ? 'Eliminado' : 'Modificado'}>{file.status}</span><span className="min-w-0 flex-1 truncate text-(--codeclub-text)">{file.path}</span><span className="shrink-0 tabular-nums text-[10px] text-(--codeclub-text-muted)"><span className="text-[#8BC7FF]">+{file.additions}</span> <span>-{file.deletions}</span></span></button>)}</div></aside>}
    {!visible && <div className="flex w-full items-start justify-center pt-10 text-center"><p className="m-0 max-w-[220px] text-[11px] leading-5 text-(--codeclub-text-muted)">Abrí la carpeta de la topbar para ver los cambios.</p></div>}
  </section>;
}

const DEFAULT_BROWSER_URL = 'https://www.google.com/';

const normalizeBrowserAddress = (value: string) => {
  const raw = value.trim();
  if (!raw) return DEFAULT_BROWSER_URL;
  try {
    const parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname) return null;
    return parsed.toString();
  } catch {
    return null;
  }
};

function BrowserPanel() {
  const webviewRef = useRef<any>(null);
  const [address, setAddress] = useState(DEFAULT_BROWSER_URL);
  const [currentUrl, setCurrentUrl] = useState(DEFAULT_BROWSER_URL);
  const [loading, setLoading] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);

  const publishState = async () => {
    const view = webviewRef.current;
    if (!view) return;
    try {
      const page = await view.executeJavaScript(`(() => {
        const visible = (element) => {
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);
          return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
        };
        const elements = Array.from(document.querySelectorAll('a,button,input,textarea,select,[role="button"]')).filter(visible).slice(0, 120).map((element, index) => ({
          ref: String(index + 1), tag: element.tagName.toLowerCase(), role: element.getAttribute('role') || element.tagName.toLowerCase(),
          text: (element.innerText || element.getAttribute('aria-label') || element.getAttribute('placeholder') || '').trim().slice(0, 180),
          selector: element.id ? '#' + CSS.escape(element.id) : null,
          disabled: Boolean(element.disabled),
          rect: (() => { const value = element.getBoundingClientRect(); return { x: Math.round(value.x), y: Math.round(value.y), width: Math.round(value.width), height: Math.round(value.height) }; })()
        }));
        return { title: document.title, text: document.body?.innerText?.slice(0, 12000) || '', elements };
      })()`);
      window.dispatchEvent(new CustomEvent('codeclub:browser-state', { detail: { ok: true, url: view.getURL?.() || currentUrl, title: view.getTitle?.() || page.title, ...page } }));
    } catch (error) {
      window.dispatchEvent(new CustomEvent('codeclub:browser-state', { detail: { ok: false, url: currentUrl, error: String(error) } }));
    }
  };

  useEffect(() => {
    const view = webviewRef.current;
    if (!view) return undefined;
    const syncUrl = () => { const next = view.getURL?.() || currentUrl; setCurrentUrl(next); setAddress(next); };
    const start = () => setLoading(true);
    const stop = () => { setLoading(false); syncUrl(); void publishState(); };
    const navigate = () => syncUrl();
    view.addEventListener('did-start-loading', start);
    view.addEventListener('did-stop-loading', stop);
    view.addEventListener('did-navigate', navigate);
    view.addEventListener('did-navigate-in-page', navigate);
    return () => {
      view.removeEventListener('did-start-loading', start);
      view.removeEventListener('did-stop-loading', stop);
      view.removeEventListener('did-navigate', navigate);
      view.removeEventListener('did-navigate-in-page', navigate);
    };
  }, [currentUrl]);

  useEffect(() => {
    const requestState = () => { void publishState(); };
    const navigate = (event: Event) => {
      const value = normalizeBrowserAddress(String((event as CustomEvent<{ url?: string }>).detail?.url || ''));
      if (value) { setAddress(value); setCurrentUrl(value); }
    };
    const action = async (event: Event) => {
      const view = webviewRef.current;
      const detail = (event as CustomEvent<{ type?: string; selector?: string; text?: string; key?: string; amount?: number }>).detail || {};
      if (!view) return;
      let result: any = { ok: true, type: detail.type };
      try {
        const selector = JSON.stringify(detail.selector || '');
        if (detail.type === 'scroll') await view.executeJavaScript(`window.scrollBy(0, ${Number(detail.amount) || 600});`);
        else if (detail.type === 'click') result = await view.executeJavaScript(`(() => { const element = document.querySelector(${selector}); if (!element) return { ok: false, error: 'Elemento no encontrado' }; element.click(); return { ok: true }; })()`);
        else if (detail.type === 'type') result = await view.executeJavaScript(`(() => { const element = document.querySelector(${selector}); if (!element) return { ok: false, error: 'Elemento no encontrado' }; element.focus(); const value = ${JSON.stringify(detail.text || '')}; if ('value' in element) element.value = value; else element.textContent = value; element.dispatchEvent(new Event('input', { bubbles: true })); element.dispatchEvent(new Event('change', { bubbles: true })); return { ok: true }; })()`);
        else if (detail.type === 'key') result = await view.executeJavaScript(`(() => { const key = ${JSON.stringify(detail.key || 'Enter')}; const element = document.activeElement || document.body; element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })); element.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true })); return { ok: true }; })()`);
        await new Promise((resolve) => setTimeout(resolve, 100));
        await publishState();
      } catch (error) {
        result = { ok: false, error: String(error) };
      }
      window.dispatchEvent(new CustomEvent('codeclub:browser-action-result', { detail: result }));
    };
    window.addEventListener('codeclub:browser-state-request', requestState);
    window.addEventListener('codeclub:browser-navigate', navigate);
    window.addEventListener('codeclub:browser-action', action);
    return () => {
      window.removeEventListener('codeclub:browser-state-request', requestState);
      window.removeEventListener('codeclub:browser-navigate', navigate);
      window.removeEventListener('codeclub:browser-action', action);
    };
  }, [currentUrl]);

  const submitAddress = (event: FormEvent) => {
    event.preventDefault();
    const next = normalizeBrowserAddress(address);
    if (next) { setAddress(next); setCurrentUrl(next); }
  };
  const viewProps = { ref: (node: any) => { webviewRef.current = node; }, src: currentUrl, className: 'block h-full w-full border-0 bg-[#202124]', title: 'Contenido del navegador', allowpopups: 'true' };

  return <div className="flex h-full min-h-0 flex-col bg-[#202124] text-[#e8eaed]">
    <div className="flex h-14 shrink-0 items-center gap-3 bg-[#171717] px-3" aria-label="Controles del navegador">
      <div className="flex shrink-0 items-center gap-1"><button type="button" onClick={() => webviewRef.current?.goBack?.()} className="grid h-8 w-8 place-items-center rounded-full text-[#8a8a8a] hover:bg-white/[0.08] hover:text-white focus-visible:outline-2 focus-visible:outline-(--codeclub-accent)" aria-label="Ir atras" title="Ir atras"><ArrowLeft size={18} /></button><button type="button" onClick={() => webviewRef.current?.goForward?.()} className="grid h-8 w-8 place-items-center rounded-full text-[#8a8a8a] hover:bg-white/[0.08] hover:text-white focus-visible:outline-2 focus-visible:outline-(--codeclub-accent)" aria-label="Ir adelante" title="Ir adelante"><ArrowRight size={18} /></button><button type="button" onClick={() => webviewRef.current?.reload?.()} className="grid h-8 w-8 place-items-center rounded-full text-[#8a8a8a] hover:bg-white/[0.08] hover:text-white focus-visible:outline-2 focus-visible:outline-(--codeclub-accent)" aria-label="Recargar pagina" title="Recargar pagina"><RotateCw size={18} className={loading ? 'animate-spin' : ''} /></button></div>
      <form onSubmit={submitAddress} className="min-w-0 flex-1"><label className="sr-only" htmlFor="codeclub-browser-address">Direccion web</label><input id="codeclub-browser-address" value={address.replace(/^https?:\/\//, '').replace(/\/$/, '')} onChange={(event) => setAddress(event.target.value)} onFocus={(event) => event.currentTarget.select()} className="h-9 w-full bg-transparent text-center text-[20px] font-medium text-[#f1f3f4] outline-none placeholder:text-[#8a8a8a]" aria-label="Direccion web" /></form>
      <div className="relative flex shrink-0 items-center gap-1"><button type="button" className="grid h-8 w-8 place-items-center rounded-full text-[#b8b8b8] hover:bg-white/[0.08] hover:text-white focus-visible:outline-2 focus-visible:outline-(--codeclub-accent)" aria-label="Abrir chat lateral" title="Abrir chat lateral" onClick={() => window.dispatchEvent(new CustomEvent('codeclub:open-chat'))}><MessageCircle size={19} /></button><button type="button" onClick={() => setMenuOpen((open) => !open)} className="grid h-8 w-8 place-items-center rounded-full text-[#b8b8b8] hover:bg-white/[0.08] hover:text-white focus-visible:outline-2 focus-visible:outline-(--codeclub-accent)" aria-label="Mas opciones del navegador" aria-expanded={menuOpen}><EllipsisVertical size={19} /></button>{menuOpen && <div className="absolute top-10 right-0 z-20 w-44 rounded-lg border border-white/[0.08] bg-[#2C2C2C]/95 p-1 shadow-xl backdrop-blur-xl"><button type="button" onClick={() => { webviewRef.current?.reload?.(); setMenuOpen(false); }} className="flex w-full rounded-md px-2.5 py-2 text-left text-[11px] text-[#eeeeee] hover:bg-white/[0.08]">Recargar pagina</button><button type="button" onClick={() => { window.open(currentUrl, '_blank'); setMenuOpen(false); }} className="flex w-full rounded-md px-2.5 py-2 text-left text-[11px] text-[#eeeeee] hover:bg-white/[0.08]">Abrir fuera de Codeclub</button></div>}</div>
    </div>
    <div className="min-h-0 flex-1 overflow-hidden">{createElement('webview', viewProps)}</div>
  </div>;
}

type TerminalInfo = { id: string; name: string; shell: string; cwd: string; status: string };

function TerminalPanel({ projectPath }: { projectPath?: string }) {
  const [session, setSession] = useState<TerminalInfo | null>(null);
  const [output, setOutput] = useState('');
  const [command, setCommand] = useState('');
  const [error, setError] = useState('');
  const [restartKey, setRestartKey] = useState(0);
  const sessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    const start = async () => {
      setError('');
      setOutput('');
      setSession(null);
      try {
        const created = await nativeInvoke<TerminalInfo>('codeclub_terminal_create', { request: { projectPath, shell: 'powershell', name: 'PowerShell' } });
        if (cancelled) {
          await nativeInvoke('codeclub_terminal_delete', { id: created.id }).catch(() => undefined);
          return;
        }
        sessionIdRef.current = created.id;
        setSession(created);
        const poll = async () => {
          try {
            const snapshot = await nativeInvoke<{ info?: TerminalInfo; output?: string }>('codeclub_terminal_snapshot', { id: created.id });
            if (!cancelled) {
              setOutput(String(snapshot.output || ''));
              if (snapshot.info) setSession(snapshot.info);
            }
          } catch (reason) {
            if (!cancelled) setError(String(reason));
          }
        };
        void poll();
        timer = window.setInterval(() => void poll(), 250);
      } catch (reason) {
        if (!cancelled) setError(String(reason));
      }
    };
    void start();
    return () => {
      cancelled = true;
      if (timer) window.clearInterval(timer);
      const id = sessionIdRef.current;
      sessionIdRef.current = null;
      if (id) void nativeInvoke('codeclub_terminal_delete', { id }).catch(() => undefined);
    };
  }, [projectPath, restartKey]);

  const sendCommand = async () => {
    const value = command;
    if (!value.trim() || !session?.id) return;
    setCommand('');
    try {
      await nativeInvoke('codeclub_terminal_write', { id: session.id, data: `${value}\r\n` });
    } catch (reason) {
      setError(String(reason));
    }
  };

  return <div className="flex h-full min-h-0 flex-col bg-[#171717] text-[#eeeeee]">
    <div className="flex h-14 shrink-0 items-center justify-between gap-3 bg-[#171717] px-3" aria-label="Controles de la terminal">
      <div className="flex min-w-0 items-center gap-2"><SquareTerminal size={18} className="shrink-0 text-[#b8b8b8]" aria-hidden="true" /><div className="min-w-0"><p className="m-0 truncate text-[13px] font-medium text-[#eeeeee]">{session?.shell || 'PowerShell'}</p><p className="m-0 max-w-[220px] truncate text-[10px] text-[#777777]" title={session?.cwd || projectPath || ''}>{session?.cwd || projectPath || 'Carpeta de usuario'}</p></div></div>
      <div className="flex shrink-0 items-center gap-1"><button type="button" onClick={() => setRestartKey((value) => value + 1)} className="grid h-8 w-8 place-items-center rounded-full text-[#8a8a8a] hover:bg-white/[0.08] hover:text-white focus-visible:outline-2 focus-visible:outline-(--codeclub-accent)" aria-label="Reiniciar PowerShell" title="Reiniciar PowerShell"><RotateCw size={17} /></button><button type="button" onClick={() => setOutput('')} className="grid h-8 w-8 place-items-center rounded-full text-[#8a8a8a] hover:bg-white/[0.08] hover:text-white focus-visible:outline-2 focus-visible:outline-(--codeclub-accent)" aria-label="Limpiar salida" title="Limpiar salida"><EllipsisVertical size={18} /></button></div>
    </div>
    <div className="min-h-0 flex-1 overflow-auto bg-[#111111] px-3 py-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"><pre className="m-0 whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-[#d2d2d2]">{output || (error ? '' : 'Iniciando PowerShell...')}</pre>{error && <p className="m-0 mt-2 whitespace-pre-wrap font-mono text-[11px] leading-5 text-red-200">{error}</p>}</div>
    <form onSubmit={(event) => { event.preventDefault(); void sendCommand(); }} className="flex shrink-0 items-center gap-2 border-t border-[#2B2B2B] bg-[#171717] px-3 py-2"><span className="font-mono text-[12px] text-[#8BC7FF]" aria-hidden="true">&gt;</span><label className="sr-only" htmlFor="codeclub-terminal-input">Escribir comando en PowerShell</label><input id="codeclub-terminal-input" value={command} onChange={(event) => setCommand(event.target.value)} disabled={!session || Boolean(error)} placeholder="Escribi un comando..." className="min-w-0 flex-1 bg-transparent font-mono text-[11px] text-[#eeeeee] outline-none placeholder:text-[#777777]" autoComplete="off" /></form>
  </div>;
}

const artifactStatusLabels: Record<TaskStatus, string> = {
  pending: 'Pendiente',
  in_progress: 'En curso',
  completed: 'Completado',
  cancelled: 'Cancelado',
  blocked: 'Bloqueado',
};

const artifactStatusClasses: Record<TaskStatus, string> = {
  pending: 'bg-white/[0.08] text-(--codeclub-text-muted)',
  in_progress: 'bg-[#8BC7FF]/10 text-[#8BC7FF]',
  completed: 'bg-emerald-300/10 text-emerald-200',
  cancelled: 'bg-white/[0.05] text-[#777777]',
  blocked: 'bg-red-300/10 text-red-200',
};

function ArtifactStatusPill({ status }: { status: TaskStatus }) {
  return <span className={`inline-flex shrink-0 items-center rounded-full px-1.5 py-0.5 text-[10px] leading-4 ${artifactStatusClasses[status] || artifactStatusClasses.pending}`}>{artifactStatusLabels[status] || artifactStatusLabels.pending}</span>;
}

function ArtifactsPanel({ projectPath, projectName }: { projectPath?: string; projectName: string }) {
  const [state, setState] = useState<AgentState>({ plan: null, plans: [], todos: [] });
  const [loading, setLoading] = useState(Boolean(projectPath));
  const [query, setQuery] = useState('');

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!projectPath) {
        setState({ plan: null, plans: [], todos: [] });
        setLoading(false);
        return;
      }
      setLoading(true);
      const next = await readAgentState(projectPath);
      if (!cancelled) {
        setState(next);
        setLoading(false);
      }
    };
    void load();
    const refresh = (event: Event) => {
      const detail = (event as CustomEvent<{ projectPath?: string }>).detail;
      if (!detail?.projectPath || detail.projectPath === projectPath) void load();
    };
    window.addEventListener('codeclub:artifacts-changed', refresh);
    return () => {
      cancelled = true;
      window.removeEventListener('codeclub:artifacts-changed', refresh);
    };
  }, [projectPath]);

  const normalizedQuery = query.trim().toLowerCase();
  const plans = (state.plans?.length ? state.plans : state.plan ? [state.plan] : []).filter((plan) => !normalizedQuery || plan.title.toLowerCase().includes(normalizedQuery) || plan.steps.some((step) => step.title.toLowerCase().includes(normalizedQuery)));
  const todos = state.todos.filter((todo) => !normalizedQuery || todo.title.toLowerCase().includes(normalizedQuery) || todo.description?.toLowerCase().includes(normalizedQuery));
  const reference = (kind: 'plan' | 'todo', id: string, title: string) => {
    if (!projectPath) return;
    window.dispatchEvent(new CustomEvent('codeclub:artifact-reference', { detail: { projectPath, kind, id, title } }));
  };
  const removePlan = async (id: string) => {
    if (!projectPath || !window.confirm('Eliminar este plan?')) return;
    const current = await readAgentState(projectPath);
    const plans = (current.plans || (current.plan ? [current.plan] : [])).filter((plan) => plan.id !== id);
    await writeAgentState(projectPath, { ...current, plans, plan: plans[plans.length - 1] || null });
    window.dispatchEvent(new CustomEvent('codeclub:artifacts-changed', { detail: { projectPath } }));
  };
  const removeTodo = async (id: string) => {
    if (!projectPath || !window.confirm('Eliminar este TODO?')) return;
    const current = await readAgentState(projectPath);
    await writeAgentState(projectPath, { ...current, todos: current.todos.filter((todo) => todo.id !== id) });
    window.dispatchEvent(new CustomEvent('codeclub:artifacts-changed', { detail: { projectPath } }));
  };

  if (!projectPath) return <div className="grid h-full place-items-center px-5 text-center"><div><ListTodo size={30} strokeWidth={1.3} className="mx-auto text-(--codeclub-text-muted)" aria-hidden="true" /><p className="mt-3 mb-0 text-[12px] text-(--codeclub-text-strong)">Sin proyecto activo</p><p className="mt-1 mb-0 text-[11px] leading-5 text-(--codeclub-text-muted)">Vinculá una carpeta para ver sus artifacts.</p></div></div>;

  return <div className="flex h-full min-h-0 flex-col bg-(--codeclub-center)">
    <div className="shrink-0 border-b border-(--codeclub-border-soft) px-3 py-3">
      <div className="flex min-w-0 items-center gap-2"><ListTodo size={17} strokeWidth={1.7} className="shrink-0 text-(--codeclub-text-muted)" aria-hidden="true" /><div className="min-w-0 flex-1"><h2 className="m-0 truncate text-[13px] font-medium text-(--codeclub-text-strong)">Artifacts</h2><p className="m-0 mt-0.5 truncate text-[10px] text-(--codeclub-text-muted)" title={projectName}>{projectName}</p></div><span className="text-[10px] tabular-nums text-(--codeclub-text-muted)">{state.plans.length + state.todos.length}</span></div>
      <label className="mt-3 flex h-8 items-center rounded-lg border border-(--codeclub-border-soft) bg-[#1E1E1E] px-2.5 focus-within:border-[#8BC7FF]/50"><span className="sr-only">Buscar artifacts</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar artifacts" className="min-w-0 flex-1 bg-transparent text-[11px] text-(--codeclub-text-strong) outline-none placeholder:text-(--codeclub-text-muted)" /></label>
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {loading && <div className="grid min-h-[160px] place-items-center text-[11px] text-(--codeclub-text-muted)">Cargando artifacts...</div>}
      {!loading && plans.length === 0 && todos.length === 0 && <div className="grid min-h-[220px] place-items-center text-center"><div><ListTodo size={26} strokeWidth={1.3} className="mx-auto text-(--codeclub-text-muted)" aria-hidden="true" /><p className="mt-3 mb-0 text-[12px] text-(--codeclub-text-strong)">{normalizedQuery ? 'Sin resultados' : 'Todavia no hay artifacts'}</p><p className="mt-1 mb-0 text-[11px] leading-5 text-(--codeclub-text-muted)">{normalizedQuery ? 'Proba con otro termino.' : 'Los planes y TODOs creados por la IA apareceran aca.'}</p></div></div>}
      {!loading && plans.length > 0 && <section aria-labelledby="artifacts-plans"><div className="mb-2 flex items-center justify-between"><h3 id="artifacts-plans" className="m-0 text-[10px] font-medium uppercase tracking-[0.08em] text-(--codeclub-text-muted)">Planes</h3><span className="text-[10px] text-(--codeclub-text-muted)">{plans.length}</span></div><div className="grid gap-2">{plans.map((plan) => { const completed = plan.steps.filter((step) => step.status === 'completed').length; const progress = plan.steps.length ? Math.round((completed / plan.steps.length) * 100) : 0; return <article key={plan.id} className="rounded-lg border border-(--codeclub-border-soft) bg-[#1E1E1E] p-2.5"><div className="flex min-w-0 items-start gap-2"><button type="button" onClick={() => reference('plan', plan.id, plan.title)} className="min-w-0 flex-1 truncate text-left text-[12px] font-medium text-(--codeclub-text-strong) hover:text-[#8BC7FF] focus-visible:outline-2 focus-visible:outline-(--codeclub-accent)">{plan.title}</button><ArtifactStatusPill status={plan.status} /><button type="button" onClick={() => void removePlan(plan.id)} className="grid h-5 w-5 shrink-0 place-items-center rounded text-(--codeclub-text-muted) hover:bg-white/[0.08] hover:text-(--codeclub-text-strong) focus-visible:outline-2 focus-visible:outline-(--codeclub-accent)" aria-label={`Eliminar plan ${plan.title}`} title="Eliminar plan"><X size={12} /></button></div><div className="mt-2 flex items-center gap-2"><div className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-white/[0.08]" role="progressbar" aria-label={`Progreso de ${plan.title}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><span className="block h-full rounded-full bg-[#8BC7FF]" style={{ width: `${progress}%` }} /></div><span className="shrink-0 text-[10px] tabular-nums text-(--codeclub-text-muted)">{completed}/{plan.steps.length}</span></div><div className="mt-2 grid gap-1">{plan.steps.map((step) => <button key={step.id} type="button" onClick={() => reference('plan', plan.id, `${plan.title}: ${step.title}`)} className="flex min-w-0 items-center gap-2 rounded px-1 py-1 text-left hover:bg-white/[0.05] focus-visible:outline-2 focus-visible:outline-(--codeclub-accent)"><span className={`h-1.5 w-1.5 shrink-0 rounded-full ${step.status === 'completed' ? 'bg-emerald-200' : step.status === 'in_progress' ? 'bg-[#8BC7FF]' : 'bg-[#666666]'}`} aria-hidden="true" /><span className="min-w-0 flex-1 truncate text-[10px] text-(--codeclub-text-muted)" title={step.title}>{step.title}</span><ArtifactStatusPill status={step.status} /></button>)}</div></article>; })}</div></section>}
      {!loading && todos.length > 0 && <section aria-labelledby="artifacts-todos" className={`${plans.length ? 'mt-4 border-t border-(--codeclub-border-soft) pt-3' : ''}`}><div className="mb-2 flex items-center justify-between"><h3 id="artifacts-todos" className="m-0 text-[10px] font-medium uppercase tracking-[0.08em] text-(--codeclub-text-muted)">TODO</h3><span className="text-[10px] text-(--codeclub-text-muted)">{todos.length}</span></div><div className="grid gap-1">{todos.map((todo) => <div key={todo.id} className="flex min-w-0 items-center gap-2 rounded-lg px-1.5 py-2 hover:bg-white/[0.04]"><button type="button" onClick={() => reference('todo', todo.id, todo.title)} className="flex min-w-0 flex-1 items-center gap-2 text-left focus-visible:outline-2 focus-visible:outline-(--codeclub-accent)"><span className={`h-1.5 w-1.5 shrink-0 rounded-full ${todo.status === 'completed' ? 'bg-emerald-200' : todo.status === 'in_progress' ? 'bg-[#8BC7FF]' : 'bg-[#666666]'}`} aria-hidden="true" /><span className="min-w-0 flex-1 truncate text-[11px] text-(--codeclub-text)" title={todo.description || todo.title}>{todo.title}</span><ArtifactStatusPill status={todo.status} /></button><button type="button" onClick={() => void removeTodo(todo.id)} className="grid h-5 w-5 shrink-0 place-items-center rounded text-(--codeclub-text-muted) hover:bg-white/[0.08] hover:text-(--codeclub-text-strong) focus-visible:outline-2 focus-visible:outline-(--codeclub-accent)" aria-label={`Eliminar TODO ${todo.title}`} title="Eliminar TODO"><X size={12} /></button></div>)}</div></section>}
    </div>
  </div>;
}

function RightSidebarContent({ panel, projectName, projectPath, filesTreeVisible, onToggleFilesTree, reviewChangesVisible }: { panel: RightPanelInstance; projectName: string; projectPath?: string; filesTreeVisible: boolean; onToggleFilesTree: () => void; reviewChangesVisible: boolean }) {
  const { tab } = panel;
  const current = rightPanelTabs.find((item) => item.id === tab) ?? rightPanelTabs[0];
  const Icon = current.icon;
  const descriptions: Record<RightPanelTab, string> = {
    files: 'Explorá los archivos del proyecto activo.',
    review: 'Revisá cambios y actividad del workspace.',
    browser: 'Abrí y controlá páginas dentro de Electron.',
    artifacts: 'Consultá planes, TODOs y resultados de la IA.',
    terminals: 'Gestioná terminales persistentes de la sesión.',
  };
  if (tab === 'files') return <motion.section key={panel.instanceId} id={`right-panel-${panel.instanceId}`} role="tabpanel" aria-label={panel.label} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.16, ease: 'easeOut' }} className="min-h-0 flex-1 overflow-hidden">{projectPath ? <ProjectPanelView projectPath={projectPath} showFileTree={filesTreeVisible} onToggleFileTree={onToggleFilesTree} /> : <div className="flex h-full flex-col items-center justify-start px-5 pt-10 text-center"><div><FolderPen size={28} strokeWidth={1.3} className="mx-auto text-(--codeclub-text-muted)" aria-hidden="true" /><p className="mt-3 mb-0 text-[12px] text-(--codeclub-text-strong)">Sin proyecto activo</p><p className="mt-1 mb-0 text-[11px] leading-5 text-(--codeclub-text-muted)">Vinculá una carpeta para explorar sus archivos.</p></div></div>}</motion.section>;
  if (tab === 'review') return <motion.section key={panel.instanceId} id={`right-panel-${panel.instanceId}`} role="tabpanel" aria-label={panel.label} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.16, ease: 'easeOut' }} className="min-h-0 flex-1 overflow-hidden"><ReviewPanel projectPath={projectPath} visible={reviewChangesVisible} /></motion.section>;
  if (tab === 'browser') return <motion.section key={panel.instanceId} id={`right-panel-${panel.instanceId}`} role="tabpanel" aria-label={panel.label} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.16, ease: 'easeOut' }} className="min-h-0 flex-1 overflow-hidden"><BrowserPanel /></motion.section>;
  if (tab === 'artifacts') return <motion.section key={panel.instanceId} id={`right-panel-${panel.instanceId}`} role="tabpanel" aria-label={panel.label} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.16, ease: 'easeOut' }} className="min-h-0 flex-1 overflow-hidden"><ArtifactsPanel projectPath={projectPath} projectName={projectName} /></motion.section>;
  if (tab === 'terminals') return <motion.section key={panel.instanceId} id={`right-panel-${panel.instanceId}`} role="tabpanel" aria-label={panel.label} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.16, ease: 'easeOut' }} className="min-h-0 flex-1 overflow-hidden"><TerminalPanel projectPath={projectPath} /></motion.section>;
  return <motion.section key={panel.instanceId} id={`right-panel-${panel.instanceId}`} role="tabpanel" aria-label={panel.label} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.16, ease: 'easeOut' }} className="min-h-0 flex-1 overflow-auto px-3 py-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
    <div className="mt-5 grid min-h-[180px] place-items-center rounded-xl bg-transparent px-5 text-center"><div><Icon size={28} strokeWidth={1.3} className="mx-auto text-(--codeclub-text-muted)" aria-hidden="true" /><p className="mt-3 mb-0 text-[12px] text-(--codeclub-text-strong)">{projectPath ? projectName : 'Sin proyecto activo'}</p><p className="mt-1 mb-0 text-[11px] leading-5 text-(--codeclub-text-muted)">{descriptions[tab]}</p></div></div>
  </motion.section>;
}

function SidebarItem({ icon, label, active, onClick }: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void }) {
  return <button type="button" aria-current={active ? 'page' : undefined} onClick={onClick} className={`flex h-8 w-full items-center gap-3 rounded-lg px-1.5 text-left text-[13px] transition-colors hover:bg-(--codeclub-hover) hover:text-(--codeclub-text-strong) ${active ? 'bg-(--codeclub-acrylic-active) text-(--codeclub-text-strong)' : 'text-(--codeclub-text)'}`}><span className={`grid h-4 w-4 shrink-0 place-items-center [&>svg]:size-4 ${active ? 'text-(--codeclub-text-strong)' : 'text-(--codeclub-text-muted)'}`}>{icon}</span><span>{label}</span></button>;
}
