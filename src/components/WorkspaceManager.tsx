import { useEffect, useRef, useState } from 'react';
import { Folder } from 'lucide-react';
import { activeChatStore } from '../lib/store';
import ChatInterface from './ChatInterface.tsx';
import ExtensionsPanel from './ExtensionsPanel.tsx';
import { readProjectIndex, type ProjectEntry } from '../lib/projectManager';

type SelectedProject = { projectPath: string; projectName?: string };

export default function WorkspaceManager({ catalog, defaultProvider, defaultModel }: { catalog: any; defaultProvider: any; defaultModel: any }) {
  const [selectedProject, setSelectedProject] = useState<SelectedProject | null>(null);
  const [showExtensions, setShowExtensions] = useState(false);
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [availableProjects, setAvailableProjects] = useState<ProjectEntry[]>([]);
  const pendingChatRef = useRef<any>(null);
  const preserveSectionRef = useRef(false);
  const [chatOpenVersion, setChatOpenVersion] = useState(0);
  const panelNavigation = useRef<{ entries: string[]; index: number; moving: boolean; chats: Record<string, any> }>({ entries: ['new-chat'], index: 0, moving: false, chats: {} });

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
    };

    const handleActiveProject = (event: Event) => {
      const detail = (event as CustomEvent).detail || {};
      if (detail.projectPath) setSelectedProject({ projectPath: detail.projectPath, projectName: detail.projectName });
      else if (Object.prototype.hasOwnProperty.call(detail, 'projectPath')) setSelectedProject(null);
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
    const publishNavigationState = () => {
      const navigation = panelNavigation.current;
      window.dispatchEvent(new CustomEvent('codeclub:left-panel-navigation-state', { detail: { back: navigation.index > 0, forward: navigation.index < navigation.entries.length - 1 } }));
    };
    const visit = (key: string, detail?: any) => {
      const navigation = panelNavigation.current;
      if (detail) navigation.chats[key] = detail;
      if (navigation.moving) { navigation.moving = false; publishNavigationState(); return; }
      if (navigation.entries[navigation.index] !== key) {
        navigation.entries = navigation.entries.slice(0, navigation.index + 1);
        navigation.entries.push(key);
        navigation.index = navigation.entries.length - 1;
      }
      publishNavigationState();
    };
    const handleOpenExtensions = () => {
      setShowExtensions(true);
      visit('extensions');
    };
    const handleCloseExtensions = (event: Event) => { preserveSectionRef.current = Boolean((event as CustomEvent).detail?.preserveSection); setShowExtensions(false); visit(activeChatStore.get().id ? `chat:${activeChatStore.get().id}` : 'new-chat'); };
    const handleOpenChat = (event: Event) => {
      const detail = (event as CustomEvent).detail || {};
      pendingChatRef.current = detail;
      setShowExtensions(false);
      visit(detail.chatId ? `chat:${detail.chatId}` : 'new-chat', detail);
      setChatOpenVersion((version) => version + 1);
    };
    const handleNavigateNewChat = () => {
      if (showExtensions) {
        setShowExtensions(false);
        visit(activeChatStore.get().id ? `chat:${activeChatStore.get().id}` : 'new-chat');
        return;
      }
      if (activeChatStore.get().id) window.dispatchEvent(new CustomEvent('codeclub:open-empty-chat'));
    };
    const handleOpenEmptyChat = () => { setShowExtensions(false); visit('new-chat'); };
    const move = (direction: -1 | 1) => {
      const navigation = panelNavigation.current;
      const nextIndex = navigation.index + direction;
      if (nextIndex < 0 || nextIndex >= navigation.entries.length) return;
      const key = navigation.entries[nextIndex];
      navigation.index = nextIndex;
      navigation.moving = true;
      if (key === 'extensions') { navigation.moving = false; window.dispatchEvent(new CustomEvent('codeclub:open-extensions')); }
      else if (key === 'new-chat') window.dispatchEvent(new CustomEvent('codeclub:open-empty-chat'));
      else if (navigation.chats[key]) window.dispatchEvent(new CustomEvent('codeclub:open-chat', { detail: navigation.chats[key] }));
      publishNavigationState();
    };
    const handleBack = () => move(-1);
    const handleForward = () => move(1);
    const handleNavigationRequest = () => publishNavigationState();
    window.addEventListener('codeclub:open-chat', handleOpenChat);
    window.addEventListener('codeclub:navigate-new-chat', handleNavigateNewChat);
    window.addEventListener('codeclub:open-extensions', handleOpenExtensions);
    window.addEventListener('codeclub:close-extensions', handleCloseExtensions);
    window.addEventListener('codeclub:open-empty-chat', handleOpenEmptyChat);
    window.addEventListener('codeclub:right-panel-back', handleBack);
    window.addEventListener('codeclub:right-panel-forward', handleForward);
    window.addEventListener('codeclub:left-panel-navigation-request', handleNavigationRequest);
    return () => {
      window.removeEventListener('codeclub:open-extensions', handleOpenExtensions);
      window.removeEventListener('codeclub:close-extensions', handleCloseExtensions);
      window.removeEventListener('codeclub:open-empty-chat', handleOpenEmptyChat);
      window.removeEventListener('codeclub:open-chat', handleOpenChat);
      window.removeEventListener('codeclub:navigate-new-chat', handleNavigateNewChat);
      window.removeEventListener('codeclub:right-panel-back', handleBack);
      window.removeEventListener('codeclub:right-panel-forward', handleForward);
      window.removeEventListener('codeclub:left-panel-navigation-request', handleNavigationRequest);
    };
  }, [showExtensions]);

  useEffect(() => {
    if (showExtensions || !pendingChatRef.current) return;
    const detail = pendingChatRef.current;
    pendingChatRef.current = null;
    const timer = window.setTimeout(() => window.dispatchEvent(new CustomEvent('codeclub:panel-left:open-chat', { detail })), 0);
    return () => window.clearTimeout(timer);
  }, [showExtensions, chatOpenVersion]);

  useEffect(() => {
    if (preserveSectionRef.current) { preserveSectionRef.current = false; return; }
    if (!showExtensions && !pendingChatRef.current && !activeChatStore.get().id) window.dispatchEvent(new CustomEvent('codeclub:open-empty-chat'));
  }, [showExtensions]);

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
      <div className={`workspace-pane acrylic-panel min-h-0 min-w-0 flex-1 ${showExtensions ? 'overflow-hidden bg-(--codeclub-center)' : 'overflow-visible bg-transparent'}`}>
        <div key={showExtensions ? 'extensions' : 'chat'} className={`workspace-panel-content h-full min-h-0 min-w-0 ${showExtensions ? 'overflow-hidden bg-(--codeclub-center)' : 'overflow-visible bg-transparent'}`}>
          {showExtensions ? <ExtensionsPanel selectedProject={selectedProject} /> : <ChatInterface
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
