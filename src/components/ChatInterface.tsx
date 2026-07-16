import React, { useState, useRef, useEffect } from 'react';
import { ArrowUpRight, ChevronDown, ChevronRight, Copy, FileCode2, FileText, MessageSquare, RotateCcw, Search, Table2, Terminal, Coffee, Folder, FolderTree, GitCompare, Plus, RefreshCw, X } from 'lucide-react';
import { EditorView, keymap, lineNumbers } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { defaultKeymap, indentWithTab } from '@codemirror/commands';
import { javascript } from '@codemirror/lang-javascript';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { oneDark } from '@codemirror/theme-one-dark';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import ReactMarkdown from 'react-markdown';
import { createTools } from '../lib/engine/tools';
import { runStream } from '../lib/engine/run';

const SPINNER_FRAMES = {
  chat: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧"],
  table: ["⡀", "⡄", "⡆", "⡇", "⣇", "⣧", "⣷", "⣿", "⣷", "⣧", "⣇", "⡇", "⡆", "⡄", "⡀"],
  note: ["⠤", "⠔", "⠒", "⠢", "⠤", "⠠", "⢀", "⡀", "⠄", "⠂", "⠐", "⠈"],
  terminal: ["⡀", "⠄", "⠂", "⠁", "⠈", "⠐", "⠠", "⢀", "⠠", "⠐", "⠈", "⠁", "⠂", "⠄"]
};

const AnimatedBraille = ({ kind }: { kind: keyof typeof SPINNER_FRAMES }) => {
  const [frame, setFrame] = useState(0);
  const [isPaused, setIsPaused] = useState(true);
  const spanRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const btn = spanRef.current?.closest('button');
    if (!btn) return;
    const enter = () => setIsPaused(false);
    const leave = () => setIsPaused(true);
    btn.addEventListener('mouseenter', enter);
    btn.addEventListener('mouseleave', leave);
    return () => {
      btn.removeEventListener('mouseenter', enter);
      btn.removeEventListener('mouseleave', leave);
    };
  }, []);

  useEffect(() => {
    if (isPaused) return;
    const frames = SPINNER_FRAMES[kind];
    const timer = setInterval(() => setFrame((f) => (f + 1) % frames.length), 110);
    return () => clearInterval(timer);
  }, [kind, isPaused]);
  
  return <span ref={spanRef} className="font-mono text-[14px] leading-none text-[#2C2C2C]">{SPINNER_FRAMES[kind][frame]}</span>;
};

const compactJsonExported = (value) => {
  try {
    return JSON.stringify(value).slice(0, 260);
  } catch {
    return String(value).slice(0, 260);
  }
};

const MessageToolSummary = ({ tools, isBusy }) => {
  const [copied, setCopied] = useState(false);
  const toolCounts = {};
  if (Array.isArray(tools)) {
    tools.forEach(t => { toolCounts[t.name] = (toolCounts[t.name] || 0) + 1; });
  }
  const summaryStr = Object.entries(toolCounts).map(([k, v]) => `${k} x${v}`).join(', ');

  if ((!tools || tools.length === 0) && !isBusy) return null;

  const handleCopy = () => {
    if (!Array.isArray(tools)) return;
    const ops = tools.map(t => `[${t.name}] args: ${compactJsonExported(t.input)} result: ${compactJsonExported(t.output)}`);
    navigator.clipboard?.writeText(ops.join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 1000);
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'rgba(216, 216, 216, 0.42)', marginBottom: '4px', marginLeft: '4px', width: '100%' }}>
      <Coffee size={13} style={{ opacity: isBusy ? 0.7 : 0.4 }} />
      <span>{isBusy ? "Agent is thinking and drinking a coffee..." : "Actividad reciente"}</span>
      {summaryStr && (
        <span 
          onClick={handleCopy} 
          style={{ cursor: 'pointer', marginLeft: '2px', color: 'inherit', userSelect: 'none' }}
        >
          {copied ? "Copiado" : summaryStr}
        </span>
      )}
    </div>
  );
};

export default function ChatInterface({ catalog, defaultProvider, defaultModel, panelId = 'left', eventPrefix = 'codeclub', selectedProject, blockedPanelState = 'blank' }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [avatarColor, setAvatarColor] = useState(() => typeof window !== 'undefined' ? localStorage.getItem('codeclub_avatar_color') || '#3b6bb5' : '#3b6bb5');
  const [attachedFiles, setAttachedFiles] = useState<string[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [agentState, setAgentState] = useState('idle');
  const [pendingApprovals, setPendingApprovals] = useState([]);
  const [composerDocked, setComposerDocked] = useState(false);
  const composerDockedRef = useRef(false);

  const [currentProvider, setCurrentProvider] = useState(defaultProvider);
  const [currentModel, setCurrentModel] = useState(defaultModel);
  const [settingsReady, setSettingsReady] = useState(false);
  const [credentialProvider, setCredentialProvider] = useState(null);

  useEffect(() => {
    const handleProfileChange = (event) => setAvatarColor(event.detail?.color || '#3b6bb5');
    window.addEventListener('codeclub:profile-changed', handleProfileChange);
    return () => window.removeEventListener('codeclub:profile-changed', handleProfileChange);
  }, []);

  const [menuOpen, setMenuOpen] = useState(false);
  const [commandKind, setCommandKind] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCommandIndex, setActiveCommandIndex] = useState(0);
  const [activeProject, setActiveProject] = useState<{projectPath: string, name: string} | null>(() => selectedProject ? { projectPath: selectedProject.projectPath, name: selectedProject.projectName || 'Proyecto' } : null);
  const [projectMeta, setProjectMeta] = useState<{chats: any[], notes: any[], tables: any[]} | null>(null);
  const [expandedMenu, setExpandedMenu] = useState<'chat' | 'note' | 'table' | null>(null);
  const [creatingArtifactKind, setCreatingArtifactKind] = useState<'chat' | 'note' | 'table' | null>(null);
  const [newArtifactName, setNewArtifactName] = useState('');
  const [artifactSearch, setArtifactSearch] = useState<Record<string, string>>({});
  const [recentArtifactIds, setRecentArtifactIds] = useState<Record<string, string[]>>({});
  const [terminalCount, setTerminalCount] = useState(0);
  const [changeCount, setChangeCount] = useState(0);
  const [activeChat, setActiveChat] = useState<{chatId: string, projectPath: string} | null>(null);
  const [workspaceMode, setWorkspaceMode] = useState('blank');
  const [activeNote, setActiveNote] = useState<{noteId: string, projectPath: string, name?: string} | null>(null);
  const [activeTable, setActiveTable] = useState<{tableId: string, projectPath: string, name?: string} | null>(null);
  const [titleDraft, setTitleDraft] = useState('');
  const [noteContent, setNoteContent] = useState('');
  const [tableData, setTableData] = useState<string[][]>([]);
  const agentStatusText = {
    idle: "Listo cuando tú lo estés.",
    streaming: "Pensando...",
    tool_call: "Usando herramienta...",
    approval: "Esperando aprobación...",
    running: "Ejecutando...",
    error: "Algo salió mal.",
  }[agentState] || "Listo cuando tú lo estés.";
  const isAgentBusy = ['streaming', 'tool_call', 'approval', 'running'].includes(agentState);
  const noteSaveTimer = useRef(null);
  const tableSaveTimer = useRef(null);
  const approvalResolversRef = useRef(new Map());
  const lastModelFetchRef = useRef(null);
  const commandMenuRef = useRef(null);
  const searchInputRef = useRef(null);
  const chatInputRef = useRef(null);
  const messagesEndRef = useRef(null);
  const restoredProjectRef = useRef('');

  const panelMemoryKey = (projectPath: string) => `codeclub:last-panel:${panelId}:${encodeURIComponent(projectPath)}`;

  const rememberPanel = (kind: 'chat' | 'note' | 'table' | 'diff' | 'folders', detail: any) => {
    if (!detail?.projectPath) return;
    localStorage.setItem(panelMemoryKey(detail.projectPath), JSON.stringify({ kind, detail }));
  };

  const rememberRecentArtifact = (kind: 'chat' | 'note' | 'table', detail: any) => {
    if (!detail?.projectPath || !detail?.[`${kind}Id`]) return;
    const key = `${detail.projectPath}:${kind}`;
    const storageKey = `codeclub:recent-artifacts:${kind}:${encodeURIComponent(detail.projectPath)}`;
    setRecentArtifactIds((current) => {
      const ids = [detail[`${kind}Id`], ...(current[key] || [])].filter((id, index, all) => all.indexOf(id) === index).slice(0, 3);
      localStorage.setItem(storageKey, JSON.stringify(ids));
      return { ...current, [key]: ids };
    });
  };

  const getRecentArtifactIds = (kind: 'chat' | 'note' | 'table', projectPath: string) => {
    const key = `${projectPath}:${kind}`;
    if (recentArtifactIds[key]) return recentArtifactIds[key];
    try {
      return JSON.parse(localStorage.getItem(`codeclub:recent-artifacts:${kind}:${encodeURIComponent(projectPath)}`) || '[]');
    } catch {
      return [];
    }
  };

  const restoreLastPanel = async (project: any) => {
    if (!project?.projectPath || restoredProjectRef.current === project.projectPath) return;
    restoredProjectRef.current = project.projectPath;
    try {
      const raw = localStorage.getItem(panelMemoryKey(project.projectPath));
      if (!raw) {
        setWorkspaceMode('blank');
        return;
      }
      const saved = JSON.parse(raw);
      if (saved.kind === 'diff' || saved.kind === 'folders') {
        window.dispatchEvent(new CustomEvent(`${eventPrefix}:open-${saved.kind}`, { detail: saved.detail }));
        return;
      }
      const { readTextFile, exists } = await import('@tauri-apps/plugin-fs');
      const metaPath = `${project.projectPath}/.codeclub/meta.json`;
      if (!(await exists(metaPath))) throw new Error('Proyecto sin metadatos');
      const meta = JSON.parse(await readTextFile(metaPath));
      const collection = saved.kind === 'chat' ? 'chats' : `${saved.kind}s`;
      const idKey = saved.kind === 'chat' ? 'chatId' : saved.kind === 'note' ? 'noteId' : 'tableId';
      const item = (meta[collection] || []).find((entry: any) => entry.id === saved.detail?.[idKey]);
      if (!item) throw new Error('Panel anterior inexistente');
      window.dispatchEvent(new CustomEvent(`${eventPrefix}:open-${saved.kind}`, {
        detail: { ...saved.detail, name: item.name, projectName: project.projectName || project.name },
      }));
    } catch {
      localStorage.removeItem(panelMemoryKey(project.projectPath));
      setWorkspaceMode('blank');
    }
  };

  useEffect(() => {
    composerDockedRef.current = composerDocked;
  }, [composerDocked]);

  useEffect(() => {
    setActiveProject((current) => {
      if (!selectedProject) return null;
      if (current?.projectPath === selectedProject.projectPath) return current;
      return { projectPath: selectedProject.projectPath, name: selectedProject.projectName || 'Proyecto' };
    });
    if (selectedProject) restoreLastPanel(selectedProject);
  }, [selectedProject]);

  useEffect(() => {
    const handleTerminalCount = (event: Event) => {
      const detail = (event as CustomEvent).detail || {};
      if (!activeProject?.projectPath || detail.projectPath === activeProject.projectPath) {
        setTerminalCount(detail.projectPath ? detail.count || 0 : 0);
      }
    };
    window.addEventListener('codeclub:terminal-count-changed', handleTerminalCount);
    return () => window.removeEventListener('codeclub:terminal-count-changed', handleTerminalCount);
  }, [activeProject]);

  useEffect(() => {
    let cancelled = false;
    const loadChangeCount = async () => {
      if (!activeProject?.projectPath) {
        setChangeCount(0);
        return;
      }
      try {
        const result = await invoke<{ stdout?: string }>('codeclub_run_command', {
          projectPath: activeProject.projectPath,
          request: { command: 'git', args: ['status', '--short'] },
        });
        if (!cancelled) setChangeCount((result.stdout || '').split('\n').filter(Boolean).length);
      } catch {
        if (!cancelled) setChangeCount(0);
      }
    };
    loadChangeCount();
    return () => { cancelled = true; };
  }, [activeProject]);

  useEffect(() => {
    const handleOpenChat = async (e: any) => {
      const chat = e.detail;
      rememberPanel('chat', chat);
      rememberRecentArtifact('chat', chat);
      setWorkspaceMode('chat');
      setActiveChat(chat);
      setAgentState('idle');
      setPendingApprovals([]);
      approvalResolversRef.current.clear();
      const wasDocked = composerDockedRef.current;
      try {
        const { readTextFile, exists } = await import('@tauri-apps/plugin-fs');
        const path = `${chat.projectPath}/.codeclub/chats/${chat.chatId}.jsonl`;
        if (await exists(path)) {
          const content = await readTextFile(path);
          const lines = content.split('\n').filter(l => l.trim() !== '');
          const parsed = lines.map(l => JSON.parse(l));
          setMessages(parsed);
          if (!wasDocked && parsed.length > 0) setComposerDocked(true);
        } else {
          setMessages([]);
        }
      } catch (err) {
        console.error("Error loading chat:", err);
      }
    };
    const eventName = `${eventPrefix}:open-chat`;
    window.addEventListener(eventName, handleOpenChat);
    return () => window.removeEventListener(eventName, handleOpenChat);
  }, [eventPrefix]);

  useEffect(() => {
    const handlers = (['diff', 'folders'] as const).map((kind) => {
      const eventName = `${eventPrefix}:open-${kind}`;
      const handler = (e: any) => {
        rememberPanel(kind, e.detail);
        setWorkspaceMode(kind);
        setActiveProject(e.detail?.projectPath ? {
          projectPath: e.detail.projectPath,
          name: e.detail.projectName || 'Proyecto',
        } : null);
      };
      window.addEventListener(eventName, handler);
      return { eventName, handler };
    });
    return () => handlers.forEach(({ eventName, handler }) => window.removeEventListener(eventName, handler));
  }, [eventPrefix]);

  useEffect(() => {
    const handleActiveProject = (e: any) => {
      setActiveProject((current) => current?.projectPath === e.detail?.projectPath ? current : e.detail);
      setExpandedMenu(null);
      restoreLastPanel(e.detail);
    };
    window.addEventListener('codeclub:active-project', handleActiveProject);

    // Fallback para cuando el panel se monta después del evento (ej. split mode o recarga)
    const selectedProject = document.querySelector<HTMLElement>('.project-card.is-selected');
    if (selectedProject) {
      const projectPath = selectedProject.dataset.path;
      const name = selectedProject.querySelector('.project-row span')?.textContent || 'Proyecto';
      if (projectPath) setActiveProject({ projectPath, name });
    }

    return () => window.removeEventListener('codeclub:active-project', handleActiveProject);
  }, []);

  useEffect(() => {
    if (workspaceMode === 'blank' && activeProject) {
      const loadMeta = async () => {
        try {
          const { readTextFile, exists } = await import('@tauri-apps/plugin-fs');
          const path = `${activeProject.projectPath}/.codeclub/meta.json`;
          if (await exists(path)) {
            setProjectMeta(JSON.parse(await readTextFile(path)));
          } else {
            setProjectMeta(null);
          }
        } catch (e) {
          console.error(e);
          setProjectMeta(null);
        }
      };
      loadMeta();
    }
  }, [workspaceMode, activeProject]);

  useEffect(() => {
    const handleOpenBlank = (event: Event) => {
      const preserveProject = (event as CustomEvent).detail?.preserveProject === true;
      setWorkspaceMode('blank');
      if (!preserveProject) {
        restoredProjectRef.current = '';
        setActiveProject(null);
        setProjectMeta(null);
      }
      setAgentState('idle');
      setPendingApprovals([]);
      approvalResolversRef.current.clear();
      setActiveNote(null);
      setActiveTable(null);
    };

    const handleOpenNote = async (e: any) => {
      const note = e.detail;
      rememberPanel('note', note);
      rememberRecentArtifact('note', note);
      setWorkspaceMode('note');
      setAgentState('idle');
      setPendingApprovals([]);
      approvalResolversRef.current.clear();
      setActiveNote(note);
      setTitleDraft(note.name || 'Nota');
      setActiveTable(null);
      try {
        const { readTextFile, exists } = await import('@tauri-apps/plugin-fs');
        const path = `${note.projectPath}/.codeclub/notes/${note.noteId}.md`;
        setNoteContent((await exists(path)) ? await readTextFile(path) : '');
      } catch (err) {
        console.error("Error loading note:", err);
        setNoteContent('');
      }
    };

    const handleOpenTable = async (e: any) => {
      const table = e.detail;
      rememberPanel('table', table);
      rememberRecentArtifact('table', table);
      setWorkspaceMode('table');
      setAgentState('idle');
      setPendingApprovals([]);
      approvalResolversRef.current.clear();
      setActiveTable(table);
      setTitleDraft(table.name || 'Tabla');
      setActiveNote(null);
      try {
        const { readTextFile, exists } = await import('@tauri-apps/plugin-fs');
        const path = `${table.projectPath}/.codeclub/tables/${table.tableId}.json`;
        const fallback = Array.from({ length: 8 }, () => Array.from({ length: 5 }, () => ''));
        setTableData((await exists(path)) ? JSON.parse(await readTextFile(path)) : fallback);
      } catch (err) {
        console.error("Error loading table:", err);
        setTableData(Array.from({ length: 8 }, () => Array.from({ length: 5 }, () => '')));
      }
    };

    const blankEvent = `${eventPrefix}:open-blank`;
    const noteEvent = `${eventPrefix}:open-note`;
    const tableEvent = `${eventPrefix}:open-table`;
    window.addEventListener(blankEvent, handleOpenBlank);
    window.addEventListener(noteEvent, handleOpenNote);
    window.addEventListener(tableEvent, handleOpenTable);
    return () => {
      window.removeEventListener(blankEvent, handleOpenBlank);
      window.removeEventListener(noteEvent, handleOpenNote);
      window.removeEventListener(tableEvent, handleOpenTable);
    };
  }, [eventPrefix]);

  useEffect(() => {
    const savedProviderId = localStorage.getItem('codeclub_last_provider_id');
    const savedModelId = localStorage.getItem('codeclub_last_model_id');
    const savedProvider = savedProviderId
      ? catalog.find((item) => item.type === 'provider' && item.id === savedProviderId)
      : null;
    const savedModel = savedModelId
      ? catalog.find((item) => item.type === 'model' && item.id === savedModelId)
      : null;

    setCurrentProvider(savedProvider || defaultProvider);
    setCurrentModel(savedModel || defaultModel);
    setSettingsReady(true);
  }, [catalog, defaultProvider, defaultModel]);

  useEffect(() => {
    if (settingsReady && currentProvider) localStorage.setItem('codeclub_last_provider_id', currentProvider.id);
  }, [currentProvider, settingsReady]);

  useEffect(() => {
    if (settingsReady && currentModel) localStorage.setItem('codeclub_last_model_id', currentModel.id);
  }, [currentModel, settingsReady]);

  useEffect(() => {
    const handleRenamedNote = (e: any) => {
      if (!activeNote || e.detail.itemId !== activeNote.noteId || e.detail.projectPath !== activeNote.projectPath) return;
      setActiveNote({ ...activeNote, name: e.detail.name });
      setTitleDraft(e.detail.name);
    };

    const handleRenamedTable = (e: any) => {
      if (!activeTable || e.detail.itemId !== activeTable.tableId || e.detail.projectPath !== activeTable.projectPath) return;
      setActiveTable({ ...activeTable, name: e.detail.name });
      setTitleDraft(e.detail.name);
    };

    window.addEventListener('codeclub:renamed-note', handleRenamedNote);
    window.addEventListener('codeclub:renamed-table', handleRenamedTable);
    return () => {
      window.removeEventListener('codeclub:renamed-note', handleRenamedNote);
      window.removeEventListener('codeclub:renamed-table', handleRenamedTable);
    };
  }, [activeNote, activeTable]);

  const openCommandMenu = (kind) => {
    setCommandKind(kind);
    setMenuOpen(true);
    setSearchQuery('');
    setActiveCommandIndex(0);
    setTimeout(() => commandMenuRef.current?.focus(), 10);
  };

  const filteredCatalog = catalog.filter((item) => {
    const matchesKind = item.type === commandKind;
    const itemLabel = item.label || item.id || '';
    const matchesQuery = itemLabel.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesProvider = commandKind !== 'model' || item.providerId === currentProvider?.id;
    return matchesKind && matchesQuery && matchesProvider;
  });

  useEffect(() => {
    setActiveCommandIndex(0);
  }, [commandKind, searchQuery]);

  useEffect(() => {
    if (!menuOpen) return;
    const activeItem = commandMenuRef.current?.querySelector(`[data-command-index="${activeCommandIndex}"]`);
    activeItem?.scrollIntoView({ block: 'nearest' });
  }, [activeCommandIndex, menuOpen, filteredCatalog.length]);

  useEffect(() => {
    if (!composerDocked) return;
    messagesEndRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [messages, isStreaming, pendingApprovals, composerDocked]);

  useEffect(() => {
    if (!menuOpen) return;

    const handlePointerDown = (event) => {
      if (commandMenuRef.current?.contains(event.target)) return;
      setMenuOpen(false);
    };

    window.addEventListener('pointerdown', handlePointerDown);
    return () => window.removeEventListener('pointerdown', handlePointerDown);
  }, [menuOpen]);

  const handleItemClick = (item) => {
    if (item.type === 'provider') {
      setCurrentProvider(item);
      setCredentialProvider(item);
      setInput('');
      const firstModel = catalog.find((m) => m.type === 'model' && m.providerId === item.id);
      if (firstModel) setCurrentModel(firstModel);
    } else if (item.type === 'model') {
      setCurrentModel(item);
      setCredentialProvider(null);
    }
    if (item.type !== 'provider') {
      setInput((prev) => prev.replace(/\/(proveedor|modelo)$/i, '').trimStart());
    }
    setMenuOpen(false);
    chatInputRef.current?.focus();
  };

  const handleSearchKeyDown = (e) => {
    if (e.key === 'Escape') {
      setMenuOpen(false);
      chatInputRef.current?.focus();
      return;
    }

    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter') {
      handleCommandMenuKeyDown(e);
    }
  };

  const handleCommandMenuKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      setMenuOpen(false);
      chatInputRef.current?.focus();
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (filteredCatalog.length === 0) return;
      setActiveCommandIndex((index) => Math.min(index + 1, filteredCatalog.length - 1));
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (filteredCatalog.length === 0) return;
      setActiveCommandIndex((index) => Math.max(index - 1, 0));
      return;
    }

    if (e.key === 'Enter' && filteredCatalog[activeCommandIndex]) {
      e.preventDefault();
      handleItemClick(filteredCatalog[activeCommandIndex]);
    }
  };

  const compactJson = (value) => {
    try {
      return JSON.stringify(value).slice(0, 260);
    } catch {
      return String(value).slice(0, 260);
    }
  };

  const clipDebug = (value, max = 20000) => {
    const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    if (!text) return '';
    return text.length > max ? `${text.slice(0, max)}\n...[truncated ${text.length - max} chars]` : text;
  };

  const errorChain = (error) => {
    const lines = [];
    let current = error;
    let depth = 0;
    while (current && depth < 5) {
      const name = current?.name || typeof current;
      const message = current?.message || String(current);
      lines.push(`${depth === 0 ? 'Error' : `Cause ${depth}`}: ${name}: ${message}`);
      current = current?.cause;
      depth += 1;
    }
    return lines.join('\n');
  };

  const formatDebugError = (error) => {
    const fetch = lastModelFetchRef.current;
    const sections = [errorChain(error)];

    if (fetch) {
      sections.push([
        'Fetch:',
        `${fetch.method} ${fetch.url}`,
        fetch.requestBody ? `Request body:\n${clipDebug(fetch.requestBody)}` : 'Request body: <empty>',
        fetch.status ? `Status: ${fetch.status} ${fetch.statusText || ''}`.trim() : null,
        fetch.responseHeaders ? `Response headers:\n${clipDebug(fetch.responseHeaders)}` : null,
        fetch.responseBody ? `Response body:\n${clipDebug(fetch.responseBody)}` : null,
        fetch.transportError ? `Transport error:\n${fetch.transportError}` : null,
      ].filter(Boolean).join('\n'));
    }

    return sections.filter(Boolean).join('\n\n');
  };

  const tauriModelFetch = async (input, init = {}) => {
    const request = input instanceof Request ? new Request(input, init) : new Request(input, init);
    const requestBody = ['GET', 'HEAD'].includes(request.method) ? undefined : await request.clone().text();
    const fetchDebug = {
      method: request.method,
      url: request.url,
      requestBody,
    };
    lastModelFetchRef.current = fetchDebug;

    try {
      const response = await invoke('codeclub_http_fetch', {
        request: {
          url: request.url,
          method: request.method,
          headers: Array.from(request.headers.entries()).map(([name, value]) => ({ name, value })),
          body: requestBody || null,
        },
      });
      const headers = new Headers((response.headers || []).map((header) => [header.name, header.value]));
      lastModelFetchRef.current = {
        ...fetchDebug,
        status: response.status,
        statusText: response.status_text,
        responseHeaders: response.headers,
        responseBody: response.body,
      };
      return new Response(response.body, {
        status: response.status,
        statusText: response.status_text,
        headers,
      });
    } catch (error) {
      lastModelFetchRef.current = {
        ...fetchDebug,
        transportError: error?.message || String(error),
      };
      throw error;
    }
  };

  const resolveToolApproval = (approvalId, approved) => {
    const resolver = approvalResolversRef.current.get(approvalId);
    if (!resolver) return;
    approvalResolversRef.current.delete(approvalId);
    setPendingApprovals((items) => items.filter((item) => item.id !== approvalId));
    resolver(approved);
  };

  const requestToolApproval = ({ toolName, input, summary }) => {
    const approvalId = crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`;
    setAgentState('approval');
    setPendingApprovals((items) => [
      ...items,
      { id: approvalId, toolName, input, summary: summary || compactJson(input) },
    ]);

    return new Promise((resolve) => {
      approvalResolversRef.current.set(approvalId, resolve);
    });
  };


  const logPersistence = async (action, status, detail = {}) => {
    const entry = {
      at: new Date().toISOString(),
      action,
      status,
      ...detail,
    };

    console.info("[codeclub:persist]", entry);

    try {
      const { readTextFile, writeTextFile, mkdir, exists } = await import('@tauri-apps/plugin-fs');
      const { appLocalDataDir, join } = await import('@tauri-apps/api/path');
      const appDataPath = await appLocalDataDir();
      const logPath = await join(appDataPath, 'persistence-log.jsonl');
      await mkdir(appDataPath, { recursive: true });
      const previous = (await exists(logPath)) ? await readTextFile(logPath) : '';
      await writeTextFile(logPath, `${previous}${JSON.stringify(entry)}\n`);
    } catch (error) {
      console.error("[codeclub:persist] log failed", error);
    }
  };

  const appendToJsonl = async (msg) => {
    if (!activeChat) return;
    try {
      const { writeTextFile, readTextFile, exists } = await import('@tauri-apps/plugin-fs');
      const path = `${activeChat.projectPath}/.codeclub/chats/${activeChat.chatId}.jsonl`;
      let content = '';
      if (await exists(path)) {
        content = await readTextFile(path);
        if (content && !content.endsWith('\n')) content += '\n';
      }
      content += JSON.stringify(msg) + '\n';
      await writeTextFile(path, content);
      await logPersistence('append_chat_message', 'ok', {
        role: msg.role,
        chatId: activeChat.chatId,
        projectPath: activeChat.projectPath,
        path,
      });
    } catch (e) {
      console.error("FS Append Error:", e);
      await logPersistence('append_chat_message', 'error', {
        role: msg.role,
        chatId: activeChat?.chatId,
        projectPath: activeChat?.projectPath,
        error: e?.message || String(e),
      });
    }
  };

  const writeChatJsonl = async (nextMessages) => {
    if (!activeChat) return;
    try {
      const { writeTextFile, mkdir } = await import('@tauri-apps/plugin-fs');
      const dir = `${activeChat.projectPath}/.codeclub/chats`;
      const path = `${dir}/${activeChat.chatId}.jsonl`;
      await mkdir(dir, { recursive: true });
      await writeTextFile(path, nextMessages.map((msg) => JSON.stringify(msg)).join('\n') + '\n');
      await logPersistence('rewrite_chat_history', 'ok', {
        chatId: activeChat.chatId,
        projectPath: activeChat.projectPath,
        path,
      });
    } catch (e) {
      await logPersistence('rewrite_chat_history', 'error', {
        chatId: activeChat?.chatId,
        projectPath: activeChat?.projectPath,
        error: e?.message || String(e),
      });
    }
  };

  const saveNote = async (content) => {
    if (!activeNote) return;
    try {
      const { writeTextFile, mkdir } = await import('@tauri-apps/plugin-fs');
      const dir = `${activeNote.projectPath}/.codeclub/notes`;
      const path = `${dir}/${activeNote.noteId}.md`;
      await mkdir(dir, { recursive: true });
      await writeTextFile(path, content);
      await logPersistence('save_note', 'ok', { noteId: activeNote.noteId, projectPath: activeNote.projectPath, path });
    } catch (e) {
      await logPersistence('save_note', 'error', { noteId: activeNote?.noteId, error: e?.message || String(e) });
    }
  };

  const queueSaveNote = (content) => {
    setNoteContent(content);
    if (noteSaveTimer.current) clearTimeout(noteSaveTimer.current);
    noteSaveTimer.current = setTimeout(() => saveNote(content), 350);
  };

  const saveTable = async (nextTable) => {
    if (!activeTable) return;
    try {
      const { writeTextFile, mkdir } = await import('@tauri-apps/plugin-fs');
      const dir = `${activeTable.projectPath}/.codeclub/tables`;
      const path = `${dir}/${activeTable.tableId}.json`;
      await mkdir(dir, { recursive: true });
      await writeTextFile(path, JSON.stringify(nextTable));
      await logPersistence('save_table', 'ok', { tableId: activeTable.tableId, projectPath: activeTable.projectPath, path });
    } catch (e) {
      await logPersistence('save_table', 'error', { tableId: activeTable?.tableId, error: e?.message || String(e) });
    }
  };

  const updateTableCell = (rowIndex, columnIndex, value) => {
    const nextTable = tableData.map((row) => [...row]);
    nextTable[rowIndex][columnIndex] = value;
    setTableData(nextTable);
    if (tableSaveTimer.current) clearTimeout(tableSaveTimer.current);
    tableSaveTimer.current = setTimeout(() => saveTable(nextTable), 350);
  };

  const renameActiveArtifact = () => {
    const artifact = workspaceMode === 'note' ? activeNote : activeTable;
    if (!artifact) return;
    const name = titleDraft.trim() || (workspaceMode === 'note' ? 'Nota' : 'Tabla');
    const itemId = workspaceMode === 'note' ? artifact.noteId : artifact.tableId;
    window.dispatchEvent(new CustomEvent('codeclub:rename-artifact', {
      detail: { kind: workspaceMode, itemId, projectPath: artifact.projectPath, name },
    }));
  };

  const handleTitleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.currentTarget.blur();
      renameActiveArtifact();
    }
    if (e.key === 'Escape') {
      setTitleDraft(workspaceMode === 'note' ? (activeNote?.name || 'Nota') : (activeTable?.name || 'Tabla'));
      e.currentTarget.blur();
    }
  };

  const sendMessage = async (content, baseMessages = messages, shouldRenameChat = messages.length === 0, replaceHistory = false) => {
    if (!activeChat) {
      window.dispatchEvent(new CustomEvent('codeclub:require-project'));
      return;
    }

    if (shouldRenameChat) {
      let title = content.trim();
      if (title.length > 20) title = title.substring(0, 20) + '...';
      window.dispatchEvent(new CustomEvent('codeclub:rename-chat', {
        detail: { chatId: activeChat.chatId, newName: title, projectPath: activeChat.projectPath }
      }));
    }

    const userMessage = { role: 'user', content };
    const newMessages = [...baseMessages, userMessage];
    setComposerDocked(true);
    setMessages(newMessages);
    setInput('');
    if (chatInputRef.current) chatInputRef.current.style.height = '22px';
    setIsStreaming(true);
    setAgentState('streaming');
    
    if (replaceHistory) {
      await writeChatJsonl(newMessages);
    } else {
      await appendToJsonl(userMessage);
    }

    try {
      if (!currentProvider || !currentModel) {
        throw new Error('Elegí un proveedor y un modelo antes de enviar.');
      }

      let apiKey = localStorage.getItem(`${currentProvider.id}_api_key`);
      
      if (!apiKey || apiKey === 'dummy-key') {
        throw new Error(`API Key no configurada para ${currentProvider.label || currentProvider.id}. Por favor agregala en la configuración.`);
      }
      
      const provider = createOpenAICompatible({
        name: currentProvider.id,
        baseURL: currentProvider.api || 'https://api.openai.com/v1',
        apiKey,
        fetch: tauriModelFetch,
      });

      let assistantContent = '';
      let assistantTools = [];
      const updateAssistantMessage = () => {
        setMessages([...newMessages, { role: 'assistant', content: assistantContent, tools: assistantTools }]);
      };
      const recordToolEvent = (name, input, output) => {
        assistantTools = [
          ...assistantTools,
          {
            id: crypto.randomUUID?.() || `${Date.now()}-${assistantTools.length}`,
            name,
            input,
            output,
            at: new Date().toISOString(),
          },
        ];
        updateAssistantMessage();
      };
      updateAssistantMessage();

      const tools = createTools({
        projectPath: activeChat.projectPath,
        recordToolEvent,
        setAgentState,
        requestToolApproval,
        provider,
        modelId: currentModel.id,
      });

      const system = [
        'Sos el agente IDE de Codeclub.',
        'Responde en español, breve y util.',
        'Tenes herramientas para inspeccionar y modificar el workspace activo.',
        'Usa listFiles, readFile y searchText antes de tocar codigo cuando falte contexto.',
        'Para modificar archivos usa writeFile con el contenido completo del archivo.',
        'Para comandos usa runCommand solo cuando aporte a la tarea.',
        'Para procesos persistentes, servidores o trabajo interactivo usa la tool terminal; crea procesos background sin abrir UI.',
        'Usa createPlan, updatePlan, todo y getTaskStatus para organizar tareas de programacion.',
        'Usa askUser solo cuando falte una decision importante; devuelve una solicitud estructurada sin asumir la respuesta.',
        'Las acciones riesgosas piden aprobacion humana antes de ejecutarse.',
      ].join(' ');

      assistantContent = await runStream({
        model: provider(currentModel.id),
        system,
        messages: newMessages.map(({ role, content }) => ({ role, content })),
        tools,
        callbacks: {
          onTextDelta: (content) => {
            assistantContent = content;
            updateAssistantMessage();
          },
          onToolCall: () => setAgentState('tool_call'),
          onToolResult: () => setAgentState('streaming'),
        },
      });

      const assistantMessage = { role: 'assistant', content: assistantContent, tools: assistantTools };
      if (replaceHistory) {
        await writeChatJsonl([...newMessages, assistantMessage]);
      } else {
        await appendToJsonl(assistantMessage);
      }
    } catch (error) {
      console.error(formatDebugError(error));
      setAgentState('error');
      setMessages((prev) => {
        const updated = [...prev];
        if (updated.length > 0 && updated[updated.length - 1].content === '' && updated[updated.length - 1].role === 'assistant') {
          updated.pop();
        }
        return updated;
      });
    } finally {
      setIsStreaming(false);
      setAgentState((state) => state === 'error' ? 'error' : 'idle');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if ((!input.trim() && attachedFiles.length === 0) || isAgentBusy) return;

    if (credentialProvider) {
      localStorage.setItem(`${credentialProvider.id}_api_key`, input.trim());
      setCredentialProvider(null);
      setInput('');
      return;
    }

    if (/^\/terminal$/i.test(input.trim())) {
      const rect = e.currentTarget.getBoundingClientRect();
      window.dispatchEvent(new CustomEvent('codeclub:open-terminal-dock', {
        detail: {
          toggle: true,
          anchorRect: {
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
          },
        },
      }));
      setInput('');
      return;
    }

    if (/\/proveedor$/i.test(input.trim())) {
      openCommandMenu('provider');
      return;
    }

    if (/\/modelo$/i.test(input.trim())) {
      openCommandMenu('model');
      return;
    }

    const attachmentContext = attachedFiles.length > 0
      ? `\n\nArchivos añadidos:\n${attachedFiles.map((file) => `- ${file}`).join('\n')}`
      : '';
    await sendMessage(`${input.trim() || 'Revisá los archivos añadidos.'}${attachmentContext}`);
    setAttachedFiles([]);
  };

  const handleCopyMessage = async (content) => {
    await navigator.clipboard?.writeText(content);
  };

  const handleRetryMessage = async (messageIndex) => {
    if (isAgentBusy) return;
    const message = messages[messageIndex];
    if (!message || message.role !== 'user') return;
    await sendMessage(message.content, messages.slice(0, messageIndex), false, true);
  };

  const handleAttachFiles = async () => {
    try {
      const selected = await open({
        multiple: true,
        directory: false,
        title: 'Añadir archivos al chat',
      });
      if (!selected) return;
      const files = Array.isArray(selected) ? selected : [selected];
      setAttachedFiles((current) => [...new Set([...current, ...files])]);
    } catch (error) {
      console.error('Error seleccionando archivos:', error);
    }
  };

  if (workspaceMode === 'blank') {
    if (activeProject) {
      const createNewArtifact = async (kind: 'chat' | 'note' | 'table', customName: string) => {
        if (!customName.trim()) {
          setCreatingArtifactKind(null);
          setNewArtifactName('');
          return;
        }
        const id = Date.now().toString();
        const name = customName.trim();
        const collection = kind === 'chat' ? 'chats' : `${kind}s`;
        try {
          const { readTextFile, writeTextFile, exists, mkdir } = await import('@tauri-apps/plugin-fs');
          const metaPath = `${activeProject.projectPath}/.codeclub/meta.json`;
          let metaData: any = { chats: [], notes: [], tables: [] };
          if (await exists(metaPath)) {
            metaData = JSON.parse(await readTextFile(metaPath));
          } else {
            await mkdir(`${activeProject.projectPath}/.codeclub`, { recursive: true });
          }
          if (!Array.isArray(metaData[collection])) metaData[collection] = [];
          metaData[collection].push({ id, name });
          await writeTextFile(metaPath, JSON.stringify(metaData));
          
          if (kind === 'chat') {
            await mkdir(`${activeProject.projectPath}/.codeclub/chats`, { recursive: true });
          } else if (kind === 'note') {
            await mkdir(`${activeProject.projectPath}/.codeclub/notes`, { recursive: true });
            await writeTextFile(`${activeProject.projectPath}/.codeclub/notes/${id}.md`, '');
          } else if (kind === 'table') {
            await mkdir(`${activeProject.projectPath}/.codeclub/tables`, { recursive: true });
            await writeTextFile(`${activeProject.projectPath}/.codeclub/tables/${id}.json`, JSON.stringify(Array.from({ length: 8 }, () => Array.from({ length: 5 }, () => ""))));
          }
          
          window.dispatchEvent(new CustomEvent(`codeclub:panel-${panelId}:open-${kind}`, {
            detail: { projectPath: activeProject.projectPath, [`${kind}Id`]: id, name }
          }));
          
          setProjectMeta(metaData);
          setCreatingArtifactKind(null);
          setNewArtifactName('');
        } catch (e) {
          console.error(e);
        }
      };

      const openProjectPanel = (kind: 'diff') => {
        window.dispatchEvent(new CustomEvent(`codeclub:open-${kind}`, {
          detail: { projectPath: activeProject.projectPath, projectName: activeProject.name, sourcePanel: panelId },
        }));
      };

      return (
        <div className="flex flex-col gap-2 w-[min(300px,calc(100%-64px))] text-[#d8d8d8] text-[13px]" style={{ fontWeight: 400 }}>
          {(['chat', 'table', 'note'] as const).map((kind) => {
            const isExpanded = expandedMenu === kind;
            const isChatsBlocked = kind === 'chat' && blockedPanelState.startsWith('chat:');
            const items = projectMeta ? (projectMeta[kind === 'chat' ? 'chats' : `${kind}s`] || []) : [];
            const title = kind === 'chat' ? 'Chats' : kind === 'table' ? 'Tablas' : 'Notas';
            const query = artifactSearch[kind] || '';
            const recentItems = getRecentArtifactIds(kind, activeProject.projectPath)
              .map((id) => items.find((item: any) => item.id === id))
              .filter(Boolean);
            const visibleItems = (query
              ? items.filter((item: any) => item.name.toLowerCase().includes(query.toLowerCase()))
              : recentItems.length ? recentItems : items.slice(-3).reverse()
            ).slice(0, 3);
            
            return (
              <div key={kind} className="flex flex-col bg-[var(--color-surface-1)] border border-[var(--color-surface-10)] rounded-xl overflow-hidden shadow-[0_4px_12px_rgba(0,0,0,0.2)]">
                <button 
                  type="button" 
                  onClick={() => { if (!isChatsBlocked) setExpandedMenu(isExpanded ? null : kind); }}
                  disabled={isChatsBlocked}
                  className={`flex items-center justify-between p-[12px_16px] border-0 text-left w-full transition-colors duration-200 outline-none ${isChatsBlocked ? 'cursor-not-allowed text-[#555555]' : `cursor-pointer text-[#eeeeee] ${isExpanded ? 'bg-[var(--color-surface-4)]' : 'bg-transparent hover:bg-[var(--color-surface-3)]'}`}`}
                >
                  <div className="flex items-center gap-3">
                    {kind === 'chat' ? <MessageSquare size={16} strokeWidth={1.5} /> : kind === 'table' ? <Table2 size={16} strokeWidth={1.5} /> : <FileText size={16} strokeWidth={1.5} />}
                    <span className="font-normal" style={{ fontWeight: 400 }}>{title}</span>
                  </div>
                  <span className="opacity-40 text-[11px]">{items.length}</span>
                </button>
                {isExpanded && (
                  <div className="flex flex-col border-t border-[var(--color-surface-10)] max-h-[250px] overflow-y-auto bg-[var(--color-surface-0)] [scrollbar-width:none]">
                    <label className="flex shrink-0 items-center gap-2 h-[34px] w-full border-b border-[var(--color-surface-8)] px-[12px] text-[#777777]">
                      <Search size={14} strokeWidth={1.6} />
                      <input
                        type="text"
                        value={query}
                        onChange={(e) => setArtifactSearch((current) => ({ ...current, [kind]: e.target.value }))}
                        placeholder={`Buscar ${title.toLowerCase()}`}
                        className="min-w-0 flex-1 border-0 bg-transparent text-xs text-[#d8d8d8] outline-none placeholder:text-[#777777]"
                      />
                      {query && (
                        <button
                          type="button"
                          aria-label="Limpiar búsqueda"
                          onClick={() => setArtifactSearch((current) => ({ ...current, [kind]: '' }))}
                          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-0 bg-transparent p-0 text-[#777777] hover:bg-[var(--color-surface-5)] hover:text-[#eeeeee]"
                        >
                          <X size={13} strokeWidth={1.8} />
                        </button>
                      )}
                    </label>
                    {visibleItems.map((item: any) => {
                      const isBlocked = kind === 'chat'
                        ? blockedPanelState.startsWith('chat:')
                        : blockedPanelState === `${kind}:${item.id}`;
                      return (
                      <button
                        key={item.id}
                        type="button"
                        draggable
                        onDragStart={(e) => {
                          document.body.classList.add("is-dragging-artifact");
                          e.dataTransfer.effectAllowed = "move";
                          const payload = JSON.stringify({ kind, id: item.id, name: item.name, projectPath: activeProject.projectPath });
                          e.dataTransfer.setData("text/plain", payload);
                          e.dataTransfer.setData("application/json", payload);
                        }}
                        onDragEnd={() => {
                          document.body.classList.remove("is-dragging-artifact");
                        }}
                        onClick={() => {
                          if (isBlocked) return;
                          rememberRecentArtifact(kind, { projectPath: activeProject.projectPath, [`${kind}Id`]: item.id });
                          window.dispatchEvent(new CustomEvent(`codeclub:open-${kind}`, {
                            detail: { projectPath: activeProject.projectPath, [`${kind}Id`]: item.id, name: item.name }
                          }));
                        }}
                        disabled={isBlocked}
                        className={`block shrink-0 w-full px-[16px] py-[10px] bg-transparent border-0 text-left text-xs whitespace-nowrap overflow-hidden text-ellipsis transition-colors outline-none ${isBlocked ? 'cursor-not-allowed text-[#555555]' : 'cursor-pointer text-[#cfcfcf] hover:bg-[var(--color-surface-4)] hover:text-[#ffffff]'}`}
                      >
                        {item.name}
                      </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}

          {(['diff'] as const).map((kind) => {
            const title = 'Cambios';
            return (
              <button
                key={kind}
                type="button"
                onClick={() => openProjectPanel(kind)}
                className="flex items-center justify-between rounded-xl border border-[var(--color-surface-10)] bg-[var(--color-surface-1)] p-[12px_16px] text-left text-[#eeeeee] shadow-[0_4px_12px_rgba(0,0,0,0.2)] outline-none transition-colors duration-200 hover:bg-[var(--color-surface-3)]"
              >
                  <div className="flex items-center gap-3">
                    {kind === 'diff' ? <GitCompare size={16} strokeWidth={1.5} /> : <FolderTree size={16} strokeWidth={1.5} />}
                    <span className="font-normal" style={{ fontWeight: 400 }}>{title}</span>
                  </div>
                <span className="opacity-40 text-[11px]">{changeCount}</span>
              </button>
            );
          })}
          
          <button 
            type="button" 
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              window.dispatchEvent(new CustomEvent('codeclub:open-terminal-dock', {
                detail: { toggle: true, anchorRect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height } }
              }));
            }}
            className="flex items-center justify-between p-[12px_16px] bg-[var(--color-surface-1)] hover:bg-[var(--color-surface-3)] border border-[var(--color-surface-10)] rounded-xl text-[#eeeeee] cursor-pointer text-left w-full transition-colors duration-200 outline-none shadow-[0_4px_12px_rgba(0,0,0,0.2)]"
          >
            <div className="flex items-center gap-3">
              <Terminal size={16} strokeWidth={1.5} />
              <span className="font-normal" style={{ fontWeight: 400 }}>Terminal</span>
            </div>
            <span className="opacity-40 text-[11px]">{terminalCount}</span>
          </button>
        </div>
      );
    }

    return (
      <div style={{ width: 'min(600px, calc(100% - 64px))', display: 'grid', placeItems: 'center', color: 'rgba(216, 216, 216, 0.42)', fontSize: '13px' }}>
        Seleccioná un proyecto
      </div>
    );
  }

  if (workspaceMode === 'note') {
    return (
      <div className="note-panel" style={{ width: 'min(860px, calc(100% - 64px))', height: 'min(720px, calc(100vh - 96px))', display: 'grid', gridTemplateRows: 'auto 1fr', gap: '14px' }}>
        <input value={titleDraft} onChange={(e) => setTitleDraft(e.target.value)} onKeyDown={handleTitleKeyDown} style={{ border: 0, outline: 'none', background: 'transparent', color: '#eeeeee', fontSize: '28px', fontWeight: 600 }} />
        <textarea value={noteContent} onChange={(e) => queueSaveNote(e.target.value)} placeholder="Escribí una nota..." style={{ resize: 'none', border: 0, outline: 'none', background: 'transparent', color: '#d8d8d8', fontSize: '14px', lineHeight: 1.7, fontFamily: 'inherit', overflow: 'auto', scrollbarWidth: 'none' }} />
      </div>
    );
  }

  if (workspaceMode === 'table') {
    return (
      <div className="table-panel" style={{ width: 'min(860px, calc(100% - 64px))', height: 'min(720px, calc(100vh - 96px))', display: 'grid', gridTemplateRows: 'auto 1fr', gap: '14px' }}>
        <input value={titleDraft} onChange={(e) => setTitleDraft(e.target.value)} onKeyDown={handleTitleKeyDown} style={{ border: 0, outline: 'none', background: 'transparent', color: '#eeeeee', fontSize: '28px', fontWeight: 600 }} />
          <div style={{ overflow: 'auto', scrollbarWidth: 'none', border: '1px solid var(--color-surface-9, #2c2c2c)', borderRadius: '8px', background: 'transparent' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
            <tbody>
              {tableData.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, columnIndex) => (
                    <td key={columnIndex} style={{ border: '1px solid #2b2b2b', padding: 0 }}>
                      <input value={cell} onChange={(e) => updateTableCell(rowIndex, columnIndex, e.target.value)} style={{ width: '100%', minHeight: '36px', boxSizing: 'border-box', border: 0, outline: 'none', background: 'transparent', color: '#d8d8d8', padding: '0 10px', fontSize: '12px' }} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (workspaceMode === 'diff' || workspaceMode === 'folders') {
    return <ProjectPanelView kind={workspaceMode} projectPath={activeProject?.projectPath} />;
  }

  return (
    <div className="chat-interface-container" style={{ width: 'min(860px, calc(100% - 64px))', height: 'min(720px, calc(100vh - 96px))', display: 'grid', gridTemplateRows: composerDocked ? 'minmax(0, 1fr) auto' : '1fr', placeItems: composerDocked ? 'stretch' : 'center', gap: '10px', overflow: 'visible', paddingBottom: composerDocked ? '18px' : 0 }}>
      
      {/* Zona de mensajes */}
      <div className="messages-area" style={{ minHeight: 0, height: '100%', overflowY: 'auto', scrollbarWidth: 'none', msOverflowStyle: 'none', display: composerDocked ? 'flex' : 'none', flexDirection: 'column', gap: '6px', paddingBottom: '10px', overscrollBehavior: 'contain' }}>
        <div aria-hidden="true" style={{ flex: '1 0 auto' }} />
        {messages.map((m, i) => (
          <React.Fragment key={i}>
            {i > 0 && (
              <div aria-hidden="true" style={{ alignSelf: 'stretch', borderTop: '1px solid rgba(255, 255, 255, 0.08)', margin: '14px 0' }} />
            )}
            <div style={{ alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', display: 'grid', justifyItems: m.role === 'user' ? 'end' : 'start', gap: '5px', maxWidth: '80%' }}>
              <span style={{ alignSelf: 'start', justifySelf: m.role === 'user' ? 'end' : 'start', color: m.role === 'user' ? avatarColor : '#ffffff', fontSize: '13px', fontWeight: 600, marginBottom: '2px', padding: m.role === 'user' ? '0 8px' : 0 }}>
                {m.role === 'user' ? 'Tú' : 'Concierge'}
              </span>
              {m.role === 'assistant' && (
                <MessageToolSummary tools={m.tools} isBusy={isAgentBusy && i === messages.length - 1} />
              )}
              <div style={{ background: m.role === 'user' ? '#202020' : 'transparent', padding: m.role === 'user' ? '14px 20px' : '0', borderRadius: m.role === 'user' ? '24px 24px 4px 24px' : '0', color: '#eee', fontSize: '14px', width: 'fit-content', maxWidth: '100%', lineHeight: 1.5, boxShadow: m.role === 'user' ? '0 4px 14px rgba(0, 0, 0, 0.18)' : 'none' }}>
                <ReactMarkdown components={{ p: ({ children }) => <p style={{ margin: 0 }}>{children}</p> }}>{m.content}</ReactMarkdown>
              </div>
              <div style={{ alignSelf: m.role === 'user' ? 'end' : 'start', display: 'flex', alignItems: 'center', gap: '4px', opacity: 0.72 }}>
                <button type="button" aria-label="Copiar mensaje" onClick={() => handleCopyMessage(m.content)} style={{ width: '22px', height: '22px', display: 'grid', placeItems: 'center', border: 0, borderRadius: '6px', background: 'transparent', color: 'rgba(216, 216, 216, 0.62)', cursor: 'pointer' }}>
                  <Copy size={13} strokeWidth={2} />
                </button>
                {m.role === 'user' && <button type="button" aria-label="Reintentar desde este mensaje" onClick={() => handleRetryMessage(i)} disabled={isAgentBusy} style={{ width: '22px', height: '22px', display: 'grid', placeItems: 'center', border: 0, borderRadius: '6px', background: 'transparent', color: 'rgba(216, 216, 216, 0.62)', cursor: isAgentBusy ? 'not-allowed' : 'pointer' }}>
                  <RotateCcw size={13} strokeWidth={2} />
                </button>}
              </div>
            </div>
          </React.Fragment>
        ))}
        {pendingApprovals.map((approval) => (
          <div key={approval.id} style={{ alignSelf: 'flex-start', display: 'grid', gap: '6px', maxWidth: '80%', border: '1px solid rgba(253, 230, 138, 0.18)', borderRadius: '8px', padding: '10px', background: 'rgba(253, 230, 138, 0.045)', color: '#eee', fontSize: '12px' }}>
            <div style={{ display: 'grid', gap: '4px' }}>
              <span style={{ color: 'rgba(238, 238, 238, 0.88)', fontWeight: 600 }}>{approval.toolName}</span>
              <span style={{ color: 'rgba(216, 216, 216, 0.66)' }}>{approval.summary}</span>
              <pre style={{ margin: 0, padding: '6px 8px', background: 'rgba(0,0,0,0.25)', borderRadius: '6px', fontSize: '11px', lineHeight: 1.4, overflow: 'auto', maxHeight: '120px', whiteSpace: 'pre-wrap', wordBreak: 'break-all', color: '#d8d8d8' }}>{JSON.stringify(approval.input, null, 2)}</pre>
            </div>
            <div style={{ display: 'flex', gap: '6px' }}>
              <button type="button" onClick={() => resolveToolApproval(approval.id, true)} style={{ minHeight: '26px', border: 0, borderRadius: '7px', padding: '0 10px', background: '#2c2c2c', color: '#ffffff', cursor: 'pointer', fontSize: '12px' }}>
                Aprobar
              </button>
              <button type="button" onClick={() => resolveToolApproval(approval.id, false)} style={{ minHeight: '26px', border: 0, borderRadius: '7px', padding: '0 10px', background: 'transparent', color: 'rgba(216, 216, 216, 0.72)', cursor: 'pointer', fontSize: '12px' }}>
                Cancelar
              </button>
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} aria-hidden="true" />
      </div>

      <div className="chat-composer" style={{ width: 'min(600px, 100%)', justifySelf: 'center', position: 'relative', display: 'grid', gap: '10px', transform: composerDocked ? 'translateY(18px)' : 'translateY(0)', transition: 'transform 420ms cubic-bezier(0.22, 1, 0.36, 1)' }}>
        <div className="composer-status w-full overflow-hidden whitespace-nowrap text-ellipsis" style={{ display: 'flex', alignItems: 'center', justifyContent: composerDocked ? 'flex-start' : 'center', gap: '8px', color: composerDocked ? 'rgba(216, 216, 216, 0.42)' : undefined, fontSize: composerDocked ? '12px' : undefined, transform: composerDocked && menuOpen ? 'translateY(-194px)' : 'translateY(0)', transition: 'transform 180ms ease', position: 'relative', zIndex: 11 }}>
          <span className="braille-spinner shrink-0" data-state={agentState} aria-hidden="true" style={{ position: 'relative' }} />
          {composerDocked ? (
            <span className="shrink-0" style={{ color: 'rgba(216, 216, 216, 0.82)' }}>{agentStatusText}</span>
          ) : (
            <p className="shrink-0" style={{ margin: 0, color: 'rgba(216, 216, 216, 0.82)', fontSize: '16px' }}>{agentStatusText}</p>
          )}
          {composerDocked && (
            <>
              <span className="shrink-0">{currentProvider?.label || 'Sin proveedor'}</span>
              <span className="shrink-0" style={{ color: 'rgba(216, 216, 216, 0.24)' }}>/</span>
              <span className="truncate min-w-0" style={{ textOverflow: 'ellipsis', overflow: 'hidden' }}>{currentModel?.label || 'Sin modelo'}</span>
            </>
          )}
        </div>

        <div className="selection-status" style={{ display: composerDocked ? 'none' : 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', color: 'rgba(216, 216, 216, 0.42)', fontSize: '12px' }}>
          <span>{currentProvider?.label || 'Sin proveedor'}</span>
          <span style={{ color: 'rgba(216, 216, 216, 0.24)' }}>/</span>
          <span>{currentModel?.label || 'Sin modelo'}</span>
        </div>

        <div className="composer-row" style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%' }}>
          <button type="button" onClick={handleAttachFiles} className="text-white/40 hover:text-white transition-colors" aria-label="Añadir archivos" style={{ flex: '0 0 40px', width: '40px', height: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--color-surface-9, #2f2f2f)', borderRadius: '50%', background: '#121212', boxShadow: '0 18px 52px rgba(0, 0, 0, 0.26)', cursor: 'pointer' }}>
            <Plus size={18} strokeWidth={2} />
          </button>
          <div className="composer-box" style={{ '--avatar-color': avatarColor, minHeight: '40px', flex: '1 1 auto', minWidth: 0, padding: '1px', borderRadius: '22px', background: 'var(--color-surface-9, #2f2f2f)', boxShadow: '0 18px 52px rgba(0, 0, 0, 0.26)' } as React.CSSProperties}>
          <form onSubmit={handleSubmit} className="composer-box-inner" style={{ minHeight: '40px', width: '100%', minWidth: 0, display: 'flex', alignItems: 'center', gap: '4px', padding: '5px 6px 5px 12px', border: 0, borderRadius: '21px', background: '#121212' }}>
          {false && (
          <button type="button" onClick={handleAttachFiles} className="text-white/40 hover:text-white transition-colors" aria-label="Añadir archivos" style={{ flex: '0 0 28px', width: '28px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center', border: 0, background: 'transparent', cursor: 'pointer' }}>
            <Plus size={18} strokeWidth={2} />
          </button>
          )}
          {attachedFiles.length > 0 && (
            <button
              type="button"
              onClick={() => setAttachedFiles([])}
              className="shrink-0 bg-[var(--color-surface-3)] text-[#bdbdbd] hover:bg-[var(--color-surface-7)] hover:text-[#eeeeee] transition-colors"
              aria-label="Quitar archivos añadidos"
              title="Quitar archivos añadidos"
              style={{ minHeight: '24px', display: 'flex', alignItems: 'center', padding: '0 9px', border: '1px solid var(--color-surface-8, #2b2b2b)', borderRadius: '999px', fontSize: '11px', cursor: 'pointer' }}
            >
              Añadido {attachedFiles.length}
            </button>
          )}
          <textarea
            ref={chatInputRef}
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onInput={(e) => {
              const target = e.currentTarget;
              target.style.height = 'auto';
              target.style.height = `${Math.min(target.scrollHeight, 58)}px`;
              target.style.overflowY = target.scrollHeight > 58 ? 'auto' : 'hidden';
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
            onFocus={() => setMenuOpen(false)}
            placeholder={credentialProvider ? `Escribí tu credencial de ${credentialProvider.label || credentialProvider.id}` : "Preguntá, pedí código o describí una tarea"}
            aria-label="Mensaje"
            style={{ appearance: 'none', flex: '1 1 auto', minWidth: 0, width: '100%', height: '22px', maxHeight: '58px', alignSelf: 'center', resize: 'none', border: 0, outline: 'none', background: 'transparent', color: '#eeeeee', fontSize: '12px', lineHeight: 1.4, padding: '4px 10px 4px 0', fontFamily: 'inherit', overflowY: 'hidden', scrollbarWidth: 'none' }}
          />
          <button type="submit" disabled={isAgentBusy} className="send-button text-white/35 hover:text-white transition-colors" aria-label={credentialProvider ? "Guardar credencial" : "Enviar"} style={{ flex: '0 0 36px', width: '36px', height: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center', border: 0, borderRadius: '50%', background: 'transparent', cursor: isAgentBusy ? 'not-allowed' : 'pointer' }}>
            <ArrowUpRight size={18} strokeWidth={2} />
          </button>
          </form>
          </div>
        </div>

        <div
          ref={commandMenuRef}
          tabIndex={-1}
          onKeyDown={handleCommandMenuKeyDown}
          className={`command-menu ${menuOpen ? 'is-open' : ''}`}
          style={{ position: 'absolute', left: 0, right: 0, top: composerDocked ? 'auto' : 'calc(100% + 8px)', bottom: composerDocked ? '58px' : 'auto', display: menuOpen ? 'grid' : 'none', gap: '8px', padding: '9px', border: '1px solid var(--color-surface-9, #2f2f2f)', borderRadius: '8px', background: composerDocked ? 'rgba(18, 18, 18, 0.72)' : '#121212', backdropFilter: composerDocked ? 'blur(18px) saturate(1.35)' : undefined, WebkitBackdropFilter: composerDocked ? 'blur(18px) saturate(1.35)' : undefined, boxShadow: '0 20px 58px rgba(0, 0, 0, 0.34)', zIndex: 10, outline: 'none' }}
        >

          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder={commandKind === 'provider' ? 'Buscar proveedor' : 'Buscar modelo del proveedor activo'}
            style={{ height: '30px', padding: '0 8px', borderRadius: '7px', background: 'var(--color-surface-3, #1c1c1c)', fontSize: '12px', color: '#eeeeee', border: 'none', outline: 'none' }}
          />
          <div className="command-list" style={{ display: 'grid', gap: '4px', maxHeight: '120px', overflow: 'auto', scrollbarWidth: 'none', paddingBottom: '12px', maskImage: 'linear-gradient(to bottom, black 85%, transparent 100%)', WebkitMaskImage: 'linear-gradient(to bottom, black 85%, transparent 100%)' }}>
            {filteredCatalog.map((item, index) => (
              <button
                key={item.id}
                type="button"
                data-command-index={index}
                onClick={() => handleItemClick(item)}
                onFocus={() => setActiveCommandIndex(index)}
                onMouseEnter={() => setActiveCommandIndex(index)}
                style={{ minHeight: '32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', border: 0, borderRadius: '7px', background: index === activeCommandIndex ? 'var(--color-surface-7, #2c2c2c)' : 'transparent', color: index === activeCommandIndex ? '#ffffff' : 'rgba(238, 238, 238, 0.78)', fontSize: '12px', padding: '0 9px', textAlign: 'left', cursor: 'pointer' }}
              >
                <span>{item.label}</span>
                <small style={{ color: 'rgba(216, 216, 216, 0.36)', fontSize: '11px' }}>
                  {item.type === 'provider' ? 'proveedor' : 'modelo'}
                </small>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

type ProjectFileEntry = { path: string; kind: string; size?: number };
type FileTreeNode = { name: string; path: string; kind: 'directory' | 'file'; children: FileTreeNode[]; extension?: string };

function buildFileTree(entries: ProjectFileEntry[]): FileTreeNode[] {
  const root: FileTreeNode[] = [];
  for (const entry of entries) {
    const parts = entry.path.split('/').filter(Boolean);
    let level = root;
    let currentPath = '';
    parts.forEach((part, index) => {
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      let node = level.find((item) => item.name === part);
      if (!node) {
        const isFile = index === parts.length - 1 && entry.kind !== 'directory';
        node = { name: part, path: currentPath, kind: isFile ? 'file' : 'directory', children: [] };
        if (isFile && part.includes('.')) node.extension = `.${part.split('.').pop()}`;
        level.push(node);
      }
      level = node.children;
    });
  }
  const sortTree = (nodes: FileTreeNode[]) => nodes.sort((a, b) => Number(a.kind === 'file') - Number(b.kind === 'file') || a.name.localeCompare(b.name));
  const sortBranch = (nodes: FileTreeNode[]) => { sortTree(nodes); nodes.forEach((node) => sortBranch(node.children)); return nodes; };
  return sortBranch(root);
}

function CodeMirrorFileEditor({ path, content }: { path: string; content: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!hostRef.current) return;
    const extension = path.split('.').pop()?.toLowerCase();
    const language = extension === 'tsx' || extension === 'ts' || extension === 'jsx' || extension === 'js'
      ? javascript({ jsx: true, typescript: extension === 'tsx' || extension === 'ts' })
      : extension === 'html' || extension === 'astro' ? html()
      : extension === 'css' || extension === 'scss' ? css()
      : extension === 'json' ? json()
      : extension === 'md' || extension === 'mdx' ? markdown()
      : [];
    const state = EditorState.create({ doc: content, extensions: [lineNumbers(), language, oneDark, keymap.of([...defaultKeymap, indentWithTab]), EditorView.editable.of(false), EditorView.theme({ '&': { height: '100%', backgroundColor: 'transparent' }, '.cm-editor': { backgroundColor: 'transparent' }, '.cm-scroller': { overflow: 'auto', fontFamily: 'var(--font-mono, monospace)' }, '.cm-gutters': { backgroundColor: 'transparent', border: 0 } })] });
    const view = new EditorView({ state, parent: hostRef.current });
    return () => view.destroy();
  }, [path, content]);
  return <div ref={hostRef} className="h-full min-h-0 text-[12px]" />;
}

function ProjectFoldersView({ projectPath }: { projectPath?: string }) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [entries, setEntries] = useState<ProjectFileEntry[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedPath, setSelectedPath] = useState('');
  const [selectedContent, setSelectedContent] = useState('');

  const loadProject = async () => {
    if (!projectPath) return;
    setLoading(true);
    setLoadError('');
    try {
    const result = await invoke<ProjectFileEntry[]>('codeclub_list_files', { projectPath, maxFiles: 1200 });
      setEntries(result);
      setExpanded(new Set(result.filter((entry) => entry.kind === 'directory').map((entry) => entry.path)));
    } catch (error) { setEntries([]); setLoadError(String(error)); } finally { setLoading(false); }
  };

  useEffect(() => { loadProject(); }, [projectPath]);

  const openFile = async (path: string) => {
    if (!projectPath) return;
    try {
      const content = await invoke<string>('codeclub_read_file', { projectPath, path });
      setSelectedPath(path);
      setSelectedContent(content);
    } catch (error) {
      setSelectedPath(path);
      setSelectedContent(`No se pudo abrir el archivo: ${String(error)}`);
    }
  };

  const tree = buildFileTree(entries);
  const renderTree = (nodes: FileTreeNode[], depth = 0): React.ReactNode => nodes.map((node) => {
    const isOpen = expanded.has(node.path);
    return <React.Fragment key={node.path}>
      <button type="button" onClick={() => node.kind === 'directory' ? setExpanded((current) => { const next = new Set(current); next.has(node.path) ? next.delete(node.path) : next.add(node.path); return next; }) : openFile(node.path)} className={`flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-[12px] ${selectedPath === node.path ? 'bg-[var(--color-surface-7)] text-[#eeeeee]' : 'text-[#bdbdbd] hover:bg-[var(--color-surface-3)]'}`} style={{ paddingLeft: `${8 + depth * 14}px` }}>
        {node.kind === 'directory' ? (isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />) : <span className="w-[13px]" />}
        {node.kind === 'directory' ? <Folder size={14} className="text-[#a89b72]" /> : <FileCode2 size={14} className="text-[#777777]" />}
        <span className="min-w-0 flex-1 truncate">{node.name}</span>
        {node.extension && <span className="text-[10px] text-[#666666]">{node.extension}</span>}
      </button>
      {node.kind === 'directory' && isOpen && renderTree(node.children, depth + 1)}
    </React.Fragment>;
  });

  return <div className="flex h-[min(720px,calc(100vh-96px))] w-[min(980px,calc(100%-64px))] min-w-0 flex-col gap-3 text-[#d8d8d8]">
    <div className="flex items-center justify-between text-sm text-[#eeeeee]"><div className="flex items-center gap-2"><FolderTree size={16} /><span>Carpetas</span></div><button type="button" onClick={loadProject} className="rounded-md p-1.5 text-[#777777] hover:bg-[var(--color-surface-3)] hover:text-[#eeeeee]" aria-label="Actualizar panel" title="Actualizar"><RefreshCw size={14} /></button></div>
    <div className="flex min-h-0 flex-1 overflow-hidden rounded-xl border border-[var(--color-surface-8)] bg-[var(--color-surface-1)]">
      {loading ? <span className="p-4 text-xs text-[#8f8f8f]">Cargando...</span> : <><div className="w-[min(290px,38%)] min-w-[190px] overflow-auto border-r border-[var(--color-surface-8)] p-2 [scrollbar-width:none]">{loadError ? <span className="p-2 text-xs text-[#a87878]">{loadError}</span> : tree.length ? renderTree(tree) : <span className="p-2 text-xs text-[#777777]">No se encontraron archivos.</span>}</div><div className="min-w-0 flex-1 overflow-hidden bg-[#101010]">{selectedPath ? <CodeMirrorFileEditor path={selectedPath} content={selectedContent} /> : <div className="flex h-full items-center justify-center text-xs text-[#666666]">Seleccioná un archivo para verlo</div>}</div></>}
    </div>
  </div>;
}

function AppleFoldersView({ projectPath }: { projectPath?: string }) {
  const [loading, setLoading] = useState(true);
  const [entries, setEntries] = useState<ProjectFileEntry[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedPath, setSelectedPath] = useState('');
  const [selectedContent, setSelectedContent] = useState('');
  const [error, setError] = useState('');

  const loadProject = async () => {
    if (!projectPath) return;
    setLoading(true); setError('');
    try {
    const result = await invoke<ProjectFileEntry[]>('codeclub_list_files', { projectPath, maxFiles: 1200 });
      setEntries(result);
      setExpanded(new Set(result.filter((entry) => entry.kind === 'directory').map((entry) => entry.path)));
    } catch (reason) { setEntries([]); setError(String(reason)); } finally { setLoading(false); }
  };

  useEffect(() => { loadProject(); }, [projectPath]);
  const openFile = async (path: string) => {
    if (!projectPath) return;
    try { setSelectedContent(await invoke<string>('codeclub_read_file', { projectPath, path })); }
    catch (reason) { setSelectedContent(`No se pudo abrir el archivo: ${String(reason)}`); }
    setSelectedPath(path);
  };
  const renderFlat = (items: ProjectFileEntry[]): React.ReactNode => items
    .slice()
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((entry) => (
      <button
        key={`${entry.kind}-${entry.path}`}
        type="button"
        onClick={() => entry.kind !== 'directory' && openFile(entry.path)}
        className={`flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-[12px] transition-colors ${selectedPath === entry.path ? 'bg-[var(--color-surface-7)] text-[#eeeeee]' : 'text-[#bdbdbd] hover:bg-[var(--color-surface-3)]'}`}
      >
        {entry.kind === 'directory' ? <Folder size={14} className="shrink-0 text-[#a89b72]" /> : <FileCode2 size={14} className="shrink-0 text-[#777777]" />}
        <span className="min-w-0 flex-1 truncate">{entry.path}</span>
      </button>
    ));
  const renderTree = (_nodes: FileTreeNode[]): React.ReactNode => renderFlat(entries);
  const tree = buildFileTree(entries);
  const selectedParts = selectedPath.split('/').filter(Boolean);
  return <div className={`flex h-full w-full min-w-0 flex-col overflow-hidden text-[#d8d8d8] [&>div>aside>div:first-child]:hidden ${tree.length ? '' : '[&>div>aside]:hidden'}`}>
    {loading ? <div className="flex flex-1 items-center justify-center text-xs text-[#777777]">Cargando proyecto...</div> : <div className="flex min-h-0 flex-1"><aside className="flex w-[250px] shrink-0 flex-col border-r border-[var(--color-surface-8)] bg-transparent"><div className="flex items-center justify-between px-3 py-3"><span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#777777]">Archivos</span><span className="text-[10px] text-[#555555]">{entries.length}</span></div><div className="min-h-0 flex-1 overflow-auto px-2 pb-3 [scrollbar-width:none]">{error ? <div className="rounded-lg bg-[#2b1e1e] p-3 text-xs text-[#c28d8d]">{error}</div> : tree.length ? renderTree(tree) : <div className="p-3 text-xs text-[#777777]">No se encontraron archivos.</div>}</div></aside><main className="flex min-w-0 flex-1 flex-col bg-transparent">{selectedPath ? <><div className="flex h-10 shrink-0 items-center gap-1 border-b border-[var(--color-surface-8)] px-4 text-[11px] text-[#777777]">{selectedParts.map((part, index) => <React.Fragment key={`${part}-${index}`}><span className={index === selectedParts.length - 1 ? 'text-[#eeeeee]' : ''}>{part}</span>{index < selectedParts.length - 1 && <ChevronRight size={12} className="text-[#4d4d4d]" />}</React.Fragment>)}</div><div className="min-h-0 flex-1 overflow-hidden"><CodeMirrorFileEditor path={selectedPath} content={selectedContent} /></div></> : <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center"><div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-[var(--color-surface-8)] bg-[var(--color-surface-3)] text-[#777777]"><FileCode2 size={20} /></div><div><p className="m-0 text-sm text-[#bdbdbd]">Elegí un archivo</p><p className="m-1 text-xs text-[#666666]">Hacé click en cualquier archivo para abrirlo acá</p></div></div>}</main></div>}
  </div>;
}

function ProjectPanelView({ kind, projectPath }: { kind: 'diff' | 'folders'; projectPath?: string }) {
  if (kind === 'folders') return <AppleFoldersView projectPath={projectPath} />;
  return <ProjectDiffView kind={kind} projectPath={projectPath} />;
}

function ProjectDiffView({ kind, projectPath }: { kind: 'diff' | 'folders'; projectPath?: string }) {
  const [loading, setLoading] = useState(true);
  const [folders, setFolders] = useState<Array<{ path: string; kind: string }>>([]);
  const [diff, setDiff] = useState('');

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!projectPath) return;
      setLoading(true);
      try {
        if (kind === 'folders') {
          const entries = await invoke<Array<{ path: string; kind: string }>>('codeclub_list_files', {
            projectPath,
            maxFiles: 400,
          });
          if (!cancelled) setFolders(entries);
        } else {
          const result = await invoke<{ stdout: string; stderr: string }>('codeclub_run_command', {
            projectPath,
            request: { command: 'git', args: ['diff', '--stat'] },
          });
          if (!cancelled) setDiff(result.stdout || result.stderr || 'Sin cambios pendientes.');
        }
      } catch (error) {
        if (!cancelled) setDiff(`No se pudo cargar ${kind}: ${String(error)}`);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [kind, projectPath]);

  return (
    <div className="flex h-full w-full min-w-0 flex-col gap-3 text-[#d8d8d8]">
      <div className="flex items-center gap-2 text-sm text-[#eeeeee]">
        {kind === 'folders' ? <FolderTree size={16} /> : <GitCompare size={16} />}
        <span>{kind === 'folders' ? 'Carpetas' : 'Cambios'}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-transparent p-0 text-xs [scrollbar-width:none]">
        {loading ? (
          <span className="text-[#8f8f8f]">Cargando...</span>
        ) : kind === 'folders' ? (
          <div className="flex flex-col gap-1">
            {folders.map((entry) => (
              <div key={`${entry.kind}-${entry.path}`} className="flex items-center gap-2 rounded-md px-2 py-1 text-[#bdbdbd] hover:bg-[var(--color-surface-3)]">
                {entry.kind === 'directory' ? <FolderTree size={13} /> : <span className="w-[13px] text-center text-[#777777]">·</span>}
                <span className="truncate">{entry.path}</span>
              </div>
            ))}
          </div>
        ) : (
          <pre className="m-0 whitespace-pre-wrap font-mono leading-5 text-[#bdbdbd]">{diff || 'Sin cambios pendientes.'}</pre>
        )}
      </div>
    </div>
  );
}

