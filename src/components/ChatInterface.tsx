import React, { useState, useRef, useEffect } from 'react';
import { ArrowUpRight, Check, ChevronDown, ChevronRight, Copy, FileCode2, Folders as FolderOpen, KeyRound, ListTodo, MessageSquare, Paperclip, RotateCcw, Search, Square, Terminal, Folder, FolderTree, RefreshCw, X } from 'lucide-react';
import { EditorView, keymap, lineNumbers } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { javascript } from '@codemirror/lang-javascript';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { python } from '@codemirror/lang-python';
import { rust } from '@codemirror/lang-rust';
import { sql } from '@codemirror/lang-sql';
import { xml } from '@codemirror/lang-xml';
import { oneDark } from '@codemirror/theme-one-dark';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { exists, mkdir, readFile, readTextFile, remove, writeTextFile } from '@tauri-apps/plugin-fs';
import { open } from '@tauri-apps/plugin-dialog';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { jsonSchema, Output } from 'ai';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { createPortal } from 'react-dom';
import mammoth from 'mammoth';
import { createBusinessTools, createTools, verifyToolExecutionWithAI } from '../lib/engine/tools';
import { runStream } from '../lib/engine/run';
import { getProjectFilePath, getSetting, logPersistence, setSetting } from '../lib/persistence';
import { appendGenerationUsage, type GenerationUsageRecord } from '../lib/usage';
import { appendExecutionLog } from '../lib/execution-log';
import { getProjectChatPath, readGlobalChatHistory, readGlobalChats, readProjectIndex, readProjectMeta, writeGlobalChatHistory, writeGlobalChats, writeProjectMeta } from '../lib/projectManager';

const SPINNER_FRAMES = {
  chat: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧"],
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

const formatDuration = (durationMs: number) => durationMs >= 60000 ? `${(durationMs / 60000).toFixed(1)} min` : `${Math.max(0.1, durationMs / 1000).toFixed(1)} s`;

type ChatAttachment = { path: string; name: string; mediaType: string; size?: number; previewUrl?: string };

const getAttachmentName = (path: string) => path.split(/[\\/]/).pop() || path;
const getAttachmentMediaType = (name: string) => {
  const extension = name.split('.').pop()?.toLowerCase();
  const types: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
    txt: 'text/plain', md: 'text/markdown', mdx: 'text/markdown', json: 'application/json', csv: 'text/csv',
    js: 'text/javascript', jsx: 'text/javascript', ts: 'text/typescript', tsx: 'text/typescript', css: 'text/css',
    html: 'text/html', htm: 'text/html', rs: 'text/plain', py: 'text/x-python', sql: 'text/plain',
    pdf: 'application/pdf', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  };
  return types[extension || ''] || 'application/octet-stream';
};

const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
};

const readAttachmentParts = async (attachments: ChatAttachment[]) => {
  const parts: any[] = [];
  for (const attachment of attachments) {
    try {
      if (attachment.mediaType.startsWith('text/') || attachment.mediaType === 'application/json') {
        const text = await readTextFile(attachment.path);
        parts.push({ type: 'text', text: `Archivo ${attachment.name}:\n${text.slice(0, 120_000)}` });
      } else {
        const bytes = await readFile(attachment.path);
        const data = bytesToBase64(bytes);
        const dataUrl = `data:${attachment.mediaType};base64,${data}`;
        parts.push(attachment.mediaType.startsWith('image/')
          ? { type: 'image', image: dataUrl, mediaType: attachment.mediaType }
          : { type: 'file', data: dataUrl, mediaType: attachment.mediaType, filename: attachment.name });
      }
    } catch (error) {
      console.error(`No se pudo leer el archivo adjunto ${attachment.name}:`, error);
      parts.push({ type: 'text', text: `No se pudo leer el archivo adjunto: ${attachment.name}` });
    }
  }
  return parts;
};

const getArtifactOutputConfig = (mode: 'business' | 'development', prompt: string) => {
  const text = prompt.toLowerCase();
  if (mode === 'business' && /cotiz|presupuesto|propuesta|estimaci[oó]n/.test(text)) {
    return Output.object({
      name: 'QuoteArtifact',
      description: 'A validated quotation summary for the project Artifacts panel.',
      schema: jsonSchema({
        type: 'object',
        properties: {
          title: { type: 'string' },
          description: { type: 'string' },
          currency: { type: 'string' },
          items: { type: 'array', items: { type: 'object', properties: { type: { type: 'string', enum: ['outcome', 'deliverable', 'milestone'] }, description: { type: 'string' }, outcome: { type: 'string' }, metric: { type: 'string' }, amount: { type: 'number' }, total: { type: 'number' } }, required: ['type', 'description', 'outcome', 'metric', 'amount', 'total'], additionalProperties: false } },
          total: { type: 'number' },
        },
        required: ['title', 'description', 'currency', 'items', 'total'],
        additionalProperties: false,
      }),
    });
  }
  if (mode === 'development' && /todo|tareas?|pendientes?/.test(text)) {
    return Output.object({
      name: 'TodoArtifact',
      description: 'A validated TODO summary for the project Artifacts panel.',
      schema: jsonSchema({
        type: 'object',
        properties: {
          items: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, description: { type: 'string' }, status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'blocked'] } }, required: ['title', 'description', 'status'], additionalProperties: false } },
        },
        required: ['items'],
        additionalProperties: false,
      }),
    });
  }
  if (mode === 'development' && /plan|planific|roadmap/.test(text)) {
    return Output.object({
      name: 'PlanArtifact',
      description: 'A validated implementation plan summary for the project Artifacts panel.',
      schema: jsonSchema({
        type: 'object',
        properties: {
          title: { type: 'string' },
          objective: { type: 'string' },
          steps: { type: 'array', items: { type: 'string' } },
          status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'blocked'] },
        },
        required: ['title', 'objective', 'steps', 'status'],
        additionalProperties: false,
      }),
    });
  }
  return null;
};

const formatArtifactOutput = (output: any) => {
  if (output?.items && output?.total !== undefined) return `Cotización «${output.title}» preparada y validada para Artifacts.`;
  if (output?.items) return `${output.items.length} TODO${output.items.length === 1 ? '' : 's'} estructurado${output.items.length === 1 ? '' : 's'} y validado${output.items.length === 1 ? '' : 's'} para Artifacts.`;
  if (output?.steps) return `Plan «${output.title}» estructurado y validado para Artifacts.`;
  return null;
};

export default function ChatInterface({ catalog, defaultProvider, defaultModel, panelId = 'left', eventPrefix = 'codeclub', selectedProject, blockedPanelState = 'blank' }) {
  const [messages, setMessages] = useState([]);
  const [copiedMessageIndex, setCopiedMessageIndex] = useState<number | null>(null);
  const copyResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [input, setInput] = useState('');
  const [artifactReference, setArtifactReference] = useState<{ kind: 'plan' | 'todo' | 'quote'; id: string; title: string } | null>(null);
  const [browserReferences, setBrowserReferences] = useState<{ id: string; title: string; text: string }[]>([]);
  const browserRefContainerRef = useRef<HTMLDivElement>(null);
  const [maxVisibleBrowserRefs, setMaxVisibleBrowserRefs] = useState(3);
  const [inputFocused, setInputFocused] = useState(false);
  const [avatarColor, setAvatarColor] = useState('#3b6bb5');
  const [attachedFiles, setAttachedFiles] = useState<ChatAttachment[]>([]);
  const chatPanelRef = useRef<HTMLDivElement>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [agentState, setAgentState] = useState('idle');
  const [activeToolName, setActiveToolName] = useState('');
  const [pendingApprovals, setPendingApprovals] = useState([]);
  const toolStateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const visualAnimationRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const generationIdRef = useRef(0);
  const [composerDocked, setComposerDocked] = useState(true);
  const composerDockedRef = useRef(false);

  const [currentProvider, setCurrentProvider] = useState(defaultProvider);
  const [currentModel, setCurrentModel] = useState(defaultModel);
  const [settingsReady, setSettingsReady] = useState(false);
  const [username, setUsername] = useState('Usuario');
  const [showEmptyGreeting, setShowEmptyGreeting] = useState(true);
  const [credentialProvider, setCredentialProvider] = useState(null);
  const [credentialInput, setCredentialInput] = useState('');
  const credentialInputRef = useRef<HTMLInputElement>(null);
  const [customHeader, setCustomHeader] = useState('');
  const [customBody, setCustomBody] = useState('');
  const [customToolsFormat, setCustomToolsFormat] = useState<'json' | 'xml'>('json');
  const [customCredentialInput, setCustomCredentialInput] = useState('');
  const [customUrl, setCustomUrl] = useState('');
  const [customConfigError, setCustomConfigError] = useState('');
  const customHeaderRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void getSetting('codeclub_avatar_color', '#3b6bb5').then(setAvatarColor);
    void invoke<string>('codeclub_get_username').then((name) => setUsername(name || 'Usuario')).catch(() => setUsername('Usuario'));
    const handleProfileChange = (event) => setAvatarColor(event.detail?.color || '#3b6bb5');
    window.addEventListener('codeclub:profile-changed', handleProfileChange);
    return () => window.removeEventListener('codeclub:profile-changed', handleProfileChange);
  }, []);

  const [menuOpen, setMenuOpen] = useState(false);
  const [commandKind, setCommandKind] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [projectOptions, setProjectOptions] = useState<any[]>([]);
  const [activeCommandIndex, setActiveCommandIndex] = useState(0);
  const [activeProject, setActiveProject] = useState<{projectPath: string, name: string} | null>(() => selectedProject ? { projectPath: selectedProject.projectPath, name: selectedProject.projectName || 'Proyecto' } : null);
  const [projectMeta, setProjectMeta] = useState<{chats: any[]} | null>(null);
  const [expandedMenu, setExpandedMenu] = useState<'chat' | null>(null);
  const [newArtifactName, setNewArtifactName] = useState('');
  const [artifactSearch, setArtifactSearch] = useState<Record<string, string>>({});
  const [recentArtifactIds, setRecentArtifactIds] = useState<Record<string, string[]>>({});
  const [terminalCount, setTerminalCount] = useState(0);
  const [activeChat, setActiveChat] = useState<{chatId: string, projectPath: string} | null>(null);
  const activeChatRef = useRef<{chatId: string, projectPath: string} | null>(null);
  const [workspaceMode, setWorkspaceMode] = useState('blank');
  const [chatMode, setChatMode] = useState<'development' | 'business'>('development');
  const [selectedStructurePath, setSelectedStructurePath] = useState('');
  const agentStatusText = {
    idle: "Listo cuando tú lo estés.",
    streaming: "Generando respuesta...",
    tool_call: "Usando herramienta...",
    approval: "Esperando aprobación...",
    running: "Ejecutando...",
    error: "Algo salió mal.",
  }[agentState] || "Listo cuando tú lo estés.";
  const isAgentBusy = isStreaming;
  useEffect(() => { window.dispatchEvent(new CustomEvent('codeclub:agent-activity', { detail: { state: agentState, tool: activeToolName, agent: chatMode === 'business' ? 'Negocios' : 'Desarrollo' } })); }, [agentState, activeToolName, chatMode]);
  useEffect(() => {
    const handleArtifactReference = (event: Event) => {
      const detail = (event as CustomEvent<{ projectPath?: string; kind?: 'plan' | 'todo' | 'quote'; id?: string; title?: string }>).detail;
      if (!detail?.kind || !detail.id || !detail.title) return;
      if (detail.projectPath && detail.projectPath !== activeProject?.projectPath) return;
      setArtifactReference({ kind: detail.kind, id: detail.id, title: detail.title });
      requestAnimationFrame(() => chatInputRef.current?.focus());
    };
    window.addEventListener('codeclub:artifact-reference', handleArtifactReference);
    return () => window.removeEventListener('codeclub:artifact-reference', handleArtifactReference);
  }, [activeProject?.projectPath]);
  useEffect(() => {
    if (!browserRefContainerRef.current) return;
    const updateMaxVisible = () => {
      const width = browserRefContainerRef.current?.clientWidth || 300;
      const count = Math.max(1, Math.floor((width - 95) / 125));
      setMaxVisibleBrowserRefs(count);
    };
    updateMaxVisible();
    const observer = new ResizeObserver(updateMaxVisible);
    observer.observe(browserRefContainerRef.current);
    return () => observer.disconnect();
  }, [browserReferences.length]);
  useEffect(() => {
    const handleBrowserReference = (event: Event) => {
      const detail = (event as CustomEvent<{ title?: string; text?: string }>).detail;
      if (!detail?.text) return;
      const newItem = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        title: detail.title || 'Referencia',
        text: detail.text,
      };
      setBrowserReferences((current) => {
        if (current.some((item) => item.text === newItem.text)) return current;
        return [...current, newItem];
      });
      requestAnimationFrame(() => chatInputRef.current?.focus());
    };
    window.addEventListener('codeclub:browser-reference', handleBrowserReference);
    return () => window.removeEventListener('codeclub:browser-reference', handleBrowserReference);
  }, []);
  const approvalResolversRef = useRef(new Map());
  const lastModelFetchRef = useRef(null);
  const commandMenuRef = useRef(null);
  const commandMenuHostRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef(null);
  const chatInputRef = useRef(null);
  const messagesEndRef = useRef(null);
  const rememberRecentArtifact = (kind: 'chat', detail: any) => {
    if (!detail?.projectPath || !detail?.[`${kind}Id`]) return;
    const key = `${detail.projectPath}:${kind}`;
    const storageKey = `codeclub:recent-artifacts:${kind}:${encodeURIComponent(detail.projectPath)}`;
    setRecentArtifactIds((current) => {
      const ids = [detail[`${kind}Id`], ...(current[key] || [])].filter((id, index, all) => all.indexOf(id) === index).slice(0, 3);
      void setSetting(storageKey, ids);
      return { ...current, [key]: ids };
    });
  };

  const getRecentArtifactIds = (kind: 'chat', projectPath: string) => {
    const key = `${projectPath}:${kind}`;
    if (recentArtifactIds[key]) return recentArtifactIds[key];
    return [];
  };

  useEffect(() => {
    if (!activeProject?.projectPath) return;
    const kind = 'chat';
    const key = `${activeProject.projectPath}:${kind}`;
    void getSetting<string[]>(`codeclub:recent-artifacts:${kind}:${encodeURIComponent(activeProject.projectPath)}`, []).then((ids) => {
      setRecentArtifactIds((current) => current[key] ? current : { ...current, [key]: ids });
    });
  }, [activeProject?.projectPath]);

  useEffect(() => {
    composerDockedRef.current = composerDocked;
  }, [composerDocked]);

  useEffect(() => {
    setActiveProject((current) => {
      if (!selectedProject) return null;
      if (current?.projectPath === selectedProject.projectPath) return current;
      activeChatRef.current = null;
      setActiveChat(null);
      return { projectPath: selectedProject.projectPath, name: selectedProject.projectName || 'Proyecto' };
    });
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
    const handleOpenChat = async (e: any) => {
      const chat = e.detail;
      rememberRecentArtifact('chat', chat);
      setWorkspaceMode('chat');
      setActiveChat(chat);
      activeChatRef.current = chat;
      const project = chat.projectPath ? {
        projectPath: chat.projectPath,
        projectName: chat.projectName || 'Proyecto',
      } : null;
      setActiveProject(project ? { projectPath: project.projectPath, name: project.projectName } : null);
      window.dispatchEvent(new CustomEvent('codeclub:project-selection-changed', {
        detail: project ? { selected: true, projectPath: project.projectPath, projectName: project.projectName } : { selected: false, keepChat: true },
      }));
      window.dispatchEvent(new CustomEvent('codeclub:active-project', { detail: project }));
      setMessages([]);
      setInput('');
      setAttachedFiles([]);
      setAgentState('idle');
      setPendingApprovals([]);
      approvalResolversRef.current.clear();
      const wasDocked = composerDockedRef.current;
      try {
        if (!chat.projectPath) {
          const parsed = await readGlobalChatHistory(chat.chatId);
          setMessages(parsed);
          if (!wasDocked && parsed.length > 0) setComposerDocked(true);
          return;
        }
        const { readTextFile, exists } = await import('@tauri-apps/plugin-fs');
        const path = await getProjectChatPath(chat.projectPath, chat.chatId);
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
    const handleOpenEmptyChat = () => {
      setWorkspaceMode('chat');
      activeChatRef.current = null;
      setActiveChat(null);
      setMessages([]);
      setInput('');
      setAttachedFiles([]);
      setPendingApprovals([]);
      setAgentState('idle');
      approvalResolversRef.current.clear();
    };
    window.addEventListener('codeclub:open-empty-chat', handleOpenEmptyChat);
    return () => window.removeEventListener('codeclub:open-empty-chat', handleOpenEmptyChat);
  }, []);

  useEffect(() => {
    const handleChatProjectChanged = async (event: Event) => {
      const detail = (event as CustomEvent).detail || {};
      const current = activeChatRef.current;
      if (!current || current.chatId !== detail.chatId || typeof detail.projectPath !== 'string' || current.projectPath === detail.projectPath) return;
      const oldPath = current.projectPath;
      const newPath = detail.projectPath;
      const chatName = (current as any).name || 'Chat';
      activeChatRef.current = { ...current, projectPath: newPath, projectName: detail.projectName, name: chatName };
      setActiveChat(activeChatRef.current);
      try {
        const oldMessages = oldPath ? await (async () => {
          const oldFile = await getProjectChatPath(oldPath, current.chatId);
          return (await exists(oldFile)) ? await readTextFile(oldFile) : '';
        })() : (await readGlobalChatHistory(current.chatId)).map((message) => JSON.stringify(message)).join('\n');
        if (!newPath) {
          const parsedMessages = oldMessages.split('\n').filter(Boolean).map((line) => JSON.parse(line));
          await writeGlobalChatHistory(current.chatId, parsedMessages);
          const globalChats = await readGlobalChats();
          if (!globalChats.some((chat) => chat.id === current.chatId)) globalChats.push({ id: current.chatId, name: chatName, projectPath: '', projectName: 'Sin proyecto' });
          await writeGlobalChats(globalChats);
          if (oldPath) {
            const oldFile = await getProjectChatPath(oldPath, current.chatId);
            if (await exists(oldFile)) await remove(oldFile);
            const oldMeta = await readProjectMeta(oldPath);
            if (oldMeta) { oldMeta.chats = oldMeta.chats.filter((chat) => chat.id !== current.chatId); await writeProjectMeta(oldPath, oldMeta); }
            window.dispatchEvent(new CustomEvent('codeclub:project-meta-changed', { detail: { projectPath: oldPath } }));
          }
          window.dispatchEvent(new CustomEvent('codeclub:global-chat-changed'));
          return;
        }
        const newDir = await getProjectFilePath(newPath, 'chats');
        const newFile = await getProjectChatPath(newPath, current.chatId);
        await mkdir(newDir, { recursive: true });
        if (oldMessages) await writeTextFile(newFile, oldMessages.endsWith('\n') ? oldMessages : `${oldMessages}\n`);
        if (oldPath) {
          const oldFile = await getProjectChatPath(oldPath, current.chatId);
          if (await exists(oldFile)) await remove(oldFile);
          const oldMeta = await readProjectMeta(oldPath);
          if (oldMeta) { oldMeta.chats = oldMeta.chats.filter((chat) => chat.id !== current.chatId); await writeProjectMeta(oldPath, oldMeta); }
        } else {
          const globalChats = await readGlobalChats();
          await writeGlobalChats(globalChats.filter((chat) => chat.id !== current.chatId));
        }
        const newMeta = await readProjectMeta(newPath) || { name: detail.projectName || 'Proyecto', path: newPath, created_at: new Date().toISOString(), chats: [] };
        if (!newMeta.chats.some((chat) => chat.id === current.chatId)) newMeta.chats.push({ id: current.chatId, name: chatName });
        await writeProjectMeta(newPath, newMeta);
        window.dispatchEvent(new CustomEvent('codeclub:project-meta-changed', { detail: { projectPath: oldPath } }));
        window.dispatchEvent(new CustomEvent('codeclub:project-meta-changed', { detail: { projectPath: newPath } }));
      } catch (error) { console.error('Error vinculando chat al proyecto:', error); }
    };
    window.addEventListener('codeclub:chat-project-changed', handleChatProjectChanged);
    return () => window.removeEventListener('codeclub:chat-project-changed', handleChatProjectChanged);
  }, []);

  useEffect(() => {
    const handleChatMode = (event: Event) => setChatMode((event as CustomEvent).detail?.mode === 'business' ? 'business' : 'development');
    window.addEventListener('codeclub:chat-mode-changed', handleChatMode);
    return () => window.removeEventListener('codeclub:chat-mode-changed', handleChatMode);
  }, []);

  useEffect(() => {
    if (messages.length === 0) {
      setShowEmptyGreeting(true);
      return;
    }
    const timer = window.setTimeout(() => setShowEmptyGreeting(false), 320);
    return () => window.clearTimeout(timer);
  }, [messages.length]);

  useEffect(() => {
    const handlers = (['folders'] as const).map((kind) => {
      const eventName = `${eventPrefix}:open-${kind}`;
      const handler = (e: any) => {
      setWorkspaceMode(kind);
        setSelectedStructurePath(kind === 'folders' ? e.detail?.path || '' : '');
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
      if (e.detail?.projectPath && activeChatRef.current?.projectPath !== e.detail.projectPath) {
        activeChatRef.current = null;
        setActiveChat(null);
      }
      setActiveProject(e.detail?.projectPath ? (current) => current?.projectPath === e.detail.projectPath ? current : e.detail : null);
      setExpandedMenu(null);
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
          setProjectMeta(await readProjectMeta(activeProject.projectPath));
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
        setActiveProject(null);
        setProjectMeta(null);
      }
      setAgentState('idle');
      setPendingApprovals([]);
      approvalResolversRef.current.clear();
    };

    const blankEvent = `${eventPrefix}:open-blank`;
    window.addEventListener(blankEvent, handleOpenBlank);

    return () => {
      window.removeEventListener(blankEvent, handleOpenBlank);
    };
  }, [eventPrefix]);

  useEffect(() => {
    Promise.all([
      getSetting('codeclub_last_provider_id', ''),
      getSetting('codeclub_last_model_id', ''),
    ]).then(([savedProviderId, savedModelId]) => {
      const savedProvider = savedProviderId ? catalog.find((item) => item.type === 'provider' && item.id === savedProviderId) : null;
      const savedModel = savedModelId ? catalog.find((item) => item.type === 'model' && item.id === savedModelId) : null;
      setCurrentProvider(savedProvider || defaultProvider);
      setCurrentModel(savedModel || defaultModel);
      setSettingsReady(true);
    });
  }, [catalog, defaultProvider, defaultModel]);

  useEffect(() => {
    if (settingsReady && currentProvider) void setSetting('codeclub_last_provider_id', currentProvider.id);
  }, [currentProvider, settingsReady]);

  useEffect(() => {
    if (settingsReady && currentModel) void setSetting('codeclub_last_model_id', currentModel.id);
  }, [currentModel, settingsReady]);

  const openCommandMenu = (kind) => {
    setCommandKind(kind);
    setMenuOpen(true);
    setSearchQuery('');
    setActiveCommandIndex(0);
    setTimeout(() => commandMenuRef.current?.focus(), 10);
  };

  useEffect(() => {
    window.dispatchEvent(new CustomEvent('codeclub:command-menu-state', {
      detail: { open: menuOpen, kind: menuOpen ? commandKind : '' },
    }));
  }, [menuOpen, commandKind]);

  useEffect(() => () => {
    if (toolStateTimerRef.current) clearTimeout(toolStateTimerRef.current);
  }, []);

  useEffect(() => {
    const handleOpenCommandMenu = (event: Event) => {
      const kind = (event as CustomEvent).detail?.kind;
      if (kind === 'provider' || kind === 'model') {
        if (menuOpen && commandKind === kind) setMenuOpen(false);
        else openCommandMenu(kind);
      }
      if (kind === 'project') {
        if (menuOpen && commandKind === kind) {
          setMenuOpen(false);
          return;
        }
        void readProjectIndex().then((projects) => {
          setProjectOptions([{ id: '__none__', label: 'Sin proyecto', type: 'project', projectPath: null, isNone: true }, ...projects.map((project) => ({ id: project.path, label: project.name, type: 'project', projectPath: project.path }))]);
          openCommandMenu('project');
        });
      }
    };
    window.addEventListener('codeclub:open-command-menu', handleOpenCommandMenu);
    return () => window.removeEventListener('codeclub:open-command-menu', handleOpenCommandMenu);
  }, [menuOpen, commandKind]);

  const filteredCatalog = (commandKind === 'project' ? projectOptions : catalog).filter((item) => {
    const matchesKind = item.type === commandKind;
    const itemLabel = item.label || item.id || '';
    const matchesQuery = itemLabel.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesProvider = commandKind !== 'model' || item.providerId === currentProvider?.id;
    return matchesKind && matchesQuery && matchesProvider;
  });
  const activeSelection = commandKind === 'provider' ? currentProvider : commandKind === 'model' ? currentModel : commandKind === 'project' && activeProject ? { id: activeProject.projectPath, label: activeProject.name } : null;
  const slashCommands = [
    { id: 'proveedor', label: '/proveedor', description: 'Seleccionar proveedor', type: 'command' },
    { id: 'modelo', label: '/modelo', description: 'Seleccionar modelo', type: 'command' },
    { id: 'proyecto', label: '/proyecto', description: 'Seleccionar proyecto', type: 'command' },
  ].filter((command) => command.label.toLowerCase().includes(searchQuery.toLowerCase()));

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
      const button = (event.target as HTMLElement).closest('button') as HTMLButtonElement | null;
      const isCommandDockButton = /^(Proveedor|Modelo|Proyecto):/.test(button?.getAttribute('aria-label') || '');
      if (commandMenuRef.current?.contains(event.target) || button?.title === 'Proveedor, modelo y proyecto' || isCommandDockButton) return;
      setMenuOpen(false);
    };

    window.addEventListener('pointerdown', handlePointerDown);
    return () => window.removeEventListener('pointerdown', handlePointerDown);
  }, [menuOpen]);

  const handleItemClick = (item) => {
    if (item.type === 'command') {
      if (item.id === 'proyecto') {
        void readProjectIndex().then((projects) => {
          setProjectOptions([{ id: '__none__', label: 'Sin proyecto', type: 'project', projectPath: null, isNone: true }, ...projects.map((project) => ({ id: project.path, label: project.name, type: 'project', projectPath: project.path }))]);
          openCommandMenu('project');
        });
        return;
      }
      setInput(`/${item.id}`);
      setMenuOpen(false);
      chatInputRef.current?.focus();
      return;
    }
    if (item.type === 'project') {
      if (item.isNone) {
        setActiveProject(null);
        activeChatRef.current = null;
        setActiveChat(null);
        window.dispatchEvent(new CustomEvent('codeclub:project-selection-changed', { detail: { selected: false, keepChat: true } }));
        window.dispatchEvent(new CustomEvent('codeclub:active-project', { detail: { projectPath: null, projectName: '' } }));
      } else {
        setActiveProject({ projectPath: item.projectPath, name: item.label });
        activeChatRef.current = null;
        setActiveChat(null);
        window.dispatchEvent(new CustomEvent('codeclub:project-selection-changed', { detail: { selected: true, projectPath: item.projectPath, projectName: item.label } }));
        window.dispatchEvent(new CustomEvent('codeclub:active-project', { detail: { projectPath: item.projectPath, projectName: item.label } }));
      }
      setMenuOpen(false);
      setCommandKind('');
      return;
    }
    if (item.type === 'provider') {
      setCurrentProvider(item);
      const isCustomProvider = item.id === 'custom';
      setCredentialProvider(isCustomProvider ? null : item);
      setCredentialInput('');
      setInput('');
      setCommandKind(isCustomProvider ? 'custom-config' : 'credential');
      setSearchQuery('');
      if (isCustomProvider) {
        void Promise.all([
          getSetting('codeclub_custom_header', ''),
          getSetting('codeclub_custom_body', ''),
          getSetting<'json' | 'xml'>('codeclub_custom_tools_format', 'json'),
          getSetting('custom_api_key', ''),
          getSetting('codeclub_custom_url', ''),
        ]).then(([header, body, format, credential, url]) => {
          setCustomHeader(header);
          setCustomBody(body);
          setCustomToolsFormat(format === 'xml' ? 'xml' : 'json');
          setCustomCredentialInput(credential);
          setCustomUrl(url);
          setCurrentProvider((current) => current ? { ...current, api: url } : current);
        });
      }
      const firstModel = catalog.find((m) => m.type === 'model' && m.providerId === item.id);
      if (firstModel) setCurrentModel(firstModel);
    } else if (item.type === 'model') {
      setCurrentModel(item);
      setCredentialProvider(null);
    }
    if (item.type !== 'provider') {
      setInput((prev) => prev.replace(/\/(proveedor|modelo)$/i, '').trimStart());
    }
    if (item.type === 'provider') {
      setMenuOpen(true);
    } else {
      setMenuOpen(false);
      setCommandKind('');
    }
    if (item.type === 'provider') {
      setTimeout(() => (item.id === 'custom' ? customHeaderRef.current : credentialInputRef.current)?.focus(), 0);
    } else {
      chatInputRef.current?.focus();
    }
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

  const saveCredential = () => {
    if (!credentialProvider || !credentialInput.trim()) return;
    void setSetting(`${credentialProvider.id}_api_key`, credentialInput.trim());
    setCredentialProvider(null);
    setCredentialInput('');
    setMenuOpen(false);
    setCommandKind('');
    chatInputRef.current?.focus();
  };

  const saveCustomProviderConfig = () => {
    if (!customUrl.trim()) {
      setCustomConfigError('La URL es obligatoria.');
      return;
    }
    void Promise.all([
      setSetting('codeclub_custom_header', customHeader.trim()),
      setSetting('codeclub_custom_body', customBody),
      setSetting('codeclub_custom_tools_format', customToolsFormat),
      setSetting('custom_api_key', customCredentialInput.trim()),
      setSetting('codeclub_custom_url', customUrl.trim()),
    ]);
    setCurrentProvider((current) => current ? { ...current, api: customUrl.trim() } : current);
    setCustomConfigError('');
    setMenuOpen(false);
    setCommandKind('');
    chatInputRef.current?.focus();
  };

const compactJson = (value) => {
    try {
      return JSON.stringify(value).slice(0, 260);
    } catch {
      return String(value).slice(0, 260);
    }
};

const readWorkspaceChangeSummary = async (projectPath?: string) => {
  if (!projectPath) return null;
  try {
    const result = await invoke<{ code?: number | null; stdout: string; stderr: string }>('codeclub_run_command', {
      projectPath,
      request: { command: 'git', args: ['diff', 'HEAD', '--numstat', '--'] },
    });
    if (result.code !== 0) return null;
    let additions = 0;
    let deletions = 0;
    let files = 0;
    result.stdout.split(/\r?\n/).filter(Boolean).forEach((line) => {
      const [added, removed] = line.split('\t');
      if (added === '-' || removed === '-') return;
      const addedCount = Number(added);
      const removedCount = Number(removed);
      if (!Number.isFinite(addedCount) || !Number.isFinite(removedCount)) return;
      additions += addedCount;
      deletions += removedCount;
      files += 1;
    });
    const statusResult = await invoke<{ code?: number | null; stdout: string }>('codeclub_run_command', {
      projectPath,
      request: { command: 'git', args: ['status', '--short', '--untracked-files=all'] },
    });
    const untracked = statusResult.code === 0 ? statusResult.stdout.split(/\r?\n/).filter((line) => line.startsWith('?? ')).map((line) => line.slice(3).trim()).filter(Boolean) : [];
    for (const path of untracked) {
      try {
        const content = await invoke<string>('codeclub_read_file', { projectPath, path });
        additions += content.split(/\r?\n/).length;
        files += 1;
      } catch { /* Los binarios nuevos no tienen conteo de líneas. */ }
    }
    return { additions, deletions, files };
  } catch {
    return null;
  }
};

type WorkspaceSnapshot = Map<string, string | null>;

const readWorkspaceSnapshot = async (projectPath: string): Promise<WorkspaceSnapshot> => {
  const snapshot: WorkspaceSnapshot = new Map();
  try {
    const [filesResult, statusResult] = await Promise.all([
      invoke<{ code?: number | null; stdout: string }>('codeclub_run_command', { projectPath, request: { command: 'git', args: ['ls-files', '-co', '--exclude-standard'] } }),
      invoke<{ code?: number | null; stdout: string }>('codeclub_run_command', { projectPath, request: { command: 'git', args: ['status', '--short', '--untracked-files=all'] } }),
    ]);
    if (filesResult.code !== 0 && statusResult.code !== 0) return snapshot;
    const trackedPaths = filesResult.stdout.split(/\r?\n/).filter(Boolean);
    const changedPaths = statusResult.stdout.split(/\r?\n/).filter(Boolean).map((line) => line.slice(3).trim()).filter(Boolean);
    const paths = [...new Set([...trackedPaths, ...changedPaths])];
    await Promise.all(paths.map(async (path) => {
      try { snapshot.set(path, await invoke<string>('codeclub_read_file', { projectPath, path })); }
      catch { snapshot.set(path, null); }
    }));
  } catch { /* El resumen es informativo y no debe bloquear el chat. */ }
  return snapshot;
};

const lineDelta = (before: string[], after: string[]) => {
  if (before.length > 2500 || after.length > 2500) return { additions: Math.max(0, after.length - before.length), deletions: Math.max(0, before.length - after.length) };
  let previous = new Array(after.length + 1).fill(0);
  for (const beforeLine of before) {
    const current = new Array(after.length + 1).fill(0);
    for (let index = 1; index <= after.length; index += 1) current[index] = beforeLine === after[index - 1] ? previous[index - 1] + 1 : Math.max(previous[index], current[index - 1]);
    previous = current;
  }
  const unchanged = previous[after.length];
  return { additions: after.length - unchanged, deletions: before.length - unchanged };
};

const summarizeWorkspaceDelta = (before: WorkspaceSnapshot, after: WorkspaceSnapshot) => {
  let additions = 0;
  let deletions = 0;
  let files = 0;
  const paths = new Set([...before.keys(), ...after.keys()]);
  paths.forEach((path) => {
    const beforeContent = before.get(path);
    const afterContent = after.get(path);
    if (beforeContent === null || afterContent === null || beforeContent === undefined || afterContent === undefined) return;
    const delta = lineDelta((beforeContent || '').split(/\r?\n/), (afterContent || '').split(/\r?\n/));
    additions += delta.additions;
    deletions += delta.deletions;
    if (delta.additions || delta.deletions) files += 1;
  });
  return { additions, deletions, files };
};

  const escapeXml = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

  const toolsAsXml = (tools) => {
    const items = Array.isArray(tools) ? tools : [];
    return `<tools>${items.map((item) => {
      const fn = item?.function || item || {};
      const parameters = typeof fn.parameters === 'string' ? fn.parameters : JSON.stringify(fn.parameters || {});
      return `<tool name="${escapeXml(fn.name)}" type="${escapeXml(item?.type || 'function')}"><description>${escapeXml(fn.description)}</description><parameters>${escapeXml(parameters)}</parameters></tool>`;
    }).join('')}</tools>`;
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
    let requestBody = ['GET', 'HEAD'].includes(request.method) ? undefined : await request.clone().text();
    if (requestBody && currentProvider?.id === 'custom' && customToolsFormat === 'xml') {
      try {
        const payload = JSON.parse(requestBody);
        if (Array.isArray(payload.tools)) {
          payload.tools = toolsAsXml(payload.tools);
          requestBody = JSON.stringify(payload);
        }
      } catch {
        // Dejá pasar cuerpos no JSON sin modificarlos.
      }
    }
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


  const appendToJsonl = async (msg) => {
    const chat = activeChatRef.current;
    if (!chat) return;
    if (!chat.projectPath) {
      const messages = await readGlobalChatHistory(chat.chatId);
      await writeGlobalChatHistory(chat.chatId, [...messages, msg]);
      return;
    }
    try {
      const { writeTextFile, readTextFile, exists, mkdir } = await import('@tauri-apps/plugin-fs');
      await mkdir(await getProjectFilePath(chat.projectPath, 'chats'), { recursive: true });
      const path = await getProjectChatPath(chat.projectPath, chat.chatId);
      let content = '';
      if (await exists(path)) {
        content = await readTextFile(path);
        if (content && !content.endsWith('\n')) content += '\n';
      }
      content += JSON.stringify(msg) + '\n';
      await writeTextFile(path, content);
      await logPersistence('append_chat_message', 'ok', {
        role: msg.role,
        chatId: chat.chatId,
        projectPath: chat.projectPath,
        path,
      });
    } catch (e) {
      console.error("FS Append Error:", e);
      await logPersistence('append_chat_message', 'error', {
        role: msg.role,
        chatId: chat?.chatId,
        projectPath: chat?.projectPath,
        error: e?.message || String(e),
      });
    }
  };

  const writeChatJsonl = async (nextMessages) => {
    const chat = activeChatRef.current;
    if (!chat) return;
    if (!chat.projectPath) {
      await writeGlobalChatHistory(chat.chatId, nextMessages);
      return;
    }
    try {
      const { writeTextFile, mkdir } = await import('@tauri-apps/plugin-fs');
      const dir = await getProjectFilePath(chat.projectPath, 'chats');
      const path = await getProjectChatPath(chat.projectPath, chat.chatId);
      await mkdir(dir, { recursive: true });
      await writeTextFile(path, nextMessages.map((msg) => JSON.stringify(msg)).join('\n') + '\n');
      await logPersistence('rewrite_chat_history', 'ok', {
        chatId: chat.chatId,
        projectPath: chat.projectPath,
        path,
      });
    } catch (e) {
      await logPersistence('rewrite_chat_history', 'error', {
        chatId: chat?.chatId,
        projectPath: chat?.projectPath,
        error: e?.message || String(e),
      });
    }
  };

  const sendMessage = async (content, baseMessages = messages, shouldRenameChat = messages.length === 0, replaceHistory = false, attachments: ChatAttachment[] = []) => {
    if (visualAnimationRef.current) {
      clearInterval(visualAnimationRef.current);
      visualAnimationRef.current = null;
    }
    if (artifactReference) {
      content = `${content}\n\nReferencia de artifact: @${artifactReference.kind} "${artifactReference.title}" (id: ${artifactReference.id})`;
      setArtifactReference(null);
    }
    if (browserReferences.length > 0) {
      const refsText = browserReferences
        .map((ref, idx) => `Referencia ${idx + 1}: @${ref.title}\nContenido seleccionado:\n${ref.text}`)
        .join('\n\n');
      content = `${content}\n\n${refsText}`;
      setBrowserReferences([]);
    }
    const abortController = new AbortController();
    const generationStartedAt = Date.now();
    const generationId = generationIdRef.current + 1;
    generationIdRef.current = generationId;
    abortControllerRef.current = abortController;
    const isCurrentGeneration = () => generationIdRef.current === generationId && abortControllerRef.current === abortController;
    const guardedSetAgentState = (state: string) => {
      if (isCurrentGeneration()) setAgentState(state);
    };
    const guardedRequestToolApproval = (options) => {
      if (!isCurrentGeneration()) return Promise.resolve(false);
      return requestToolApproval(options);
    };
    let chat = activeChatRef.current;
    if (!chat && activeProject?.projectPath) {
      const title = content.trim().split(/\r?\n/)[0].slice(0, 60) || 'Nuevo chat';
      const id = Date.now().toString();
      const metaData: any = await readProjectMeta(activeProject.projectPath) || { name: activeProject.name, path: activeProject.projectPath, created_at: new Date().toISOString(), chats: [] };
      if (!Array.isArray(metaData.chats)) metaData.chats = [];
      metaData.chats.push({ id, name: title });
      await writeProjectMeta(activeProject.projectPath, metaData);
      chat = { chatId: id, projectPath: activeProject.projectPath };
      activeChatRef.current = chat;
      setActiveChat(chat);
      setProjectMeta(metaData);
      window.dispatchEvent(new CustomEvent('codeclub:project-meta-changed', { detail: { projectPath: activeProject.projectPath } }));
    }

    if (!chat) {
      chat = { chatId: `global-${Date.now()}`, projectPath: '' };
      activeChatRef.current = chat;
      setActiveChat(chat);
      const globalChats = await readGlobalChats();
      globalChats.push({ id: chat.chatId, name: 'Nuevo chat', projectPath: '', projectName: 'Sin proyecto' });
      await writeGlobalChats(globalChats);
      window.dispatchEvent(new CustomEvent('codeclub:global-chat-changed'));
    }

    if (shouldRenameChat) {
      window.dispatchEvent(new CustomEvent('codeclub:chat-created', { detail: { chatId: chat.chatId } }));
      let title = content.trim();
      if (title.length > 120) title = title.substring(0, 120) + '...';
      window.dispatchEvent(new CustomEvent('codeclub:rename-chat', {
        detail: { chatId: chat.chatId, newName: title, projectPath: chat.projectPath }
      }));
    }

    const attachmentParts = attachments.length > 0 ? await readAttachmentParts(attachments) : [];
    const userMessage = { role: 'user', content, attachments: attachments.map(({ path, name, mediaType, size, previewUrl }) => ({ path, name, mediaType, size, previewUrl })) };
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

      let apiKey = await getSetting(`${currentProvider.id}_api_key`, '');
      
      if ((!apiKey || apiKey === 'dummy-key') && currentProvider.id !== 'custom') {
        throw new Error(`API Key no configurada para ${currentProvider.label || currentProvider.id}. Por favor agregala en la configuración.`);
      }
      
      const provider = createOpenAICompatible({
        name: currentProvider.id,
        baseURL: currentProvider.api || 'https://api.openai.com/v1',
        apiKey,
        fetch: tauriModelFetch,
      });

      let assistantContent = '';
      let assistantReasoning = '';
      let assistantTools = [];
      let executionStartedAt = Date.now();
      let latestUsage: GenerationUsageRecord | null = null;
      const updateAssistantMessage = () => {
        setMessages([...newMessages, { role: 'assistant', content: assistantContent, reasoning: assistantReasoning, tools: assistantTools, agentName: chatMode === 'business' ? 'Negocios' : 'Desarrollo' }]);
      };
      const recordToolEvent = (name, input, output) => {
        setActiveToolName(name);
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
        void appendExecutionLog({ projectPath: chat?.projectPath || '', chatId: chat?.chatId, tool: name, input, output });
        if (['writeFile', 'runCommand', 'terminal'].includes(name)) window.dispatchEvent(new CustomEvent('codeclub:workspace-changed', { detail: { projectPath: chat?.projectPath || '', tool: name } }));
        if (['todo', 'createPlan', 'updatePlan', 'createQuote', 'updateBusinessWorkspace'].includes(name)) {
          window.dispatchEvent(new CustomEvent('codeclub:artifacts-changed', { detail: { projectPath: chat?.projectPath || '' } }));
        }
      };
      updateAssistantMessage();

      const toolProjectPath = chat.projectPath || await invoke<string>('codeclub_get_system_root');
      const beforeWorkspaceSnapshot = await readWorkspaceSnapshot(toolProjectPath);
      const indexedProjects = await readProjectIndex();
      const developmentTools = createTools({
        projectPath: toolProjectPath,
        recordToolEvent,
        setAgentState: guardedSetAgentState,
        requestToolApproval: guardedRequestToolApproval,
        provider,
        modelId: currentModel.id,
      });
      const allTools = chatMode === 'business'
        ? createBusinessTools({ recordToolEvent, setAgentState: guardedSetAgentState, indexedProjects, projectPath: toolProjectPath, provider, modelId: currentModel.id })
        : developmentTools;
      const toolMode = chatMode === 'business' ? 'business' : 'development';
      let tools: Record<string, any> = allTools;
      let toolRoutingContext = 'La IA de intención no devolvió contexto adicional.';
      let routingRequiresAction = false;
      let routingUsedFallback = true;
      let routingGoal = content;
      let routingVerification = 'La tool correspondiente debe devolver un resultado exitoso.';
      /*
      try {
        const routing = await resolveToolsWithAI({
          model: provider(currentModel.id),
          mode: toolMode,
          prompt: content,
          toolset: allTools,
          signal: abortController.signal,
          onUsage: async (usage) => {
            await appendGenerationUsage({
              id: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`,
              at: new Date().toISOString(),
              projectPath: chat?.projectPath || '',
              chatId: chat?.chatId || '',
              mode: `${toolMode}-tool-router`,
              provider: currentProvider.id,
              model: usage.model || currentModel.id,
              inputTokens: usage.inputTokens ?? null,
              outputTokens: usage.outputTokens ?? null,
              totalTokens: usage.totalTokens ?? null,
              reasoningTokens: usage.reasoningTokens ?? null,
              durationMs: usage.durationMs,
              status: 'completed',
            });
          },
        });
        tools = routing.tools;
        routingRequiresAction = routing.requiresAction;
        routingGoal = routing.goal;
        routingVerification = routing.verification;
        toolRoutingContext = `La IA de intención resolvió: ${routing.reason || 'intención detectada'} (confianza ${routing.confidence}). Tools habilitadas: ${Object.keys(tools).join(', ')}.`;
        void appendExecutionLog({ projectPath: chat?.projectPath || '', chatId: chat?.chatId, tool: 'tool-router', input: { mode: toolMode, prompt: content }, output: { confidence: routing.confidence, reason: routing.reason, requiresAction: routing.requiresAction, tools: Object.keys(tools) } });
      } catch (error) {
        tools = allTools;
        routingUsedFallback = true;
        routingRequiresAction = false;
        toolRoutingContext = `La IA de intención falló; se habilitó temporalmente el catálogo completo para no bloquear la tarea. Error: ${String(error)}`;
        void appendExecutionLog({ projectPath: chat?.projectPath || '', chatId: chat?.chatId, tool: 'tool-router', input: { mode: toolMode, prompt: content }, output: { status: 'fallback-all-tools', error: String(error), tools: Object.keys(tools) } });
      }
      if (!routingUsedFallback && Object.keys(tools).some((name) => ['writeFile', 'runCommand', 'terminal'].includes(name))) routingRequiresAction = true;
      */

      const system = chatMode === 'business' ? [
        'Sos el asistente de negocios de Codeclub.',
        'Usa getExecutionLog cuando necesites auditar quÃ© tools ejecutÃ³ la orquestaciÃ³n o una sub-IA; el log contiene trazas observables, no pensamiento privado.',
        'Responde en español, claro y orientado a decisiones.',
        `El proyecto activo es ${chat.projectPath || 'Sin proyecto'}.`,
        `Proyectos indexados disponibles: ${indexedProjects.map((project) => `${project.name} (${project.path})`).join(', ') || 'ninguno'}.`,
        'Usa listIndexedProjects para consultar el portfolio, getBusinessWorkspace para leer la economía, getAIUsageMetrics para medir tokens, duración y costo estimado por período, updateBusinessWorkspace para mantenerla, createExecutionPlan para planes y createBudget para presupuestos.',
        'Usa getWhatsAppBusinessContext para consultar conversaciones en tiempo real. Es estrictamente solo lectura: nunca envía mensajes.',
        'Usa listProjectFiles, readProjectFile y searchProjectText para entender la implementación, capacidades y límites técnicos. Son herramientas de solo lectura: no edites código desde Negocios.',
        'Delegá investigaciones amplias a sub-IA especialistas: en Código usa explorer, frontend, backend, qa, security o documentation; en Negocios usa delegateBusinessSpecialist con commercial, pricing, finance, operations, crm_whatsapp o strategy.',
        'Actuá como economista de resultados: analizá valor entregado, valor estimado y contratado, total cotizado, pipeline, impacto esperado, ROI, alcance, riesgo, software producido, hitos, abonos y criterios de aceptación. Nunca recomiendes tarifas basadas en tiempo ni uses tiempo como unidad comercial. Cuando estimes el valor de un proyecto, guardalo con updateBusinessWorkspace en project. Si el usuario pide mostrar, ocultar o recuperar paneles, leé dashboard.visible_panels y actualizalo permanentemente con updateBusinessWorkspace; nunca borres paneles, solo cambia su visibilidad. Si pide cambiar el formato visual, configurá dashboard.panel_types usando solo metric, progress, trend o status, según los datos disponibles; no inventes valores. Cuando pidan una cotización, usá createQuote con resultados, métricas e importes; no la simules solo en texto. Tus resultados son borradores estructurados y deben explicar supuestos cuando falten datos.',
      ].join(' ') : [
        'Sos el agente IDE de Codeclub.',
        'Si necesitas delegar implementacion, usa subagent con specialist developer. Para controlar navegador o PC, delega en specialist computer_use; esa subIA debe observar, actuar y verificar. Elegi la especialista segun el contexto; no delegues por defecto.',
        'La orquestadora recibe todas las tools disponibles y decide de forma autonoma si debe actuar, delegar o responder.',
        `Contexto de la IA de intencion: ${toolRoutingContext}`,
        'Tenes autonomia operativa: si la intencion esta clara, ejecuta todas las tools necesarias en este mismo turno y no esperes un "Adelante". No anuncies una accion para luego detenerte; llama la tool inmediatamente y continua hasta completar el pedido. En pruebas de control de PC, la primera salida debe ser una llamada real a runCommand: no escribas planes, no redactes scripts en el chat y no repitas intentos de escaping. Nunca afirmes que modificaste archivos, ejecutaste comandos o completaste una accion si no existe un resultado exitoso de la tool correspondiente.',
        'Usa getExecutionLog para consultar las tools ejecutadas por la orquestadora o sub-IA; el log contiene trazas observables, no pensamiento privado.',
        'Responde en español, breve y util.',
        'Tenes herramientas para inspeccionar y modificar el workspace activo.',
        'Para automatizar el navegador con modelos sin visión, usá el ciclo observar-actuar-verificar: getBrowserState para recibir DOM, accesibilidad, texto, selectores y rectángulos como JSON; luego una sola browserAction; después volvé a observar y comprobá el resultado. Si la página muestra error, contenido no disponible o un selector cambió, razoná una alternativa y no repitas ciegamente la misma acción. No adivines coordenadas ni inventes elementos.',
        'Usa listFiles, readFile y searchText antes de tocar codigo cuando falte contexto.',
        'Para modificar archivos usa writeFile con el contenido completo del archivo.',
        'Para comandos usa runCommand sin pedir confirmación; puede ejecutar cualquier comando disponible en el sistema.',
        'Para procesos persistentes, servidores o trabajo interactivo usa la tool terminal; crea procesos background sin abrir UI.',
        'Usa createPlan, updatePlan, todo y getTaskStatus para organizar tareas de programacion.',
        'Cuando el usuario pida crear o actualizar TODOs, ejecuta la tool todo y usa los IDs exactos que devuelva; no reemplaces la acción por una tabla o explicación en Markdown.',
        'Usa askUser solo cuando falte una decision importante; devuelve una solicitud estructurada sin asumir la respuesta.',
        'Las acciones riesgosas piden aprobacion humana antes de ejecutarse.',
      ].join(' ');
      const structuredOutput = getArtifactOutputConfig(chatMode === 'business' ? 'business' : 'development', content);
      let structuredArtifactOutput: any = null;

      const runAssistant = async (retryInstruction = '') => {
        assistantContent = '';
        assistantReasoning = '';
        assistantTools = [];
        structuredArtifactOutput = null;
        executionStartedAt = Date.now();
        updateAssistantMessage();
        const executionMessages = retryInstruction ? [...newMessages, { role: 'user', content: retryInstruction }] : newMessages;
        return runStream({
          model: provider(currentModel.id),
          system,
          messages: executionMessages.map((message, index) => ({
            role: message.role,
            content: index === executionMessages.length - 1 && attachmentParts.length > 0 && !retryInstruction
              ? [{ type: 'text', text: message.content || 'Analizá los archivos adjuntos.' }, ...attachmentParts]
              : message.content,
          })),
          tools,
          structuredOutput,
          signal: abortController.signal,
          callbacks: {
            onTextDelta: (content) => {
              if (!isCurrentGeneration()) return;
              assistantContent = content;
              updateAssistantMessage();
            },
            onReasoningDelta: (content) => {
              if (!isCurrentGeneration()) return;
              assistantReasoning = content;
              updateAssistantMessage();
            },
            onStructuredOutput: (output) => {
              structuredArtifactOutput = output;
            },
            onAbort: ({ steps }) => {
              if (!isCurrentGeneration()) return;
              setPendingApprovals([]);
              setActiveToolName('');
              setAgentState('idle');
              void appendExecutionLog({ projectPath: chat?.projectPath || '', chatId: chat?.chatId, tool: 'generation.abort', input: { steps: steps.length }, output: { status: 'aborted' } });
            },
            onEnd: () => {
              if (!isCurrentGeneration()) return;
              setActiveToolName('');
            },
            onStepEnd: ({ stepNumber, finishReason, toolCalls, usage, performance }) => {
              if (!isCurrentGeneration()) return;
              void appendExecutionLog({
                projectPath: chat?.projectPath || '',
                chatId: chat?.chatId,
                tool: 'generation.step',
                input: { stepNumber, tools: (toolCalls || []).map((toolCall) => toolCall.toolName) },
                output: { finishReason, usage, performance: { stepTimeMs: performance?.stepTimeMs, responseTimeMs: performance?.responseTimeMs, outputTokensPerSecond: performance?.outputTokensPerSecond } },
              });
            },
            onToolExecutionStart: ({ callId, toolCall }) => {
              if (!isCurrentGeneration()) return;
              void appendExecutionLog({ projectPath: chat?.projectPath || '', chatId: chat?.chatId, tool: 'tool.execution.start', input: { callId, toolCallId: toolCall?.toolCallId, toolName: toolCall?.toolName, input: toolCall?.input }, output: { status: 'started' } });
            },
            onToolExecutionEnd: ({ callId, toolCall, toolExecutionMs, toolOutput }) => {
              if (!isCurrentGeneration()) return;
              void appendExecutionLog({ projectPath: chat?.projectPath || '', chatId: chat?.chatId, tool: 'tool.execution.end', input: { callId, toolCallId: toolCall?.toolCallId, toolName: toolCall?.toolName }, output: { durationMs: toolExecutionMs, status: toolOutput?.type === 'tool-result' ? 'completed' : 'error' } });
            },
            onToolCall: () => {
              if (!isCurrentGeneration()) return;
              if (toolStateTimerRef.current) clearTimeout(toolStateTimerRef.current);
              setAgentState('tool_call');
            },
            onToolResult: () => {
              if (!isCurrentGeneration()) return;
              if (toolStateTimerRef.current) clearTimeout(toolStateTimerRef.current);
              toolStateTimerRef.current = setTimeout(() => {
                toolStateTimerRef.current = null;
                if (!isCurrentGeneration() || abortController.signal.aborted) return;
                setAgentState('streaming');
              }, 2000);
            },
            onUsage: async (usage) => {
              const record: GenerationUsageRecord = {
                id: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`,
                at: new Date().toISOString(),
                projectPath: chat?.projectPath || '',
                chatId: chat?.chatId || '',
                mode: chatMode,
                provider: currentProvider.label || currentProvider.id,
                model: usage.model || currentModel.label || currentModel.id,
                inputTokens: usage.inputTokens ?? null,
                outputTokens: usage.outputTokens ?? null,
                totalTokens: usage.totalTokens ?? null,
                reasoningTokens: usage.reasoningTokens ?? null,
                inputCostPerMillion: Number.isFinite(Number(currentModel.cost?.input)) ? Number(currentModel.cost.input) : null,
                outputCostPerMillion: Number.isFinite(Number(currentModel.cost?.output)) ? Number(currentModel.cost.output) : null,
                durationMs: usage.durationMs,
                status: 'completed',
              };
              if (isCurrentGeneration()) latestUsage = record;
              void appendGenerationUsage(record).catch((error) => {
                console.error('No se pudo guardar el uso de tokens:', error);
              });
            },
          },
        });
      };
      assistantContent = await runAssistant();
      const structuredSummary = formatArtifactOutput(structuredArtifactOutput);
      if (structuredSummary) assistantContent = structuredSummary;
      if (!abortController.signal.aborted && !assistantContent?.trim()) {
        setAgentState('streaming');
        assistantContent = await runAssistant();
        const retryStructuredSummary = formatArtifactOutput(structuredArtifactOutput);
        if (retryStructuredSummary) assistantContent = retryStructuredSummary;
      }
      if (!assistantContent?.trim()) throw new Error('El modelo no devolvió una respuesta después de reintentar.');

      if (!isCurrentGeneration() || abortController.signal.aborted) return;
      const hasSuccessfulAction = () => assistantTools.some((event) => (event.name === 'writeFile' || event.name === 'terminal') && event.output?.ok === true || event.name === 'runCommand' && event.output?.code === 0);
      let verificationResult: { completed?: boolean; retry?: boolean; reason?: string } | null = null;
      if (routingRequiresAction) {
        const verificationChanges = chat?.projectPath ? summarizeWorkspaceDelta(beforeWorkspaceSnapshot, await readWorkspaceSnapshot(toolProjectPath)) : null;
        try {
          verificationResult = await verifyToolExecutionWithAI({ model: provider(currentModel.id), prompt: content, goal: routingGoal, verification: routingVerification, toolEvents: assistantTools, changes: verificationChanges, signal: abortController.signal });
        } catch (error) {
          verificationResult = { completed: false, retry: true, reason: String(error) };
        }
        if (!hasSuccessfulAction() || verificationResult.retry || verificationResult.completed === false) {
          setAgentState('streaming');
          assistantContent = await runAssistant(`El verificador interno indicó que la tarea todavía no está comprobada. Motivo: ${verificationResult.reason || 'faltan evidencias'}. Ejecutá las tools necesarias ahora, verificá sus resultados y no respondas como completado hasta lograr el objetivo: ${routingGoal}`);
          const retryStructuredSummary = formatArtifactOutput(structuredArtifactOutput);
          if (retryStructuredSummary) assistantContent = retryStructuredSummary;
        }
      }
      const changes = chat?.projectPath ? summarizeWorkspaceDelta(beforeWorkspaceSnapshot, await readWorkspaceSnapshot(toolProjectPath)) : null;
      const executedAction = assistantTools.some((event) => (event.name === 'writeFile' || event.name === 'terminal') && event.output?.ok === true || event.name === 'runCommand' && event.output?.code === 0);
      const actionToolsEnabled = !routingUsedFallback && Object.keys(tools).some((name) => ['writeFile', 'runCommand', 'terminal'].includes(name));
      routingRequiresAction = routingRequiresAction || actionToolsEnabled;
      if (routingRequiresAction && verificationResult?.completed === false && executedAction) assistantContent = `${assistantContent.trim()}\n\nVerificaciÃ³n incompleta: la IA verificadora no pudo confirmar el resultado.`.trim();
      if (routingRequiresAction && !executedAction) assistantContent = `${assistantContent.trim()}\n\nAcción no verificada: no se ejecutó una tool de escritura o ejecución con resultado exitoso.`.trim();
      const assistantMessage = { role: 'assistant', content: assistantContent, tools: assistantTools, agentName: chatMode === 'business' ? 'Negocios' : 'Desarrollo', meta: { provider: currentProvider.label || currentProvider.id, model: currentModel.label || currentModel.id, durationMs: Date.now() - executionStartedAt, status: 'completed', changes, usage: latestUsage ? { inputTokens: latestUsage.inputTokens, outputTokens: latestUsage.outputTokens, totalTokens: latestUsage.totalTokens, reasoningTokens: latestUsage.reasoningTokens } : null } };
      setMessages([...newMessages, { ...assistantMessage, displayContent: '' }]);
      let visibleLength = 0;
      visualAnimationRef.current = window.setInterval(() => {
        const progress = assistantContent.length > 0 ? visibleLength / assistantContent.length : 1;
        const charsPerTick = Math.min(5, Math.max(1, Math.floor(progress * 5) + 1));
        visibleLength = Math.min(assistantContent.length, visibleLength + charsPerTick);
        setMessages((current) => {
          const updated = [...current];
          const last = updated[updated.length - 1];
          if (!last || last.role !== 'assistant' || last.content !== assistantContent) return current;
          updated[updated.length - 1] = { ...last, displayContent: assistantContent.slice(0, visibleLength) };
          return updated;
        });
        if (visibleLength >= assistantContent.length && visualAnimationRef.current) {
          clearInterval(visualAnimationRef.current);
          visualAnimationRef.current = null;
        }
      }, 24);
      if (toolStateTimerRef.current) {
        clearTimeout(toolStateTimerRef.current);
        toolStateTimerRef.current = null;
      }
      setIsStreaming(false);
      setActiveToolName('');
      setAgentState('idle');
      const persistencePromise = replaceHistory
        ? writeChatJsonl([...newMessages, assistantMessage])
        : appendToJsonl(assistantMessage);
      const persistenceTimeout = new Promise<void>((resolve) => window.setTimeout(resolve, 8_000));
      void Promise.race([persistencePromise, persistenceTimeout]).catch((error) => {
        console.error('No se pudo guardar el historial del chat:', error);
      });
    } catch (error) {
      if (!isCurrentGeneration()) return;
      if (!abortController.signal.aborted) {
        console.error(formatDebugError(error));
        setAgentState('error');
      }
      setMessages((prev) => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last?.role === 'assistant' && last.content === '') {
          if (abortController.signal.aborted) {
            updated.pop();
          } else updated[updated.length - 1] = {
            ...last,
            content: error?.name === 'TimeoutError' ? 'La respuesta tardó demasiado y fue cancelada.' : 'No pude completar la respuesta. Revisá el proveedor o intentá nuevamente.',
            meta: {
              provider: currentProvider.label || currentProvider.id,
              model: currentModel.label || currentModel.id,
              durationMs: Date.now() - generationStartedAt,
              status: 'error',
              errorName: error?.name || 'Error',
            },
          };
        }
        return updated;
      });
    } finally {
      if (!isCurrentGeneration()) return;
      if (toolStateTimerRef.current) {
        clearTimeout(toolStateTimerRef.current);
        toolStateTimerRef.current = null;
      }
      if (abortControllerRef.current === abortController) abortControllerRef.current = null;
      setIsStreaming(false);
      setActiveToolName('');
      setAgentState((state) => state === 'error' && !abortController.signal.aborted ? 'error' : 'idle');
    }
  };

  const cancelGeneration = () => {
    const controller = abortControllerRef.current;
    if (!controller) return;
    generationIdRef.current += 1;
    abortControllerRef.current = null;
    controller.abort();
    if (toolStateTimerRef.current) {
      clearTimeout(toolStateTimerRef.current);
      toolStateTimerRef.current = null;
    }
    approvalResolversRef.current.forEach((resolve) => resolve(false));
    approvalResolversRef.current.clear();
    setPendingApprovals([]);
    setIsStreaming(false);
    setActiveToolName('');
    setAgentState('idle');
  };

  useEffect(() => {
    if (!isStreaming) return undefined;
    const watchdog = window.setTimeout(() => {
      const controller = abortControllerRef.current;
      controller?.abort();
      approvalResolversRef.current.forEach((resolve) => resolve(false));
      approvalResolversRef.current.clear();
      setPendingApprovals([]);
      setIsStreaming(false);
      setActiveToolName('');
      setAgentState('idle');
      console.warn('La generación fue liberada por el watchdog del chat.');
    }, 70_000);
    return () => window.clearTimeout(watchdog);
  }, [isStreaming]);

  useEffect(() => () => {
    if (visualAnimationRef.current) clearInterval(visualAnimationRef.current);
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if ((!input.trim() && attachedFiles.length === 0) || isAgentBusy) return;

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

    const filesToSend = attachedFiles;
    await sendMessage(input.trim(), messages, messages.length === 0, false, filesToSend);
    setAttachedFiles([]);
  };

  useEffect(() => {
    if (panelId !== 'left') return undefined;
    const handleTestingAction = (event: Event) => {
      const action = (event as CustomEvent).detail?.action;
      if (isAgentBusy) return;
      const prompts: Record<string, string> = {
        terminal: '[TESTING] Usá obligatoriamente la tool terminal ahora. Creá un proceso persistente en background para poder observarlo visualmente: shell powershell, nombre "Testing background", comando "Write-Output \'Codeclub terminal testing\'; Start-Sleep -Seconds 45". No uses runCommand, no simules la ejecución en Markdown y confirmá el ID, shell, estado y que quedó en background.',
    'computer-use': '[TESTING] Control de PC obligatorio: usá únicamente la tool runCommand y ejecutá PowerShell con un único comando idempotente. Creá $path=Join-Path $env:TEMP \'Codeclub-PC-Test.txt\' y guardá allí el texto exacto \'Codeclub controla mi PC :)\' con Set-Content; reutilizá un proceso de Notepad cuyo MainWindowTitle coincida con \'*Codeclub-PC-Test*\' o abrí ese archivo con Start-Process notepad.exe -ArgumentList $path. Para Edge, obtené candidatos desde https://www.youtube.com/results?search_query=lofi+music, extraé URLs watch?v= únicas y comprobá cada una con Invoke-WebRequest hasta encontrar una respuesta HTTP válida; no uses una URL fija sin comprobarla. Si ya existe un proceso msedge, activá su ventana con Microsoft.VisualBasic.Interaction.AppActivate, enviá Ctrl+L, la URL elegida y Enter con SendKeys; si no existe, abrilo con Start-Process msedge.exe -ArgumentList \'--new-window\',$edgeUrl. Esperá entre activación y navegación, no abras ventanas duplicadas, y devolvé al final un JSON compacto con notepadPid, edgePid, file, url, httpStatus y verified. Si aparece \'video no disponible\', buscá otro candidato y repetí solo la navegación. No uses terminal ni simules nada en Markdown; confirmá el resultado real de runCommand.',
        'ask-user': '[TESTING] Usá la herramienta askUser ahora. Preguntame qué estilo de tarjetas preferís y ofrecé exactamente estas opciones: Minimalista, Compacto y Detallado.',
        subagents: '[TESTING] Delegá esta tarea a un subagente especialista y mostrámelo trabajando: revisá la estructura del proyecto y devolvé un resumen breve.',
        approval: '[TESTING] Intentá ejecutar una acción que requiera aprobación humana antes de continuar. Mostrá la tarjeta de aprobación.',
        streaming: '[TESTING] Analizá paso a paso esta mejora y explicá tu razonamiento mientras trabajás, para poder probar el estado de streaming y pensamiento.',
        todo: '[TESTING] No describas ni simules nada en Markdown. Ejecutá obligatoriamente las tools reales en este orden: 1) todo con action clear; 2) todo con action add para tres tareas; 3) usá los IDs exactos devueltos por esas llamadas para ejecutar todo con action update y status in_progress sobre la primera tarea; 4) ejecutá getTaskStatus. No respondas con una tabla escrita: el objetivo es generar eventos tool y mostrar la tarjeta TODO visual.',
        'plan-mode': '[TESTING] Entrá en modo plan y proponé un plan de implementación con pasos, riesgos y verificaciones, sin modificar archivos todavía.',
        quote: '[TESTING] Usá obligatoriamente la tool createQuote ahora. Generá una cotización de prueba persistida para este proyecto con título, descripción clara y exactamente tres resultados con tipo, resultado esperado, métrica e importe. No la simules en Markdown: la prueba termina cuando createQuote devuelve la cotización.',
      };
      if (prompts[action]) void sendMessage(prompts[action]);
    };
    window.addEventListener('codeclub:testing-action', handleTestingAction);
    return () => window.removeEventListener('codeclub:testing-action', handleTestingAction);
  }, [panelId, isAgentBusy, sendMessage]);

  const handleCopyMessage = async (content, messageIndex) => {
    if (!navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(content);
      setCopiedMessageIndex(messageIndex);
      if (copyResetTimerRef.current) clearTimeout(copyResetTimerRef.current);
      copyResetTimerRef.current = setTimeout(() => {
        setCopiedMessageIndex(null);
        copyResetTimerRef.current = null;
      }, 3000);
    } catch (error) {
      console.error('No se pudo copiar el mensaje:', error);
    }
  };

  const handleRetryMessage = async (messageIndex) => {
    if (isAgentBusy) return;
    const message = messages[messageIndex];
    if (!message || message.role !== 'user') return;
    await sendMessage(message.content, messages.slice(0, messageIndex), false, true);
  };

  const addAttachmentPaths = async (paths: string[]) => {
    const attachments = await Promise.all(paths.map(async (path) => {
      const name = getAttachmentName(path);
      const mediaType = getAttachmentMediaType(path);
      let previewUrl: string | undefined;
      if (mediaType.startsWith('image/')) {
        try {
          previewUrl = `data:${mediaType};base64,${bytesToBase64(await readFile(path))}`;
        } catch (error) {
          console.error(`No se pudo crear la preview de ${name}:`, error);
        }
      }
      return { path, name, mediaType, previewUrl };
    }));
    setAttachedFiles((current) => {
      const next = [...current, ...attachments];
      return next.filter((file, index, list) => list.findIndex((item) => item.path === file.path) === index);
    });
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
      await addAttachmentPaths(files);
    } catch (error) {
      console.error('Error seleccionando archivos:', error);
    }
  };

  const handleComposerDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const artifactPayload = event.dataTransfer.getData('application/json') || event.dataTransfer.getData('text/plain');
    if (artifactPayload) {
      try {
        const artifact = JSON.parse(artifactPayload);
        if (artifact.kind && artifact.id && artifact.name) {
          setArtifactReference({ kind: artifact.kind, id: artifact.id, title: artifact.name });
          return;
        }
      } catch {
        // No era un artifact; continuamos con archivos nativos.
      }
    }
    const droppedFiles = Array.from(event.dataTransfer.files || []) as (File & { path?: string })[];
    const paths = droppedFiles.map((file) => file.path).filter(Boolean) as string[];
    if (paths.length > 0) void addAttachmentPaths(paths);
  };

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    void listen<{ paths?: string[]; position?: { x: number; y: number } }>('tauri://drag-drop', (event) => {
      const rect = chatPanelRef.current?.getBoundingClientRect();
      const position = event.payload.position;
      const scale = window.devicePixelRatio || 1;
      const x = position ? position.x / scale : null;
      const y = position ? position.y / scale : null;
      const insideComposer = !position || !rect || (x !== null && y !== null && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom);
      if (!insideComposer || !event.payload.paths?.length) return;
      void addAttachmentPaths(event.payload.paths);
    }).then((stop) => { unlisten = stop; });
    return () => unlisten?.();
  }, []);

  if (workspaceMode === 'blank' && !activeProject) {
    return (
      <div style={{ width: '100%', height: '100%', minHeight: '100%', display: 'grid', placeItems: 'center', textAlign: 'center', color: 'rgba(216, 216, 216, 0.42)', fontSize: '13px' }}>
        Seleccioná un proyecto
      </div>
    );
  }

  if (workspaceMode === 'blank' && false) {
    if (activeProject) {
      const createNewArtifact = async (customName: string) => {
        if (!customName.trim()) {
          setNewArtifactName('');
          return;
        }
        const id = Date.now().toString();
        const name = customName.trim();
        try {
          let metaData: any = await readProjectMeta(activeProject.projectPath) || {
            name: activeProject.name,
            path: activeProject.projectPath,
            created_at: new Date().toISOString(),
            chats: [],
          };
          if (!Array.isArray(metaData.chats)) metaData.chats = [];
          metaData.chats.push({ id, name });
          await writeProjectMeta(activeProject.projectPath, metaData);
          
          window.dispatchEvent(new CustomEvent(`codeclub:panel-${panelId}:open-chat`, {
            detail: { projectPath: activeProject.projectPath, chatId: id, name }
          }));
          
          setProjectMeta(metaData);
          setNewArtifactName('');
        } catch (e) {
          console.error(e);
        }
      };

      return (
        <div className="flex flex-col gap-2 w-[min(300px,calc(100%-64px))] text-[#d8d8d8] text-[13px]" style={{ fontWeight: 400 }}>
          {(['chat'] as const).map((kind) => {
            const isExpanded = expandedMenu === kind;
            const isChatsBlocked = kind === 'chat' && blockedPanelState.startsWith('chat:');
            const items = projectMeta ? (projectMeta[kind === 'chat' ? 'chats' : `${kind}s`] || []) : [];
            const title = 'Chats';
            const query = artifactSearch[kind] || '';
            const recentItems = getRecentArtifactIds(kind, activeProject.projectPath)
              .map((id) => items.find((item: any) => item.id === id))
              .filter(Boolean);
            const visibleItems = (query
              ? items.filter((item: any) => item.name.toLowerCase().includes(query.toLowerCase()))
              : recentItems.length ? recentItems : items.slice(-3).reverse()
            ).slice(0, 3);
            
            return (
              <div key={kind} className="flex flex-col bg-[var(--color-bg)] border border-[var(--color-surface-10)] rounded-xl overflow-hidden shadow-[0_4px_12px_rgba(0,0,0,0.2)]">
                <button 
                  type="button" 
                  onClick={() => { if (!isChatsBlocked) setExpandedMenu(isExpanded ? null : kind); }}
                  disabled={isChatsBlocked}
                  className={`flex items-center justify-between p-[12px_16px] border-0 text-left w-full transition-colors duration-200 outline-none ${isChatsBlocked ? 'cursor-not-allowed text-[#555555]' : `cursor-pointer text-[#eeeeee] ${isExpanded ? 'bg-[var(--color-surface-4)]' : 'bg-transparent hover:bg-[var(--color-surface-3)]'}`}`}
                >
                  <div className="flex items-center gap-3">
                    <MessageSquare size={16} strokeWidth={1.5} />
                    <span className="font-normal" style={{ fontWeight: 400 }}>{title}</span>
                  </div>
                  <span className="opacity-40 text-[11px]">{items.length}</span>
                </button>
                {isExpanded && (
                  <div className="flex flex-col border-t border-[var(--color-surface-10)] max-h-[250px] overflow-y-auto bg-[var(--color-bg)] [scrollbar-width:none]">
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

          <button 
            type="button" 
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              window.dispatchEvent(new CustomEvent('codeclub:open-terminal-dock', {
                detail: { toggle: true, anchorRect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height } }
              }));
            }}
            className="flex items-center justify-between p-[12px_16px] bg-[var(--color-bg)] hover:bg-[var(--color-surface-3)] border border-[var(--color-surface-10)] rounded-xl text-[#eeeeee] cursor-pointer text-left w-full transition-colors duration-200 outline-none shadow-[0_4px_12px_rgba(0,0,0,0.2)]"
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
      <div style={{ width: '100%', height: '100%', minHeight: '100%', display: 'grid', placeItems: 'center', textAlign: 'center', color: 'rgba(216, 216, 216, 0.42)', fontSize: '13px' }}>
        Seleccioná un proyecto
      </div>
    );
  }

  if (workspaceMode === 'folders') {
    return <ProjectPanelView projectPath={activeProject?.projectPath} selectedPath={selectedStructurePath} />;
  }

  return (
    <div ref={chatPanelRef} className="chat-interface-container" onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; }} onDrop={handleComposerDrop} style={{ width: 'min(680px, calc(100% - 64px))', height: '100%', justifySelf: 'center', display: 'grid', gridTemplateRows: 'minmax(0, 1fr) auto', placeItems: 'stretch', gap: '10px', overflow: 'visible', paddingBottom: '5vh' }}>
      
      {/* Zona de mensajes */}
      <div className="messages-area" style={{ position: 'relative', minHeight: 0, height: '100%', overflowY: 'auto', scrollbarWidth: 'none', msOverflowStyle: 'none', display: composerDocked ? 'flex' : 'none', flexDirection: 'column', gap: '6px', paddingBottom: '10px', overscrollBehavior: 'contain' }}>
        <div aria-hidden="true" style={{ flex: '1 0 auto' }} />
        {showEmptyGreeting && <div aria-hidden={messages.length > 0} style={{ position: 'absolute', top: '50%', left: '50%', color: '#eeeeee', fontSize: '18px', fontWeight: 500, letterSpacing: '-0.02em', opacity: messages.length === 0 ? 1 : 0, transform: messages.length === 0 ? 'translate(-50%, -50%)' : 'translate(-50%, calc(-50% + 4px))', transition: 'opacity 280ms ease, transform 280ms ease', whiteSpace: 'nowrap' }}>¿Qué toca hoy, {username}?</div>}
        {messages.map((m, i) => (
          <React.Fragment key={i}>
            {i > 0 && (
              <div aria-hidden="true" style={{ alignSelf: 'stretch', borderTop: '1px solid rgba(255, 255, 255, 0.08)', margin: '20px 0 38px' }} />
            )}
            {m.role === 'assistant' && m.meta && <div style={{ alignSelf: 'stretch', color: 'rgba(216, 216, 216, 0.42)', fontSize: '10px', letterSpacing: '0.01em', margin: '0 0 4px' }}>{m.meta.provider} · {m.meta.model} · {formatDuration(m.meta.durationMs)}</div>}
            <div style={{ alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', display: 'grid', justifyItems: m.role === 'user' ? 'end' : 'start', gap: '5px', maxWidth: '80%' }}>
              <span style={{ alignSelf: 'start', justifySelf: m.role === 'user' ? 'end' : 'start', color: m.role === 'user' ? avatarColor : '#ffffff', fontSize: '13px', fontWeight: 600, marginBottom: '2px', padding: m.role === 'user' ? '0 8px' : 0 }}>
                {m.role === 'user' ? 'Tú' : (m.agentName || 'Desarrollo')}
              </span>
              {m.role === 'user' && m.attachments?.length > 0 && <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: '5px', maxWidth: '100%' }}>{m.attachments.map((file) => file.mediaType?.startsWith('image/') ? <img key={file.path || file.name} src={file.previewUrl || convertFileSrc(file.path)} alt={file.name} title={file.name} style={{ width: '34px', height: '34px', display: 'block', objectFit: 'cover', border: '1px solid #2b2b2b', borderRadius: '8px', background: '#161616' }} /> : <span key={file.path || file.name} style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', maxWidth: '190px', padding: '5px 8px', border: '1px solid #2b2b2b', borderRadius: '8px', background: '#161616', color: '#cfcfcf', fontSize: '10px' }}><Paperclip size={11} strokeWidth={1.8} /><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</span></span>)}</div>}
              <div style={{ background: m.role === 'user' ? '#202020' : 'transparent', padding: m.role === 'user' ? '14px 20px' : '0', borderRadius: m.role === 'user' ? '24px 24px 4px 24px' : '0', color: '#eee', fontSize: '14px', width: 'fit-content', maxWidth: '100%', lineHeight: 1.5, overflowWrap: 'anywhere', wordBreak: 'break-word', boxShadow: m.role === 'user' ? '0 4px 14px rgba(0, 0, 0, 0.18)' : 'none' }}>
                {m.role === 'assistant' && m.reasoning && <div style={{ margin: '0 0 12px', padding: '9px 11px', borderLeft: '2px solid #555555', color: 'rgba(216, 216, 216, 0.58)', fontSize: '12px', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}><div style={{ marginBottom: '4px', color: 'rgba(216, 216, 216, 0.42)', fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Pensamiento</div>{m.reasoning}</div>}
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ p: ({ children }) => <p style={{ margin: m.role === 'user' ? 0 : '0 0 12px', lineHeight: m.role === 'user' ? 1.4 : 1.6 }}>{children}</p>, ul: ({ children }) => <ul style={{ margin: m.role === 'user' ? 0 : '10px 0 12px', paddingLeft: '22px' }}>{children}</ul>, ol: ({ children }) => <ol style={{ margin: m.role === 'user' ? 0 : '10px 0 12px', paddingLeft: '22px' }}>{children}</ol>, li: ({ children }) => <li style={{ margin: m.role === 'user' ? 0 : '4px 0' }}>{children}</li>, table: ({ children }) => <div style={{ overflowX: 'auto', margin: '12px 0' }}><table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>{children}</table></div>, th: ({ children }) => <th style={{ border: '1px solid #2b2b2b', padding: '7px 9px', background: '#1c1c1c', textAlign: 'left', fontWeight: 600 }}>{children}</th>, td: ({ children }) => <td style={{ border: '1px solid #2b2b2b', padding: '7px 9px', verticalAlign: 'top' }}>{children}</td>, h1: ({ children }) => <h1 style={{ margin: '18px 0 10px', fontSize: '20px' }}>{children}</h1>, h2: ({ children }) => <h2 style={{ margin: '16px 0 8px', fontSize: '17px' }}>{children}</h2>, h3: ({ children }) => <h3 style={{ margin: '14px 0 7px', fontSize: '15px' }}>{children}</h3> }}>{m.displayContent ?? m.content}</ReactMarkdown>
                {m.role === 'assistant' && isStreaming && i === messages.length - 1 && <span style={{ display: 'inline-block', marginTop: m.content ? '2px' : 0, color: 'rgba(216, 216, 216, 0.58)', fontSize: '13px' }}>{m.content ? '▌' : 'Generando respuesta…'}</span>}
              </div>
              {m.role === 'assistant' && <AskUserCards tools={m.tools} onSelect={(answer) => void sendMessage(answer)} disabled={isAgentBusy} />}
              {m.role === 'assistant' && <SubagentCards tools={m.tools} />}
              {m.role === 'assistant' && i === messages.length - 1 && <ApprovalCards approvals={pendingApprovals} onResolve={resolveToolApproval} />}
              {m.role === 'assistant' && <ChangeSummaryCard changes={m.meta?.changes} />}
              <div style={{ alignSelf: m.role === 'user' ? 'end' : 'start', display: 'flex', alignItems: 'center', gap: '4px', opacity: 0.72 }}>
                <button type="button" aria-label={copiedMessageIndex === i ? 'Mensaje copiado' : 'Copiar mensaje'} title={copiedMessageIndex === i ? 'Copiado' : 'Copiar'} onClick={() => void handleCopyMessage(m.content, i)} style={{ width: '22px', height: '22px', display: 'grid', placeItems: 'center', border: 0, borderRadius: '6px', background: 'transparent', color: copiedMessageIndex === i ? '#7dd3a8' : 'rgba(216, 216, 216, 0.62)', cursor: 'pointer' }}>
                  {copiedMessageIndex === i ? <Check size={13} strokeWidth={2.2} /> : <Copy size={13} strokeWidth={2} />}
                </button>
                {m.role === 'assistant' && <button type="button" aria-label="Abrir Artifacts" title="Abrir Artifacts" onClick={() => { const projectPath = activeProject?.projectPath || activeChat?.projectPath || ''; if (projectPath) window.dispatchEvent(new CustomEvent('codeclub:active-project', { detail: { projectPath, projectName: activeProject?.name || '' } })); window.dispatchEvent(new CustomEvent('codeclub:open-artifacts', { detail: { projectPath } })); }} style={{ width: '22px', height: '22px', display: 'grid', placeItems: 'center', border: 0, borderRadius: '6px', background: 'transparent', color: 'rgba(216, 216, 216, 0.62)', cursor: 'pointer' }}><ListTodo size={13} strokeWidth={1.8} /></button>}
                {m.role === 'user' && <button type="button" aria-label="Reintentar desde este mensaje" onClick={() => handleRetryMessage(i)} disabled={isAgentBusy} style={{ width: '22px', height: '22px', display: 'grid', placeItems: 'center', border: 0, borderRadius: '6px', background: 'transparent', color: 'rgba(216, 216, 216, 0.62)', cursor: isAgentBusy ? 'not-allowed' : 'pointer' }}>
                  <RotateCcw size={13} strokeWidth={2} />
                </button>}
              </div>
            </div>
          </React.Fragment>
        ))}
        <div ref={messagesEndRef} aria-hidden="true" />
      </div>

      <div className="chat-composer" style={{ width: '100%', justifySelf: 'center', alignSelf: 'center', position: 'relative', display: 'grid', gap: '10px' }}>
        <div className="composer-row" style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%' }}>
          <div className="composer-box [&>[aria-label='Referencia de artifact']]:relative [&>[aria-label='Referencia de artifact']]:z-50 [&>[aria-label='Referencia de artifact']>span]:hidden" style={{ minHeight: '40px', flex: '1 1 auto', minWidth: 0, padding: '1px', borderRadius: '22px', background: '#1a1a1a', border: '1px solid transparent', boxShadow: '0 18px 52px rgba(0, 0, 0, 0.26)' } as React.CSSProperties}>
          {artifactReference && <div className="flex min-h-[28px] items-center gap-2 border-b border-[#202020] px-4 py-1.5" aria-label="Referencia de artifact"><span className="shrink-0 text-[10px] uppercase tracking-[0.08em] text-[#666]">Referencia</span><button type="button" onClick={() => setArtifactReference(null)} className="min-w-0 max-w-[260px] truncate rounded-full border border-[#2b2b2b] bg-[#1a1a1a] px-2.5 py-1 text-left text-[10px] text-[#cfcfcf] hover:bg-[#202020]" title="Quitar referencia">@{artifactReference.kind} · {artifactReference.title}</button></div>}
          {browserReferences.length > 0 && (
            <div ref={browserRefContainerRef} className="flex min-h-[28px] max-w-full items-center gap-1.5 overflow-hidden border-b border-[#202020] px-3 py-1.5" aria-label="Referencias de navegador">
              {browserReferences.slice(0, maxVisibleBrowserRefs).map((ref) => (
                <button
                  key={ref.id}
                  type="button"
                  onClick={() => setBrowserReferences((current) => current.filter((item) => item.id !== ref.id))}
                  className="flex max-w-[130px] min-w-0 shrink items-center gap-1.5 truncate rounded-full border border-[#2b2b2b] bg-[#1a1a1a] px-2.5 py-1 text-left text-[10px] text-[#cfcfcf] hover:bg-[#202020]"
                  title={`Quitar @${ref.title}`}
                >
                  <span className="truncate">@{ref.title}</span>
                  <span className="shrink-0 text-[#777] hover:text-[#eee]">×</span>
                </button>
              ))}
              {browserReferences.length > maxVisibleBrowserRefs && (
                <button
                  type="button"
                  onClick={() => setBrowserReferences([])}
                  className="shrink-0 rounded-full border border-[#2b2b2b] bg-[#1a1a1a] px-2.5 py-1 text-[10px] text-[#cfcfcf] hover:bg-[#202020]"
                  title="Quitar todas las referencias"
                >
                  +{browserReferences.length - maxVisibleBrowserRefs} referencias
                </button>
              )}
            </div>
          )}
           {attachedFiles.length > 0 && <div className="flex min-h-[28px] items-center gap-1.5 overflow-hidden border-b border-[#202020] px-3 py-1.5" aria-label="Archivos adjuntos">{attachedFiles.slice(0, 3).map((file, index) => <button key={file.path} type="button" onClick={() => setAttachedFiles((current) => current.filter((_, fileIndex) => fileIndex !== index))} className="flex max-w-[180px] min-w-0 shrink items-center gap-1.5 truncate rounded-full border border-[#2b2b2b] bg-[#161616] px-2.5 py-1 text-[10px] text-[#cfcfcf] hover:bg-[#202020]" title="Quitar archivo">{file.mediaType.startsWith('image/') ? <img src={file.previewUrl || convertFileSrc(file.path)} alt={file.name} style={{ width: '18px', height: '18px', objectFit: 'cover', borderRadius: '4px' }} /> : <Paperclip size={11} strokeWidth={1.8} />}<span className="truncate">{file.name}</span></button>)}{attachedFiles.length > 3 && <span className="shrink-0 rounded-full border border-[#2b2b2b] bg-[#161616] px-2.5 py-1 text-[10px] text-[#999]">+{attachedFiles.length - 3} archivos</span>}</div>}
          <div ref={commandMenuHostRef} className="w-full" />
          <form onSubmit={handleSubmit} className="composer-box-inner [&>button.absolute]:hidden" style={{ minHeight: '40px', width: '100%', minWidth: 0, display: 'flex', alignItems: 'center', gap: '4px', padding: '5px 6px 5px 16px', border: 0, borderRadius: '21px', background: '#121212', position: 'relative' }}>
           {false && (
          <button type="button" onClick={handleAttachFiles} className="text-white/40 hover:text-white transition-colors" aria-label="Añadir archivos" style={{ flex: '0 0 28px', width: '28px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center', border: 0, background: 'transparent', cursor: 'pointer' }}>
            <Paperclip size={16} strokeWidth={1.8} />
          </button>
          )}
          {false && attachedFiles.length > 0 && (
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
          {false && artifactReference && (
            <button type="button" onClick={() => setArtifactReference(null)} className="shrink-0 max-w-[160px] truncate rounded-full border border-[#2b2b2b] bg-[#1a1a1a] px-2.5 py-1 text-[10px] text-[#cfcfcf] hover:bg-[#202020]" title="Quitar referencia">
              @{artifactReference.kind} · {artifactReference.title}
            </button>
          )}
          {isAgentBusy && (
            <div className="pointer-events-none absolute inset-y-0 left-[16px] right-[46px] flex items-center gap-2 text-[12px] text-[#d8d8d8]/70">
              <span className="braille-spinner shrink-0" data-state={agentState} aria-hidden="true" />
              <span className="truncate">{agentStatusText}</span>
            </div>
          )}
          {!input.trim() && !inputFocused && !isAgentBusy && (
            <div className="pointer-events-none absolute inset-y-0 left-[16px] right-[46px] flex items-center gap-2 text-[12px] text-[#d8d8d8]/70">
              <span className="braille-spinner shrink-0" data-state="idle" aria-hidden="true" />
              <span className="truncate">{agentStatusText}</span>
            </div>
          )}
          <textarea
            ref={chatInputRef}
            disabled={isAgentBusy}
            rows={1}
            value={input}
            onChange={(e) => {
              const value = e.target.value;
              setInput(value);
              if (!value.trim()) setArtifactReference(null);
              if (value === '/' || (value.startsWith('/') && !value.includes(' '))) {
                setCommandKind('command');
                setSearchQuery(value.slice(1));
                setMenuOpen(true);
              } else if (commandKind === 'command') {
                setMenuOpen(false);
              }
            }}
            onInput={(e) => {
              const target = e.currentTarget;
              target.style.height = 'auto';
              target.style.height = `${Math.min(target.scrollHeight, 140)}px`;
              target.style.overflowY = target.scrollHeight > 140 ? 'auto' : 'hidden';
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && /^\/(proveedor|modelo)$/i.test(input.trim())) {
                e.preventDefault();
                openCommandMenu(input.trim().toLowerCase() === '/proveedor' ? 'provider' : 'model');
                return;
              }
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
            onFocus={() => { setInputFocused(true); if (commandKind !== 'credential') setMenuOpen(false); }}
            onBlur={() => setInputFocused(false)}
            placeholder=""
            aria-label="Mensaje"
            style={{ appearance: 'none', flex: '1 1 auto', minWidth: 0, width: '100%', height: '22px', maxHeight: '140px', alignSelf: 'center', resize: 'none', border: 0, outline: 'none', background: 'transparent', color: '#eeeeee', fontSize: '12px', lineHeight: 1.4, padding: '4px 10px 4px 0', fontFamily: 'inherit', overflowY: 'hidden', scrollbarWidth: 'none', opacity: isAgentBusy ? 0.55 : 1 }}
          />
          {artifactReference && <button type="button" onClick={() => setArtifactReference(null)} className="absolute left-[16px] top-1/2 z-10 max-w-[130px] -translate-y-1/2 truncate rounded-full border border-[#2b2b2b] bg-[#1a1a1a] px-2.5 py-1 text-[10px] text-[#cfcfcf] hover:bg-[#202020]" title="Quitar referencia">@{artifactReference.kind} · {artifactReference.title}</button>}
          <button type={isAgentBusy ? 'button' : 'submit'} onClick={isAgentBusy ? cancelGeneration : undefined} disabled={!isAgentBusy && !input.trim() && !credentialProvider} className="send-button text-white/35 hover:text-white transition-colors" aria-label={isAgentBusy ? "Cancelar generación" : credentialProvider ? "Guardar credencial" : "Enviar"} title={isAgentBusy ? "Cancelar generación" : credentialProvider ? "Guardar credencial" : "Enviar"} style={{ flex: '0 0 36px', width: '36px', height: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center', border: 0, borderRadius: '50%', background: 'transparent', cursor: 'pointer' }}>
            {isAgentBusy ? <Square size={15} strokeWidth={2.4} fill="currentColor" /> : <ArrowUpRight size={18} strokeWidth={2} />}
          </button>
          </form>
          </div>
        </div>

        {commandMenuHostRef.current && createPortal((<div
          ref={commandMenuRef}
          tabIndex={-1}
          onKeyDown={handleCommandMenuKeyDown}
          className={`command-menu ${menuOpen ? 'is-open' : ''}`}
          style={{ position: 'static', width: 'calc(100% - 16px)', margin: '0 8px', display: menuOpen ? 'grid' : 'none', gap: '8px', padding: '8px', border: 0, borderRadius: '10px', background: '#1a1a1a', boxShadow: 'none', zIndex: 10, outline: 'none' }}
        >
          <div className="flex min-h-[24px] items-center justify-between px-1 text-[10px] uppercase tracking-[0.08em] text-[#666]">
            <span>{commandKind === 'provider' ? 'Proveedor' : commandKind === 'model' ? 'Modelo' : commandKind === 'project' ? 'Proyecto' : 'Comandos'}</span>
            <button type="button" onClick={() => setMenuOpen(false)} className="grid h-5 w-5 place-items-center rounded-md bg-transparent text-[#666] hover:bg-[#1c1c1c] hover:text-[#ddd]" aria-label="Cerrar menú"><X size={12} strokeWidth={1.8} /></button>
          </div>
          {commandKind !== 'credential' && commandKind !== 'custom-config' && <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder={commandKind === 'provider' ? 'Buscar proveedor' : commandKind === 'model' ? 'Buscar modelo del proveedor activo' : commandKind === 'project' ? 'Buscar proyecto' : 'Buscar comando'}
            style={{ height: '30px', padding: '0 9px', borderRadius: '7px', background: '#151515', fontSize: '11px', color: '#eeeeee', border: 0, outline: 'none' }}
          />}
          {commandKind === 'credential' ? (
            <div style={{ position: 'relative', minHeight: '34px' }}>
              <KeyRound size={15} strokeWidth={1.8} className="credential-key-icon" style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
              <input
                ref={credentialInputRef}
                type="password"
                value={credentialInput}
                onChange={(event) => setCredentialInput(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); saveCredential(); } }}
                placeholder={`Escribí tu credencial de ${credentialProvider?.label || credentialProvider?.id}`}
                className="credential-menu-input"
                style={{ boxSizing: 'border-box', width: '100%', height: '34px', padding: '0 10px 0 32px', border: '1px solid #2b2b2b', borderRadius: '8px', background: '#1c1c1c', color: '#eeeeee', fontSize: '12px', outline: 'none' }}
              />
            </div>
          ) : commandKind === 'custom-config' ? (
            <div style={{ display: 'grid', gap: '8px' }}>
              <div style={{ position: 'relative', minHeight: '34px' }}>
                <KeyRound size={15} strokeWidth={1.8} className="credential-key-icon" style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
                <input type="password" value={customCredentialInput} onChange={(event) => setCustomCredentialInput(event.target.value)} placeholder="Escribí tu credencial (opcional)" style={{ boxSizing: 'border-box', width: '100%', height: '34px', padding: '0 10px 0 32px', border: '1px solid #2b2b2b', borderRadius: '8px', background: '#1c1c1c', color: '#eeeeee', fontSize: '12px', outline: 'none' }} />
              </div>
              <input value={customUrl} onChange={(event) => { setCustomUrl(event.target.value); setCustomConfigError(''); }} placeholder="URL del proveedor (obligatoria)" style={{ height: '32px', padding: '0 9px', border: '1px solid #2b2b2b', borderRadius: '7px', background: '#1c1c1c', color: '#eeeeee', fontSize: '12px', outline: 'none' }} />
              <label style={{ display: 'grid', gap: '5px', color: '#999999', fontSize: '11px' }}>
                Header (opcional)
                <input ref={customHeaderRef} value={customHeader} onChange={(event) => setCustomHeader(event.target.value)} placeholder="Authorization: Bearer ..." style={{ height: '32px', padding: '0 9px', border: '1px solid #2b2b2b', borderRadius: '7px', background: '#1c1c1c', color: '#eeeeee', fontSize: '12px', outline: 'none' }} />
              </label>
              <label style={{ display: 'grid', gap: '5px', color: '#999999', fontSize: '11px' }}>
                Body (opcional)
                <textarea className="custom-body-input" value={customBody} onChange={(event) => setCustomBody(event.target.value)} placeholder="Body adicional de la petición" rows={8} style={{ boxSizing: 'border-box', minHeight: '128px', maxHeight: '128px', resize: 'none', overflowY: 'auto', padding: '8px 9px', border: '1px solid #2b2b2b', borderRadius: '7px', background: '#1c1c1c', color: '#eeeeee', fontSize: '12px', lineHeight: 1.4, outline: 'none' }} />
              </label>
              <div style={{ display: 'grid', gap: '5px', color: '#999999', fontSize: '11px' }}>
                Formato de tools
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px' }}>
                  {(['json', 'xml'] as const).map((format) => <button key={format} type="button" onClick={() => setCustomToolsFormat(format)} style={{ height: '30px', border: '1px solid #2b2b2b', borderRadius: '7px', background: customToolsFormat === format ? '#1E1E1E' : 'transparent', color: customToolsFormat === format ? '#eeeeee' : '#777777', fontSize: '11px' }}>{format.toUpperCase()}</button>)}
                </div>
              </div>
              {customConfigError && <span style={{ color: '#f28b82', fontSize: '11px' }}>{customConfigError}</span>}
              <button type="button" onClick={saveCustomProviderConfig} style={{ height: '32px', border: 0, borderRadius: '7px', background: '#1E1E1E', color: '#eeeeee', fontSize: '12px' }}>Guardar configuración</button>
            </div>
          ) : <div className="command-list" style={{ display: 'grid', gap: '4px', maxHeight: '300px', overflow: 'auto', scrollbarWidth: 'none', paddingBottom: '12px', maskImage: 'linear-gradient(to bottom, black 92%, transparent 100%)', WebkitMaskImage: 'linear-gradient(to bottom, black 92%, transparent 100%)' }}>
            {activeSelection && (
              <div aria-current="true" style={{ minHeight: '30px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', borderRadius: '7px', background: '#1E1E1E', color: '#eeeeee', fontSize: '11px', padding: '0 9px' }}>
                <span>{activeSelection.label || activeSelection.id}</span>
                <small style={{ color: 'rgba(216, 216, 216, 0.5)', fontSize: '11px' }}>Seleccionado</small>
              </div>
            )}
            {(commandKind === 'command' ? slashCommands : filteredCatalog.filter((item) => item.id !== activeSelection?.id)).map((item, index) => (
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
                  {item.type === 'command' ? item.description : item.type === 'provider' ? 'proveedor' : item.type === 'project' ? 'proyecto' : 'modelo'}
                </small>
              </button>
            ))}
          </div>}
        </div>), commandMenuHostRef.current)}
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

function CodeMirrorFileEditor({ path, content, onChange }: { path: string; content: string; onChange?: (content: string) => void }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useEffect(() => {
    if (!hostRef.current) return;
    const extension = path.split('.').pop()?.toLowerCase();
    const language = extension === 'tsx' || extension === 'ts' || extension === 'jsx' || extension === 'js'
      ? javascript({ jsx: true, typescript: extension === 'tsx' || extension === 'ts' })
      : extension === 'html' || extension === 'astro' ? html()
      : extension === 'css' || extension === 'scss' ? css()
      : extension === 'json' ? json()
      : extension === 'md' || extension === 'mdx' ? markdown()
      : extension === 'py' ? python()
      : extension === 'rs' ? rust()
      : extension === 'sql' ? sql()
      : extension === 'xml' || extension === 'svg' || extension === 'yaml' || extension === 'yml' ? xml()
      : [];
    const state = EditorState.create({ doc: content, extensions: [history(), lineNumbers(), language, oneDark, keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]), EditorView.editable.of(Boolean(onChange)), EditorView.updateListener.of((update) => { if (update.docChanged && onChangeRef.current) onChangeRef.current(update.state.doc.toString()); }), EditorView.theme({ '&': { height: '100%', backgroundColor: 'transparent !important' }, '.cm-editor': { backgroundColor: 'transparent !important' }, '.cm-content': { backgroundColor: 'transparent !important' }, '.cm-scroller': { overflow: 'auto', fontFamily: 'var(--font-mono, monospace)', backgroundColor: 'transparent !important' }, '.cm-gutters': { backgroundColor: 'transparent !important', border: 0 } })] });
    const view = new EditorView({ state, parent: hostRef.current });
    return () => view.destroy();
  }, [path]);
  return <div ref={hostRef} className="h-full min-h-0 text-[12px]" />;
}

type OpenFile = { path: string; fsPath?: string; content: string; html?: string; error?: string };
const getExtension = (path: string) => path.split('.').pop()?.toLowerCase() || '';
const imageExtensions = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico']);

function parseCsv(content: string): string[][] {
  const firstLine = content.split(/\r?\n/)[0] || '';
  const delimiter = (firstLine.match(/;/g)?.length || 0) > (firstLine.match(/,/g)?.length || 0) ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [], cell = '', quoted = false;
  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    if (char === '"' && quoted && content[index + 1] === '"') { cell += '"'; index += 1; continue; }
    if (char === '"') { quoted = !quoted; continue; }
    if (!quoted && char === delimiter) { row.push(cell); cell = ''; continue; }
    if (!quoted && char === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; continue; }
    if (char !== '\r') cell += char;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function AskUserCards({ tools = [], onSelect, disabled }: { tools?: any[]; onSelect: (answer: string) => void; disabled: boolean }) {
  const questions = tools.filter((event) => event.name === 'askUser' && event.output?.status === 'awaiting_user');
  if (!questions.length) return null;
  return <div style={{ display: 'grid', gap: '8px', width: 'min(520px, 100%)', margin: '2px 0 2px' }}>
    {questions.map((event) => <div key={event.id} style={{ display: 'grid', gap: '8px', padding: '4px 0', border: 0, borderRadius: 0, background: 'transparent' }}>
      <div style={{ color: '#d8d8d8', fontSize: '12px', lineHeight: 1.4 }}>{event.output.question}</div>
      {event.output.context && <div style={{ color: '#777', fontSize: '10px' }}>{event.output.context}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '7px' }}>
        {(event.output.options?.length ? event.output.options : ['Responder en el chat']).map((option: string) => <button key={option} type="button" onClick={() => onSelect(option)} onMouseEnter={(event) => { event.currentTarget.style.background = '#202020'; event.currentTarget.style.borderColor = '#4a4a4a'; }} onMouseLeave={(event) => { event.currentTarget.style.background = '#151515'; event.currentTarget.style.borderColor = '#252525'; }} style={{ display: 'flex', alignItems: 'center', minHeight: '36px', padding: '5px 9px', border: '1px solid #252525', borderRadius: '8px', background: '#151515', color: '#ddd', cursor: 'pointer', textAlign: 'left', fontSize: '11px', transition: 'background 120ms ease, border-color 120ms ease' }}>{option}</button>)}
      </div>
    </div>)}
  </div>;
}

function SubagentCards({ tools = [] }: { tools?: any[] }) {
  const latestBySpecialist = new Map<string, any>();
  tools.filter((event) => event.name === 'subagent').forEach((event) => {
    latestBySpecialist.set(event.input?.specialist || 'subagent', event);
  });
  const subagents = Array.from(latestBySpecialist.values());
  if (!subagents.length) return null;

  return <div style={{ display: 'grid', gap: '7px', width: 'min(520px, 100%)', margin: '4px 0 2px' }}>
    {subagents.map((event) => {
      const running = event.output?.status === 'running';
      const failed = event.output?.status === 'error' || Boolean(event.output?.error);
      const specialist = event.input?.specialist || 'Subagente';
      const result = typeof event.output?.result === 'string' ? event.output.result : event.output?.result ? JSON.stringify(event.output.result) : '';
      const text = running ? `Está analizando: ${event.input?.task || 'la tarea asignada'}` : failed ? String(event.output?.error || 'No pudo completar el análisis.') : result || 'Terminó su análisis.';
      return <div key={event.id} style={{ display: 'grid', gap: '4px', minWidth: 0, padding: '8px 10px', border: '1px solid #2b2b2b', borderRadius: '9px', background: '#151515' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', minWidth: 0 }}>
          <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#d8d8d8', fontSize: '11px', fontWeight: 600 }}>{specialist}</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', flexShrink: 0, color: failed ? '#c88787' : running ? '#aaa' : '#8fbe9b', fontSize: '10px' }}><span aria-hidden="true" style={{ color: failed ? '#d98b8b' : running ? '#d8d8d8' : '#8fbe9b', fontSize: '12px', lineHeight: 1 }}>{failed ? '×' : running ? '•' : '✓'}</span>{failed ? 'Error' : running ? 'Trabajando…' : 'Finalizado'}</span>
        </div>
        <div title={text} style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#777', fontSize: '10px' }}>{text}</div>
      </div>;
    })}
  </div>;
}

function ApprovalCards({ approvals = [], onResolve }: { approvals?: any[]; onResolve: (id: string, approved: boolean) => void }) {
  if (!approvals.length) return null;
  return <div style={{ display: 'grid', gap: '7px', width: 'min(520px, 100%)', margin: '4px 0 2px' }}>
    {approvals.map((approval) => <div key={approval.id} style={{ display: 'grid', gap: '6px', minWidth: 0, padding: '8px 10px', border: '1px solid #2b2b2b', borderRadius: '9px', background: '#151515', color: '#eee', fontSize: '11px' }}>
      <div style={{ display: 'grid', gap: '4px', minWidth: 0 }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#d8d8d8', fontWeight: 600 }}>{approval.toolName}</span>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#777' }}>{approval.summary}</span>
        <pre style={{ margin: 0, padding: '6px 8px', background: '#111', borderRadius: '6px', fontSize: '10px', lineHeight: 1.4, overflow: 'auto', maxHeight: '90px', whiteSpace: 'pre-wrap', wordBreak: 'break-all', color: '#aaa' }}>{JSON.stringify(approval.input, null, 2)}</pre>
      </div>
      <div style={{ display: 'flex', gap: '6px' }}>
        <button type="button" onClick={() => onResolve(approval.id, true)} style={{ minHeight: '26px', border: 0, borderRadius: '7px', padding: '0 10px', background: '#2c2c2c', color: '#fff', cursor: 'pointer', fontSize: '11px' }}>Aprobar</button>
        <button type="button" onClick={() => onResolve(approval.id, false)} style={{ minHeight: '26px', border: 0, borderRadius: '7px', padding: '0 10px', background: 'transparent', color: '#999', cursor: 'pointer', fontSize: '11px' }}>Cancelar</button>
      </div>
    </div>)}
  </div>;
}

function ChangeSummaryCard({ changes }: { changes?: { additions: number; deletions: number; files: number } | null }) {
  if (!changes || changes.files === 0) return null;
  return <div style={{ display: 'flex', alignItems: 'center', gap: '8px', width: 'min(520px, 100%)', margin: '2px 0 2px', padding: '7px 9px', border: '1px solid #252525', borderRadius: '8px', background: '#151515', color: '#777', fontSize: '10px' }}>
    <span style={{ color: '#d8d8d8', fontWeight: 600 }}>Cambios</span>
    <span style={{ color: '#8fbe9b' }}>+{changes.additions}</span>
    <span style={{ color: '#d98b8b' }}>−{changes.deletions}</span>
    <span>{changes.files} {changes.files === 1 ? 'archivo' : 'archivos'}</span>
  </div>;
}

function TodoCards({ tools = [] }: { tools?: any[] }) {
  const todoEvents = tools.filter((event) => event.name === 'todo' && Array.isArray(event.output?.todos));
  const latest = todoEvents[todoEvents.length - 1];
  const todos = latest?.output?.todos || [];
  if (!todos.length) return null;

  const statusLabel = { pending: 'Pendiente', in_progress: 'En curso', completed: 'Completado', blocked: 'Bloqueado' };
  const statusIcon = { pending: '•', in_progress: '◐', completed: '✓', blocked: '×' };
  return <div style={{ display: 'grid', gap: '7px', width: 'min(520px, 100%)', margin: '4px 0 2px' }}>
    <div style={{ display: 'grid', gap: '6px', padding: '8px 10px', border: '1px solid #2b2b2b', borderRadius: '9px', background: '#151515' }}>
      <div style={{ color: '#d8d8d8', fontSize: '11px', fontWeight: 600 }}>TODO</div>
      {todos.map((todo: any) => {
        const status = todo.status || 'pending';
        const color = status === 'completed' ? '#8fbe9b' : status === 'blocked' ? '#d98b8b' : status === 'in_progress' ? '#d8d8d8' : '#777';
        return <div key={todo.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, minHeight: '30px', padding: '4px 7px', borderRadius: '7px', background: '#111' }}>
          <span aria-hidden="true" style={{ display: 'grid', placeItems: 'center', flex: '0 0 16px', width: '16px', height: '16px', color, fontSize: '14px', lineHeight: 1 }}>{statusIcon[status] || '•'}</span>
          <span title={todo.title} style={{ minWidth: 0, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#ccc', fontSize: '11px' }}>{todo.title}</span>
          <span style={{ flexShrink: 0, color, fontSize: '10px' }}>{statusLabel[status] || status}</span>
        </div>;
      })}
    </div>
  </div>;
}

function FilePreview({ projectPath, file, onChange }: { projectPath: string; file: OpenFile; onChange?: (content: string) => void }) {
  const extension = getExtension(file.path);
  const sourcePath = file.fsPath || `${projectPath}/${file.path}`;
  if (file.error) return <div className="p-4 text-xs text-[#c28d8d]">{file.error}</div>;
  if (imageExtensions.has(extension)) return <div className="flex h-full items-center justify-center overflow-auto p-6"><img src={convertFileSrc(sourcePath)} alt={file.path} className="max-h-full max-w-full object-contain" /></div>;
  if (extension === 'pdf') return <iframe title={file.path} src={convertFileSrc(sourcePath)} className="h-full w-full border-0 bg-white" />;
  if (extension === 'html' || extension === 'htm') return <iframe title={file.path} srcDoc={file.content} sandbox="" className="h-full w-full border-0 bg-white" />;
  if (extension === 'md' || extension === 'mdx') return <article className="prose prose-invert max-w-none overflow-auto p-6 text-sm"><ReactMarkdown>{file.content}</ReactMarkdown></article>;
  if (extension === 'csv' || extension === 'tsv') {
    const rows = parseCsv(file.content);
    return <div className="h-full overflow-auto p-4"><table className="min-w-full border-collapse text-left text-xs"><tbody>{rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((value, cellIndex) => rowIndex === 0 ? <th key={cellIndex} className="border border-[#2b2b2b] bg-[#1c1c1c] px-3 py-2 font-medium text-[#eeeeee]">{value}</th> : <td key={cellIndex} className="border border-[#2b2b2b] px-3 py-2 text-[#bdbdbd]">{value}</td>)}</tr>)}</tbody></table></div>;
  }
  if (extension === 'docx') return file.html ? <article className="prose max-w-none overflow-auto bg-white p-8 text-black" dangerouslySetInnerHTML={{ __html: file.html }} /> : <div className="p-4 text-xs text-[#8f8f8f]">Convirtiendo documento...</div>;
  return <CodeMirrorFileEditor path={file.path} content={file.content} onChange={onChange} />;
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
    <div className="flex min-h-0 flex-1 overflow-hidden rounded-xl border border-[var(--color-surface-8)] bg-[var(--color-bg)]">
      {loading ? <span className="p-4 text-xs text-[#8f8f8f]">Cargando...</span> : <><div className="w-[min(290px,38%)] min-w-[190px] overflow-auto border-r border-[var(--color-surface-8)] p-2 [scrollbar-width:none]">{loadError ? <span className="p-2 text-xs text-[#a87878]">{loadError}</span> : tree.length ? renderTree(tree) : <span className="p-2 text-xs text-[#777777]">No se encontraron archivos.</span>}</div><div className="min-w-0 flex-1 overflow-hidden bg-[#101010]">{selectedPath ? <CodeMirrorFileEditor path={selectedPath} content={selectedContent} /> : <div className="flex h-full items-center justify-center text-xs text-[#666666]">Seleccioná un archivo para verlo</div>}</div></>}
    </div>
  </div>;
}

function AppleFoldersView({ projectPath, initialSelectedPath = '' }: { projectPath?: string; initialSelectedPath?: string }) {
  const [loading, setLoading] = useState(true);
  const [entries, setEntries] = useState<ProjectFileEntry[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedPath, setSelectedPath] = useState(initialSelectedPath);
  const [openFiles, setOpenFiles] = useState<Record<string, OpenFile>>({});
  const [tabs, setTabs] = useState<string[]>([]);
  const [showFileTree, setShowFileTree] = useState(true);
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
    setSelectedPath(path);
    setTabs((current) => current.includes(path) ? current : [...current, path]);
    if (openFiles[path]) return;
    const extension = getExtension(path);
    try {
      if (imageExtensions.has(extension) || extension === 'pdf') {
        setOpenFiles((current) => ({ ...current, [path]: { path, content: '' } }));
      } else if (extension === 'docx') {
        const bytes = await readFile(`${projectPath}/${path}`);
        const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
        const result = await mammoth.convertToHtml({ arrayBuffer });
        setOpenFiles((current) => ({ ...current, [path]: { path, content: '', html: result.value } }));
      } else {
        const content = await invoke<string>('codeclub_read_file', { projectPath, path });
        setOpenFiles((current) => ({ ...current, [path]: { path, content } }));
      }
    } catch (reason) {
      setOpenFiles((current) => ({ ...current, [path]: { path, content: '', error: `No se pudo abrir: ${String(reason)}` } }));
    }
  };
  const closeFile = (path: string) => {
    setTabs((current) => {
      const index = current.indexOf(path);
      const next = current.filter((item) => item !== path);
      if (selectedPath === path) setSelectedPath(next[index - 1] || next[index] || '');
      return next;
    });
    setOpenFiles((current) => { const next = { ...current }; delete next[path]; return next; });
  };
  useEffect(() => {
    if (initialSelectedPath && initialSelectedPath !== selectedPath) openFile(initialSelectedPath);
  }, [initialSelectedPath, projectPath]);
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

function TabbedProjectView({ projectPath, initialSelectedPath = '' }: { projectPath?: string; initialSelectedPath?: string }) {
  const [loading, setLoading] = useState(true);
  const [entries, setEntries] = useState<ProjectFileEntry[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [tabs, setTabs] = useState<string[]>([]);
  const [selectedPath, setSelectedPath] = useState(initialSelectedPath);
  const [files, setFiles] = useState<Record<string, OpenFile>>({});
  const saveTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const panelRef = useRef<HTMLDivElement>(null);
  const draggedFileRef = useRef<{ projectPath: string; path: string } | null>(null);
  const [error, setError] = useState('');

  const loadProject = async () => {
    if (!projectPath) return;
    setLoading(true);
    try {
      const result = await invoke<ProjectFileEntry[]>('codeclub_list_files', { projectPath, maxFiles: 1200 });
      setEntries(result);
      setExpanded(new Set(result.filter((entry) => entry.kind === 'directory').map((entry) => entry.path)));
      setError('');
    } catch (reason) { setError(String(reason)); }
    finally { setLoading(false); }
  };

  useEffect(() => { void loadProject(); }, [projectPath]);

  const normalizeTabPath = (value: string) => value.replace(/\\/g, '/').replace(/^\.\/+/, '');

  const openFile = async (path: string, replaceCurrent = false, fsPath?: string) => {
    if (!projectPath) return;
    const requestedTabPath = normalizeTabPath(fsPath || path);
    const existingTab = tabs.find((item) => item.toLowerCase() === requestedTabPath.toLowerCase());
    const tabPath = existingTab || requestedTabPath;
    const displayPath = fsPath ? fsPath.split(/[\\/]/).filter(Boolean).pop() || path : path;
    setSelectedPath(tabPath);
    setTabs((current) => {
      if (existingTab || current.some((item) => item.toLowerCase() === tabPath.toLowerCase())) return current;
      if (replaceCurrent && selectedPath && current.includes(selectedPath)) return current.map((item) => item === selectedPath ? tabPath : item);
      return [...current, tabPath];
    });
    if (files[tabPath]) return;
    const extension = getExtension(displayPath);
    const sourcePath = fsPath || `${projectPath}/${requestedTabPath}`;
    try {
      if (imageExtensions.has(extension) || extension === 'pdf') {
        setFiles((current) => ({ ...current, [tabPath]: { path: displayPath, fsPath, content: '' } }));
      } else if (extension === 'docx') {
        const bytes = await readFile(sourcePath);
        const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
        const result = await mammoth.convertToHtml({ arrayBuffer });
        setFiles((current) => ({ ...current, [tabPath]: { path: displayPath, fsPath, content: '', html: result.value } }));
      } else {
        const content = fsPath ? await readTextFile(sourcePath) : await invoke<string>('codeclub_read_file', { projectPath, path: requestedTabPath });
        setFiles((current) => ({ ...current, [tabPath]: { path: displayPath, fsPath, content } }));
      }
    } catch (reason) {
      setFiles((current) => ({ ...current, [tabPath]: { path: displayPath, fsPath, content: '', error: `No se pudo abrir: ${String(reason)}` } }));
    }
  };

  useEffect(() => { if (initialSelectedPath) void openFile(initialSelectedPath); }, [initialSelectedPath, projectPath]);

  useEffect(() => {
    const rememberDraggedFile = (event: Event) => {
      draggedFileRef.current = (event as CustomEvent<{ projectPath: string; path: string }>).detail;
    };
    const clearDraggedFile = () => { draggedFileRef.current = null; };
    window.addEventListener('codeclub-file-drag-start', rememberDraggedFile);
    window.addEventListener('dragend', clearDraggedFile);
    return () => {
      window.removeEventListener('codeclub-file-drag-start', rememberDraggedFile);
      window.removeEventListener('dragend', clearDraggedFile);
    };
  }, []);

  const handleFileDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const payload = event.dataTransfer.getData('application/codeclub-file') || event.dataTransfer.getData('text/plain');
    const fallback = draggedFileRef.current;
    const nativeFile = event.dataTransfer.files?.[0] as (File & { path?: string }) | undefined;
    if (!payload && !fallback && !nativeFile?.path) return;
    try {
      const dropped = fallback || (payload ? JSON.parse(payload) as { projectPath: string; path: string } : null);
      if (dropped && dropped.projectPath === projectPath) {
        const tabBar = panelRef.current?.querySelector('main > div:first-child');
        void openFile(dropped.path, !tabBar?.contains(event.target as Node));
      } else if (nativeFile?.path) {
        const tabBar = panelRef.current?.querySelector('main > div:first-child');
        void openFile(nativeFile.name, !tabBar?.contains(event.target as Node), nativeFile.path);
      }
    } catch {
      // Ignorar datos de arrastre que no pertenecen al indexador.
    }
  };

  useEffect(() => () => Object.values(saveTimersRef.current).forEach((timer) => clearTimeout(timer)), []);

  const handleContentChange = (path: string, content: string) => {
    if (!projectPath) return;
    const file = files[path];
    setFiles((current) => ({ ...current, [path]: { ...current[path], content } }));
    const previousTimer = saveTimersRef.current[path];
    if (previousTimer) clearTimeout(previousTimer);
    saveTimersRef.current[path] = setTimeout(async () => {
      try {
        if (file?.fsPath) await writeTextFile(file.fsPath, content);
        else await invoke('codeclub_write_file', { projectPath, path, content });
      } catch (reason) {
        setFiles((current) => ({ ...current, [path]: { ...current[path], error: `No se pudo guardar: ${String(reason)}` } }));
      }
    }, 700);
  };

  const closeFile = (path: string) => {
    setTabs((current) => {
      const index = current.indexOf(path);
      const next = current.filter((item) => item !== path);
      if (selectedPath === path) setSelectedPath(next[index - 1] || next[index] || '');
      return next;
    });
    setFiles((current) => { const next = { ...current }; delete next[path]; return next; });
  };

  const tree = buildFileTree(entries);
  const renderTree = (nodes: FileTreeNode[], depth = 0): React.ReactNode => nodes.map((node) => {
    const isOpen = expanded.has(node.path);
    return <React.Fragment key={node.path}>
      <button type="button" onClick={() => node.kind === 'directory' ? setExpanded((current) => { const next = new Set(current); next.has(node.path) ? next.delete(node.path) : next.add(node.path); return next; }) : void openFile(node.path)} className={`flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[12px] ${selectedPath === node.path ? 'bg-[var(--color-surface-7)] text-[#eeeeee]' : 'text-[#bdbdbd] hover:bg-[var(--color-surface-3)]'}`} style={{ paddingLeft: `${8 + depth * 14}px` }}>
        {node.kind === 'directory' ? (isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />) : <span className="w-[13px]" />}
        {node.kind === 'directory' ? <Folder size={14} className="text-[#a89b72]" /> : <FileCode2 size={14} className="text-[#777777]" />}
        <span className="min-w-0 flex-1 truncate">{node.name}</span>
      </button>
      {node.kind === 'directory' && isOpen && renderTree(node.children, depth + 1)}
    </React.Fragment>;
  });

  return <div ref={panelRef} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; }} onDrop={handleFileDrop} className="flex h-full w-full min-w-0 flex-col overflow-hidden bg-[#171717] text-[#eeeeee]">
    <div className="flex h-9 shrink-0 items-center justify-between border-b border-[#2b2b2b] px-4"><span className="text-[13px] leading-none">/</span><button type="button" onClick={() => setShowFileTree((visible) => !visible)} className="grid h-7 w-7 place-items-center rounded-[9px] bg-[#202020] text-[#eeeeee] hover:bg-[#2b2b2b]" title="Mostrar u ocultar árbol del workspace" aria-label="Mostrar u ocultar árbol del workspace"><FolderOpen size={16} /></button></div>
    {loading ? <div className="flex flex-1 items-center justify-center text-xs text-[#777777]">Cargando proyecto...</div> : <div className="flex min-h-0 flex-1">
      <main className="flex min-w-0 flex-1 flex-col bg-[#171717]">{tabs.length ? <><div className="flex h-8 shrink-0 items-end gap-1 overflow-x-auto border-b border-[#2b2b2b] bg-[#171717] px-2">{tabs.map((path) => <div key={path} className={`group flex h-7 max-w-[190px] min-w-[110px] items-center gap-2 border-x border-t px-3 text-[11px] ${selectedPath === path ? 'border-[#2b2b2b] bg-[#1c1c1c] text-[#eeeeee]' : 'border-transparent text-[#777777]'}`}><button type="button" onClick={() => setSelectedPath(path)} className="min-w-0 flex-1 truncate bg-transparent text-left">{path.split(/[\\/]/).pop()}</button><button type="button" onClick={() => closeFile(path)} className="rounded p-0.5 text-[#666666] hover:bg-white/10 hover:text-white" title="Cerrar archivo" aria-label={`Cerrar ${path}`}><X size={12} /></button></div>)}</div><div className="min-h-0 flex-1 overflow-hidden bg-transparent">{files[selectedPath] ? <FilePreview projectPath={projectPath || ''} file={files[selectedPath]} onChange={(content) => handleContentChange(selectedPath, content)} /> : <div className="p-4 text-xs text-[#777777]">Cargando archivo...</div>}</div></> : <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center"><FolderOpen size={44} strokeWidth={1.4} className="text-[#a7a7a7]" /><div><p className="m-0 text-[18px] font-semibold text-[#eeeeee]">Abrir archivo</p><p className="m-0 mt-3 max-w-[360px] text-[16px] leading-6 text-[#a7a7a7]">Selecciona un archivo del árbol del espacio de trabajo</p></div></div>}</main>
      {showFileTree && <aside className="flex w-[374px] shrink-0 flex-col border-l border-[#2b2b2b] bg-[#171717]"><div className="min-h-0 flex-1 overflow-auto px-3 py-3 [scrollbar-width:none]">{tree.length ? renderTree(tree) : <div className="p-3 text-sm text-[#777777]">No se encontraron archivos.</div>}</div></aside>}
    </div>}
  </div>;
}

function ProjectPanelView({ projectPath, selectedPath }: { projectPath?: string; selectedPath?: string }) {
  return <TabbedProjectView projectPath={projectPath} initialSelectedPath={selectedPath} />;
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
