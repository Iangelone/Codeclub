import { getDesktopBridge } from '../lib/runtime';
/** Creates, selects, renames, and indexes local projects; project files stay behind the Electron bridge. */
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Folder } from 'lucide-react';
import { usePopupKeyboard } from './ui/use-accessible-overlay';
import { activeChatStore } from '../lib/store';
import ChatInterface from './ChatInterface.tsx';
import ExtensionsPanel from './ExtensionsPanel.tsx';
import { readProjectIndex, type ProjectEntry } from '../lib/projectManager';
import { useAppLanguage, translate, getMessages } from '../lib/i18n';

type SelectedProject = { projectPath: string; projectName?: string };

function WorkspaceManager({ catalog, defaultProvider, defaultModel }: { catalog: any; defaultProvider: any; defaultModel: any }) {
  const language = useAppLanguage();
  const text = getMessages('sidebar', language);
  const [selectedProject, setSelectedProject] = useState<SelectedProject | null>(null);
  const selectedProjectRef = useRef<SelectedProject | null>(null);
  const updateSelectedProject = useCallback((project: SelectedProject | null) => {
    selectedProjectRef.current = project;
    setSelectedProject(project);
  }, []);
  const [showExtensions, setShowExtensions] = useState(false);
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const projectPickerRef = useRef<HTMLDivElement>(null);
  usePopupKeyboard(projectPickerRef, projectPickerOpen, () => setProjectPickerOpen(false));
  useEffect(() => {
    if (!projectPickerOpen) return;
    const close = (event: PointerEvent) => { if (!projectPickerRef.current?.contains(event.target as Node)) setProjectPickerOpen(false); };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [projectPickerOpen]);
  const [availableProjects, setAvailableProjects] = useState<ProjectEntry[]>([]);
  const pendingChatRef = useRef<any>(null);
  const preserveSectionRef = useRef(false);
  const [chatOpenVersion, setChatOpenVersion] = useState(0);
  const panelNavigation = useRef<{ entries: string[]; index: number; moving: boolean; chats: Record<string, any> }>({ entries: ['new-chat'], index: 0, moving: false, chats: {} });

  useEffect(()=>{
    let active=true,polling=false,lastId='';
    // Open the next eligible mobile conversation; ChatInterface owns claiming and execution.
    const poll=async()=>{if(polling)return;polling=true;try{const next=await getDesktopBridge()?.mobileNext?.();if(active&&next&&next.id!==lastId){lastId=next.id;window.dispatchEvent(new CustomEvent('codeclub:open-chat',{detail:next.chat}));}if(!next)lastId='';}catch{/* Reconnect on the next poll. */}finally{polling=false;}};
    const timer=window.setInterval(()=>void poll(),1000);void poll();
    return()=>{active=false;window.clearInterval(timer);};
  },[]);

  useEffect(() => {
    const open = (chat: any) => { if (chat?.chatId) window.dispatchEvent(new CustomEvent('codeclub:open-chat', { detail: chat })); };
    const bridge = getDesktopBridge();
    const unsubscribe = bridge?.onSessionOpen?.(open);
    const shown = bridge?.onMainShow?.(() => { void bridge.sessionSelected?.().then(open); });
    return () => { unsubscribe?.(); shown?.(); };
  }, []);

  useEffect(() => {
    const handleProjectPanelSelection = (event: Event) => {
      const detail = (event as CustomEvent).detail || {};
      if (!detail.projectPath) {
        updateSelectedProject(null);
        return;
      }
      updateSelectedProject({ projectPath: detail.projectPath, projectName: detail.projectName });
    };
    const handleProjectSelection = (event: Event) => {
      const detail = (event as CustomEvent).detail || {};
      updateSelectedProject(detail.selected === true && detail.projectPath
        ? { projectPath: detail.projectPath, projectName: detail.projectName }
        : null);
    };

    const handleActiveProject = (event: Event) => {
      const detail = (event as CustomEvent).detail || {};
      if (detail.projectPath) updateSelectedProject({ projectPath: detail.projectPath, projectName: detail.projectName });
      else if (Object.prototype.hasOwnProperty.call(detail, 'projectPath')) updateSelectedProject(null);
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
    const projectChanged = selectedProject?.projectPath !== project.path;
    setProjectPickerOpen(false);
    window.dispatchEvent(new CustomEvent('codeclub:project-selection-changed', {
      detail: { selected: Boolean(project.path), keepChat: !project.path, projectPath: project.path, projectName: project.name },
    }));
    window.dispatchEvent(new CustomEvent('codeclub:active-project', {
      detail: { projectPath: project.path || null, projectName: project.name },
    }));
    if (projectChanged) window.dispatchEvent(new CustomEvent('codeclub:open-empty-chat'));
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
    const handleCloseExtensions = (event: Event) => {
      preserveSectionRef.current = Boolean((event as CustomEvent).detail?.preserveSection);
      setShowExtensions(false);
      if (preserveSectionRef.current) return;
      const project = selectedProjectRef.current;
      const chatId = activeChatStore.get().id;
      const detail = { chatId, projectPath: project?.projectPath || '', projectName: project?.projectName || 'Home' };
      const key = chatId ? `chat:${JSON.stringify([detail.projectPath, chatId])}` : `draft:${detail.projectPath}`;
      visit(key, panelNavigation.current.chats[key] || detail);
    };
    const handleOpenChat = (event: Event) => {
      const detail = (event as CustomEvent).detail || {};
      pendingChatRef.current = detail;
      setShowExtensions(false);
      visit(detail.chatId ? `chat:${JSON.stringify([detail.projectPath || '', detail.chatId])}` : 'new-chat', detail);
      setChatOpenVersion((version) => version + 1);
    };
    const handleNavigateNewChat = () => {
      pendingChatRef.current = null;
      setShowExtensions(false);
      const project = selectedProjectRef.current;
      const key = project?.projectPath ? `draft:${project.projectPath}` : 'new-chat';
      visit(key, { projectPath: project?.projectPath || '', projectName: project?.projectName || 'Home' });
      window.dispatchEvent(new CustomEvent('codeclub:open-empty-chat'));
    };
    const handleOpenEmptyChat = () => {
      pendingChatRef.current = null;
      setShowExtensions(false);
      const project = selectedProjectRef.current;
      const key = project?.projectPath ? `draft:${project.projectPath}` : 'new-chat';
      visit(key, { projectPath: project?.projectPath || '', projectName: project?.projectName || 'Home' });
    };
    const move = (direction: -1 | 1) => {
      const navigation = panelNavigation.current;
      const nextIndex = navigation.index + direction;
      if (nextIndex < 0 || nextIndex >= navigation.entries.length) return;
      const key = navigation.entries[nextIndex];
      navigation.index = nextIndex;
      navigation.moving = true;
      if (key === 'extensions') { navigation.moving = false; window.dispatchEvent(new CustomEvent('codeclub:open-extensions')); }
      else if (key === 'new-chat' || key.startsWith('draft:')) {
        const project = navigation.chats[key];
        window.dispatchEvent(new CustomEvent('codeclub:project-switch', { detail: { id: project?.projectPath || 'home', path: project?.projectPath || '', name: project?.projectName || 'Home' } }));
      }
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
    window.addEventListener('codeclub:left-panel-back', handleBack);
    window.addEventListener('codeclub:left-panel-forward', handleForward);
    window.addEventListener('codeclub:left-panel-navigation-request', handleNavigationRequest);
    return () => {
      window.removeEventListener('codeclub:open-extensions', handleOpenExtensions);
      window.removeEventListener('codeclub:close-extensions', handleCloseExtensions);
      window.removeEventListener('codeclub:open-empty-chat', handleOpenEmptyChat);
      window.removeEventListener('codeclub:open-chat', handleOpenChat);
      window.removeEventListener('codeclub:navigate-new-chat', handleNavigateNewChat);
      window.removeEventListener('codeclub:left-panel-back', handleBack);
      window.removeEventListener('codeclub:left-panel-forward', handleForward);
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
      <div className="absolute left-0 top-0 z-[60] h-12 w-full" role="toolbar" aria-label={translate('workspaceManager.quickAccess', language)}>
        {projectPickerOpen && <div ref={projectPickerRef} role="menu" aria-label={text.projects} className="absolute left-1/2 top-12 z-50 grid w-[230px] -translate-x-1/2 gap-1 rounded-xl border border-[#2b2b2b] bg-[#121212] p-1.5" onClick={(event) => event.stopPropagation()}>
          <button type="button" role="menuitemradio" aria-checked={!selectedProject?.projectPath} onClick={() => selectActiveProject({ path: '', name: translate('workspaceManager.noProject', language) })} className="flex min-h-[32px] items-center gap-2 rounded-lg border-0 bg-transparent px-2.5 text-left text-xs text-[#bdbdbd] hover:bg-[#1e1e1e] hover:text-[#eeeeee]"><Folder size={14} aria-hidden="true" /><span className="min-w-0 flex-1 truncate">{translate('workspaceManager.noProject', language)}</span></button>
          {availableProjects.length === 0 ? <div className="px-3 py-2 text-[11px] text-[#999999]">{translate('workspaceManager.noIndexedProjects', language)}</div> : availableProjects.map((project) => <button key={project.path} type="button" role="menuitemradio" aria-checked={selectedProject?.projectPath === project.path} onClick={() => selectActiveProject(project)} className="flex min-h-[32px] items-center gap-2 rounded-lg border-0 bg-transparent px-2.5 text-left text-xs text-[#bdbdbd] hover:bg-[#1e1e1e] hover:text-[#eeeeee]"><Folder size={14} aria-hidden="true" /><span className="min-w-0 flex-1 truncate">{project.name}</span></button>)}
        </div>}
      </div>
      <div className={`workspace-pane acrylic-panel min-h-0 min-w-0 flex-1 ${showExtensions ? 'overflow-hidden bg-(--codeclub-center)' : 'overflow-visible bg-transparent'}`}>
        <div className="workspace-panel-content h-full min-h-0 min-w-0 overflow-visible bg-transparent">
          {showExtensions && <ExtensionsPanel selectedProject={selectedProject} />}
          <div className="h-full min-h-0" style={{display:showExtensions?'none':undefined}}><ChatInterface
            catalog={catalog}
            defaultProvider={defaultProvider}
            defaultModel={defaultModel}
            panelId="left"
            eventPrefix="codeclub:panel-left"
            selectedProject={selectedProject}
            blockedPanelState="blank"
          /></div>
        </div>
      </div>
    </div>
  );
}

export default memo(WorkspaceManager);
