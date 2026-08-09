import React, { useEffect, useRef, useState } from 'react';
import { Folder } from 'lucide-react';
import { activeChatStore } from '../lib/store';
import ChatInterface from './ChatInterface.tsx';
import ProjectsPanel from './ProjectsPanel.tsx';
import ExtensionsPanel from './ExtensionsPanel.tsx';
import SettingsPanel from './SettingsPanel.tsx';
import { readProjectIndex, type ProjectEntry } from '../lib/projectManager';

type SelectedProject = { projectPath: string; projectName?: string };

export default function WorkspaceManager({ catalog, defaultProvider, defaultModel, initialView = 'projects' }: { catalog: any; defaultProvider: any; defaultModel: any; initialView?: 'projects' | 'chat' }) {
  const [selectedProject, setSelectedProject] = useState<SelectedProject | null>(null);
  const [showProjects, setShowProjects] = useState(initialView !== 'chat');
  const [showExtensions, setShowExtensions] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [availableProjects, setAvailableProjects] = useState<ProjectEntry[]>([]);
  const pendingChatRef = useRef<any>(null);
  const [chatOpenVersion, setChatOpenVersion] = useState(0);

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
    };
    const handleOpenSettings = () => { setShowProjects(false); setShowExtensions(false); setShowSettings(true); setSelectedProject(null); };
    const handleOpenChat = (event: Event) => {
      pendingChatRef.current = (event as CustomEvent).detail || null;
      setShowProjects(false);
      setShowExtensions(false);
      setShowSettings(false);
      setChatOpenVersion((version) => version + 1);
    };
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
    if (showProjects || showExtensions || showSettings || !pendingChatRef.current) return;
    const detail = pendingChatRef.current;
    pendingChatRef.current = null;
    const timer = window.setTimeout(() => window.dispatchEvent(new CustomEvent('codeclub:panel-left:open-chat', { detail })), 0);
    return () => window.clearTimeout(timer);
  }, [showProjects, showExtensions, showSettings, chatOpenVersion]);

  useEffect(() => {
    if (!showProjects && !showExtensions && !showSettings && !activeChatStore.get().id) window.dispatchEvent(new CustomEvent('codeclub:open-empty-chat'));
  }, [showProjects, showExtensions, showSettings]);

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
      <div className="absolute left-0 top-0 z-[60] h-12 w-full" role="toolbar" aria-label="Accesos rápidos">
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
