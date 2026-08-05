import React, { useEffect, useState } from 'react';
import { Cpu, Folder, House, Play, Server, Terminal, X } from 'lucide-react';
import { activeChatStore, chatsStore, type GlobalChat } from '../lib/store';
import ChatInterface from './ChatInterface.tsx';
import ProjectsPanel from './ProjectsPanel.tsx';
import ExtensionsPanel from './ExtensionsPanel.tsx';
import SettingsPanel from './SettingsPanel.tsx';
import { readProjectIndex, type ProjectEntry } from '../lib/projectManager';

type SelectedProject = { projectPath: string; projectName?: string };
const CHAT_AVATAR_GRADIENT = 'linear-gradient(145deg, #8BC7FF 0%, #3D9BFF 44%, #1687FF 100%)';

export default function WorkspaceManager({ catalog, defaultProvider, defaultModel }) {
  const [selectedProject, setSelectedProject] = useState<SelectedProject | null>(null);
  const [showProjects, setShowProjects] = useState(true);
  const [showExtensions, setShowExtensions] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [dockVisible, setDockVisible] = useState(false);
  const [commandMenuKind, setCommandMenuKind] = useState('');
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [availableProjects, setAvailableProjects] = useState<ProjectEntry[]>([]);
  const [recentChats, setRecentChats] = useState<GlobalChat[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | undefined>(activeChatStore.get().id);

  useEffect(() => {
    const updateRecentChats = (chats: GlobalChat[]) => {
      const recent = chats.slice(-3).reverse();
      setRecentChats(recent);
      window.dispatchEvent(new CustomEvent('codeclub:recent-chats-changed', { detail: { chats: recent } }));
    };
    updateRecentChats(chatsStore.get());
    const unsubscribe = chatsStore.subscribe(updateRecentChats);
    return () => { unsubscribe(); };
  }, []);

  useEffect(() => {
    const handleProjectPanelSelection = (event: Event) => {
      const detail = (event as CustomEvent).detail || {};
      if (!detail.projectPath) {
        setSelectedProject(null);
        return;
      }
      setSelectedProject({ projectPath: detail.projectPath, projectName: detail.projectName });
    };
    const handleProjectSelection = (event: Event) => {
      const detail = (event as CustomEvent).detail || {};
      setSelectedProject(detail.selected === true && detail.projectPath
        ? { projectPath: detail.projectPath, projectName: detail.projectName }
        : null);
      setShowProjects(detail.selected !== true && detail.keepChat !== true && detail.keepView !== true);
    };

    const handleActiveProject = (event: Event) => {
      const detail = (event as CustomEvent).detail || {};
      if (detail.projectPath) setSelectedProject({ projectPath: detail.projectPath, projectName: detail.projectName });
      if (detail.projectPath) setShowProjects(false);
      else if (Object.prototype.hasOwnProperty.call(detail, 'projectPath')) { setSelectedProject(null); setShowProjects(false); }
    };

    window.addEventListener('codeclub:project-panel-selected', handleProjectPanelSelection);
    window.addEventListener('codeclub:project-selection-changed', handleProjectSelection);
    window.addEventListener('codeclub:active-project', handleActiveProject);
    return () => {
      window.removeEventListener('codeclub:project-panel-selected', handleProjectPanelSelection);
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
      detail: { selected: Boolean(project.path), keepChat: !project.path, projectPath: project.path, projectName: project.name },
    }));
    window.dispatchEvent(new CustomEvent('codeclub:active-project', {
      detail: { projectPath: project.path || null, projectName: project.name },
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
      setShowExtensions(false);
      setShowSettings(false);
      setSelectedProject(null);
    };
    const handleOpenExtensions = () => {
      setShowExtensions(true);
      setShowProjects(false);
      setShowSettings(false);
      setSelectedProject(null);
    };
    const handleOpenSettings = () => { setShowProjects(false); setShowExtensions(false); setShowSettings(true); setSelectedProject(null); };
    const handleOpenChat = () => { setShowProjects(false); setShowExtensions(false); setShowSettings(false); };
    const handleOpenEmptyChat = () => { setShowProjects(false); setShowExtensions(false); setShowSettings(false); };
    window.addEventListener('codeclub:open-chat', handleOpenChat);
    window.addEventListener('codeclub:open-projects', handleOpenProjects);
    window.addEventListener('codeclub:open-extensions', handleOpenExtensions);
    window.addEventListener('codeclub:open-settings', handleOpenSettings);
    window.addEventListener('codeclub:open-empty-chat', handleOpenEmptyChat);
    return () => {
      window.removeEventListener('codeclub:open-projects', handleOpenProjects);
      window.removeEventListener('codeclub:open-extensions', handleOpenExtensions);
      window.removeEventListener('codeclub:open-settings', handleOpenSettings);
      window.removeEventListener('codeclub:open-empty-chat', handleOpenEmptyChat);
      window.removeEventListener('codeclub:open-chat', handleOpenChat);
    };
  }, []);

  useEffect(() => {
    if (!showProjects && !showExtensions && !showSettings && !activeChatStore.get().id) window.dispatchEvent(new CustomEvent('codeclub:open-empty-chat'));
  }, [showProjects, showExtensions, showSettings]);

  useEffect(() => {
    const toggleDock = () => setDockVisible((visible) => !visible);
    window.addEventListener('codeclub:toggle-panel-dock', toggleDock);
    return () => window.removeEventListener('codeclub:toggle-panel-dock', toggleDock);
  }, []);

  useEffect(() => activeChatStore.subscribe((chat) => setActiveChatId(chat.id)), []);

  useEffect(() => {
    const handleCommandMenuState = (event: Event) => {
      const detail = (event as CustomEvent).detail || {};
      setCommandMenuKind(detail.open ? detail.kind || '' : '');
    };
    window.addEventListener('codeclub:command-menu-state', handleCommandMenuState);
    return () => window.removeEventListener('codeclub:command-menu-state', handleCommandMenuState);
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
        <div className={`codeclub-motion-panel absolute left-1/2 top-1 flex h-11 -translate-x-1/2 items-start justify-center rounded-2xl px-1.5 pt-1.5 ${dockVisible ? 'pointer-events-auto translate-y-0 scale-100 opacity-100' : 'pointer-events-none translate-y-0 scale-100 opacity-0'}`}>
        <div className="flex items-center gap-1 rounded-[14px] border border-[#3A3A3A] bg-[#2F2F2F] p-1">
          <button type="button" aria-label="Nuevo chat" title="Nuevo chat" onClick={() => window.dispatchEvent(new CustomEvent('codeclub:request-new-chat'))} className="grid h-7 w-7 place-items-center rounded-[9px] border-0 bg-transparent text-[#777777] transition-colors hover:bg-[#1e1e1e] hover:text-[#eeeeee]"><House size={14} strokeWidth={1.8} /></button>
          <button type="button" aria-pressed={commandMenuKind === 'provider'} aria-label={`Proveedor: ${commandMenuKind === 'provider' ? 'Activo' : 'Desactivado'}`} title={`Proveedor: ${commandMenuKind === 'provider' ? 'Activo' : 'Desactivado'}`} onClick={() => window.dispatchEvent(new CustomEvent('codeclub:open-command-menu', { detail: { kind: 'provider' } }))} className={`grid h-7 w-7 place-items-center rounded-[9px] border-0 transition-colors ${commandMenuKind === 'provider' ? 'bg-[#1e1e1e] text-[#eeeeee]' : 'bg-transparent text-[#777777] hover:bg-[#1e1e1e] hover:text-[#eeeeee]'}`}><Server size={14} strokeWidth={1.8} /></button>
          <button type="button" aria-pressed={commandMenuKind === 'model'} aria-label={`Modelo: ${commandMenuKind === 'model' ? 'Activo' : 'Desactivado'}`} title={`Modelo: ${commandMenuKind === 'model' ? 'Activo' : 'Desactivado'}`} onClick={() => window.dispatchEvent(new CustomEvent('codeclub:open-command-menu', { detail: { kind: 'model' } }))} className={`grid h-7 w-7 place-items-center rounded-[9px] border-0 transition-colors ${commandMenuKind === 'model' ? 'bg-[#1e1e1e] text-[#eeeeee]' : 'bg-transparent text-[#777777] hover:bg-[#1e1e1e] hover:text-[#eeeeee]'}`}><Cpu size={14} strokeWidth={1.8} /></button>
          <button type="button" aria-pressed={commandMenuKind === 'project'} aria-label={`Proyecto: ${commandMenuKind === 'project' ? 'Activo' : 'Desactivado'}`} title={`Proyecto: ${commandMenuKind === 'project' ? 'Activo' : 'Desactivado'}`} onClick={() => window.dispatchEvent(new CustomEvent('codeclub:open-command-menu', { detail: { kind: 'project' } }))} className={`grid h-7 w-7 place-items-center rounded-[9px] border-0 transition-colors ${commandMenuKind === 'project' ? 'bg-[#1e1e1e] text-[#eeeeee]' : 'bg-transparent text-[#777777] hover:bg-[#1e1e1e] hover:text-[#eeeeee]'}`}><Folder size={14} strokeWidth={1.8} /></button>
          {recentChats.map((chat) => (
            <button key={`${chat.projectPath}:${chat.id}`} type="button" aria-label={`Abrir ${chat.name}`} title={chat.name} onClick={() => openDockChat(chat)} className="codeclub-motion-control grid h-7 w-7 place-items-center rounded-[9px] border-0 bg-transparent hover:bg-[#1e1e1e] hover:scale-[1.04]">
              <span className="grid h-5 w-5 place-items-center rounded-[6px] text-[8px] font-medium uppercase transition-shadow" style={{ background: activeChatId === chat.id ? CHAT_AVATAR_GRADIENT : '#343434', color: activeChatId === chat.id ? '#ffffff' : '#777777', boxShadow: activeChatId === chat.id ? '0 0 8px rgba(45,145,255,0.42)' : 'inset 0 1px rgba(255,255,255,0.08)' }}>{chat.name.trim().charAt(0).toUpperCase() || '?'}</span>
            </button>
          ))}
        </div>
        </div>
        {projectPickerOpen && <div className="absolute left-1/2 top-12 z-50 grid w-[230px] -translate-x-1/2 gap-1 rounded-xl border border-[#2b2b2b] bg-[#121212] p-1.5" onClick={(event) => event.stopPropagation()}>
          <button type="button" onClick={() => selectActiveProject({ path: '', name: 'Sin proyecto' })} className="flex min-h-[32px] items-center gap-2 rounded-lg border-0 bg-transparent px-2.5 text-left text-xs text-[#bdbdbd] hover:bg-[#1e1e1e] hover:text-[#eeeeee]"><Folder size={14} /><span className="min-w-0 flex-1 truncate">Sin proyecto</span></button>
          {availableProjects.length === 0 ? <div className="px-3 py-2 text-[11px] text-[#777777]">No hay proyectos indexados</div> : availableProjects.map((project) => <button key={project.path} type="button" onClick={() => selectActiveProject(project)} className="flex min-h-[32px] items-center gap-2 rounded-lg border-0 bg-transparent px-2.5 text-left text-xs text-[#bdbdbd] hover:bg-[#1e1e1e] hover:text-[#eeeeee]"><Folder size={14} /><span className="min-w-0 flex-1 truncate">{project.name}</span></button>)}
        </div>}
      </div>
      <div className="workspace-pane acrylic-panel min-h-0 min-w-0 flex-1 overflow-hidden">
        <div key={showProjects ? 'projects' : showExtensions ? 'extensions' : showSettings ? 'settings' : 'chat'} className="workspace-panel-content h-full min-h-0 min-w-0">
          {showProjects ? <ProjectsPanel /> : showExtensions ? <ExtensionsPanel selectedProject={selectedProject} /> : showSettings ? <SettingsPanel /> : <ChatInterface
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
    </div>
  );
}

function DeveloperLoopPreviewLegacy({ onClose }: { onClose: () => void }) {
  const steps = [
    ['1', 'Entender', 'Lee el pedido y el contexto'],
    ['2', 'Planificar', 'Crea pasos y TODOs'],
    ['3', 'Actuar', 'Usa archivos, terminal y herramientas'],
    ['4', 'Verificar', 'Ejecuta checks y revisa resultados'],
    ['5', 'Entregar', 'Resume cambios y próximos pasos'],
  ];
  return <aside className="absolute right-4 top-14 z-[70] w-[320px] rounded-2xl border border-[#2b2b2b] bg-[#121212] p-3 shadow-2xl">
    <div className="mb-3 flex items-center justify-between"><div><div className="text-xs font-medium text-[#eee]">Developer loop</div><div className="mt-1 text-[10px] text-[#666]">Previsualización del agente</div></div><button type="button" onClick={onClose} className="grid h-6 w-6 place-items-center rounded-md border-0 bg-transparent text-[#777] hover:bg-[#1e1e1e] hover:text-white" aria-label="Cerrar preview"><X size={13} /></button></div>
    <div className="mb-3 rounded-xl border border-[#202020] bg-[#161616] p-2.5"><div className="mb-2 flex items-center gap-2 text-[10px] text-[#c7cbff]"><Play size={11} fill="currentColor" /> Chat mockup</div><div className="rounded-lg bg-[#202020] px-2.5 py-2 text-[11px] text-[#ddd]">“Implementá la mejora y verificá que compile.”</div><div className="mt-2 rounded-lg border border-[#2b2b2b] px-2.5 py-2 text-[11px] leading-4 text-[#aaa]">Analizo el proyecto → planifico → ejecuto herramientas → verifico → informo.</div></div>
    <div className="grid gap-1.5">{steps.map(([number, title, description], index) => <div key={number} className="flex items-start gap-2.5 rounded-lg px-2 py-1.5 hover:bg-[#1c1c1c]"><div className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] ${index === 2 ? 'bg-[#c7cbff] text-[#181818]' : 'bg-[#202020] text-[#999]'}`}>{number}</div><div><div className="text-[11px] text-[#ddd]">{title}</div><div className="text-[10px] text-[#666]">{description}</div></div></div>)}</div>
  </aside>;
}

function DeveloperLoopPreviewOld({ onClose }: { onClose: () => void }) {
  const [selectedAskOption, setSelectedAskOption] = useState<string | null>(null);
  const messages = [
    { role: 'user', text: 'Implementá la mejora y verificá que compile.' },
    { role: 'assistant', label: 'Entender', text: 'Reviso el pedido, el proyecto activo y los archivos relacionados.' },
    { role: 'event', label: 'TODO', text: '1. Inspeccionar componentes\n2. Implementar el cambio\n3. Ejecutar verificaciones' },
    { role: 'assistant', label: 'Planificar', text: 'Ya tengo el plan. Empiezo por el componente principal y sus estilos.' },
    { role: 'tool', label: 'Acción · archivos', text: 'Abro src/components/ChatInterface.tsx' },
    { role: 'tool', label: 'Terminal', text: '$ bun run typecheck\n> Revisando tipos…' },
    { role: 'assistant', label: 'Ask user', text: 'Encontré dos variantes posibles. ¿Preferís mantener el diseño actual o usar tarjetas más compactas?' },
    { role: 'user', text: 'Mantené el diseño actual y hacelo más claro.' },
    { role: 'tool', label: 'Verificación', text: '$ bun run web:build\n✓ Build completado sin errores' },
    { role: 'assistant', label: 'Entregar', text: 'Listo. Apliqué la mejora, actualicé el TODO y verifiqué que el proyecto compile.' },
  ] as const;

  return <aside className="absolute right-4 top-14 z-[70] flex max-h-[calc(100%-72px)] w-[380px] flex-col overflow-hidden rounded-2xl border border-[#2b2b2b] bg-[#121212] shadow-2xl">
    <div className="flex items-center justify-between border-b border-[#202020] px-3 py-2.5"><div><div className="text-xs font-medium text-[#eee]">Chat mockup</div><div className="mt-0.5 text-[10px] text-[#666]">10 mensajes · solo previsualización · no se guarda</div></div><button type="button" onClick={onClose} className="grid h-6 w-6 place-items-center rounded-md border-0 bg-transparent text-[#777] hover:bg-[#1e1e1e] hover:text-white" aria-label="Cerrar mockup"><X size={13} /></button></div>
    <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
      {messages.map((message, index) => <div key={index} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
        <div className={`max-w-[92%] rounded-xl border px-2.5 py-2 text-[11px] leading-4 whitespace-pre-line ${message.role === 'user' ? 'border-[#34345a] bg-[#242442] text-[#e7e7f4]' : message.role === 'tool' ? 'border-[#29352e] bg-[#18201b] text-[#b9d6c0]' : message.role === 'event' ? 'border-[#493e26] bg-[#211d14] text-[#d6c79e]' : 'border-[#292929] bg-[#1b1b1b] text-[#c7c7c7]'}`}>
          {'label' in message && <div className="mb-1 text-[9px] font-medium uppercase tracking-[0.08em] text-[#888]">{message.label}</div>}
          {message.text}
          {message.label === 'Ask user' && <div className="mt-2 grid grid-cols-2 gap-1.5">
            {['Mantener diseño actual', 'Usar tarjetas compactas'].map((option) => <button key={option} type="button" aria-pressed={selectedAskOption === option} onClick={() => setSelectedAskOption(option)} className={`min-h-[48px] rounded-lg border px-2 text-left text-[10px] transition-colors ${selectedAskOption === option ? 'border-[#8b8fd8] bg-[#30305a] text-white' : 'border-[#353535] bg-[#202020] text-[#bdbdbd] hover:border-[#62629a] hover:bg-[#29294a]'}`}>{option}</button>)}
          </div>}
        </div>
      </div>)}
    </div>
  </aside>;
}
