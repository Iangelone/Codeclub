'use client';

/** Main workspace shell: coordinates project/chat-scoped panels, persisted layouts, browser, files, review, and terminals. */
import { createElement, memo, useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { AppWindowMac, ArrowLeft, ArrowRight, ArrowRightToLine, ArrowUp, Check, ChevronDown, Circle, CircleCheck, CirclePlus, Clock, CopyX, EllipsisVertical, ExternalLink, FileWarning, FolderOpen, FolderPen, FolderTree, Grid2X2, Heart, Home, Hourglass, Info, MessageSquare, MoreHorizontal, MousePointerClick, PanelLeft, Pencil, Play, Plus, Radius, RotateCw, Search, SquareTerminal, Trash2, X } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { GlobeCheck } from 'lucide-react';
import { Terminal as XtermTerminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import ChatPanel from './ChatPanel';
import OrbsPanel from './OrbsPanel';
import BrowserStyleEditor, { type BrowserElementSelection, type BrowserElementChanges } from './BrowserStyleEditor';
import { createBrowserPickerScript, type BrowserMarkerOrder } from '../lib/browser-dom-picker';
import { ProjectPanelView } from './ChatInterface';
import { useOrbPalette } from './OrbPaletteProvider';
import OrbPaletteButton from './ui/OrbPaletteButton';
import { readGlobalChats, readProjectMeta, writeGlobalChats, writeProjectMeta } from '../lib/projectManager';
import { nativeInvoke, onTerminalOutput } from '../lib/runtime';
import { getSetting, setSetting } from '../lib/persistence';
import { activityTranslations, agentTextSelectionTranslations, browserStyleTranslations, rightSidebarTranslations, sidebarTranslations, useAppLanguage, type AppLanguage } from '../lib/i18n';
import { sameSession, useSharedSessions, type SharedSession } from '../lib/shared-sessions';

const MIN_WIDTH = 220;
const MAX_WIDTH = 420;
const MIN_CENTER_WIDTH = 320;
const RESIZE_HANDLE_SPACE = 8;
const DEFAULT_LEFT = 280;
const DEFAULT_RIGHT = 300;

type Side = 'left' | 'right';
type RecentChat = { id: string; title: string; customName?: boolean; projectPath?: string; projectName?: string };
type SidebarSection = 'new-chat' | 'projects' | 'orbs' | 'extensions';
type ChatContextMenu = { chat: RecentChat; x: number; y: number };
type RightPanelTab = 'files' | 'browser' | 'terminals';
type RightPanelInstance = { instanceId: string; tab: RightPanelTab; label: string; iconUrl?: string; terminalId?: string };
type RightChatView = { panels: RightPanelInstance[]; active: string; file: string; tree: boolean; width: number; open: boolean };
const emptyRightView = (): RightChatView => ({ panels: [], active: '', file: '', tree: false, width: DEFAULT_RIGHT, open: false });
type RightPanelContextMenu = { panel: RightPanelInstance; x: number; y: number };
function GithubMark({ size = 16 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .5a12 12 0 0 0-3.79 23.39c.6.11.82-.26.82-.58v-2.05c-3.34.73-4.04-1.42-4.04-1.42-.55-1.39-1.33-1.76-1.33-1.76-1.09-.75.08-.74.08-.74 1.2.08 1.83 1.23 1.83 1.23 1.07 1.83 2.8 1.3 3.49.99.11-.77.42-1.3.76-1.6-2.67-.3-5.47-1.34-5.47-5.95 0-1.31.47-2.38 1.23-3.22-.12-.3-.53-1.53.12-3.18 0 0 1-.32 3.3 1.23a11.47 11.47 0 0 1 6 0c2.29-1.55 3.29-1.23 3.29-1.23.66 1.65.25 2.88.13 3.18.77.84 1.23 1.91 1.23 3.22 0 4.62-2.8 5.64-5.48 5.94.43.37.81 1.1.81 2.22v3.29c0 .32.22.69.83.57A12 12 0 0 0 12 .5Z"/></svg>;
}

const rightPanelTabs: Array<{ id: RightPanelTab; label: string; icon: typeof FolderTree }> = [
  { id: 'files', label: 'Archivos', icon: FolderPen },
  { id: 'browser', label: 'Navegador', icon: AppWindowMac },
  { id: 'terminals', label: 'Terminales', icon: SquareTerminal },
];

function ResizeHandle({ side, value, maxValue, onStart, onKeyboardResize, language }: { side: Side; value: number; maxValue: number; onStart: (event: React.PointerEvent<HTMLDivElement>) => void; onKeyboardResize: (value: number) => void; language: AppLanguage }) {
  const isLeft = side === 'left';
  const resizeWithKeyboard = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const direction = isLeft ? 1 : -1;
    let next = value;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next += 16 * direction;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next -= 16 * direction;
    else if (event.key === 'Home') next = MIN_WIDTH;
    else if (event.key === 'End') next = maxValue;
    else return;
    event.preventDefault();
    onKeyboardResize(Math.min(maxValue, Math.max(MIN_WIDTH, next)));
  };
  return <div
    role="separator"
    aria-orientation="vertical"
    aria-label={language === 'en' ? `Resize ${isLeft ? 'left' : 'right'} sidebar` : `Redimensionar sidebar ${isLeft ? 'izquierda' : 'derecha'}`}
    aria-valuemin={MIN_WIDTH}
    aria-valuemax={maxValue}
    aria-valuenow={value}
    tabIndex={0}
    onPointerDown={onStart}
    onKeyDown={resizeWithKeyboard}
    className={`group relative z-10 w-1 shrink-0 cursor-col-resize bg-transparent focus-visible:outline-2 focus-visible:outline-(--codeclub-accent) ${isLeft ? '-mr-1' : '-ml-1'}`}
  >
    <motion.span initial={{ opacity: 0 }} whileHover={{ opacity: 1 }} className="codeclub-resize-indicator absolute top-1/2 left-1/2 h-[65%] w-px -translate-x-1/2 -translate-y-1/2 rounded-full" />
  </div>;
}

export default function WorkspaceLayout({ leftOpen, rightOpen, onToggleLeft, onRightVisibilityChange }: { leftOpen: boolean; rightOpen: boolean; onToggleLeft: () => void; onRightVisibilityChange: (open: boolean) => void }) {
  const language = useAppLanguage();
  const sessions = useSharedSessions();
  const sidebarText = sidebarTranslations[language];
  const panelText = rightSidebarTranslations[language];
  const [activeProjectId, setActiveProjectId] = useState('home');
  const [activeProjectName, setActiveProjectName] = useState('Codeclub');
  const [activeProjectPath, setActiveProjectPath] = useState<string | undefined>();
  const [editingProjectName, setEditingProjectName] = useState(false);
  const [projectNameDraft, setProjectNameDraft] = useState('Codeclub');
  const [projectNameError, setProjectNameError] = useState('');
  const projectNameEdit = useRef({ token: 0, submitted: true });
  const [chatsByProject, setChatsByProject] = useState<Record<string, RecentChat[]>>({});
  const [activeSection, setActiveSection] = useState<SidebarSection>('new-chat');
  const [activeChatId, setActiveChatId] = useState<string | undefined>();
  const [seenCompletions, setSeenCompletions] = useState<Record<string, string>>({});
  const [seenCompletionsReady, setSeenCompletionsReady] = useState(false);
  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('codeclub:seen-chat-completions') || '{}');
      if (stored && typeof stored === 'object' && !Array.isArray(stored)) setSeenCompletions(stored);
    } catch { /* Invalid or unavailable local preferences. */ }
    setSeenCompletionsReady(true);
  }, []);
  useEffect(() => {
    if (!seenCompletionsReady || activeSection !== 'new-chat' || !activeChatId) return;
    const session = sessions.find(item => !item.external && sameSession({chatId: activeChatId, projectPath: activeProjectPath || ''}, item));
    if (!session || session.busy || session.state !== 'finished') return;
    const completion = `${session.runId}:${session.startedAt}`;
    setSeenCompletions(previous => previous[session.key] === completion ? previous : {...previous, [session.key]: completion});
  }, [sessions, activeChatId, activeProjectPath, activeSection, seenCompletionsReady]);
  useEffect(() => {
    if (!seenCompletionsReady) return;
    try { localStorage.setItem('codeclub:seen-chat-completions', JSON.stringify(seenCompletions)); } catch { /* Keep in-memory read state. */ }
  }, [seenCompletions, seenCompletionsReady]);
  const [chatContextMenu, setChatContextMenu] = useState<ChatContextMenu | null>(null);
  const chatContextMenuRef = useRef<HTMLDivElement | null>(null);
  const [confirmClearHistory, setConfirmClearHistory] = useState(false);
  const [leftWidth, setLeftWidth] = useState(DEFAULT_LEFT);
  // Keep layouts isolated per project/chat; restored terminal IDs are cleared because their processes cannot survive a restart.
  const rightScope = JSON.stringify([activeProjectPath || '', activeChatId || 'draft']);
  const [rightViews, setRightViews] = useState<Record<string, RightChatView>>({});
  const [rightViewsReady, setRightViewsReady] = useState(false);
  const rightView = rightViews[rightScope] || emptyRightView();
  const restoringVisibility = useRef<boolean | null>(null);
  const { panels: rightPanels, active: activeRightPanelId, file: selectedRightFilePath, tree: filesTreeVisible, width: rightWidth } = rightView;
  const updateRightView = useCallback(<K extends keyof RightChatView,>(key: K, update: React.SetStateAction<RightChatView[K]>) => {
    setRightViews(previous => { const view = previous[rightScope] || emptyRightView(); return { ...previous, [rightScope]: { ...view, [key]: typeof update === 'function' ? (update as (value: RightChatView[K]) => RightChatView[K])(view[key]) : update } }; });
  }, [rightScope]);
  const setRightPanels = useCallback((update: React.SetStateAction<RightPanelInstance[]>) => updateRightView('panels', update), [updateRightView]);
  const setActiveRightPanelId = useCallback((update: React.SetStateAction<string>) => updateRightView('active', update), [updateRightView]);
  const setSelectedRightFilePath = (value: string) => updateRightView('file', value);
  const setFilesTreeVisible = (update: React.SetStateAction<boolean>) => updateRightView('tree', update);
  const setRightWidth = (update: React.SetStateAction<number>) => updateRightView('width', update);
  useEffect(() => {
    if (!rightViewsReady) return;
    const open = rightViews[rightScope]?.open ?? false;
    restoringVisibility.current = open;
    onRightVisibilityChange(open);
  }, [rightScope, rightViewsReady, onRightVisibilityChange]);
  useEffect(() => {
    if (!rightViewsReady) return;
    if (restoringVisibility.current !== null) {
      if (restoringVisibility.current === rightOpen) restoringVisibility.current = null;
      return;
    }
    updateRightView('open', rightOpen);
  }, [rightOpen, rightScope, rightViewsReady, updateRightView]);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('codeclub:right-chat-views') || '{}');
      const restored: Record<string, RightChatView> = {};
      for (const [key, value] of Object.entries(saved)) {
        const view = value as RightChatView;
        const context = JSON.parse(key);
        if (!Array.isArray(context) || context.length !== 2 || !Array.isArray(view?.panels)) continue;
        restored[key] = { ...emptyRightView(), ...view, panels: view.panels.filter(panel => ['files', 'browser', 'terminals'].includes(panel.tab) && typeof panel.instanceId === 'string').map(panel => ({ ...panel, terminalId: undefined })) };
      }
      setRightViews(previous => ({ ...restored, ...previous }));
    } catch { /* Invalid saved layout starts empty. */ }
    setRightViewsReady(true);
  }, []);
  useEffect(() => {
    if (!rightViewsReady) return;
    const timer = setTimeout(() => { try { localStorage.setItem('codeclub:right-chat-views', JSON.stringify(rightViews)); } catch { /* Layout remains usable when storage is full. */ } }, 200);
    return () => clearTimeout(timer);
  }, [rightViews, rightViewsReady]);
  useEffect(() => { setRightMenuOpen(false); setRightContextMenu(null); setReviewModalOpen(false); rightPanelNavigation.current = { entries: [], index: -1, moving: false }; }, [rightScope]);
  const [reviewModalOpen, setReviewModalOpen] = useState(false);
  const [rightMenuOpen, setRightMenuOpen] = useState(false);
  const rightMenuRef = useRef<HTMLDivElement | null>(null);
  const [rightContextMenu, setRightContextMenu] = useState<RightPanelContextMenu | null>(null);
  const rightContextMenuRef = useRef<HTMLDivElement | null>(null);
  const rightPanelSequence = useRef(0);
  const rightPanelNavigation = useRef<{ entries: string[]; index: number; moving: boolean }>({ entries: [], index: -1, moving: false });
  const [resizing, setResizing] = useState<Side | null>(null);
  const [sizesReady, setSizesReady] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(1280);
  const resizeRef = useRef<{ side: Side; pointerId: number; startX: number; startWidth: number } | null>(null);
  const resizeFrameRef = useRef<number | null>(null);
  const pendingResizeRef = useRef<{ side: Side; width: number } | null>(null);

  const rightMaxWidth = Math.max(
    MIN_WIDTH,
    viewportWidth - (leftOpen ? leftWidth : 0) - MIN_CENTER_WIDTH - RESIZE_HANDLE_SPACE,
  );
  const rightMaxWidthRef = useRef(rightMaxWidth);
  rightMaxWidthRef.current = rightMaxWidth;

  useEffect(() => {
    const updateViewportWidth = () => setViewportWidth(window.innerWidth);
    updateViewportWidth();
    window.addEventListener('resize', updateViewportWidth);
    return () => window.removeEventListener('resize', updateViewportWidth);
  }, []);

  useEffect(() => {
    if (rightViewsReady) setRightWidth((current) => Math.min(current, rightMaxWidth));
  }, [rightMaxWidth, rightScope, rightViewsReady]);

  useEffect(() => {
    if (!activeRightPanelId) return;
    const navigation = rightPanelNavigation.current;
    const validIds = new Set(rightPanels.map((panel) => panel.instanceId));
    const currentId = navigation.entries[navigation.index];
    navigation.entries = navigation.entries.filter((entry) => validIds.has(entry));
    navigation.index = navigation.entries.indexOf(currentId);
    if (navigation.index < 0) navigation.index = Math.min(navigation.entries.length - 1, Math.max(0, navigation.entries.length - 1));
    if (navigation.moving) {
      navigation.moving = false;
      return;
    }
    if (navigation.entries[navigation.index] === activeRightPanelId) return;
    navigation.entries = navigation.entries.slice(0, navigation.index + 1);
    navigation.entries.push(activeRightPanelId);
    navigation.index = navigation.entries.length - 1;
  }, [activeRightPanelId, rightPanels]);

  useEffect(() => {
    const publishNavigationState = () => {
      const navigation = rightPanelNavigation.current;
      const isValid = (index: number) => index >= 0 && index < navigation.entries.length && rightPanels.some((panel) => panel.instanceId === navigation.entries[index]);
      window.dispatchEvent(new CustomEvent('codeclub:right-panel-navigation-state', { detail: { back: isValid(navigation.index - 1), forward: isValid(navigation.index + 1) } }));
    };
    publishNavigationState();
    window.addEventListener('codeclub:right-panel-navigation-request', publishNavigationState);
    return () => window.removeEventListener('codeclub:right-panel-navigation-request', publishNavigationState);
  }, [activeRightPanelId, rightPanels]);

  useEffect(() => {
    const movePanel = (direction: -1 | 1) => {
      const navigation = rightPanelNavigation.current;
      let nextIndex = navigation.index + direction;
      while (nextIndex >= 0 && nextIndex < navigation.entries.length && !rightPanels.some((panel) => panel.instanceId === navigation.entries[nextIndex])) nextIndex += direction;
      if (nextIndex < 0 || nextIndex >= navigation.entries.length) return;
      const nextId = navigation.entries[nextIndex];
      navigation.index = nextIndex;
      navigation.moving = true;
      setActiveRightPanelId(nextId);
    };
    const back = () => movePanel(-1);
    const forward = () => movePanel(1);
    window.addEventListener('codeclub:right-panel-back', back);
    window.addEventListener('codeclub:right-panel-forward', forward);
    return () => {
      window.removeEventListener('codeclub:right-panel-back', back);
      window.removeEventListener('codeclub:right-panel-forward', forward);
    };
  }, [rightPanels]);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('codeclub:sidebar-sizes') ?? '{}') as { left?: number; right?: number };
      if (typeof saved.left === 'number') setLeftWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, saved.left)));
    } catch { /* Invalid saved dimensions fall back to the initial panel sizes. */ }
    setSizesReady(true);
  }, []);

  useEffect(() => { if (sizesReady) localStorage.setItem('codeclub:sidebar-sizes', JSON.stringify({ left: leftWidth })); }, [leftWidth, rightWidth, sizesReady]);

  useEffect(() => {
    if (!resizing) return undefined;
    const applyPendingResize = () => {
      const pending = pendingResizeRef.current;
      pendingResizeRef.current = null;
      if (!pending) return;
      if (pending.side === 'left') setLeftWidth(pending.width); else setRightWidth(pending.width);
    };
    const handleMove = (event: PointerEvent) => {
      const drag = resizeRef.current;
      if (!drag || event.pointerId !== drag.pointerId) return;
      const delta = drag.side === 'left' ? event.clientX - drag.startX : drag.startX - event.clientX;
      const maxWidth = drag.side === 'right' ? rightMaxWidthRef.current : MAX_WIDTH;
      const nextWidth = Math.min(maxWidth, Math.max(MIN_WIDTH, drag.startWidth + delta));
      pendingResizeRef.current = { side: drag.side, width: nextWidth };
      if (resizeFrameRef.current === null) {
        resizeFrameRef.current = window.requestAnimationFrame(() => {
          resizeFrameRef.current = null;
          applyPendingResize();
        });
      }
    };
    const finishResize = () => {
      if (!resizeRef.current) return;
      if (resizeFrameRef.current !== null) {
        window.cancelAnimationFrame(resizeFrameRef.current);
        resizeFrameRef.current = null;
      }
      applyPendingResize();
      resizeRef.current = null;
      setResizing(null);
    };
    const handleEnd = (event: PointerEvent) => {
      if (event.pointerId === resizeRef.current?.pointerId) finishResize();
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleEnd);
    window.addEventListener('pointercancel', handleEnd);
    window.addEventListener('blur', finishResize);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleEnd);
      window.removeEventListener('pointercancel', handleEnd);
      window.removeEventListener('blur', finishResize);
      if (resizeFrameRef.current !== null) {
        window.cancelAnimationFrame(resizeFrameRef.current);
        resizeFrameRef.current = null;
      }
    };
  }, [resizing]);

  useEffect(() => {
    const handleProjectSwitch = (event: Event) => {
      const project = (event as CustomEvent<{ id?: string; name?: string; path?: string }>).detail;
      if (!project?.id) return;
      const projectId = project.id;
      setActiveProjectId(projectId);
      setActiveProjectPath(project.path);
      const nextName = project.name ?? (project.id === 'home' ? 'Codeclub' : activeProjectName);
      setActiveProjectName(nextName);
      setProjectNameDraft(nextName);
      projectNameEdit.current = { token: projectNameEdit.current.token + 1, submitted: true };
      setEditingProjectName(false);
      setProjectNameError('');
      setChatsByProject((current) => current[projectId] ? current : { ...current, [projectId]: [] });
      window.dispatchEvent(new CustomEvent('codeclub:open-empty-chat'));
      if (project.path) window.localStorage.setItem('codeclub:active-project', JSON.stringify({ id: projectId, name: nextName, path: project.path }));
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
    } catch { /* Start in the global Codeclub workspace when no project is saved. */ }
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
    const unsubscribe = (window as any).codeclub?.onTasksChanged?.(refresh);
    const unsubscribeSettings = (window as any).codeclub?.onSettingsChanged?.((detail: { key: string }) => { if (detail.key === 'codeclub_global_chats') refresh(); });
    window.addEventListener('codeclub:global-chat-changed', refresh);
    window.addEventListener('codeclub:project-meta-changed', refresh);
    return () => {
      cancelled = true;
      unsubscribe?.();
      unsubscribeSettings?.();
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
    if (!chatContextMenu) { setConfirmClearHistory(false); return; }
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
    document.addEventListener('pointerdown', closeMenu, true);
    window.addEventListener('keydown', closeWithEscape);
    return () => {
      document.removeEventListener('pointerdown', closeMenu, true);
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
        const panelId = tab.getAttribute('aria-controls');
        if (panelId) {
          tab.id = `right-tab-${panelId}`;
          root.querySelector<HTMLElement>(`#${CSS.escape(panelId)}`)?.setAttribute('aria-labelledby', tab.id);
        }
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
    const showCreatedChat = (event: Event) => {
      const chatId = (event as CustomEvent<{ chatId?: string }>).detail?.chatId;
      if (!chatId) return;
      const draftScope = JSON.stringify([activeProjectPath || '', 'draft']);
      const chatScope = JSON.stringify([activeProjectPath || '', chatId]);
      setRightViews(previous => {
        if (!previous[draftScope] || previous[chatScope]) return previous;
        const { [draftScope]: draft, ...rest } = previous;
        return { ...rest, [chatScope]: draft };
      });
      setActiveSection('new-chat');
      setActiveChatId(chatId);
    };
    const showEmptyChat = () => { setActiveSection('new-chat'); setActiveChatId(undefined); };
    const showExtensions = () => { setActiveSection('extensions'); setActiveChatId(undefined); };
    window.addEventListener('codeclub:open-chat', showChat);
    window.addEventListener('codeclub:panel-left:open-chat', showChat);
    window.addEventListener('codeclub:chat-created', showCreatedChat);
    window.addEventListener('codeclub:open-empty-chat', showEmptyChat);
    window.addEventListener('codeclub:open-extensions', showExtensions);
    return () => {
      window.removeEventListener('codeclub:open-chat', showChat);
      window.removeEventListener('codeclub:panel-left:open-chat', showChat);
      window.removeEventListener('codeclub:chat-created', showCreatedChat);
      window.removeEventListener('codeclub:open-empty-chat', showEmptyChat);
      window.removeEventListener('codeclub:open-extensions', showExtensions);
    };
  }, [activeProjectPath]);

  const recentChats = chatsByProject[activeProjectId] ?? [];

  const selectSidebarSection = (section: SidebarSection) => {
    setActiveSection(section);
    setActiveChatId(undefined);
    if (section === 'new-chat') window.dispatchEvent(new CustomEvent('codeclub:open-empty-chat'));
    else if (section === 'extensions') window.dispatchEvent(new CustomEvent('codeclub:open-extensions'));
    else window.dispatchEvent(new CustomEvent('codeclub:close-extensions', { detail: { preserveSection: true } }));
  };

  const openFromContextMenu = () => {
    const chat = chatContextMenu?.chat;
    if (!chat) return;
    setChatContextMenu(null);
    window.dispatchEvent(new CustomEvent('codeclub:open-chat', { detail: { chatId: chat.id, name: chat.title, customName: chat.customName, projectId: activeProjectId, projectPath: chat.projectPath ?? activeProjectPath, projectName: chat.projectName ?? activeProjectName } }));
  };

  const deleteFromContextMenu = async () => {
    const chat = chatContextMenu?.chat;
    if (!chat) return;
    setChatContextMenu(null);
    await (window as any).codeclub?.chatDelete?.(chat.projectPath||'',chat.id);
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
    if (activeChatId === chat.id) window.dispatchEvent(new CustomEvent('codeclub:open-empty-chat'));
  };

  const clearChatHistory = async () => {
    if (!confirmClearHistory) {
      setConfirmClearHistory(true);
      return;
    }
    setChatContextMenu(null);
    setConfirmClearHistory(false);
    if (activeProjectPath) {
      const meta = await readProjectMeta(activeProjectPath);
      if (!meta) return;
      for(const chat of meta.chats)await (window as any).codeclub?.chatDelete?.(activeProjectPath,chat.id);
      meta.chats = [];
      await writeProjectMeta(activeProjectPath, meta);
      window.dispatchEvent(new CustomEvent('codeclub:project-meta-changed', { detail: { projectPath: activeProjectPath } }));
    } else {
      for(const chat of await readGlobalChats())await (window as any).codeclub?.chatDelete?.('',chat.id);
      await writeGlobalChats([]);
      window.dispatchEvent(new CustomEvent('codeclub:global-chat-changed'));
    }
    setActiveChatId(undefined);
    window.dispatchEvent(new CustomEvent('codeclub:open-empty-chat'));
  };

  const startResize = (side: Side) => (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    resizeRef.current = { side, pointerId: event.pointerId, startX: event.clientX, startWidth: side === 'left' ? leftWidth : rightWidth };
    setResizing(side);
  };

  const openRightPanel = (tab: RightPanelTab) => {
    const existing = rightPanels.find((panel) => panel.tab === tab && tab !== 'browser' && tab !== 'terminals');
    if (existing) {
      setActiveRightPanelId(existing.instanceId);
      setRightMenuOpen(false);
      return;
    }
    const base = panelText[tab];
    const count = rightPanels.filter((panel) => panel.tab === tab).length + 1;
    rightPanelSequence.current += 1;
    const panel = { instanceId: `${tab}-${crypto.randomUUID()}`, tab, label: tab === 'terminals' ? 'PowerShell' : tab === 'browser' ? `${base} ${count}` : base };
    setRightPanels((current) => [...current, panel]);
    setActiveRightPanelId(panel.instanceId);
    setRightMenuOpen(false);
  };

  useEffect(() => {
    const openBrowser = (event: Event) => {
      const detail = (event as CustomEvent<{ chatId?: string; projectPath?: string }>).detail;
      if (detail?.chatId) {
        const scope = JSON.stringify([detail.projectPath || '', detail.chatId]);
        setRightViews(previous => {
          const view = previous[scope] || emptyRightView();
          const browser = view.panels.find(panel => panel.tab === 'browser') || { instanceId: `browser-${crypto.randomUUID()}`, tab: 'browser' as const, label: panelText.browser };
          return { ...previous, [scope]: { ...view, panels: view.panels.includes(browser) ? view.panels : [...view.panels, browser], active: browser.instanceId } };
        });
        return;
      }
      const existing = rightPanels.find((panel) => panel.tab === 'browser');
      if (existing) {
        setActiveRightPanelId(existing.instanceId);
        return;
      }
      rightPanelSequence.current += 1;
      const panel = { instanceId: `browser-${crypto.randomUUID()}`, tab: 'browser' as const, label: panelText.browser };
      setRightPanels((current) => [...current, panel]);
      setActiveRightPanelId(panel.instanceId);
    };
    window.addEventListener('codeclub:open-right-panel', openBrowser);
    return () => {
      window.removeEventListener('codeclub:open-right-panel', openBrowser);
    };
  }, [activeProjectPath, rightPanels]);

  useEffect(() => {
    const updateBrowserTab = (event: Event) => {
      const detail = (event as CustomEvent<{ instanceId?: string; favicon?: string; title?: string; clearFavicon?: boolean }>).detail || {};
      if (!detail.favicon && !detail.title && !detail.clearFavicon) return;
      setRightViews(previous => Object.fromEntries(Object.entries(previous).map(([scope, view]) => [scope, { ...view, panels: view.panels.map(panel => panel.tab === 'browser' && (detail.instanceId ? panel.instanceId === detail.instanceId : scope === rightScope && panel.instanceId === activeRightPanelId) ? { ...panel, iconUrl: detail.clearFavicon ? undefined : detail.favicon || panel.iconUrl, label: detail.title?.trim() || panel.label } : panel) }])));

    };
    window.addEventListener('codeclub:browser-tab-meta', updateBrowserTab);
    return () => window.removeEventListener('codeclub:browser-tab-meta', updateBrowserTab);
  }, [rightScope, activeRightPanelId]);

  useEffect(() => {
    const updateTerminalTab = (event: Event) => {
      const detail = (event as CustomEvent<{ instanceId: string; title: string }>).detail;
      if (!detail?.instanceId || !detail.title?.trim()) return;
      setRightViews(previous => Object.fromEntries(Object.entries(previous).map(([scope, view]) => [scope, { ...view, panels: view.panels.map(panel => panel.tab === 'terminals' && panel.instanceId === detail.instanceId ? { ...panel, label: detail.title } : panel) }])));

    };
    window.addEventListener('codeclub:terminal-tab-meta', updateTerminalTab);
    return () => window.removeEventListener('codeclub:terminal-tab-meta', updateTerminalTab);
  }, []);

  useEffect(() => {
    const openRightFile = (event: Event) => {
      const detail = (event as CustomEvent<{ path?: string; projectPath?: string }>).detail || {};
      if (!detail.path || (detail.projectPath && detail.projectPath !== activeProjectPath)) return;
      setSelectedRightFilePath(detail.path);
      setFilesTreeVisible(true);
      const existing = rightPanels.find((panel) => panel.tab === 'files');
      if (existing) {
        setActiveRightPanelId(existing.instanceId);
        return;
      }
      rightPanelSequence.current += 1;
      const panel = { instanceId: `files-${crypto.randomUUID()}`, tab: 'files' as const, label: panelText.files };
      setRightPanels((current) => [...current, panel]);
      setActiveRightPanelId(panel.instanceId);
    };
    window.addEventListener('codeclub:open-right-file', openRightFile);
    return () => window.removeEventListener('codeclub:open-right-file', openRightFile);
  }, [activeProjectPath, panelText.files, rightPanels]);

  useEffect(() => {
    const openTerminalPanel = (event: Event) => {
      const detail = (event as CustomEvent<{ terminalId?: string; projectPath?: string; chatId?: string }>).detail || {};
      if (detail.chatId) {
        const scope = JSON.stringify([detail.projectPath || '', detail.chatId]);
        setRightViews(previous => {
          const view = previous[scope] || emptyRightView();
          const panel = view.panels.find(item => item.terminalId === detail.terminalId) || { instanceId: `terminals-${crypto.randomUUID()}`, tab: 'terminals' as const, label: 'PowerShell', terminalId: detail.terminalId };
          return { ...previous, [scope]: { ...view, panels: view.panels.includes(panel) ? view.panels : [...view.panels, panel], active: panel.instanceId } };
        });
        if (scope === rightScope) window.dispatchEvent(new CustomEvent('codeclub:open-right-sidebar'));
        return;
      }
      if (detail.projectPath && detail.projectPath !== activeProjectPath) return;
      window.dispatchEvent(new CustomEvent('codeclub:open-right-sidebar'));
      const existing = detail.terminalId ? rightPanels.find((panel) => panel.terminalId === detail.terminalId) : rightPanels.find((panel) => panel.tab === 'terminals');
      if (existing) {
        setActiveRightPanelId(existing.instanceId);
        return;
      }
      rightPanelSequence.current += 1;
      const panel = { instanceId: `terminals-${crypto.randomUUID()}`, tab: 'terminals' as const, label: 'PowerShell', terminalId: detail.terminalId };
      setRightPanels((current) => [...current, panel]);
      setActiveRightPanelId(panel.instanceId);
    };
    window.addEventListener('codeclub:open-terminal-panel', openTerminalPanel);
    return () => window.removeEventListener('codeclub:open-terminal-panel', openTerminalPanel);
  }, [activeProjectPath, rightScope, panelText.terminals, rightPanels]);

  useEffect(() => {
    const closeTerminalPanel = (event: Event) => {
      const detail = (event as CustomEvent<{ terminalId?: string; projectPath?: string }>).detail || {};
      if (!detail.terminalId) return;
      setRightViews(current => Object.fromEntries(Object.entries(current).map(([scope, view]) => {
        const panels = view.panels.filter(panel => panel.terminalId !== detail.terminalId);
        return [scope, { ...view, panels, active: panels.some(panel => panel.instanceId === view.active) ? view.active : panels[0]?.instanceId || '' }];
      })));
    };
    window.addEventListener('codeclub:terminal-closed', closeTerminalPanel);
    return () => window.removeEventListener('codeclub:terminal-closed', closeTerminalPanel);
  }, [activeProjectPath]);

  useEffect(() => {
    const openTerminalAndRun = (detail: { code?: string; language?: string; cwd?: string }) => {
      if (!detail.code?.trim()) return;
      window.dispatchEvent(new CustomEvent('codeclub:open-right-sidebar'));
      const existing = rightPanels.find((panel) => panel.tab === 'terminals');
      if (existing) {
        setActiveRightPanelId(existing.instanceId);
        window.setTimeout(() => window.dispatchEvent(new CustomEvent('codeclub:terminal-run-code', { detail })), 0);
        return;
      }
      rightPanelSequence.current += 1;
      const panel = { instanceId: `terminals-${crypto.randomUUID()}`, tab: 'terminals' as const, label: 'PowerShell' };
      setRightPanels((current) => [...current, panel]);
      setActiveRightPanelId(panel.instanceId);
      window.setTimeout(() => window.dispatchEvent(new CustomEvent('codeclub:terminal-run-code', { detail })), 0);
    };
    const runCodeInTerminal = (event: Event) => {
      const detail = (event as CustomEvent<{ code?: string; language?: string }>).detail || {};
      const candidate = detail.code?.trim().replace(/^['"`]|['"`]$/g, '');
      const looksLikePath = Boolean(candidate && !/[\s(){}[\];=]/.test(candidate) && (/^[./\\]/.test(candidate) || /\.[a-z0-9]{1,8}$/i.test(candidate)));
      if (!activeProjectPath || !looksLikePath) {
        openTerminalAndRun(detail);
        return;
      }
      void nativeInvoke<{ kind?: string }>('codeclub_path_kind', { projectPath: activeProjectPath, path: candidate }).then((result) => {
        if (result?.kind === 'file') {
          window.dispatchEvent(new CustomEvent('codeclub:open-right-sidebar'));
          window.dispatchEvent(new CustomEvent('codeclub:open-right-file', { detail: { path: candidate, projectPath: activeProjectPath } }));
        } else if (result?.kind === 'directory') {
          openTerminalAndRun({ code: candidate, cwd: candidate });
        } else {
          openTerminalAndRun(detail);
        }
      }).catch(() => openTerminalAndRun(detail));
    };
    window.addEventListener('codeclub:execute-inline-code', runCodeInTerminal);
    return () => window.removeEventListener('codeclub:execute-inline-code', runCodeInTerminal);
  }, [activeProjectPath, rightScope, panelText.terminals, rightPanels]);

  const closeRightPanel = (instanceId: string) => {
    const index = rightPanels.findIndex((panel) => panel.instanceId === instanceId);
    if (index < 0) return;
    const next = rightPanels.filter((panel) => panel.instanceId !== instanceId);
    setRightPanels(next);
    if (activeRightPanelId === instanceId) setActiveRightPanelId(next[index === next.length ? index - 1 : index]?.instanceId ?? '');
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

  const startProjectNameEdit = () => {
    projectNameEdit.current = { token: projectNameEdit.current.token + 1, submitted: false };
    setProjectNameDraft(activeProjectName);
    setProjectNameError('');
    setEditingProjectName(true);
  };

  const cancelProjectNameEdit = () => {
    projectNameEdit.current = { token: projectNameEdit.current.token + 1, submitted: true };
    setProjectNameDraft(activeProjectName);
    setProjectNameError('');
    setEditingProjectName(false);
  };

  const commitProjectName = async () => {
    if (projectNameEdit.current.submitted) return;
    projectNameEdit.current.submitted = true;
    const token = projectNameEdit.current.token;
    const nextName = projectNameDraft.trim();
    if (!nextName || nextName === activeProjectName || activeProjectId === 'home') {
      setProjectNameDraft(activeProjectName);
      setProjectNameError('');
      setEditingProjectName(false);
      return;
    }
    try {
      const project = await (window as any).codeclub?.renameProject?.(activeProjectId, nextName);
      if (!project) throw new Error('Project rename returned no project');
      window.dispatchEvent(new CustomEvent('codeclub:project-renamed', { detail: { id: activeProjectId, name: project.name, path: project.path } }));
      if (projectNameEdit.current.token !== token) return;
      setEditingProjectName(false);
      setProjectNameError('');
      setActiveProjectName(project.name);
      setProjectNameDraft(project.name);
      setActiveProjectPath(project.path ?? activeProjectPath);
      const detail = { projectPath: project.path ?? activeProjectPath, projectName: project.name };
      window.dispatchEvent(new CustomEvent('codeclub:project-selection-changed', { detail: { selected: true, ...detail } }));
      window.dispatchEvent(new CustomEvent('codeclub:active-project', { detail }));
      window.localStorage.setItem('codeclub:active-project', JSON.stringify({ id: activeProjectId, name: project.name, path: project.path ?? activeProjectPath }));
    } catch (error) {
      console.error('No se pudo renombrar el proyecto', error);
      if (projectNameEdit.current.token === token) {
        projectNameEdit.current.submitted = false;
        setProjectNameError(error instanceof Error ? error.message : sidebarText.renameProjectError);
        setEditingProjectName(true);
      }
    }
  };

  return <section id="codeclub-workspace" className="bg-[#080808] grid h-full min-h-0 min-w-0 flex-1 grid-cols-[minmax(0,1fr)] overflow-hidden" aria-label={sidebarText.workspace}>
    <div className="flex h-full min-h-0 min-w-0 overflow-hidden">
      <motion.aside id="codeclub-left-sidebar" animate={{ width: leftOpen ? leftWidth : 0, opacity: leftOpen ? 1 : 0 }} transition={resizing ? { duration: 0 } : { type: 'spring', stiffness: 340, damping: 30 }} className="codeclub-widget-chrome flex h-full min-h-0 shrink-0 flex-col overflow-hidden" aria-label={sidebarText.leftSidebar} aria-hidden={!leftOpen} inert={!leftOpen}>
        <div className="flex min-h-0 flex-1 flex-col px-2.5 py-2.5 text-(--codeclub-text)">
          <div className="flex h-8 min-w-0 items-center gap-2 px-1.5">
            {editingProjectName ? <input autoFocus value={projectNameDraft} onFocus={(event) => event.currentTarget.select()} onChange={(event) => { setProjectNameDraft(event.target.value); setProjectNameError(''); }} onBlur={() => void commitProjectName()} onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === 'Enter') { event.preventDefault(); void commitProjectName(); }
              if (event.key === 'Escape') { event.preventDefault(); cancelProjectNameEdit(); }
            }} className="h-7 min-w-0 flex-1 rounded-md border border-(--codeclub-border-soft) bg-(--codeclub-surface-raised) px-1.5 text-[15px] font-semibold tracking-tight text-(--codeclub-text-strong) outline-none focus:border-(--codeclub-text-muted)" aria-label={sidebarText.projectName} /> : <span className="min-w-0 flex-1 truncate text-[15px] font-semibold tracking-tight text-(--codeclub-text-strong)" title={activeProjectName}>{activeProjectName}</span>}
            <div className="flex shrink-0 items-center gap-1">
              {activeProjectId !== 'home' && <button type="button" onMouseDown={(event) => { if (editingProjectName) event.preventDefault(); }} onClick={editingProjectName ? () => void commitProjectName() : startProjectNameEdit} className="grid h-7 w-7 place-items-center rounded-md text-(--codeclub-text-muted) hover:bg-(--codeclub-hover) hover:text-(--codeclub-text-strong) focus-visible:outline-2 focus-visible:outline-(--codeclub-text-muted)" aria-label={editingProjectName ? sidebarText.saveProjectName : sidebarText.renameProject} title={editingProjectName ? sidebarText.saveProjectName : sidebarText.renameProject}>{editingProjectName ? <Check size={13} aria-hidden="true" /> : <Pencil size={13} aria-hidden="true" />}</button>}
              <button type="button" onClick={onToggleLeft} className="grid h-7 w-7 place-items-center rounded-md text-(--codeclub-text-muted) transition-colors hover:bg-(--codeclub-hover) hover:text-(--codeclub-text-strong) focus-visible:outline-2 focus-visible:outline-(--codeclub-text-muted)" aria-label={language === 'en' ? 'Hide left sidebar' : 'Ocultar sidebar izquierda'} title={language === 'en' ? 'Hide left sidebar' : 'Ocultar sidebar izquierda'}><PanelLeft size={15} aria-hidden="true" /></button>
            </div>
          </div>
          {projectNameError && <p role="alert" className="mx-1.5 mt-1 mb-0 text-[11px] leading-4 text-red-300">{projectNameError}</p>}
          <nav className="mt-4 space-y-0.5" aria-label={sidebarText.mainNavigation}>
            <SidebarItem active={activeSection === 'new-chat' && !activeChatId} icon={<CirclePlus />} label={sidebarText.newChat} onClick={() => selectSidebarSection('new-chat')} />
            <SidebarItem active={activeSection === 'orbs'} icon={<Radius />} label={sidebarText.orbs} onClick={() => selectSidebarSection('orbs')} />
            <SidebarItem active={activeSection === 'extensions'} icon={<Grid2X2 />} label={sidebarText.extensions} onClick={() => selectSidebarSection('extensions')} />
            <SidebarItem active={false} icon={<MoreHorizontal />} label={sidebarText.devices} disabled onClick={() => {}} />
          </nav>
          <div className="mt-5 min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {recentChats.length > 0 && <div className="pb-3"><p className="px-1.5 text-[13px] font-semibold text-(--codeclub-text-muted)">{sidebarText.recent}</p><div className="mt-2 space-y-1">{recentChats.slice().reverse().map((chat) => <button key={chat.id} type="button" onContextMenu={(event) => { event.preventDefault(); setChatContextMenu({ chat, x: event.clientX, y: event.clientY }); }} onClick={() => window.dispatchEvent(new CustomEvent('codeclub:open-chat', { detail: { chatId: chat.id, name: chat.title, customName: chat.customName, projectId: activeProjectId, projectPath: chat.projectPath ?? activeProjectPath, projectName: chat.projectName ?? activeProjectName } }))} className={`flex w-full min-w-0 items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] text-(--codeclub-text-strong) ${activeChatId === chat.id ? 'bg-(--codeclub-acrylic-active)' : 'bg-transparent hover:bg-(--codeclub-hover)'}`}><span className="min-w-0 flex-1 truncate">{chat.title}</span><ChatSessionStatus seenCompletions={seenCompletions} session={sessions.find(session=>!session.external && sameSession({chatId:chat.id,projectPath:chat.projectPath ?? activeProjectPath ?? ''},session))} language={language} /></button>)}</div></div>}
          </div>
          <div className="mt-auto border-t border-(--codeclub-border-soft) px-1.5 pt-3"><button type="button" onClick={() => void nativeInvoke('codeclub_open_external', { url: 'https://ko-fi.com/iangeldev' })} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12px] text-(--codeclub-text-muted) transition-colors hover:bg-(--codeclub-hover) hover:text-(--codeclub-text-strong) focus-visible:outline-2 focus-visible:outline-(--codeclub-accent)" aria-label={sidebarText.support} title={sidebarText.donation}><Heart size={15} strokeWidth={1.8} /><span>{sidebarText.support}</span></button></div>
        </div>
      </motion.aside>
      {chatContextMenu && <div ref={chatContextMenuRef} className="fixed z-[100] w-48 rounded-xl border border-white/[0.08] bg-[#2C2C2C]/90 p-1 shadow-2xl backdrop-blur-xl" style={{ left: chatContextMenu.x, top: chatContextMenu.y }} role="menu" aria-label={sidebarText.chatMenu}><button type="button" onClick={openFromContextMenu} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-(--codeclub-text) hover:bg-(--codeclub-hover) hover:text-(--codeclub-text-strong)" role="menuitem"><FolderOpen size={14} aria-hidden="true" />{sidebarText.open}</button><div className="mx-2 h-px bg-[#444444]" aria-hidden="true" /><button type="button" onClick={() => void deleteFromContextMenu()} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-(--codeclub-text) hover:bg-(--codeclub-hover) hover:text-(--codeclub-text-strong)" role="menuitem"><Trash2 size={14} aria-hidden="true" />{sidebarText.delete}</button><div className="mx-2 h-px bg-[#444444]" aria-hidden="true" /><button type="button" onClick={() => void clearChatHistory()} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-(--codeclub-text) hover:bg-(--codeclub-hover) hover:text-(--codeclub-text-strong)" role="menuitem"><Clock size={14} aria-hidden="true" />{sidebarText.clearHistory}</button>{confirmClearHistory && <><div className="mx-2 my-1 h-px bg-[#444444]" aria-hidden="true" /><div className="grid grid-cols-2 gap-1 px-1" role="group" aria-label={language === 'en' ? 'Confirm clearing history' : 'Confirmar limpieza del historial'}><button type="button" onClick={() => void clearChatHistory()} className="grid h-7 place-items-center rounded-lg text-[#8BC7FF] hover:bg-(--codeclub-hover) hover:text-(--codeclub-text-strong)" title={language === 'en' ? 'Confirm' : 'Confirmar'} aria-label={language === 'en' ? 'Confirm' : 'Confirmar'}><Check size={14} aria-hidden="true" /></button><button type="button" onClick={() => setConfirmClearHistory(false)} className="grid h-7 place-items-center rounded-lg text-(--codeclub-text-muted) hover:bg-(--codeclub-hover) hover:text-(--codeclub-text-strong)" title={language === 'en' ? 'Cancel' : 'Cancelar'} aria-label={language === 'en' ? 'Cancel' : 'Cancelar'}><X size={14} aria-hidden="true" /></button></div></>}</div>}
      {rightContextMenu && <div ref={rightContextMenuRef} className="fixed z-[100] grid w-52 gap-0.5 rounded-xl border border-white/[0.08] bg-[#2C2C2C]/90 p-1 shadow-2xl backdrop-blur-xl" style={{ left: rightContextMenu.x, top: rightContextMenu.y }} role="menu" aria-label={`${panelText.rightPanel}: ${rightContextMenu.panel.label}`}><button type="button" onClick={() => closeRightPanel(rightContextMenu.panel.instanceId)} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-(--codeclub-text) hover:bg-(--codeclub-hover) hover:text-(--codeclub-text-strong)" role="menuitem"><X size={14} aria-hidden="true" />{panelText.closeRightPanel}</button><button type="button" onClick={() => closeOtherRightPanels(rightContextMenu.panel.instanceId)} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-(--codeclub-text) hover:bg-(--codeclub-hover) hover:text-(--codeclub-text-strong)" role="menuitem"><CopyX size={14} aria-hidden="true" />{panelText.closeOtherRightPanels}</button><button type="button" onClick={() => closeRightPanelsToRight(rightContextMenu.panel.instanceId)} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-(--codeclub-text) hover:bg-(--codeclub-hover) hover:text-(--codeclub-text-strong)" role="menuitem"><ArrowRightToLine size={14} aria-hidden="true" />{panelText.closeRightPanelsAfter}</button></div>}
      {leftOpen && <ResizeHandle side="left" value={leftWidth} maxValue={MAX_WIDTH} onStart={startResize('left')} onKeyboardResize={setLeftWidth} language={language} />}

      <div data-main-panel={activeSection} className="codeclub-conversation-surface flex min-h-0 min-w-0 flex-1 overflow-hidden">
          <PanelManager activeSection={activeSection} />

      {rightOpen && <ResizeHandle side="right" value={rightWidth} maxValue={rightMaxWidth} onStart={startResize('right')} onKeyboardResize={setRightWidth} language={language} />}
      <motion.aside id="codeclub-right-sidebar" animate={{ width: rightOpen ? rightWidth : 0, opacity: rightOpen ? 1 : 0 }} transition={resizing ? { duration: 0 } : { type: 'spring', stiffness: 340, damping: 30 }} className={`codeclub-panel-edge flex h-full min-h-0 shrink-0 flex-col bg-transparent ${rightOpen ? 'pointer-events-auto overflow-visible' : 'pointer-events-none overflow-hidden'}`} aria-label={panelText.rightPanel} aria-hidden={!rightOpen} inert={!rightOpen}>
        <div className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden">
          <div ref={rightMenuRef} className="codeclub-widget-chrome relative z-[2147483647] isolate flex h-11 min-w-0 shrink-0 items-center gap-2 px-2 [transform:translateZ(0)] [pointer-events:auto]">
            <div role="tablist" aria-label={panelText.openPanels} className="right-panel-tabs-scroll flex h-full min-w-0 flex-1 items-start gap-1.5 overflow-x-scroll overflow-y-hidden pt-1.5 pb-0.5" onWheel={(event) => {
              const tabs = event.currentTarget;
              if (tabs.scrollWidth <= tabs.clientWidth || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
              tabs.scrollLeft += event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? tabs.clientWidth : 1);
            }}>
              {rightPanels.map((panel) => { const item = rightPanelTabs.find((candidate) => candidate.id === panel.tab) ?? rightPanelTabs[0]; const Icon = item.icon; const label = panelText[panel.tab]; const displayLabel = panel.tab === 'browser' || panel.tab === 'terminals' ? panel.label : label; const active = activeRightPanelId === panel.instanceId; return <div key={panel.instanceId} className={`group flex h-8 min-w-0 shrink-0 items-center rounded-lg transition-colors ${active ? 'bg-(--codeclub-acrylic-active) hover:bg-(--codeclub-hover)' : 'hover:bg-white/[0.06]'}`}><button type="button" role="tab" aria-selected={active} aria-controls={`right-panel-${panel.instanceId}`} title={displayLabel} onClick={() => setActiveRightPanelId(panel.instanceId)} onContextMenu={(event) => { event.preventDefault(); setRightMenuOpen(false); setRightContextMenu({ panel, x: event.clientX, y: event.clientY }); }} className={`flex h-full min-w-0 items-center gap-2 rounded-lg px-2.5 text-[12px] font-medium focus-visible:outline-2 focus-visible:outline-(--codeclub-accent) ${active ? 'text-(--codeclub-text-strong)' : 'text-(--codeclub-text-muted)'}`}>{panel.iconUrl ? <img src={panel.iconUrl} alt="" onError={(event) => { event.currentTarget.style.display = 'none'; window.dispatchEvent(new CustomEvent('codeclub:browser-tab-meta', { detail: { clearFavicon: true } })); }} className="h-[15px] w-[15px] shrink-0 rounded-sm object-contain" /> : <Icon size={15} strokeWidth={1.8} aria-hidden="true" />}<span className="max-w-[150px] truncate">{displayLabel}</span></button><button type="button" onClick={() => closeRightPanel(panel.instanceId)} className={`mr-1 grid h-5 w-5 shrink-0 place-items-center rounded-md transition-opacity hover:bg-white/[0.1] hover:text-(--codeclub-text-strong) focus-visible:outline-2 focus-visible:outline-(--codeclub-accent) ${active ? 'text-(--codeclub-text-strong) opacity-100' : 'text-(--codeclub-text-muted) opacity-0 group-hover:opacity-100'}`} aria-label={`${sidebarText.close} ${displayLabel}`} title={`${sidebarText.close} ${displayLabel}`}><X size={12} strokeWidth={2} aria-hidden="true" /></button></div>; })}
              <button type="button" onClick={() => setRightMenuOpen((open) => !open)} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-transparent text-(--codeclub-text-muted) transition-colors hover:bg-white/[0.08] hover:text-(--codeclub-text) focus-visible:outline-2 focus-visible:outline-(--codeclub-accent)" aria-label={panelText.addRightPanel} aria-haspopup="menu" aria-expanded={rightMenuOpen}><Plus size={16} strokeWidth={1.7} aria-hidden="true" /></button>
            </div>
            <AnimatePresence>
              {rightMenuOpen && <motion.div initial={{ opacity: 0, y: -5, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -5, scale: 0.98 }} transition={{ duration: 0.14, ease: 'easeOut' }} className="absolute top-[42px] left-2 z-30 w-[220px] max-w-[calc(100vw-24px)] rounded-xl border border-white/[0.08] bg-[#2C2C2C]/90 p-1 shadow-2xl backdrop-blur-xl" role="menu" aria-label={panelText.rightPanelMenu}>
                {rightPanelTabs.map(({ id, icon: Icon }) => { const selected = rightPanels.some((panel) => panel.tab === id); const canOpenMultiple = id === 'browser' || id === 'terminals'; const disabled = selected && !canOpenMultiple; return <button key={id} type="button" role="menuitemradio" aria-checked={selected} aria-disabled={disabled} disabled={disabled} onClick={() => openRightPanel(id)} className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[12px] transition-colors focus-visible:outline-2 focus-visible:outline-(--codeclub-accent) ${disabled ? 'cursor-not-allowed text-(--codeclub-text-muted) opacity-40' : selected ? 'bg-[#2B2B2B] text-(--codeclub-text-strong)' : 'text-(--codeclub-text) hover:bg-(--codeclub-hover) hover:text-(--codeclub-text-strong)'}`}><Icon size={15} strokeWidth={1.8} aria-hidden="true" /><span className="min-w-0 truncate">{panelText[id]}</span></button>; })}
              </motion.div>}
            </AnimatePresence>
            {rightPanels.find((panel) => panel.instanceId === activeRightPanelId)?.tab === 'files' && <button type="button" onClick={() => setReviewModalOpen(true)} className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-transparent transition-colors hover:bg-white/[0.08] focus-visible:outline-2 focus-visible:outline-(--codeclub-accent) ${reviewModalOpen ? 'text-(--codeclub-text-strong)' : 'text-(--codeclub-text-muted)'}`} aria-label={language === 'en' ? 'Open GitHub changes' : 'Abrir cambios de GitHub'} aria-pressed={reviewModalOpen} title={language === 'en' ? 'GitHub changes' : 'Cambios de GitHub'}><GithubMark size={16} /></button>}
            {rightPanels.find((panel) => panel.instanceId === activeRightPanelId)?.tab === 'files' && <button type="button" onClick={() => setFilesTreeVisible((visible) => !visible)} className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-transparent transition-colors hover:bg-white/[0.08] focus-visible:outline-2 focus-visible:outline-(--codeclub-accent) ${filesTreeVisible ? 'text-(--codeclub-text-strong)' : 'text-(--codeclub-text-muted)'}`} aria-label={filesTreeVisible ? panelText.toggleFileTreeHide : panelText.toggleFileTreeShow} aria-pressed={filesTreeVisible} title={filesTreeVisible ? panelText.toggleFileTreeHide : panelText.toggleFileTreeShow}><FolderOpen size={16} strokeWidth={1.8} aria-hidden="true" /></button>}
          </div>
          <div className="absolute inset-x-0 top-11 bottom-0 flex min-h-0 flex-col overflow-hidden">
            {rightPanels.length === 0 && <RightPanelEmptyState onSelect={openRightPanel} />}
            {Object.entries(rightViews).flatMap(([scope, view]) => view.panels.map(panel => { const visible = scope === rightScope && view.active === panel.instanceId; const [projectPath] = JSON.parse(scope); return <div key={panel.instanceId} className={`min-h-0 min-w-0 flex-1 flex-col ${visible ? 'flex' : 'hidden'}`}><RightSidebarContent panel={panel} projectName={projectPath ? projectPath.split(/[\\/]/).pop() : 'Codeclub'} projectPath={projectPath} selectedFilePath={view.file} filesTreeVisible={view.tree} onToggleFilesTree={() => setFilesTreeVisible(value => !value)} visible={visible} chatId={JSON.parse(scope)[1] === 'draft' ? undefined : JSON.parse(scope)[1]} selected={view.active === panel.instanceId} /></div>; }))}
          </div>
        </div>
      </motion.aside>
      </div>
    </div>
    <ReviewPanel projectPath={activeProjectPath} visible={reviewModalOpen} onClose={() => setReviewModalOpen(false)} />
  </section>;
}

const PanelManager = memo(function PanelManager({ activeSection }: { activeSection: SidebarSection }) {
  const language = useAppLanguage();
  const chatVisible = activeSection === 'new-chat' || activeSection === 'extensions';
  const synapseVisible = activeSection === 'projects';
  const orbsVisible = activeSection === 'orbs';
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('codeclub:chat-panel-visibility', { detail: { visible: chatVisible } }));
  }, [chatVisible]);
  return <main id="codeclub-main-content" tabIndex={-1} className="relative min-h-0 min-w-0 flex-1 overflow-hidden" aria-label={rightSidebarTranslations[language].panelManager} aria-live="polite">
    <div className={`codeclub-panel-shell h-full w-full ${chatVisible ? 'overflow-visible' : 'overflow-hidden'} bg-(--codeclub-center)`}>
      <div className={`h-full min-h-0 min-w-0 ${chatVisible ? 'block' : 'hidden'}`} aria-hidden={!chatVisible} inert={!chatVisible}><ChatPanel /></div>
      {synapseVisible && <div className="relative z-10 h-full min-h-0 min-w-0"><SynapsePanel /></div>}
      {orbsVisible && <div className="relative z-10 h-full min-h-0 min-w-0"><OrbsPanel /></div>}
    </div>
  </main>;
});

function SynapsePanel() {
  const language = useAppLanguage();
  const text = language === 'en' ? { title: 'Devices', description: 'Connect your phone to the IDE by scanning a QR code.' } : { title: 'Dispositivos', description: 'Conectá tu celular al IDE escaneando un código QR.' };
  return <section id="codeclub-synapse-panel" className="h-full min-h-0 overflow-auto bg-(--codeclub-center)" aria-label={text.title}>
    <div className="mx-auto min-w-0 w-full max-w-[1040px] px-6 py-7 lg:px-8">
      <header>
        <h1 className="m-0 text-[28px] font-normal tracking-[-0.04em] text-(--codeclub-text-strong)">{text.title}</h1>
        <p className="mt-1.5 text-[14px] text-(--codeclub-text-muted)">{text.description}</p>
      </header>
    </div>
  </section>;
}

type ReviewFile = { path: string; status: string; additions: number; deletions: number; untracked?: boolean };

function ReviewPanel({ projectPath, visible, onClose }: { projectPath?: string; visible: boolean; onClose: () => void }) {
  const language = useAppLanguage();
  const { palette } = useOrbPalette();
  const text = rightSidebarTranslations[language];
  const [files, setFiles] = useState<ReviewFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [branch, setBranch] = useState(language === 'en' ? 'No branch' : 'Sin rama');
  const [changeScope, setChangeScope] = useState<'unstaged' | 'uncommitted' | 'staged' | 'branch'>('unstaged');
  const [scopeMenuOpen, setScopeMenuOpen] = useState(false);
  const [compareBranch, setCompareBranch] = useState('');
  const [branches, setBranches] = useState<string[]>([]);
  const [branchMenuOpen, setBranchMenuOpen] = useState(false);
  const [branchQuery, setBranchQuery] = useState('');
  const scopeMenuRef = useRef<HTMLDivElement | null>(null);
  const branchMenuRef = useRef<HTMLDivElement | null>(null);
  const [loading, setLoading] = useState(false);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffContent, setDiffContent] = useState('');
  const [error, setError] = useState('');

  const loadReview = async () => {
    if (!projectPath) return;
    setLoading(true);
    setError('');
    try {
      const diffArgs = changeScope === 'branch'
        ? ['diff', compareBranch || 'HEAD', '--numstat', '--']
        : changeScope === 'staged'
          ? ['diff', '--cached', '--numstat', '--']
          : changeScope === 'unstaged'
            ? ['diff', '--numstat', '--']
            : ['diff', 'HEAD', '--numstat', '--'];
      const [statusResult, diffResult, branchResult, branchesResult, upstreamResult] = await Promise.all([
        nativeInvoke<{ stdout?: string; stderr?: string; code?: number }>('codeclub_run_command', { projectPath, request: { command: 'git', args: ['status', '--short', '--untracked-files=all'] } }),
        nativeInvoke<{ stdout?: string; stderr?: string; code?: number }>('codeclub_run_command', { projectPath, request: { command: 'git', args: diffArgs } }),
        nativeInvoke<{ stdout?: string; stderr?: string; code?: number }>('codeclub_run_command', { projectPath, request: { command: 'git', args: ['branch', '--show-current'] } }),
        nativeInvoke<{ stdout?: string; stderr?: string; code?: number }>('codeclub_run_command', { projectPath, request: { command: 'git', args: ['branch', '--all', '--no-color', '--format=%(refname:short)'] } }),
        nativeInvoke<{ stdout?: string; stderr?: string; code?: number }>('codeclub_run_command', { projectPath, request: { command: 'git', args: ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'] } }),
      ]);
      if (statusResult.code && statusResult.code !== 0) throw new Error(language === 'en' ? 'This folder is not a Git repository yet.' : 'Esta carpeta todavía no tiene un repositorio Git.');
      const statusLines = String(statusResult.stdout || '').split(/\r?\n/).filter(Boolean);
      const diffByPath = new Map<string, { additions: number; deletions: number }>();
      String(diffResult.stdout || '').split(/\r?\n/).filter(Boolean).forEach((line) => {
        const [added, removed, ...pathParts] = line.split('\t');
        const path = pathParts.join('\t').trim();
        if (!path) return;
        diffByPath.set(path, { additions: added === '-' ? 0 : Number(added) || 0, deletions: removed === '-' ? 0 : Number(removed) || 0 });
      });
      const visibleStatusLines = statusLines.filter((line) => changeScope === 'staged'
        ? line.slice(0, 2) !== '??' && line[0] !== ' '
        : changeScope === 'unstaged'
          ? line.slice(0, 2) === '??' || line[1] !== ' '
          : true);
      const nextFiles = visibleStatusLines.map((line) => {
        const code = line.slice(0, 2);
        const path = line.slice(3).trim();
        const delta = diffByPath.get(path) || { additions: 0, deletions: 0 };
        return { path, status: code === '??' ? 'A' : code.trim() || 'M', untracked: code === '??', ...delta };
      });
      diffByPath.forEach((delta, path) => { if (!nextFiles.some((file) => file.path === path)) nextFiles.push({ path, status: 'M', untracked: false, ...delta }); });
      setFiles(nextFiles);
      setSelectedFile((current) => current && nextFiles.some((file) => file.path === current) ? current : nextFiles[0]?.path || null);
      const currentBranch = String(branchResult.stdout || '').trim() || (language === 'en' ? 'No branch' : 'Sin rama');
      const availableBranches = [...new Set(String(branchesResult.stdout || '').split(/\r?\n/).map((item) => item.trim()).filter(Boolean))];
      const upstream = String(upstreamResult.stdout || '').trim();
      setBranch(currentBranch);
      setBranches(availableBranches);
      if (!compareBranch && upstream && availableBranches.includes(upstream)) setCompareBranch(upstream);
    } catch (caught) {
      setFiles([]);
      setSelectedFile(null);
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadReview(); }, [projectPath, compareBranch, changeScope]);
  useEffect(() => {
    const refresh = (event: Event) => {
      const detail = (event as CustomEvent<{ projectPath?: string }>).detail;
      if (!detail?.projectPath || detail.projectPath === projectPath) void loadReview();
    };
    window.addEventListener('codeclub:workspace-changed', refresh);
    return () => window.removeEventListener('codeclub:workspace-changed', refresh);
  }, [projectPath, compareBranch, changeScope]);
  useEffect(() => {
    if (!visible) return undefined;
    const closeWithEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', closeWithEscape);
    return () => window.removeEventListener('keydown', closeWithEscape);
  }, [visible, onClose]);
  useEffect(() => {
    if (!scopeMenuOpen && !branchMenuOpen) return undefined;
    const closeOnOutsideClick = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!scopeMenuRef.current?.contains(target)) setScopeMenuOpen(false);
      if (!branchMenuRef.current?.contains(target)) setBranchMenuOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    return () => document.removeEventListener('pointerdown', closeOnOutsideClick);
  }, [scopeMenuOpen, branchMenuOpen]);
  useEffect(() => {
    const selected = files.find((file) => file.path === selectedFile);
    if (!projectPath || !selected) { setDiffContent(''); return undefined; }
    let cancelled = false;
    setDiffLoading(true);
    setDiffContent('');
    const args = selected.untracked
      ? ['diff', '--no-index', '--no-ext-diff', '--unified=3', '--', '/dev/null', selected.path]
      : changeScope === 'branch'
        ? ['diff', compareBranch || 'HEAD', '--no-ext-diff', '--unified=3', '--', selected.path]
        : changeScope === 'staged'
          ? ['diff', '--cached', '--no-ext-diff', '--unified=3', '--', selected.path]
          : changeScope === 'unstaged'
            ? ['diff', '--no-ext-diff', '--unified=3', '--', selected.path]
            : ['diff', 'HEAD', '--no-ext-diff', '--unified=3', '--', selected.path];
    void nativeInvoke<{ stdout?: string; stderr?: string; code?: number }>('codeclub_run_command', { projectPath, request: { command: 'git', args } }).then((result) => {
      if (cancelled) return;
      if (result.code && result.code !== 1) throw new Error(result.stderr || (language === 'en' ? 'Could not load this diff.' : 'No se pudo cargar este diff.'));
      setDiffContent(String(result.stdout || ''));
    }).catch((caught) => {
      if (!cancelled) setDiffContent(String(caught instanceof Error ? caught.message : caught));
    }).finally(() => { if (!cancelled) setDiffLoading(false); });
    return () => { cancelled = true; };
  }, [projectPath, selectedFile, files, compareBranch, changeScope]);

  const additions = files.reduce((total, file) => total + file.additions, 0);
  const deletions = files.reduce((total, file) => total + file.deletions, 0);
  const selected = files.find((file) => file.path === selectedFile);
  const scopeLabels = language === 'en'
    ? { unstaged: 'Unstaged', uncommitted: 'Uncommitted', staged: 'Staged', branch: 'Branch' }
    : { unstaged: 'Sin preparar', uncommitted: 'Sin confirmar', staged: 'Preparados', branch: 'Rama' };
  const filteredBranches = branches.filter((item) => item.toLowerCase().includes(branchQuery.trim().toLowerCase()));
  const diffRows = diffContent.split(/\r?\n/);
  const modal = visible && typeof document !== 'undefined' ? createPortal(<div className="fixed inset-0 z-[2147483647] flex items-center justify-center bg-black/65 p-4 backdrop-blur-[3px]" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section role="dialog" aria-modal="true" aria-label={language === 'en' ? 'Review changes' : 'Revisar cambios'} className="flex h-[min(720px,85vh)] w-[min(900px,92vw)] flex-col overflow-hidden border border-[#252525] bg-[#111111] shadow-2xl shadow-black/60" style={{ borderRadius: 0, '--codeclub-accent': palette.accent, '--codeclub-accent-bright': palette.bright } as React.CSSProperties}>
    <header className="relative z-20 flex h-12 shrink-0 items-center gap-3 border-b border-[#252525] px-4">
      <GithubMark size={18}/>
      <h2 className="m-0 shrink-0 text-[13px] font-medium text-(--codeclub-text-strong)">{language === 'en' ? 'Review changes' : 'Revisar cambios'}</h2>
      <div ref={scopeMenuRef} className="relative">
        <button type="button" onClick={() => { setBranchMenuOpen(false); setScopeMenuOpen((open) => !open); }} className="flex h-7 items-center gap-1.5 rounded-full bg-[#252525] px-2.5 text-[11px] text-(--codeclub-text-strong) hover:bg-[#303030]" aria-haspopup="menu" aria-expanded={scopeMenuOpen} aria-label={language === 'en' ? 'Select change group' : 'Seleccionar grupo de cambios'}>{scopeLabels[changeScope]}<ChevronDown size={12} aria-hidden="true"/></button>
        {scopeMenuOpen && <div className="absolute left-0 top-[calc(100%+6px)] z-50 w-40 rounded-xl border border-white/[0.08] bg-[#292929] p-1 shadow-2xl" role="menu" aria-label={language === 'en' ? 'Change groups' : 'Grupos de cambios'}>{(['uncommitted', 'unstaged', 'staged', 'branch'] as const).map((scope) => <button key={scope} type="button" role="menuitemradio" aria-checked={changeScope === scope} onClick={() => { setChangeScope(scope); setScopeMenuOpen(false); }} className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-[11px] ${changeScope === scope ? 'bg-white/[0.08] text-(--codeclub-text-strong)' : 'text-(--codeclub-text) hover:bg-white/[0.06]'}`}>{scopeLabels[scope]}{changeScope === scope && <Check size={13} aria-hidden="true"/>}</button>)}</div>}
      </div>
      <div ref={branchMenuRef} className="relative min-w-0">
        <button type="button" onClick={() => { setScopeMenuOpen(false); setBranchQuery(''); setBranchMenuOpen((open) => !open); }} className="flex h-7 max-w-[min(36vw,300px)] items-center gap-2 rounded-full bg-[#252525] px-2.5 text-[11px] text-(--codeclub-text-strong) hover:bg-[#303030]" aria-haspopup="listbox" aria-expanded={branchMenuOpen} aria-label={language === 'en' ? 'Select comparison branch' : 'Seleccionar rama de comparación'} title={`${branch} → ${compareBranch || (language === 'en' ? 'Select branch' : 'Elegir rama')}`}><span className="max-w-[88px] truncate">{branch}</span><span className="text-(--codeclub-text-muted)" aria-hidden="true">→</span><span className="max-w-[110px] truncate">{compareBranch || (language === 'en' ? 'Select branch' : 'Elegir rama')}</span><ChevronDown size={12} className="shrink-0" aria-hidden="true"/></button>
        {branchMenuOpen && <div className="absolute left-0 top-[calc(100%+6px)] z-50 w-[min(280px,calc(100vw-48px))] rounded-xl border border-white/[0.08] bg-[#292929] p-1 shadow-2xl">
          <label className="flex h-8 items-center gap-2 border-b border-white/[0.08] px-2 text-(--codeclub-text-muted)"><Search size={13} aria-hidden="true"/><input autoFocus value={branchQuery} onChange={(event) => setBranchQuery(event.target.value)} placeholder={language === 'en' ? 'Search branches' : 'Buscar ramas'} className="min-w-0 flex-1 bg-transparent text-[11px] text-(--codeclub-text-strong) outline-none placeholder:text-(--codeclub-text-muted)" aria-label={language === 'en' ? 'Search branches' : 'Buscar ramas'}/></label>
          <div className="project-files-modal-scroll max-h-52 overflow-y-auto py-1" role="listbox" aria-label={language === 'en' ? 'Branches' : 'Ramas'}>{filteredBranches.map((item) => <button key={item} type="button" role="option" aria-selected={compareBranch === item} onClick={() => { setCompareBranch(item); setBranchMenuOpen(false); setBranchQuery(''); }} className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-[11px] text-(--codeclub-text) hover:bg-white/[0.07]"><span className="truncate">{item}</span>{compareBranch === item && <Check size={13} className="shrink-0" aria-hidden="true"/>}</button>)}{filteredBranches.length === 0 && <p className="m-0 px-2 py-2 text-[10px] text-(--codeclub-text-muted)">{language === 'en' ? 'No branches found' : 'No se encontraron ramas'}</p>}</div>
        </div>}
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-3 text-[11px] tabular-nums"><span className="text-(--codeclub-text-muted)">{files.length} {language === 'en' ? 'files' : 'archivos'}</span><span className="text-[#4ade80]">+{additions}</span><span className="text-[#f87171]">−{deletions}</span><button type="button" onClick={() => void loadReview()} className="grid h-7 w-7 place-items-center text-(--codeclub-text-muted) hover:text-(--codeclub-text-strong)" aria-label={language === 'en' ? 'Refresh changes' : 'Actualizar cambios'} title={language === 'en' ? 'Refresh changes' : 'Actualizar cambios'}><RotateCw size={14} aria-hidden="true"/></button><button type="button" onClick={onClose} className="grid h-7 w-7 place-items-center text-(--codeclub-text-muted) hover:text-(--codeclub-text-strong)" aria-label={language === 'en' ? 'Close' : 'Cerrar'} title={language === 'en' ? 'Close' : 'Cerrar'}><X size={16} aria-hidden="true"/></button></div>
    </header>
    {!projectPath ? <div className="grid min-h-0 flex-1 place-items-center px-6 text-center text-[12px] text-(--codeclub-text-muted)">{text.selectProjectReview}</div> : <div className="flex min-h-0 flex-1">
      <aside className="flex w-[min(340px,36%)] shrink-0 flex-col border-r border-[#252525]" aria-label={language === 'en' ? 'Changed files' : 'Archivos modificados'}><div className="project-files-modal-scroll min-h-0 flex-1 overflow-auto p-1.5">{loading && <p className="m-0 px-2 py-3 text-[11px] text-(--codeclub-text-muted)">{text.reviewing}</p>}{!loading && error && <div className="flex items-start gap-2 px-2 py-3 text-[11px] text-(--codeclub-text-muted)"><FileWarning size={14} className="mt-0.5 shrink-0 text-(--codeclub-accent-bright)" aria-hidden="true"/><span>{error}</span></div>}{!loading && !error && files.length === 0 && <p className="m-0 px-2 py-3 text-[11px] text-(--codeclub-text-muted)">{text.noPendingChanges}</p>}{!loading && !error && files.map((file) => <button key={`${file.status}-${file.path}`} type="button" onClick={() => setSelectedFile(file.path)} className={`flex w-full min-w-0 items-center gap-2 px-2 py-2 text-left text-[11px] transition-colors hover:bg-[#1c1c1c] ${selectedFile === file.path ? 'bg-[#1c1c1c]' : ''}`}><span className={`grid h-5 w-5 shrink-0 place-items-center text-[10px] font-semibold ${file.status === 'A' ? 'text-[#8BC7FF]' : file.status === 'D' ? 'text-[#999999]' : 'text-(--codeclub-text-strong)'}`} aria-label={file.status === 'A' ? text.added : file.status === 'D' ? text.deleted : text.modified}>{file.status}</span><span className="min-w-0 flex-1 truncate text-(--codeclub-text)">{file.path}</span>{(file.additions || file.deletions) > 0 && <span className="shrink-0 tabular-nums text-[10px]"><span className="text-[#4ade80]">+{file.additions}</span> <span className="text-[#f87171]">−{file.deletions}</span></span>}</button>)}</div></aside>
      <main className="flex min-w-0 flex-1 flex-col"><div className="flex h-9 shrink-0 items-center gap-3 border-b border-[#252525] px-4 text-[11px]">{selected ? <><span className="min-w-0 flex-1 truncate text-(--codeclub-text-strong)">{selected.path}</span>{(selected.additions || selected.deletions) > 0 && <span className="shrink-0 tabular-nums"><span className="text-[#4ade80]">+{selected.additions}</span> <span className="text-[#f87171]">−{selected.deletions}</span></span>}</> : <span className="text-(--codeclub-text-muted)">{language === 'en' ? 'Select a changed file' : 'Seleccioná un archivo modificado'}</span>}</div><div className="project-files-modal-scroll min-h-0 flex-1 overflow-auto font-mono text-[12px] leading-[21px]">{!selected ? <div className="grid h-full place-items-center text-[11px] text-(--codeclub-text-muted)">{loading ? text.reviewing : text.noPendingChanges}</div> : diffLoading ? <div className="p-4 text-[11px] text-(--codeclub-text-muted)">{text.reviewing}</div> : diffContent ? <div className="min-w-max py-2">{diffRows.map((line, index) => { const added = line.startsWith('+') && !line.startsWith('+++'); const removed = line.startsWith('-') && !line.startsWith('---'); const hunk = line.startsWith('@@'); const header = line.startsWith('diff --git') || line.startsWith('index ') || line.startsWith('--- ') || line.startsWith('+++ '); return <div key={`${index}-${line}`} className={`flex min-h-[21px] px-4 ${added ? 'bg-[#12301f] text-[#a4e4b5]' : removed ? 'bg-[#351b1b] text-[#f2aaaa]' : hunk ? 'bg-[#17232e] text-[#9bc7ec]' : header ? 'text-[#858585]' : 'text-[#c6c6c6]'}`}><span className="sticky left-0 w-12 shrink-0 select-none bg-[#111111] pr-3 text-right text-[#555555]">{index + 1}</span><span className="whitespace-pre">{line || ' '}</span></div>; })}</div> : <div className="grid h-full place-items-center px-6 text-center text-[11px] text-(--codeclub-text-muted)">{text.noDiff}</div>}</div></main>
    </div>}
    </section></div>, document.body) : null;
  if (!visible) return null;
  return modal;
}

const DEFAULT_BROWSER_URL = 'https://www.google.com/';
const EMPTY_BROWSER_URL = `data:text/html;charset=utf-8,${encodeURIComponent('<!doctype html><style>html,body{margin:0;background:#202124;color:#9a9a9a;font-family:Arial,sans-serif}form{display:flex;align-items:center;height:40px;margin:10px 6px;padding:0 10px;border-radius:12px;background:#2c2c2c}input{min-width:0;flex:1;border:0;outline:0;background:transparent;color:#e8eaed;text-align:center;font-size:16px}input::placeholder{color:#9a9a9a}button{border:0;background:transparent;color:#9a9a9a;font-size:24px;cursor:pointer}form:hover{background:#353535}form:hover button{color:#e8eaed}</style><form onsubmit="event.preventDefault();var value=this.querySelector(\'input\').value.trim();if(value)location.href=/^https?:\\/\\//i.test(value)?value:\'https://\'+value"><input autofocus placeholder="Ingresá una URL" aria-label="Ingresar una URL"><button type="submit" aria-label="Abrir URL">↗</button></form>')}`;

const normalizeBrowserAddress = (value: string) => {
  const raw = value.trim();
  if (!raw) return null;
  try {
    if (/^[a-z][a-z\d+.-]*:\/\//i.test(raw) && !/^https?:\/\//i.test(raw)) return null;
    const parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname) return null;
    return parsed.toString();
  } catch {
    return null;
  }
};

/** Integrated WebView; scoped agent events go to the matching chat/project, while legacy broadcasts reach only visible instances. */
export function BrowserPanel({ isolated = false, visible = true, selected = true, chatId, projectPath = '', instanceId = 'isolated-browser' }: { isolated?: boolean; visible?: boolean; selected?: boolean; chatId?: string; projectPath?: string; instanceId?: string } = {}) {
  const language = useAppLanguage();
  const { palette } = useOrbPalette();
  const text = rightSidebarTranslations[language];
  const webviewRef = useRef<any>(null);
  const visibleRef = useRef(visible); visibleRef.current = visible;
  const selectedRef = useRef(selected); selectedRef.current = selected;
  const acceptsBrowserEvent = (event: Event) => { const detail = (event as CustomEvent).detail; return isolated || (detail?.chatId ? selectedRef.current && detail.chatId === chatId && (detail.projectPath || '') === projectPath : visibleRef.current); };
  const addressId = `codeclub-browser-address-${instanceId}`;
  const initialUrl = typeof window !== 'undefined' && !isolated ? localStorage.getItem(`codeclub:browser-url:${instanceId}`) || DEFAULT_BROWSER_URL : DEFAULT_BROWSER_URL;
  const [address, setAddress] = useState(initialUrl);
  const [currentUrl, setCurrentUrl] = useState(initialUrl);
  useEffect(() => { if (!isolated) localStorage.setItem(`codeclub:browser-url:${instanceId}`, currentUrl); }, [currentUrl, instanceId, isolated]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [browserHistory, setBrowserHistory] = useState<{ url: string; title: string }[]>([]);
  const browserAddressMenuRef = useRef<HTMLDivElement | null>(null);
  const browserAddressFocusedRef = useRef(false);
  const closeAddressMenu = (blurInput = false) => {
    browserAddressFocusedRef.current = false;
    if (browserAddressMenuRef.current) browserAddressMenuRef.current.style.display = 'none';
    if (blurInput) (document.getElementById(addressId) as HTMLInputElement | null)?.blur();
  };
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedElement, setSelectedElement] = useState<BrowserElementSelection | null>(null);
  const [styleEditorOpen, setStyleEditorOpen] = useState(false);
  const selectedElementRef = useRef(selectedElement);
  selectedElementRef.current = selectedElement;
  const styleEditorOpenRef = useRef(styleEditorOpen);
  styleEditorOpenRef.current = styleEditorOpen;
  const markerOrderRef = useRef<BrowserMarkerOrder>({ total: 0, items: [] });
  const previewQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  const selectionSubmittingRef = useRef(false);
  const runPickerAction = useCallback((script: string, shouldRun?: () => boolean) => {
    const view = webviewRef.current;
    const action = previewQueueRef.current.catch(() => false).then(() => shouldRun && !shouldRun() ? false : view?.executeJavaScript(script)).catch(() => false);
    previewQueueRef.current = action;
    return action;
  }, []);
  const previewStyleChanges = useCallback(async (markerId: string, changes: BrowserElementChanges) => Boolean(await runPickerAction(`window.__codeclubPreviewCommentMarker?.(${JSON.stringify(markerId)}, ${JSON.stringify(changes)}) ?? false`, () => styleEditorOpenRef.current && selectedElementRef.current?.markerId === markerId)), [runPickerAction]);
  const [selectionComment, setSelectionComment] = useState('');
  const selectionCommentRef = useRef<HTMLInputElement | null>(null);

  const rememberBrowserPage = (url: string, title?: string) => {
    if (!url || url.startsWith('data:')) return;
    const entry = { url, title: title?.trim() || url.replace(/^https?:\/\//, '').replace(/\/$/, '') };
    setBrowserHistory((current) => {
      const next = [entry, ...current.filter((item) => item.url !== url)].slice(0, 20);
      if (!isolated) localStorage.setItem(`codeclub:browser-history:${instanceId}`,  JSON.stringify(next));
      return next;
    });
  };

  useEffect(() => {
    if (isolated) return;
    try {
      const saved = JSON.parse(localStorage.getItem(`codeclub:browser-history:${instanceId}`) || '[]');
      if (Array.isArray(saved)) setBrowserHistory(saved.filter((item) => item?.url).slice(0, 20));
    } catch { /* ignore malformed local history */ }
  }, []);

  useEffect(() => {
    const input = document.getElementById(addressId) as HTMLInputElement | null;
    if (!input) return undefined;
    input.removeAttribute('list');
    const menu = document.createElement('div');
    menu.className = 'codeclub-browser-history-menu';
    menu.setAttribute('role', 'listbox');
    menu.style.display = 'none';
    document.body.appendChild(menu);
    browserAddressMenuRef.current = menu;
    const reposition = () => {
      const rect = input.getBoundingClientRect();
      menu.style.left = `${rect.left}px`;
      menu.style.top = `${rect.bottom + 6}px`;
      menu.style.width = `${rect.width}px`;
    };
    const show = () => { browserAddressFocusedRef.current = true; reposition(); menu.style.display = 'block'; };
    const hide = () => { window.setTimeout(() => { if (!menu.matches(':hover') && !menu.contains(document.activeElement) && document.activeElement !== input) { browserAddressFocusedRef.current = false; menu.style.display = 'none'; } }, 120); };
    input.addEventListener('focus', show);
    input.addEventListener('blur', hide);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => { input.removeEventListener('focus', show); input.removeEventListener('blur', hide); window.removeEventListener('resize', reposition); window.removeEventListener('scroll', reposition, true); menu.remove(); browserAddressMenuRef.current = null; };
  }, []);

  useEffect(() => {
    const menu = browserAddressMenuRef.current;
    const input = document.getElementById(addressId) as HTMLInputElement | null;
    if (!menu || !input) return;
    const query = address.trim();
    const normalizedQuery = query.toLowerCase();
    const matchingHistory = browserHistory.filter((item) => !normalizedQuery || `${item.title} ${item.url}`.toLowerCase().includes(normalizedQuery));
    menu.replaceChildren();
    menu.style.display = browserAddressFocusedRef.current ? 'block' : 'none';
    const addIcon = (svg: string) => { const icon = document.createElement('span'); icon.className = 'codeclub-browser-history-icon'; icon.innerHTML = svg; return icon; };
    const addRow = (label: string, detail: string, svg: string, onClick: () => void) => {
      const row = document.createElement('button');
      row.type = 'button'; row.className = 'codeclub-browser-history-row'; row.setAttribute('role', 'option');
      row.append(addIcon(svg));
      const copy = document.createElement('span'); copy.className = 'codeclub-browser-history-copy';
      const title = document.createElement('span'); title.className = 'codeclub-browser-history-title'; title.textContent = label;
      const meta = document.createElement('span'); meta.className = 'codeclub-browser-history-detail'; meta.textContent = detail;
      copy.append(title, meta); row.append(copy);
      row.addEventListener('mousedown', (event) => event.preventDefault());
      row.addEventListener('keydown', (event) => {
        const rows = Array.from(menu.querySelectorAll<HTMLButtonElement>('.codeclub-browser-history-row'));
        const index = rows.indexOf(row);
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          rows[(index + (event.key === 'ArrowDown' ? 1 : rows.length - 1)) % rows.length]?.focus();
        } else if (event.key === 'Escape') {
          event.preventDefault(); closeAddressMenu(); input.focus();
        }
      });
      row.addEventListener('click', () => { closeAddressMenu(true); onClick(); }); menu.appendChild(row);
    };
    if (query) {
      addRow(language === 'es' ? `Buscar en la web: ${query}` : `Search the web for: ${query}`, language === 'es' ? 'Buscar en la web' : 'Search the web', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>', () => { const next = `https://www.google.com/search?q=${encodeURIComponent(query)}`; setAddress(next); rememberBrowserPage(next, query); window.dispatchEvent(new CustomEvent('codeclub:browser-navigate', { detail: { url: next } })); });
    }
    matchingHistory.slice(0, 5).forEach((item, index) => {
      if (query || index > 0) { const divider = document.createElement('div'); divider.className = 'codeclub-browser-history-divider'; menu.appendChild(divider); }
      addRow(item.title, item.url.replace(/^https?:\/\//, '').replace(/\/$/, ''), '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>', () => { window.dispatchEvent(new CustomEvent('codeclub:browser-navigate', { detail: { url: item.url } })); });
    });
    if (menu.childElementCount === 0) menu.style.display = 'none';
  }, [address, browserHistory, language]);

  useEffect(() => {
    if (!selectedElement) return;
    requestAnimationFrame(() => {
      const input = selectionCommentRef.current;
      if (!input) return;
      input.focus();
    });
  }, [selectedElement?.markerId]);

  const clearPagePicker = async () => {
    try { await webviewRef.current?.executeJavaScript(`window.__codeclubStopPicker?.();`); } catch { /* page may have navigated */ }
    setSelectionMode(false);
  };

  const startPagePicker = async () => {
    const view = webviewRef.current;
    if (!view) return;
    selectedElementRef.current = null;
    styleEditorOpenRef.current = false;
    setSelectedElement(null);
    setStyleEditorOpen(false);
    setSelectionComment('');
    setSelectionMode(true);
    let pickerCursor = '';
    try {
      const response = await fetch('./cursors/dark/arrow.cur');
      const bytes = new Uint8Array(await response.arrayBuffer());
      let binary = '';
      bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
      pickerCursor = `data:image/x-icon;base64,${btoa(binary)}`;
    } catch { /* use the fallback crosshair */ }
    try {
      const started = await runPickerAction(createBrowserPickerScript(pickerCursor, palette.accent, markerOrderRef.current, agentTextSelectionTranslations[language].removeReference));
      if (!started) setSelectionMode(false);
    } catch { setSelectionMode(false); }
  };

  useEffect(() => {
    if (!selectionMode) return undefined;
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') void clearPagePicker(); };
    window.addEventListener('keydown', escape);
    const poll = window.setInterval(async () => {
      try {
        const state = await webviewRef.current?.executeJavaScript('({ selection: window.__codeclubSelection || null, cancelled: Boolean(window.__codeclubPickerCancelled) })');
        if (state?.cancelled) setSelectionMode(false);
        const result = state?.selection;
        if (result?.html) { setSelectedElement(result); setSelectionMode(false); }
      } catch { /* page may have navigated */ }
    }, 250);
    return () => { window.clearInterval(poll); window.removeEventListener('keydown', escape); };
  }, [selectionMode]);

  useEffect(() => {
    const removeBrowserMarker = (event: Event) => {
      const markerId = (event as CustomEvent<{ markerId?: string }>).detail?.markerId;
      if (markerId) void runPickerAction(`window.__codeclubRemoveCommentMarker?.(${JSON.stringify(markerId)});`);
    };
    const updateOrder = (event: Event) => {
      const order = (event as CustomEvent<BrowserMarkerOrder>).detail;
      if (!order || !Array.isArray(order.items)) return;
      markerOrderRef.current = order;
      void runPickerAction(`window.__codeclubSetCommentMarkerOrder?.(${JSON.stringify(order)});`);
    };
    window.addEventListener('codeclub:remove-browser-marker', removeBrowserMarker);
    window.addEventListener('codeclub:browser-reference-order', updateOrder);
    window.dispatchEvent(new CustomEvent('codeclub:browser-reference-order-request'));
    let active = true, busy = false;
    const pollRemovedMarker = window.setInterval(async () => {
      if (busy) return;
      busy = true;
      try {
        const selected = selectedElementRef.current;
        const state = await webviewRef.current?.executeJavaScript(`window.__codeclubTakeCommentMarkerState?.(${JSON.stringify(selected?.markerId || null)}) ?? null`);
        if (!active || !state) return;
        for (const markerId of state.removed) window.dispatchEvent(new CustomEvent('codeclub:remove-browser-reference', { detail: { markerId } }));
        if (selected && selectedElementRef.current?.markerId === selected.markerId) {
          if (!state.active) { setSelectedElement(null); setStyleEditorOpen(false); setSelectionComment(''); }
          else if (state.active.anchor && !styleEditorOpenRef.current) {
            const { x, y } = state.active.anchor;
            setSelectedElement((current) => current?.markerId === selected.markerId && (Math.abs(current.x - x) > 1 || Math.abs(current.y - y) > 1) ? { ...current, x, y } : current);
          }
        }
      } catch { /* page may have navigated */ }
      finally { busy = false; }
    }, 250);
    return () => {
      active = false;
      window.clearInterval(pollRemovedMarker);
      window.removeEventListener('codeclub:remove-browser-marker', removeBrowserMarker);
      window.removeEventListener('codeclub:browser-reference-order', updateOrder);
      void runPickerAction('window.__codeclubDisposeDomPicker?.();');
    };
  }, [runPickerAction]);

  useEffect(() => { void runPickerAction(`window.__codeclubSetPickerPalette?.(${JSON.stringify(palette.accent)});`); }, [palette.accent, runPickerAction]);

  const addSelectedReference = async () => {
    if (!selectedElement || selectionSubmittingRef.current) return;
    selectionSubmittingRef.current = true;
    const valid = await runPickerAction(`window.__codeclubFinalizeCommentMarker?.(${JSON.stringify(selectedElement.markerId)}) ?? false`);
    selectionSubmittingRef.current = false;
    if (!valid || selectedElementRef.current?.markerId !== selectedElement.markerId) return;
    const comment = selectionComment.trim();
    const text = `${comment ? `Comentario: ${comment}\n\n` : ''}Componente seleccionado:\n${selectedElement.html}\n\nTexto visible: ${selectedElement.text}`;
    window.dispatchEvent(new CustomEvent('codeclub:browser-reference', { detail: { title: selectedElement.title || 'Elemento seleccionado', text, url: selectedElement.pageUrl, markerId: selectedElement.markerId } }));
    setSelectedElement(null);
    setSelectionComment('');
  };

  const addStyleChanges = async (changes: BrowserElementChanges, description: string) => {
    if (!selectedElement) throw new Error('Selection unavailable');
    if (!await previewStyleChanges(selectedElement.markerId, changes)) throw new Error('Preview unavailable');
    const valid = await runPickerAction(`window.__codeclubFinalizeCommentMarker?.(${JSON.stringify(selectedElement.markerId)}) ?? false`);
    if (!valid || selectedElementRef.current?.markerId !== selectedElement.markerId) throw new Error('Selection changed');
    const text = `Apply the following exact changes to the selected DOM element in the project source. Only change the listed properties; preserve other styles and children.\n\n${description ? `Description: ${description}\n\n` : ''}Page: ${selectedElement.pageUrl}\nElement: <${selectedElement.tagName}>\n\n${JSON.stringify(changes, null, 2)}\n\nOriginal element HTML:\n${selectedElement.html}`;
    window.dispatchEvent(new CustomEvent('codeclub:browser-reference', { detail: { title: `${selectedElement.title} · CSS`, text, url: selectedElement.pageUrl, markerId: selectedElement.markerId } }));
    setStyleEditorOpen(false);
    setSelectedElement(null);
    setSelectionComment('');
  };

  const cancelStyleChanges = async () => {
    styleEditorOpenRef.current = false;
    const id = selectedElementRef.current?.markerId;
    if (id) await runPickerAction(`window.__codeclubRollbackCommentMarker?.(${JSON.stringify(id)});`);
    if (selectedElementRef.current?.markerId !== id) return;
    setStyleEditorOpen(false);
    requestAnimationFrame(() => selectionCommentRef.current?.focus());
  };

  const discardSelectedReference = () => {
    selectedElementRef.current = null;
    styleEditorOpenRef.current = false;
    setSelectedElement(null);
    setSelectionComment('');
    setStyleEditorOpen(false);
    void runPickerAction(`window.__codeclubRemoveCommentMarker?.(${JSON.stringify(selectedElement?.markerId || '')});`);
  };

  const publishState = async (requestId?: string) => {
    const view = webviewRef.current;
    if (!view) return;
    try {
      const page = await view.executeJavaScript(`(() => {
        const visible = (element) => {
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);
          return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
        };
        const snapshotId = crypto.randomUUID();
        document.querySelectorAll('[data-codeclub-tool-ref]').forEach(element => element.removeAttribute('data-codeclub-tool-ref'));
        const elements = Array.from(document.querySelectorAll('a,button,input,textarea,select,[role="button"]')).filter(visible).slice(0, 120).map((element, index) => {
          const ref = snapshotId + '-' + index;
          element.setAttribute('data-codeclub-tool-ref', ref);
          return {
          ref: String(index + 1), tag: element.tagName.toLowerCase(), role: element.getAttribute('role') || element.tagName.toLowerCase(),
          text: (element.innerText || element.getAttribute('aria-label') || element.getAttribute('placeholder') || '').trim().slice(0, 180),
          selector: '[data-codeclub-tool-ref="' + ref + '"]',
          value: element.type === 'password' ? undefined : typeof element.value === 'string' ? element.value.slice(0, 2000) : undefined,
          disabled: Boolean(element.disabled),
          checked: typeof element.checked === 'boolean' ? element.checked : undefined,
          options: element.tagName === 'SELECT' ? Array.from(element.options).map(option => ({ value: option.value, label: option.textContent.trim(), disabled: option.disabled, selected: option.selected })) : undefined,
          rect: (() => { const value = element.getBoundingClientRect(); return { x: Math.round(value.x), y: Math.round(value.y), width: Math.round(value.width), height: Math.round(value.height) }; })()
        }; });
        return { snapshotId, title: document.title, text: document.body?.innerText?.slice(0, 12000) || '', elements, media: Array.from(document.querySelectorAll('video,audio')).map(media => ({ paused: media.paused, muted: media.muted, volume: media.volume, currentTime: media.currentTime, ended: media.ended, readyState: media.readyState })) };
      })()`);
      const state = { ok: true, url: view.getURL?.() || currentUrl, title: view.getTitle?.() || page.title, ...page };
      window.dispatchEvent(new CustomEvent('codeclub:browser-state', { detail: { ...state, chatId, requestId } }));
      return state;
    } catch (error) {
      const state = { ok: false, url: currentUrl, error: String(error) };
      window.dispatchEvent(new CustomEvent('codeclub:browser-state', { detail: { ...state, chatId, requestId } }));
      return state;
    }
  };

  useEffect(() => {
    const view = webviewRef.current;
    if (!view) return undefined;
    const syncUrl = () => { const next = view.getURL?.() || currentUrl; if (next === EMPTY_BROWSER_URL) { setAddress(''); return; } setAddress(next); rememberBrowserPage(next, view.getTitle?.()); };
    const start = () => { setLoading(true); setLoadError(''); selectedElementRef.current = null; styleEditorOpenRef.current = false; setSelectedElement(null); setStyleEditorOpen(false); setSelectionMode(false); setSelectionComment(''); };
    const stop = async () => { setLoading(false); syncUrl(); try { const pageUrl = view.getURL?.() || currentUrl; const favicon = await view.executeJavaScript(`document.querySelector('link[rel~="icon"],link[rel="shortcut icon"]')?.href || ''`); const domain = new URL(pageUrl).hostname; window.dispatchEvent(new CustomEvent('codeclub:browser-tab-meta', { detail: { favicon: favicon || undefined, title: view.getTitle?.() || domain, clearFavicon: !favicon } })); } catch { /* page may have navigated */ } if (view.getURL?.() === EMPTY_BROWSER_URL) await view.insertCSS?.(`html,body{height:100%!important;margin:0!important}body{display:grid!important;place-items:center!important;position:relative!important;background:#202124!important}body::before{content:'⌁  Navegador';position:absolute;top:calc(50% - 82px);left:0;right:0;text-align:center;color:#e8eaed;font:500 22px Arial,sans-serif;letter-spacing:-.02em}body::after{content:'Ingresá una dirección para empezar';position:absolute;top:calc(50% - 42px);left:0;right:0;text-align:center;color:#9aa0a6;font:14px Arial,sans-serif}form{width:min(520px,calc(100% - 48px))!important;height:44px!important;margin:0!important;padding:0 12px!important;border:1px solid #3c4043!important;border-radius:14px!important;background:#2c2c2c!important;box-sizing:border-box!important}form:hover,form:focus-within{background:#353535!important;border-color:#5f6368!important}`); void publishState(); };
    const fail = (event: Event) => {
      const detail = event as Event & { errorCode?: number; errorDescription?: string; isMainFrame?: boolean };
      if (detail.isMainFrame === false || detail.errorCode === -3) return;
      setLoading(false);
      setLoadError(detail.errorDescription || 'No se pudo cargar esta página.');
    };
    const navigate = () => syncUrl();
    const faviconUpdated = (event: Event) => {
      const favicons = (event as Event & { favicons?: string[] }).favicons || [];
      let domain = '';
      try { domain = new URL(view.getURL?.() || currentUrl).hostname; } catch { /* invalid or empty URL */ }
      window.dispatchEvent(new CustomEvent('codeclub:browser-tab-meta', { detail: { instanceId, favicon: favicons[0], title: view.getTitle?.() || domain, clearFavicon: !favicons[0] } }));
    };
    view.addEventListener('did-start-loading', start);
    view.addEventListener('did-stop-loading', stop);
    view.addEventListener('did-fail-load', fail);
    view.addEventListener('did-navigate', navigate);
    view.addEventListener('did-navigate-in-page', navigate);
    view.addEventListener('page-favicon-updated', faviconUpdated);
    return () => {
      view.removeEventListener('did-start-loading', start);
      view.removeEventListener('did-stop-loading', stop);
      view.removeEventListener('did-fail-load', fail);
      view.removeEventListener('did-navigate', navigate);
      view.removeEventListener('did-navigate-in-page', navigate);
      view.removeEventListener('page-favicon-updated', faviconUpdated);
    };
  }, []);

  useEffect(() => {
    const requestState = (event: Event) => { if (acceptsBrowserEvent(event)) void publishState((event as CustomEvent).detail?.requestId); };
    const navigate = (event: Event) => {
      if (!acceptsBrowserEvent(event)) return;
      const value = normalizeBrowserAddress(String((event as CustomEvent<{ url?: string }>).detail?.url || ''));
      if (value) { setAddress(value); setCurrentUrl(value); }
    };
    const action = async (event: Event) => {
      if (!acceptsBrowserEvent(event)) return;
      const view = webviewRef.current;
      const detail = (event as CustomEvent<{ type?: string; selector?: string; text?: string; key?: string; amount?: number }>).detail || {};
      if (!view) return;
      let result: any = { ok: true, type: detail.type };
      try {
        const selector = JSON.stringify(detail.selector || '');
        if (detail.type === 'scroll') await view.executeJavaScript(`window.scrollBy(0, ${Number(detail.amount) || 600});`);
        else if (detail.type === 'click') result = await view.executeJavaScript(`(() => { const element = document.querySelector(${selector}); if (!element) return { ok: false, error: 'Elemento no encontrado' }; element.click(); return { ok: true }; })()`);
        else if (detail.type === 'type') result = await view.executeJavaScript(`(() => { const element = document.querySelector(${selector}); if (!element) return { ok: false, error: 'Elemento no encontrado' }; if (element.disabled || element.readOnly) return { ok: false, error: 'Elemento no editable' }; element.focus(); const value = ${JSON.stringify(detail.text || '')}; if (element.tagName === 'SELECT') { const option = Array.from(element.options).find(option => option.value === value || option.textContent.trim() === value.trim()); if (!option || option.disabled) return { ok: false, error: 'Opción no disponible' }; element.value = option.value; } else if ('value' in element) element.value = value; else element.textContent = value; element.dispatchEvent(new Event('input', { bubbles: true })); element.dispatchEvent(new Event('change', { bubbles: true })); return { ok: true, value: element.value }; })()`);
        else if (detail.type === 'key') result = await view.executeJavaScript(`(() => { const key = ${JSON.stringify(detail.key || 'Enter')}; const element = document.activeElement || document.body; element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })); element.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true })); return { ok: true }; })()`);
        else result = { ok: false, error: 'Acción no implementada en el navegador.' };
        await new Promise((resolve) => setTimeout(resolve, 100));
        result = { ...result, state: await publishState() };
      } catch (error) {
        result = { ok: false, error: String(error) };
      }
      window.dispatchEvent(new CustomEvent('codeclub:browser-action-result', { detail: { ...result, chatId, requestId: (event as CustomEvent).detail?.requestId } }));
    };
    window.addEventListener('codeclub:browser-state-request', requestState);
    window.addEventListener('codeclub:browser-navigate', navigate);
    window.addEventListener('codeclub:browser-action', action);
    return () => {
      window.removeEventListener('codeclub:browser-state-request', requestState);
      window.removeEventListener('codeclub:browser-navigate', navigate);
      window.removeEventListener('codeclub:browser-action', action);
    };
  }, [currentUrl, chatId, projectPath]);

  useEffect(() => {
    const view = webviewRef.current;
    if (!view) return undefined;
    const styleEmptyPage = async () => {
      if (view.getURL?.() !== EMPTY_BROWSER_URL) return;
      await view.insertCSS?.(`body::before,body::after{content:none!important;display:none!important}form{width:min(620px,calc(100% - 32px))!important;height:58px!important;margin:0!important;padding:8px 10px!important;border:1px solid #2e2e2e!important;border-radius:12px!important;background:#1a1a1a!important;box-shadow:0 8px 30px #00000040!important;box-sizing:border-box!important}form::before{content:'⌕'!important;display:grid!important;place-items:center!important;width:28px!important;height:28px!important;color:#8a8a8a!important;font:18px Arial,sans-serif!important}form:hover,form:focus-within{background:#1f1f1f!important;border-color:#444!important}input{height:40px!important;padding:0 10px!important;text-align:left!important;font-size:13px!important}button{width:30px!important;height:30px!important;color:#8a8a8a!important;border-radius:8px!important}button:hover{background:#ffffff0d!important;color:#f1f1f1!important}`);
    };
    view.addEventListener('did-stop-loading', styleEmptyPage);
    return () => view.removeEventListener('did-stop-loading', styleEmptyPage);
  }, []);

  useEffect(() => {
    const view = webviewRef.current;
    if (!view) return undefined;
    const refineEmptyPage = async () => {
      if (!String(view.getURL?.() || '').startsWith('data:text/html')) return;
      await view.insertCSS?.(`body{display:grid!important;place-items:center!important}body::before,body::after{content:none!important;display:none!important}form{width:min(520px,calc(100% - 32px))!important;height:52px!important;margin:0!important}form::before{width:34px!important;height:34px!important;font-size:24px!important}input{height:38px!important;font-size:13px!important}button{width:34px!important;height:34px!important;font-size:24px!important}`);
    };
    view.addEventListener('did-finish-load', refineEmptyPage);
    view.addEventListener('did-stop-loading', refineEmptyPage);
    return () => {
      view.removeEventListener('did-finish-load', refineEmptyPage);
      view.removeEventListener('did-stop-loading', refineEmptyPage);
    };
  }, []);

  useEffect(() => {
    const view = webviewRef.current;
    if (!view) return undefined;
    const showCompass = async () => {
      if (!String(view.getURL?.() || '').startsWith('data:text/html')) return;
      await view.insertCSS?.(`body::before{content:'✦'!important;display:block!important;position:absolute!important;top:calc(50% - 98px)!important;left:0!important;right:0!important;text-align:center!important;color:#9aa0a6!important;font:400 42px Arial,sans-serif!important;line-height:1!important;animation:codeclub-compass-pulse 2.4s ease-in-out infinite!important}body::after{content:none!important;display:none!important}@keyframes codeclub-compass-pulse{0%,100%{opacity:.55;transform:scale(.94) rotate(0deg)}50%{opacity:1;transform:scale(1) rotate(180deg)}}`);
    };
    view.addEventListener('did-finish-load', showCompass);
    view.addEventListener('did-stop-loading', showCompass);
    return () => {
      view.removeEventListener('did-finish-load', showCompass);
      view.removeEventListener('did-stop-loading', showCompass);
    };
  }, []);

  const submitAddress = (event: FormEvent) => {
    event.preventDefault();
    if (address.startsWith('Buscar en la web:') || address.startsWith('Search the web for:')) {
      const query = address.slice('Buscar en la web:'.length).trim();
      const searchQuery = address.startsWith('Search the web for:') ? address.slice('Search the web for:'.length).trim() : query;
      if (searchQuery) { const next = `https://www.google.com/search?q=${encodeURIComponent(searchQuery)}`; setAddress(next); setCurrentUrl(next); rememberBrowserPage(next, searchQuery); }
      closeAddressMenu(true);
      return;
    }
    const trimmedAddress = address.trim();
    const isExplicitUrl = /^https?:\/\//i.test(trimmedAddress);
    const looksLikeAddress = !/\s/.test(trimmedAddress) && (isExplicitUrl || /[./:]|^localhost$/i.test(trimmedAddress));
    if (!looksLikeAddress && trimmedAddress) {
      const next = `https://www.google.com/search?q=${encodeURIComponent(trimmedAddress)}`;
      setAddress(next); setCurrentUrl(next); rememberBrowserPage(next, trimmedAddress); closeAddressMenu(true); return;
    }
    const next = normalizeBrowserAddress(trimmedAddress);
    if (next) { setAddress(next); setCurrentUrl(next); rememberBrowserPage(next); closeAddressMenu(true); }
  };
  const viewProps = { ref: (node: any) => { webviewRef.current = node; }, src: currentUrl || EMPTY_BROWSER_URL, className: 'absolute inset-0 border-0 bg-[#202124]', hidden: !currentUrl, style: { display: currentUrl ? 'inline-flex' : 'none' }, title: text.browser, allowpopups: 'true' };

  return <div className="relative h-full min-h-0 bg-transparent text-[#e8eaed]">
    <div className="flex h-9 shrink-0 items-center gap-2 bg-transparent px-2.5" aria-label={text.browserControls}>{!currentUrl && !loadError && <div className="absolute top-9 right-0 bottom-0 left-0 z-[1] flex flex-col items-center justify-center gap-5 bg-[#202124]"><GlobeCheck aria-hidden="true" className="text-[#9aa0a6]" size={38} strokeWidth={1.7} /><form onSubmit={submitAddress} className="flex h-[52px] w-[min(520px,calc(100%-32px))] items-center gap-2 rounded-[14px] border border-[#3c4043] bg-[#1a1a1a] px-3 shadow-[0_8px_30px_#00000040] transition-colors hover:bg-[#1f1f1f] focus-within:border-[#5f6368]"><span className="grid h-8 w-8 shrink-0 place-items-center text-[24px] text-[#8a8a8a]">⌕</span><input autoFocus value={address} onChange={(event) => setAddress(event.target.value)} className="h-9 min-w-0 flex-1 bg-transparent px-2 text-[13px] text-[#e8eaed] outline-none placeholder:text-[#9a9a9a]" placeholder={text.browserAddressPlaceholder} aria-label={text.webAddress} /><button type="submit" aria-label={text.openUrl} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-transparent text-[24px] text-[#8a8a8a] hover:bg-white/[0.06] hover:text-[#f1f1f1]">↗</button></form></div>}
      <div className="flex shrink-0 items-center gap-0.5"><button type="button" onClick={() => webviewRef.current?.goBack?.()} className="grid h-7 w-7 place-items-center rounded-full text-[#8a8a8a] hover:bg-white/[0.08] hover:text-white focus-visible:outline-2 focus-visible:outline-(--codeclub-accent)" aria-label={text.back} title={text.back}><ArrowLeft size={16} /></button><button type="button" onClick={() => webviewRef.current?.goForward?.()} className="grid h-7 w-7 place-items-center rounded-full text-[#8a8a8a] hover:bg-white/[0.08] hover:text-white focus-visible:outline-2 focus-visible:outline-(--codeclub-accent)" aria-label={text.forward} title={text.forward}><ArrowRight size={16} /></button><button type="button" onClick={() => webviewRef.current?.reload?.()} className="grid h-7 w-7 place-items-center rounded-full text-[#8a8a8a] hover:bg-white/[0.08] hover:text-white focus-visible:outline-2 focus-visible:outline-(--codeclub-accent)" aria-label={text.reload} title={text.reload}><RotateCw size={16} className={loading ? 'animate-spin' : ''} /></button><button type="button" onClick={() => { setAddress(''); setCurrentUrl(DEFAULT_BROWSER_URL); setLoadError(''); setLoading(false); }} className="grid h-7 w-7 place-items-center rounded-full text-[#8a8a8a] hover:bg-white/[0.08] hover:text-white focus-visible:outline-2 focus-visible:outline-(--codeclub-accent)" aria-label={text.home} title={text.home}><Home size={15} /></button></div>
      <form onSubmit={submitAddress} className="min-w-0 flex-1"><label className="sr-only" htmlFor={addressId}>{text.webAddress}</label><input id={addressId} value={address.replace(/^https?:\/\//, '').replace(/\/$/, '')} onChange={(event) => setAddress(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); closeAddressMenu(); event.currentTarget.blur(); } else if (event.key === 'ArrowDown') { const firstRow = browserAddressMenuRef.current?.querySelector<HTMLButtonElement>('.codeclub-browser-history-row'); if (firstRow) { event.preventDefault(); firstRow.focus(); } } }} onFocus={(event) => event.currentTarget.select()} className="h-8 w-full bg-transparent text-center text-[17px] font-medium text-[#f1f3f4] outline-none placeholder:text-[#8a8a8a]" aria-label={text.webAddress} placeholder={text.browserAddressPlaceholder} /></form>
      <div className="relative flex shrink-0 items-center gap-0.5"><button type="button" className={`grid h-7 w-7 place-items-center rounded-full hover:bg-white/[0.08] hover:text-white focus-visible:outline-2 focus-visible:outline-(--codeclub-accent) ${selectionMode ? 'bg-[#3d9bff22] text-[#8bc7ff]' : 'text-[#b8b8b8]'}`} aria-label={text.pickElement} title={text.pickElement} aria-pressed={selectionMode} onClick={() => selectionMode ? void clearPagePicker() : void startPagePicker()}><MousePointerClick size={17} /></button><button type="button" onClick={() => setMenuOpen((open) => !open)} className="grid h-7 w-7 place-items-center rounded-full text-[#b8b8b8] hover:bg-white/[0.08] hover:text-white focus-visible:outline-2 focus-visible:outline-(--codeclub-accent)" aria-label={text.moreOptions} title={text.moreOptions} aria-expanded={menuOpen}><EllipsisVertical size={17} /></button>{menuOpen && <div className="absolute top-9 right-0 z-20 w-56 rounded-xl border border-white/[0.08] bg-[#2C2C2C]/95 p-1.5 shadow-xl backdrop-blur-xl"><button type="button" onClick={() => { webviewRef.current?.reload?.(); setMenuOpen(false); }} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[11px] whitespace-nowrap text-[#eeeeee] hover:bg-white/[0.08]"><RotateCw className="shrink-0 text-[#b8b8b8]" size={14} strokeWidth={1.8} aria-hidden="true" /><span className="min-w-0 truncate">{text.reload}</span></button><div className="mx-2 my-1 h-px bg-[#444444]" /><button type="button" onClick={() => { window.open(currentUrl, '_blank'); setMenuOpen(false); }} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[11px] whitespace-nowrap text-[#eeeeee] hover:bg-white/[0.08]"><ExternalLink className="shrink-0 text-[#b8b8b8]" size={14} strokeWidth={1.8} aria-hidden="true" /><span className="min-w-0 truncate">{text.openOutside}</span></button></div>}</div>
    </div>
    <div className="absolute top-9 right-0 bottom-0 left-0 overflow-hidden">{createElement('webview', viewProps)}</div>{selectedElement && <div className="absolute z-20 w-[min(360px,calc(100%-16px))]" style={{ left: `clamp(8px, ${selectedElement.x}px, calc(100% - 376px))`, top: styleEditorOpen ? `clamp(48px, ${selectedElement.y + 48}px, calc(100% - 328px))` : `clamp(48px, ${selectedElement.y + 48}px, calc(100% - 152px))`, ...(styleEditorOpen ? { height: "min(320px, calc(100% - 56px))" } : {}) }}>{styleEditorOpen ? <BrowserStyleEditor key={selectedElement.markerId} element={selectedElement} language={language} onCancel={cancelStyleChanges} onConfirm={addStyleChanges} onPreview={previewStyleChanges} /> : <form className="chat-selection-comment browser-selection-comment" onSubmit={(event) => { event.preventDefault(); addSelectedReference(); }}><button type="button" onClick={() => setStyleEditorOpen(true)} aria-label={browserStyleTranslations[language].edit} title={browserStyleTranslations[language].edit}><Pencil size={15} strokeWidth={1.8} aria-hidden="true" /></button><input ref={selectionCommentRef} type="text" value={selectionComment} onChange={(event) => setSelectionComment(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); discardSelectedReference(); } }} placeholder={agentTextSelectionTranslations[language].commentPlaceholder} aria-label={agentTextSelectionTranslations[language].commentPlaceholder} /><button type="submit" aria-label={agentTextSelectionTranslations[language].addToChat} title={agentTextSelectionTranslations[language].addToChat}><ArrowUp size={16} strokeWidth={2} /></button></form>}</div>}{loadError && <div className="absolute inset-0 z-10 grid place-items-center bg-[#202124] px-6 text-center"><div className="max-w-[360px]"><p className="m-0 text-[15px] font-medium text-[#f1f3f4]">{text.pageLoadError}</p><p className="mt-2 mb-0 break-words text-[12px] leading-5 text-[#a7a7a7]">{loadError}</p><p className="mt-1 mb-0 break-words text-[11px] text-[#777777]">{currentUrl}</p><button type="button" onClick={() => { setLoadError(''); setLoading(true); webviewRef.current?.reload?.(); }} className="mt-4 rounded-lg bg-white/[0.08] px-3 py-1.5 text-[11px] text-[#eeeeee] hover:bg-white/[0.14]">{text.retry}</button></div></div>}
  </div>;
}

type TerminalInfo = { id: string; name: string; shell: string; cwd: string; status: string };
type TerminalRunRequest = { code: string; language?: string; cwd?: string };

function buildTerminalRunCommand({ code, language = 'text', cwd }: TerminalRunRequest, projectPath?: string) {
  if (cwd) {
    const target = `${String(projectPath || '').replace(/[\\/]+$/, '')}\\${cwd.replace(/^[/\\]+/, '').replace(/[\\/]+/g, '\\')}`.replace(/'/g, "''");
    return `Set-Location -LiteralPath '${target}'\r\n`;
  }
  const normalizedLanguage = language.toLowerCase();
  const interpreter = normalizedLanguage === 'javascript' || normalizedLanguage === 'js' || normalizedLanguage === 'typescript' || normalizedLanguage === 'ts'
    ? 'node'
    : normalizedLanguage === 'python' || normalizedLanguage === 'py'
      ? 'python'
      : normalizedLanguage === 'bash' || normalizedLanguage === 'sh' || normalizedLanguage === 'shell' ? 'bash' : '';
  const payload = code.replace(/\r?\n/g, '\r\n');
  if (interpreter) return `@'\r\n${payload}\r\n'@ | ${interpreter}\r\n`;
  return `& ([scriptblock]::Create(@'\r\n${payload}\r\n'@))\r\n`;
}

function TerminalPanel({ projectPath, terminalId, instanceId, visible = true }: { projectPath?: string; terminalId?: string; instanceId?: string; visible?: boolean }) {
  const language = useAppLanguage();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<XtermTerminal | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const outputOffsetRef = useRef(0);
  const pendingRunRef = useRef<TerminalRunRequest | null>(null);
  const syncSizeRef = useRef<(() => void) | null>(null);
  const syncOutputRef = useRef<(() => void) | null>(null);
  const visibleRef = useRef(visible);

  useEffect(() => {
    visibleRef.current = visible;
    if (visible) {
      syncOutputRef.current?.();
      window.requestAnimationFrame(() => syncSizeRef.current?.());
    }
  }, [visible]);

  useEffect(() => {
    const runCode = (event: Event) => {
      if (!visibleRef.current) return;
      const detail = (event as CustomEvent<TerminalRunRequest>).detail;
      if (!detail?.code?.trim()) return;
      const id = sessionIdRef.current;
      if (!id) {
        pendingRunRef.current = detail;
        return;
      }
      void nativeInvoke('codeclub_terminal_write', { id, data: buildTerminalRunCommand(detail, projectPath) }).catch(() => undefined);
    };
    window.addEventListener('codeclub:terminal-run-code', runCode);
    return () => window.removeEventListener('codeclub:terminal-run-code', runCode);
  }, [projectPath]);

  useEffect(() => {
    if (!containerRef.current) return undefined;
    const terminal = new XtermTerminal({
      convertEol: true,
      cursorBlink: true,
      fontFamily: 'Consolas, "Cascadia Mono", monospace',
      fontSize: 11,
      lineHeight: 1.25,
      scrollback: 5000,
       theme: { background: '#00000000', foreground: '#F5F5EF', cursor: '#F5F5EF', selectionBackground: '#8BC7FF66' },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(containerRef.current);
    terminalRef.current = terminal;
    const resize = () => {
      try {
        const container = containerRef.current;
        if (!container || container.clientWidth < 2 || container.clientHeight < 2) return;
        fit.fit();
        const id = sessionIdRef.current;
        if (id) void nativeInvoke('codeclub_terminal_resize', { id, cols: terminal.cols, rows: terminal.rows }).catch(() => undefined);
      } catch { /* The container may be hidden while the panel is mounting. */ }
    };
    syncSizeRef.current = resize;
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(containerRef.current);
    let typing = false;
    let lastTitle = '';
    const parsed = terminal.onWriteParsed(() => {
      if (typing || !instanceId) return;
      const buffer = terminal.buffer.active;
      const cursorRow = buffer.baseY + buffer.cursorY;
      for (let row = cursorRow; row >= Math.max(0, cursorRow - 200); row--) {
        let line = buffer.getLine(row);
        let text = line?.translateToString(true) || '';
        while (line?.isWrapped && row > 0) {
          line = buffer.getLine(--row);
          text = (line?.translateToString(false) || '') + text;
        }
        const command = text.match(/^PS .+?>\s*(\S.*)$/)?.[1]?.trim();
        if (!command || command.endsWith('^C')) continue;
        const title = command.slice(0, 120);
        if (title !== lastTitle) {
          lastTitle = title;
          window.dispatchEvent(new CustomEvent('codeclub:terminal-tab-meta', { detail: { instanceId, title } }));
        }
        break;
      }
    });
    const key = terminal.onKey(({ domEvent }) => {
      typing = domEvent.key !== 'Enter' && !(domEvent.ctrlKey && domEvent.key.toLowerCase() === 'c');
    });
    const input = terminal.onData((data) => {
      if (!data.startsWith('\x1b')) typing = !/[\r\n\x03]/.test(data);
      const id = sessionIdRef.current;
      if (id) void nativeInvoke('codeclub_terminal_write', { id, data });
    });
    return () => {
      observer.disconnect();
      parsed.dispose();
      key.dispose();
      input.dispose();
      terminal.dispose();
      terminalRef.current = null;
      syncSizeRef.current = null;
    };
  }, [instanceId]);

  useEffect(() => {
    let cancelled = false;
    let pollInFlight = false;
    let pollAgain = false;
    const unsubscribe = onTerminalOutput(({ id }) => {
      if (id === sessionIdRef.current) syncOutputRef.current?.();
    });
    const start = async () => {
      outputOffsetRef.current = 0;
      try {
        const existing = terminalId ? await nativeInvoke<{ info?: TerminalInfo; output?: string; offset?: number }>('codeclub_terminal_snapshot', { id: terminalId }) : null;
        const created = existing?.info || await nativeInvoke<TerminalInfo>('codeclub_terminal_create', { request: { projectPath, shell: 'powershell', name: 'PowerShell' } });
        if (cancelled) {
          if (!terminalId) await nativeInvoke('codeclub_terminal_delete', { id: created.id }).catch(() => undefined);
          return;
        }
        sessionIdRef.current = created.id;
        syncSizeRef.current?.();
        if (visibleRef.current) terminalRef.current?.focus();
        if (existing?.output) {
          terminalRef.current?.write(String(existing.output));
        }
        outputOffsetRef.current = Number(existing?.offset) || 0;
        if (pendingRunRef.current) {
          const pending = pendingRunRef.current;
          pendingRunRef.current = null;
          void nativeInvoke('codeclub_terminal_write', { id: created.id, data: buildTerminalRunCommand(pending, projectPath) });
        }
        const poll = async () => {
          if (cancelled || !visibleRef.current) return;
          if (pollInFlight) { pollAgain = true; return; }
          pollAgain = false;
          pollInFlight = true;
          try {
            const snapshot = await nativeInvoke<{ output?: string; offset?: number; truncated?: boolean }>('codeclub_terminal_snapshot', { id: created.id, offset: outputOffsetRef.current });
            if (cancelled) return;
            const output = String(snapshot.output || '');
            const terminal = terminalRef.current;
            if (!terminal) return;
            if (output) {
              const followOutput = terminal.buffer.active.viewportY >= terminal.buffer.active.baseY;
              if (snapshot.truncated) terminal.reset();
              terminal.write(output);
              if (followOutput) terminal.scrollToBottom();
            }
            outputOffsetRef.current = Number(snapshot.offset) || outputOffsetRef.current;
          } catch { /* La sesión se limpia al desmontar el panel. */ }
          finally {
            pollInFlight = false;
            if (pollAgain && !cancelled) void poll();
          }
        };
        syncOutputRef.current = () => void poll();
        void poll();
      } catch (reason) {
        terminalRef.current?.writeln(`\r\n${String(reason)}`);
      }
    };
    void start();
    return () => {
      cancelled = true;
      unsubscribe();
      syncOutputRef.current = null;
      const id = sessionIdRef.current;
      sessionIdRef.current = null;
      if (id && !terminalId) void nativeInvoke('codeclub_terminal_delete', { id }).catch(() => undefined);
    };
  }, [projectPath, terminalId]);

  return <div ref={containerRef} id="codeclub-terminal-panel" className="h-full min-h-0 w-full bg-(--paper) p-0" onClick={() => terminalRef.current?.focus()} aria-label={rightSidebarTranslations[language].terminalAria} />;
}

function ChatSessionStatus({ session, language, seenCompletions }: { session?: SharedSession; language: AppLanguage; seenCompletions: Record<string, string> }) {
  if (!session) return null;
  const text = activityTranslations[language];
  const pending = session.approvals.length > 0 || session.state === 'question';
  const failed = session.state === 'error' || session.state === 'interrupted';
  const state = pending ? 'attention' : failed ? 'error' : session.busy ? 'working' : session.state === 'finished' ? 'finished' : null;
  if (!state || (state === 'finished' && seenCompletions[session.key] === `${session.runId}:${session.startedAt}`)) return null;
  const Icon = state === 'attention' ? MessageSquare : state === 'error' ? X : state === 'working' ? Hourglass : Check;
  const label = state === 'attention' ? (session.approvals.length ? text.approval : text.question) : state === 'error' ? text.error : state === 'working' ? text.working : text.finished;
  return <span role="img" aria-label={label} title={label} data-chat-state={state} className={`inline-flex shrink-0 items-center ${state === 'attention' || state === 'error' ? 'text-(--codeclub-text-strong)' : 'text-(--codeclub-text-muted)'}`}><Icon size={13} strokeWidth={1.7} aria-hidden="true" /></span>;
}

function RightPanelEmptyState({ onSelect }: { onSelect: (tab: RightPanelTab) => void }) {
  const language = useAppLanguage();
  const reducedMotion = useReducedMotion();
  const text = language === 'en' ? { choose: 'Choose a panel', open: 'Open a tool to view it in this sidebar.' } : { choose: 'Elegí un panel', open: 'Abrí una herramienta para verla en esta sidebar.' };
  const panelLabels = rightSidebarTranslations[language];
  return <section className="flex min-h-0 flex-1 flex-col items-center justify-center px-5 text-center" aria-label={text.choose}>
    <div className="max-w-[250px]">
      <OrbPaletteButton size={64} className="mx-auto mb-5" />
      <p className="mt-3 mb-0 text-[13px] text-(--codeclub-text-strong)">{text.choose}</p>
      <p className="mt-1 mb-4 text-[11px] leading-5 text-(--codeclub-text-muted)">{text.open}</p>
      <div className="grid gap-1.5">
        {rightPanelTabs.map(({ id, icon: Icon }) => <motion.button key={id} type="button" onClick={() => onSelect(id)} initial={false} animate={{ transform: 'translateY(0px) scale(1)' }} whileHover={reducedMotion ? undefined : { transform: 'translateY(-1px) scale(1)' }} whileTap={reducedMotion ? undefined : { transform: 'translateY(0px) scale(0.99)' }} transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }} className="right-panel-launch-card flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-[11px]"><Icon size={15} strokeWidth={1.8} aria-hidden="true" /><span>{panelLabels[id]}</span></motion.button>)}
      </div>
    </div>
  </section>;
}

function RightSidebarContent({ panel, projectName, projectPath, selectedFilePath, filesTreeVisible, onToggleFilesTree, visible, chatId, selected }: { chatId?: string; selected?: boolean; panel: RightPanelInstance; projectName: string; projectPath?: string; selectedFilePath?: string; filesTreeVisible: boolean; onToggleFilesTree: () => void; visible: boolean }) {
  const { tab } = panel;
  const language = useAppLanguage();
  const text = rightSidebarTranslations[language];
  const current = rightPanelTabs.find((item) => item.id === tab) ?? rightPanelTabs[0];
  const Icon = current.icon;
  const descriptions: Record<RightPanelTab, string> = language === 'en' ? {
    files: 'Explore files from the active project.', browser: 'Open and control pages inside Electron.', terminals: 'Manage persistent session terminals.',
  } : {
    files: 'Explorá los archivos del proyecto activo.', browser: 'Abrí y controlá páginas dentro de Electron.', terminals: 'Gestioná terminales persistentes de la sesión.',
  };
  if (tab === 'files') return <motion.section key={panel.instanceId} id={`right-panel-${panel.instanceId}`} role="tabpanel" aria-label={text.files} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.16, ease: 'easeOut' }} className="h-full min-h-0 flex-1 overflow-hidden bg-(--paper) text-(--ink)">{projectPath ? <ProjectPanelView projectPath={projectPath} projectName={projectName} selectedPath={selectedFilePath} showFileTree={filesTreeVisible} onToggleFileTree={onToggleFilesTree} /> : <div className="flex h-full flex-col items-center justify-center px-5 text-center"><div><FolderPen size={28} strokeWidth={1.3} className="mx-auto text-(--codeclub-text-muted)" aria-hidden="true" /><p className="mt-3 mb-0 text-[12px] text-(--codeclub-text-strong)">{language === 'en' ? 'No active project' : 'Sin proyecto activo'}</p><p className="mt-1 mb-0 text-[11px] leading-5 text-(--codeclub-text-muted)">{language === 'en' ? 'Link a folder to explore its files.' : 'Vinculá una carpeta para explorar sus archivos.'}</p></div></div>}</motion.section>;
  if (tab === 'browser') return <motion.section key={panel.instanceId} id={`right-panel-${panel.instanceId}`} role="tabpanel" aria-label={panel.label} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.16, ease: 'easeOut' }} className="h-full min-h-0 flex-1 overflow-hidden bg-(--paper) text-(--ink)"><BrowserPanel visible={visible} selected={selected} chatId={chatId} projectPath={projectPath} instanceId={panel.instanceId} /></motion.section>;
  if (tab === 'terminals') return <motion.section key={panel.instanceId} id={`right-panel-${panel.instanceId}`} role="tabpanel" aria-label={panel.label} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.16, ease: 'easeOut' }} className="min-h-0 flex-1 overflow-hidden bg-(--paper) text-(--ink)"><TerminalPanel projectPath={projectPath} terminalId={panel.terminalId} instanceId={panel.instanceId} visible={visible} /></motion.section>;
  return <motion.section key={panel.instanceId} id={`right-panel-${panel.instanceId}`} role="tabpanel" aria-label={panel.label} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.16, ease: 'easeOut' }} className="min-h-0 flex-1 overflow-auto bg-(--paper) px-3 py-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
    <div className="mt-5 grid min-h-[180px] place-items-center rounded-xl bg-transparent px-5 text-center"><div><Icon size={28} strokeWidth={1.3} className="mx-auto text-(--codeclub-text-muted)" aria-hidden="true" /><p className="mt-3 mb-0 text-[12px] text-(--codeclub-text-strong)">{projectPath ? projectName : 'Sin proyecto activo'}</p><p className="mt-1 mb-0 text-[11px] leading-5 text-(--codeclub-text-muted)">{descriptions[tab]}</p></div></div>
  </motion.section>;
}

function SidebarItem({ icon, label, active, disabled = false, onClick }: { icon: React.ReactNode; label: string; active: boolean; disabled?: boolean; onClick: () => void }) {
  return <button type="button" disabled={disabled} aria-disabled={disabled || undefined} aria-current={active ? 'page' : undefined} onClick={onClick} className={`flex h-8 w-full items-center gap-3 rounded-lg px-1.5 text-left text-[13px] transition-colors ${disabled ? 'cursor-not-allowed text-(--codeclub-text-muted) opacity-40' : `hover:bg-(--codeclub-hover) hover:text-(--codeclub-text-strong) ${active ? 'bg-(--codeclub-acrylic-active) text-(--codeclub-text-strong)' : 'text-(--codeclub-text)'}`}`}><span className={`grid h-4 w-4 shrink-0 place-items-center [&>svg]:size-4 ${active ? 'text-(--codeclub-text-strong)' : 'text-(--codeclub-text-muted)'}`}>{icon}</span><span>{label}</span></button>;
}
