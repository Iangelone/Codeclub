import React, { useEffect, useState } from 'react';
import { Cpu, House, Server, Terminal } from 'lucide-react';
import { chatsStore, type GlobalChat } from '../lib/store';
import ChatInterface from './ChatInterface.tsx';

type SelectedProject = { projectPath: string; projectName?: string };

export default function WorkspaceManager({ catalog, defaultProvider, defaultModel }) {
  const [selectedProject, setSelectedProject] = useState<SelectedProject | null>(null);
  const [recentChats, setRecentChats] = useState<GlobalChat[]>(() => chatsStore.get().slice(-3).reverse());

  useEffect(() => chatsStore.subscribe((chats) => setRecentChats(chats.slice(-3).reverse())), []);

  useEffect(() => {
    const handleProjectSelection = (event: Event) => {
      const detail = (event as CustomEvent).detail || {};
      setSelectedProject(detail.selected === true && detail.projectPath
        ? { projectPath: detail.projectPath, projectName: detail.projectName }
        : null);
    };

    const handleActiveProject = (event: Event) => {
      const detail = (event as CustomEvent).detail || {};
      if (detail.projectPath) setSelectedProject({ projectPath: detail.projectPath, projectName: detail.projectName });
    };

    window.addEventListener('codeclub:project-selection-changed', handleProjectSelection);
    window.addEventListener('codeclub:active-project', handleActiveProject);
    return () => {
      window.removeEventListener('codeclub:project-selection-changed', handleProjectSelection);
      window.removeEventListener('codeclub:active-project', handleActiveProject);
    };
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
    <div className="workspace-panels relative flex h-full w-full min-w-0 min-h-0 flex-col overflow-hidden">
      <div className="group absolute left-1/2 top-0 z-30 flex h-14 w-[280px] -translate-x-1/2 items-start justify-center" aria-label="Accesos rápidos">
        <div className="pointer-events-none mt-2 flex h-11 items-start justify-center rounded-2xl px-1.5 pt-1.5 opacity-0 shadow-[0_12px_30px_rgba(0,0,0,0.3)] transition-opacity duration-150 group-hover:pointer-events-auto group-hover:opacity-100">
        <div className="flex items-center gap-1 rounded-[14px] border border-[#202020] bg-[#111111]/95 p-1 backdrop-blur-xl">
          <button type="button" aria-label="Chat vacío" title="Chat vacío" onClick={() => window.dispatchEvent(new CustomEvent('codeclub:open-empty-chat'))} className="grid h-7 w-7 place-items-center rounded-[9px] border-0 bg-transparent text-[#777777] transition-colors hover:bg-[#1e1e1e] hover:text-[#eeeeee]"><House size={14} strokeWidth={1.8} /></button>
          <button type="button" aria-label="Seleccionar proveedor" title="Proveedor" onClick={() => window.dispatchEvent(new CustomEvent('codeclub:open-command-menu', { detail: { kind: 'provider' } }))} className="grid h-7 w-7 place-items-center rounded-[9px] border-0 bg-transparent text-[#777777] transition-colors hover:bg-[#1e1e1e] hover:text-[#eeeeee]"><Server size={14} strokeWidth={1.8} /></button>
          <button type="button" aria-label="Seleccionar modelo" title="Modelo" onClick={() => window.dispatchEvent(new CustomEvent('codeclub:open-command-menu', { detail: { kind: 'model' } }))} className="grid h-7 w-7 place-items-center rounded-[9px] border-0 bg-transparent text-[#777777] transition-colors hover:bg-[#1e1e1e] hover:text-[#eeeeee]"><Cpu size={14} strokeWidth={1.8} /></button>
          {recentChats.map((chat) => (
            <button key={`${chat.projectPath}:${chat.id}`} type="button" aria-label={`Abrir ${chat.name}`} title={chat.name} onClick={() => window.dispatchEvent(new CustomEvent('codeclub:open-chat', { detail: { projectPath: chat.projectPath, chatId: chat.id, name: chat.name, projectName: chat.projectName } }))} className="grid h-7 w-7 place-items-center rounded-[9px] border-0 bg-[#1e1e1e] text-[10px] font-medium uppercase text-[#777777] transition-colors hover:bg-[#2c2c2c] hover:text-[#eeeeee]">
              {chat.name.trim().charAt(0).toUpperCase() || '?'}
            </button>
          ))}
          <button type="button" aria-label="Terminal" title="Terminal" onClick={() => window.dispatchEvent(new CustomEvent('codeclub:open-terminal-dock', { detail: { toggle: true } }))} className="grid h-7 w-7 place-items-center rounded-[9px] border-0 bg-transparent text-[#777777] transition-colors hover:bg-[#1e1e1e] hover:text-[#eeeeee]"><Terminal size={14} strokeWidth={1.8} /></button>
        </div>
        </div>
      </div>
      <div className="workspace-pane acrylic-panel min-h-0 min-w-0 flex-1 overflow-hidden">
        <ChatInterface
          catalog={catalog}
          defaultProvider={defaultProvider}
          defaultModel={defaultModel}
          panelId="left"
          eventPrefix="codeclub:panel-left"
          selectedProject={selectedProject}
          blockedPanelState="blank"
        />
      </div>
    </div>
  );
}
