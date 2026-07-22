import React, { useEffect, useState } from 'react';
import { Cpu, Folder, House, MessageSquarePlus, MousePointer, Server, Target, Terminal } from 'lucide-react';
import { chatsStore, type GlobalChat } from '../lib/store';
import ChatInterface from './ChatInterface.tsx';
import ProjectsPanel from './ProjectsPanel.tsx';
import BusinessPanel from './BusinessPanel.tsx';
import { readProjectIndex, type ProjectEntry } from '../lib/projectManager';

type SelectedProject = { projectPath: string; projectName?: string };

export default function WorkspaceManager({ catalog, defaultProvider, defaultModel }) {
  const [selectedProject, setSelectedProject] = useState<SelectedProject | null>(null);
  const [showProjects, setShowProjects] = useState(true);
  const [showBusinesses, setShowBusinesses] = useState(false);
  const [chatMode, setChatMode] = useState<'development' | 'business'>('development');
  const [modeHovered, setModeHovered] = useState(false);
  const [dockVisible, setDockVisible] = useState(false);
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [availableProjects, setAvailableProjects] = useState<ProjectEntry[]>([]);
  const [recentChats, setRecentChats] = useState<GlobalChat[]>(() => chatsStore.get().slice(-3).reverse());

  useEffect(() => chatsStore.subscribe((chats) => setRecentChats(chats.slice(-3).reverse())), []);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent('codeclub:chat-mode-changed', { detail: { mode: chatMode } }));
  }, [chatMode]);

  useEffect(() => {
    const handleProjectSelection = (event: Event) => {
      const detail = (event as CustomEvent).detail || {};
      setSelectedProject(detail.selected === true && detail.projectPath
        ? { projectPath: detail.projectPath, projectName: detail.projectName }
        : null);
      setShowProjects(detail.selected !== true && detail.keepChat !== true);
      if (detail.selected === true || detail.keepChat === true) setShowBusinesses(false);
    };

    const handleActiveProject = (event: Event) => {
      const detail = (event as CustomEvent).detail || {};
      if (detail.projectPath) setSelectedProject({ projectPath: detail.projectPath, projectName: detail.projectName });
      if (detail.projectPath) setShowProjects(false);
      else if (Object.prototype.hasOwnProperty.call(detail, 'projectPath')) { setSelectedProject(null); setShowProjects(false); }
      setShowBusinesses(false);
    };

    window.addEventListener('codeclub:project-selection-changed', handleProjectSelection);
    window.addEventListener('codeclub:active-project', handleActiveProject);
    return () => {
      window.removeEventListener('codeclub:project-selection-changed', handleProjectSelection);
      window.removeEventListener('codeclub:active-project', handleActiveProject);
    };
  }, []);

  useEffect(() => {
    const handleOpenProjectPicker = async () => {
      setAvailableProjects(await readProjectIndex());
      setProjectPickerOpen(true);
    };
    window.addEventListener('codeclub:open-project-picker', handleOpenProjectPicker);
    return () => window.removeEventListener('codeclub:open-project-picker', handleOpenProjectPicker);
  }, []);

  const selectActiveProject = (project: ProjectEntry) => {
    setProjectPickerOpen(false);
    window.dispatchEvent(new CustomEvent('codeclub:project-selection-changed', {
      detail: { selected: true, projectPath: project.path, projectName: project.name },
    }));
    window.dispatchEvent(new CustomEvent('codeclub:active-project', {
      detail: { projectPath: project.path, projectName: project.name },
    }));
  };

  const openDockChat = (chat: GlobalChat) => {
    if (chat.projectPath) {
      window.dispatchEvent(new CustomEvent('codeclub:project-selection-changed', {
        detail: { selected: true, projectPath: chat.projectPath, projectName: chat.projectName },
      }));
      window.dispatchEvent(new CustomEvent('codeclub:active-project', {
        detail: { projectPath: chat.projectPath, projectName: chat.projectName },
      }));
    } else {
      window.dispatchEvent(new CustomEvent('codeclub:project-selection-changed', {
        detail: { selected: false, keepChat: true },
      }));
      window.dispatchEvent(new CustomEvent('codeclub:active-project', { detail: { projectPath: null } }));
    }
    window.setTimeout(() => window.dispatchEvent(new CustomEvent('codeclub:open-chat', {
      detail: { projectPath: chat.projectPath, chatId: chat.id, name: chat.name, projectName: chat.projectName },
    })), 0);
  };

  useEffect(() => {
    const handleOpenProjects = () => {
      setShowProjects(true);
      setShowBusinesses(false);
      setSelectedProject(null);
    };
    const handleOpenBusinesses = () => {
      setShowBusinesses(true);
      setShowProjects(false);
      setSelectedProject(null);
    };
    const handleOpenEmptyChat = () => { setShowProjects(false); setShowBusinesses(false); };
    window.addEventListener('codeclub:open-projects', handleOpenProjects);
    window.addEventListener('codeclub:open-businesses', handleOpenBusinesses);
    window.addEventListener('codeclub:open-empty-chat', handleOpenEmptyChat);
    return () => {
      window.removeEventListener('codeclub:open-projects', handleOpenProjects);
      window.removeEventListener('codeclub:open-businesses', handleOpenBusinesses);
      window.removeEventListener('codeclub:open-empty-chat', handleOpenEmptyChat);
    };
  }, []);

  useEffect(() => {
    if (!showProjects && !showBusinesses) window.dispatchEvent(new CustomEvent('codeclub:open-empty-chat'));
  }, [showProjects, showBusinesses]);

  useEffect(() => {
    if (showBusinesses) window.dispatchEvent(new CustomEvent('codeclub:open-businesses'));
  }, [showBusinesses]);

  useEffect(() => {
    const toggleDock = () => setDockVisible((visible) => !visible);
    window.addEventListener('codeclub:toggle-panel-dock', toggleDock);
    return () => window.removeEventListener('codeclub:toggle-panel-dock', toggleDock);
  }, []);

  useEffect(() => {
    const openInPanel = (kind: 'chat' | 'folders' | 'blank') => (event: Event) => {
      window.dispatchEvent(new CustomEvent(`codeclub:panel-left:open-${kind}`, {
        detail: (event as CustomEvent).detail || {},
      }));
    };

    const entries = (['chat', 'folders', 'blank'] as const).map((kind) => {
      const handler = openInPanel(kind);
      const name = `codeclub:open-${kind}`;
      window.addEventListener(name, handler);
      return { name, handler };
    });

    return () => entries.forEach(({ name, handler }) => window.removeEventListener(name, handler));
  }, []);

  return (
    <div className="workspace-panels group relative flex h-full w-full min-w-0 min-h-0 flex-col overflow-hidden">
      <div className="absolute left-0 top-0 z-[60] h-12 w-full" aria-label="Accesos rápidos">
        <div className={`absolute left-1/2 top-1 flex h-11 -translate-x-1/2 items-start justify-center rounded-2xl px-1.5 pt-1.5 transition-opacity duration-150 ${dockVisible ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'}`}>
        <div className="flex items-center gap-1 rounded-[14px] border border-[#202020] bg-[#111111] p-1">
          <button type="button" aria-label="Nuevo chat" title="Nuevo chat" onClick={() => window.dispatchEvent(new CustomEvent('codeclub:request-new-chat'))} className="grid h-7 w-7 place-items-center rounded-[9px] border-0 bg-transparent text-[#777777] transition-colors hover:bg-[#1e1e1e] hover:text-[#eeeeee]"><House size={14} strokeWidth={1.8} /></button>
          <button type="button" aria-label="Seleccionar proveedor" title="Proveedor" onClick={() => window.dispatchEvent(new CustomEvent('codeclub:open-command-menu', { detail: { kind: 'provider' } }))} className="grid h-7 w-7 place-items-center rounded-[9px] border-0 bg-transparent text-[#777777] transition-colors hover:bg-[#1e1e1e] hover:text-[#eeeeee]"><Server size={14} strokeWidth={1.8} /></button>
          <button type="button" aria-label="Seleccionar modelo" title="Modelo" onClick={() => window.dispatchEvent(new CustomEvent('codeclub:open-command-menu', { detail: { kind: 'model' } }))} className="grid h-7 w-7 place-items-center rounded-[9px] border-0 bg-transparent text-[#777777] transition-colors hover:bg-[#1e1e1e] hover:text-[#eeeeee]"><Cpu size={14} strokeWidth={1.8} /></button>
          <button type="button" aria-label="Proyectos" title="Proyectos" onClick={() => window.dispatchEvent(new CustomEvent('codeclub:open-projects'))} className="grid h-7 w-7 place-items-center rounded-[9px] border-0 bg-transparent text-[#777777] transition-colors hover:bg-[#1e1e1e] hover:text-[#eeeeee]"><Folder size={14} strokeWidth={1.8} /></button>
          <button type="button" aria-label="Elegir proyecto indexado" title="Proyectos indexados" onClick={() => window.dispatchEvent(new CustomEvent('codeclub:open-command-menu', { detail: { kind: 'project' } }))} className="grid h-7 w-7 place-items-center rounded-[9px] border-0 bg-transparent text-[#777777] transition-colors hover:bg-[#1e1e1e] hover:text-[#eeeeee]"><MousePointer size={14} strokeWidth={1.8} /></button>
          <button type="button" aria-label={`Modo ${chatMode === 'development' ? 'desarrollo' : 'negocios'}`} title={`Modo ${chatMode === 'development' ? 'desarrollo' : 'negocios'}`} onMouseEnter={() => setModeHovered(true)} onMouseLeave={() => setModeHovered(false)} onClick={() => setChatMode((mode) => mode === 'development' ? 'business' : 'development')} className="grid h-7 w-7 place-items-center rounded-[9px] border-0 bg-transparent text-[#777777] transition-colors hover:bg-[#1e1e1e]">
            {chatMode === 'development' ? <MessageSquarePlus size={13} strokeWidth={1.8} style={{ color: modeHovered ? '#eeeeee' : '#777777' }} /> : <Target size={13} strokeWidth={1.8} style={{ color: modeHovered ? '#eeeeee' : '#777777' }} />}
          </button>
          {recentChats.map((chat) => (
            <button key={`${chat.projectPath}:${chat.id}`} type="button" aria-label={`Abrir ${chat.name}`} title={chat.name} onClick={() => openDockChat(chat)} className="grid h-7 w-7 place-items-center rounded-[9px] border-0 bg-[#1e1e1e] text-[10px] font-medium uppercase text-[#777777] transition-colors hover:bg-[#2c2c2c] hover:text-[#eeeeee]">
              {chat.name.trim().charAt(0).toUpperCase() || '?'}
            </button>
          ))}
          <button type="button" aria-label="Terminal" title="Terminal" onClick={() => window.dispatchEvent(new CustomEvent('codeclub:open-terminal-dock', { detail: { toggle: true } }))} className="grid h-7 w-7 place-items-center rounded-[9px] border-0 bg-transparent text-[#777777] transition-colors hover:bg-[#1e1e1e] hover:text-[#eeeeee]"><Terminal size={14} strokeWidth={1.8} /></button>
        </div>
        </div>
        {projectPickerOpen && <div className="absolute left-1/2 top-12 z-50 grid w-[230px] -translate-x-1/2 gap-1 rounded-xl border border-[#2b2b2b] bg-[#121212] p-1.5" onClick={(event) => event.stopPropagation()}>
          {availableProjects.length === 0 ? <div className="px-3 py-2 text-[11px] text-[#777777]">No hay proyectos indexados</div> : availableProjects.map((project) => <button key={project.path} type="button" onClick={() => selectActiveProject(project)} className="flex min-h-[32px] items-center gap-2 rounded-lg border-0 bg-transparent px-2.5 text-left text-xs text-[#bdbdbd] hover:bg-[#1e1e1e] hover:text-[#eeeeee]"><Folder size={14} /><span className="min-w-0 flex-1 truncate">{project.name}</span></button>)}
        </div>}
      </div>
      <div className="workspace-pane acrylic-panel min-h-0 min-w-0 flex-1 overflow-hidden">
        {showProjects ? <ProjectsPanel /> : showBusinesses ? <BusinessPanel /> : <ChatInterface
          catalog={catalog}
          defaultProvider={defaultProvider}
          defaultModel={defaultModel}
          panelId="left"
          eventPrefix="codeclub:panel-left"
          selectedProject={selectedProject}
          blockedPanelState="blank"
        />}
      </div>
    </div>
  );
}
