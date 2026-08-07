'use client';

import { useEffect, useRef, useState } from 'react';
import { CircleHelp, CirclePlus, Fingerprint, Folder, Grid2X2, PanelLeft, PanelRight, Pencil } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';

const MIN_WIDTH = 220;
const MAX_WIDTH = 420;
const DEFAULT_LEFT = 280;
const DEFAULT_RIGHT = 300;

type Side = 'left' | 'right';
type WorkspacePanel = { id: string; title: string; description: string };
type RecentChat = { id: string; title: string };

const panels: WorkspacePanel[] = [{ id: 'empty', title: 'Panel sin contenido', description: 'El espacio central se adaptará a los paneles que agreguemos.' }];

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
  const [editingProjectName, setEditingProjectName] = useState(false);
  const [projectNameDraft, setProjectNameDraft] = useState('Codeclub');
  const [chatsByProject, setChatsByProject] = useState<Record<string, RecentChat[]>>({ home: [{ id: 'confirm-skills-mcp', title: 'Confirmar skills y MCP' }] });
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
      const project = (event as CustomEvent<{ id?: string; name?: string }>).detail;
      if (!project?.id) return;
      setActiveProjectId(project.id);
      const nextName = project.name ?? (project.id === 'home' ? 'Codeclub' : activeProjectName);
      setActiveProjectName(nextName);
      setProjectNameDraft(nextName);
      setEditingProjectName(false);
      setChatsByProject((current) => current[project.id] ? current : { ...current, [project.id]: [] });
    };
    window.addEventListener('codeclub:project-switch', handleProjectSwitch);
    return () => window.removeEventListener('codeclub:project-switch', handleProjectSwitch);
  }, []);

  const recentChats = chatsByProject[activeProjectId] ?? [];

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
            <SidebarItem icon={<CirclePlus />} label="Nuevo chat" />
            <SidebarItem icon={<Folder />} label="Proyectos" />
            <SidebarItem icon={<Fingerprint />} label="Programadas" />
            <SidebarItem icon={<Grid2X2 />} label="Extensiones" />
          </nav>
          <div className="mt-5"><p className="px-1.5 text-[13px] font-semibold text-(--codeclub-text-muted)">Recientes</p><div className="mt-2 space-y-1">{recentChats.length ? recentChats.map((chat) => <button key={chat.id} type="button" onClick={() => window.dispatchEvent(new CustomEvent('codeclub:open-chat', { detail: { chatId: chat.id, projectId: activeProjectId } }))} className="flex w-full items-center justify-between rounded-lg bg-(--codeclub-acrylic-active) px-2.5 py-2 text-left text-[13px] text-(--codeclub-text-strong)"><span className="truncate">{chat.title}</span></button>) : <p className="px-2.5 py-2 text-xs text-(--codeclub-text-muted)">Sin chats todavía</p>}</div></div>
          <div className="mt-auto flex items-center justify-between border-t border-(--codeclub-border-soft) px-1.5 pt-3"><div className="flex items-center gap-2"><span className="grid h-6 w-6 place-items-center rounded-full bg-[#9b59b6] text-[9px] font-medium text-white">MA</span><span className="text-[13px] text-(--codeclub-text-strong)">Matecore</span></div><CircleHelp size={16} className="text-(--codeclub-text-muted)" /></div>
        </div>
      </motion.aside>
      {leftOpen && <ResizeHandle side="left" onStart={startResize('left')} />}

      <PanelManager />

      {rightOpen && <ResizeHandle side="right" onStart={startResize('right')} />}
      <motion.aside animate={{ width: rightOpen ? rightWidth : 0, opacity: rightOpen ? 1 : 0 }} transition={resizing ? { type: 'spring', stiffness: 900, damping: 58, mass: 0.22 } : { type: 'spring', stiffness: 340, damping: 30 }} className="codeclub-panel-edge flex min-h-0 shrink-0 flex-col overflow-hidden bg-(--codeclub-center)" aria-label="Sidebar derecha" aria-hidden={!rightOpen}>
        <div className="flex h-10 shrink-0 items-center justify-end gap-2 border-b border-(--codeclub-border-soft) px-3 text-xs font-medium text-(--codeclub-text-muted)">Sidebar derecha <PanelRight size={14} /></div>
        <div className="flex-1 p-3"><div className="h-20 rounded-lg border border-(--codeclub-border-soft) bg-(--codeclub-surface)" /></div>
      </motion.aside>
    </div>
  </section>;
}

function PanelManager() {
  const [activePanelId] = useState(panels[0].id);
  const activePanel = panels.find((panel) => panel.id === activePanelId) ?? panels[0];
  return <main className="codeclub-graphite relative min-h-0 min-w-0 flex-1 overflow-hidden backdrop-blur-xl" aria-label="Gestor de paneles">
    <div className="codeclub-panel-shell flex h-full w-full items-center justify-center overflow-hidden bg-(--codeclub-center)">
      <AnimatePresence mode="wait">
        <motion.div key={activePanel.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18 }} className="px-6 text-center">
          <p className="text-sm font-medium text-(--codeclub-text-muted)">{activePanel.title}</p>
          <p className="mt-1 text-xs text-(--codeclub-text-muted) opacity-60">{activePanel.description}</p>
        </motion.div>
      </AnimatePresence>
    </div>
  </main>;
}

function SidebarItem({ icon, label }: { icon: React.ReactNode; label: string }) {
  return <button type="button" className="flex h-8 w-full items-center gap-3 rounded-lg px-1.5 text-left text-[13px] text-(--codeclub-text) transition-colors hover:bg-(--codeclub-hover) hover:text-(--codeclub-text-strong)"><span className="grid h-4 w-4 shrink-0 place-items-center text-(--codeclub-text-muted) [&>svg]:size-4">{icon}</span><span>{label}</span></button>;
}
