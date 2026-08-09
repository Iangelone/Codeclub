import React, { useState, useRef, useEffect } from 'react';
import { ArrowUp, ArrowUpRight, Box, Bug, Camera, Check, ChevronDown, ChevronRight, CircleHelp, Code2, Copy, Eye, FileCode2, FileText, FileType2, Folders as FolderOpen, GitCompare, Globe, KeyRound, Languages, LayoutTemplate, Lightbulb, ListChecks, ListTodo, MessageSquare, Monitor, MousePointer2, Orbit, Paperclip, Pencil, Presentation, Radar, RotateCcw, Search, ScrollText, Square, Table2, Terminal, Folder, FolderTree, RefreshCw, WandSparkles, Wifi, X } from 'lucide-react';
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
import { copyText, safeListen, desktopFileUrl as convertFileSrc, nativeInvoke as invoke, fileExists as exists, makeDirectory as mkdir, readDesktopBytes as readFile, readDesktopText as readTextFile, removeDesktopFile as remove, writeDesktopText as writeTextFile, selectDesktopFiles as open } from '../lib/runtime';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { jsonSchema, Output } from 'ai';
import ReactMarkdown from 'react-markdown';
import { motion } from 'motion/react';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { createPortal } from 'react-dom';
import mammoth from 'mammoth';
import { createDynamicToolAccess, createTools, inferAgentSpecialist, selectToolsForPrompt, resolveToolsWithAI, type AgentMode, type AgentSpecialist } from '../lib/engine/tools';
import { runStream } from '../lib/engine/run';
import { getProjectFilePath, getSetting, logPersistence, setSetting } from '../lib/persistence';
import { appendGenerationUsage, type GenerationUsageRecord } from '../lib/usage';
import { appendExecutionLog } from '../lib/execution-log';
import { appendGlobalChatTranscript, getProjectChatPath, getProjectTranscriptPath, readGlobalChatHistory, readGlobalChats, readProjectIndex, readProjectMeta, writeGlobalChatHistory, writeGlobalChats, writeProjectMeta } from '../lib/projectManager';
import { codeclubExtensions, type CodeclubExtension } from '../lib/extensions';
import { LANGUAGE_STORAGE_KEY, type AppLanguage } from '../lib/i18n';
import { connectAllAgentPluginMcp, loadAgentPlugins } from '../lib/agent-plugins';

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
const formatProcessingDuration = (durationMs: number) => durationMs >= 60000 ? `${(durationMs / 60000).toFixed(1)}min` : `${Math.max(0, Math.round(durationMs / 1000))}s`;
const escapeXml = (value: unknown) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const getBrowserReferenceFavicon = (reference: { title: string; url?: string }) => {
  try {
    if (!reference.url && reference.title.toLowerCase().includes('google')) return 'https://www.google.com/favicon.ico';
    const source = reference.url || '';
    if (!source) return '';
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(new URL(source).hostname)}&sz=32`;
  } catch {
    return '';
  }
};

type ChatAttachment = { path: string; name: string; mediaType: string; size?: number; previewUrl?: string; previewText?: string };
type ChatMessage = { role: string; content: string; attachments: ChatAttachment[]; [key: string]: any };
type CatalogItem = { id: string; type?: string; label?: string; name?: string; description?: string; aliases?: string[]; source?: string; [key: string]: any };
type ProjectOption = CatalogItem & { path?: string; projectPath?: string | null; projectId?: string; isNone?: boolean };
type SessionSkill = CatalogItem & { name: string; source: string; content: string; pluginRoot?: string };
type ChatInterfaceProps = { catalog: CatalogItem[]; defaultProvider: CatalogItem; defaultModel: CatalogItem; panelId?: string; eventPrefix?: string; selectedProject?: { projectPath: string; projectName?: string } | null; blockedPanelState?: string };
const extensionIcons: Record<string, any> = { documents: FileText, pdf: FileType2, spreadsheets: Table2, presentations: Presentation, 'template-creator': LayoutTemplate };
type ChatRuntime = {
  controller: AbortController;
  state: string;
  tool: string;
  startedAt: number;
  messages: any[];
  pendingApprovals: any[];
  approvalResolvers: Map<string, (approved: boolean) => void>;
};

const getAttachmentName = (path: string) => path.split(/[\\/]/).pop() || path;
const readDesktopFile = async (path: string) => {
  const reader = (window as any).codeclub?.readFile;
  return reader ? new Uint8Array(await reader(path)) : readFile(path);
};
const readDesktopTextFile = async (path: string) => {
  const reader = (window as any).codeclub?.readTextFile;
  return reader ? String(await reader(path)) : readTextFile(path);
};
const readProjectChatHistory = async (projectPath: string, chatId: string) => {
  const desktopReader = (window as any).codeclub?.readProjectChat;
  if (desktopReader) {
    const content = String(await desktopReader(projectPath, chatId) || '');
    return content.split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line));
  }
  const path = await getProjectFilePath(projectPath, 'chats', `${chatId}.jsonl`);
  if (!(await exists(path))) return [];
  const content = await readTextFile(path);
  return content.split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line));
};
const writeProjectChatHistory = async (projectPath: string, chatId: string, messages: any[]) => {
  const content = messages.map((message) => JSON.stringify(message)).join('\n') + (messages.length ? '\n' : '');
  const desktopWriter = (window as any).codeclub?.writeProjectChat;
  if (desktopWriter) {
    await desktopWriter(projectPath, chatId, content);
    return;
  }
  const dir = await getProjectFilePath(projectPath, 'chats');
  await mkdir(dir, { recursive: true });
  await writeTextFile(await getProjectFilePath(projectPath, 'chats', `${chatId}.jsonl`), content);
};
const normalizeChatContent = (value: unknown) => {
  const text = String(value ?? '');
  if (text.includes('No pude completar la respuesta') || text.includes('La respuesta tard')) return '';
  return text;
};
const getAttachmentMediaType = (name: string) => {
  const extension = name.split('.').pop()?.toLowerCase();
  const types: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
    txt: 'text/plain', md: 'text/markdown', mdx: 'text/markdown', json: 'application/json', csv: 'text/csv',
    js: 'text/javascript', jsx: 'text/javascript', ts: 'text/typescript', tsx: 'text/typescript', css: 'text/css',
    html: 'text/html', htm: 'text/html', rs: 'text/plain', py: 'text/x-python', sql: 'text/plain',
    svg: 'image/svg+xml', bmp: 'image/bmp', ico: 'image/x-icon', avif: 'image/avif', tif: 'image/tiff', tiff: 'image/tiff',
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
        const bytes = await readDesktopFile(attachment.path);
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

const getArtifactOutputConfig = (prompt: string) => {
  const text = prompt.toLowerCase();
  if (/todo|tareas?|pendientes?/.test(text)) {
    return Output.object({
      name: 'TodoArtifact',
      description: 'A validated TODO summary for the project Artifacts panel.',
      schema: jsonSchema({
        type: 'object',
        properties: {
          items: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, description: { type: 'string' }, status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'cancelled', 'blocked'] } }, required: ['title', 'description', 'status'], additionalProperties: false } },
        },
        required: ['items'],
        additionalProperties: false,
      }),
    });
  }
  if (/plan|planific|roadmap/.test(text)) {
    return Output.object({
      name: 'PlanArtifact',
      description: 'A validated implementation plan summary for the project Artifacts panel.',
      schema: jsonSchema({
        type: 'object',
        properties: {
          title: { type: 'string' },
          objective: { type: 'string' },
          steps: { type: 'array', items: { type: 'string' } },
          status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'cancelled', 'blocked'] },
        },
        required: ['title', 'objective', 'steps', 'status'],
        additionalProperties: false,
      }),
    });
  }
  return null;
};

const formatArtifactOutput = (output: any) => {
  if (output?.items) return `${output.items.length} TODO${output.items.length === 1 ? '' : 's'} estructurado${output.items.length === 1 ? '' : 's'} y validado${output.items.length === 1 ? '' : 's'} para Artifacts.`;
  if (output?.steps) return `Plan «${output.title}» estructurado y validado para Artifacts.`;
  return null;
};

const formatToolExecutionFallback = (mode: AgentMode, specialist: AgentSpecialist, tools: any[]) => {
  const completed = tools.filter((event) => event.output?.status !== 'running' && !event.output?.error);
  if (!completed.length) return '';
  const details = completed.map((event) => {
    const raw = typeof event.output === 'string' ? event.output : JSON.stringify(event.output ?? {});
    return `- ${event.name}: ${raw.slice(0, 900)}`;
  }).join('\n');
  return `Ejecución completada con evidencia real.\n\nModo: ${mode}\nEspecialista: ${specialist}\nTools usadas: ${completed.map((event) => event.name).join(', ')}\n\nResultados:\n${details}`;
};

export default function ChatInterface({ catalog, defaultProvider, defaultModel, panelId = 'left', eventPrefix = 'codeclub', selectedProject, blockedPanelState = 'blank' }: ChatInterfaceProps) {
  const [language, setLanguage] = useState<AppLanguage>('es');
  const chatText = language === 'en' ? { greeting: 'What are we working on today', send: 'Send', cancel: 'Cancel generation', message: 'Message', attach: 'Attach', removeFiles: 'Remove added files', activeSkills: 'Active skills', activeExtensions: 'Active extensions', removeSkill: 'Remove skill from this session', removeExtension: 'Remove extension from this session', selected: 'Selected', provider: 'provider', model: 'model', project: 'project', skill: 'skill', extension: 'extension', command: 'command', searchProvider: 'Search provider', searchModel: 'Search active provider model', searchProject: 'Search project', searchSkill: 'Search skill', searchCommand: 'Search command', noProject: 'No project', slash: { provider: 'Provider', model: 'Model', project: 'Project', skill: 'Skill', providerDescription: 'Select provider', modelDescription: 'Select model', projectDescription: 'Select project', skillDescription: 'Load skill in this session' }, status: { idle: 'Ready when you are.', connecting: 'Connecting to provider...', streaming: 'Thinking...', tool_call: 'Using tool...', approval: 'Waiting for approval...', running: 'Running...', error: 'Something went wrong.' } } : { greeting: '¿Qué toca hoy', send: 'Enviar', cancel: 'Cancelar generación', message: 'Mensaje', attach: 'Adjuntar', removeFiles: 'Quitar archivos añadidos', activeSkills: 'Habilidades activas', activeExtensions: 'Extensiones activas', removeSkill: 'Quitar habilidad de esta sesión', removeExtension: 'Quitar extensión de esta sesión', selected: 'Seleccionado', provider: 'proveedor', model: 'modelo', project: 'proyecto', skill: 'habilidad', extension: 'extensión', command: 'comando', searchProvider: 'Buscar proveedor', searchModel: 'Buscar modelo del proveedor activo', searchProject: 'Buscar proyecto', searchSkill: 'Buscar habilidad', searchCommand: 'Buscar comando', noProject: 'Sin proyecto', slash: { provider: 'Proveedor', model: 'Modelo', project: 'Proyecto', skill: 'Habilidad', providerDescription: 'Seleccionar proveedor', modelDescription: 'Seleccionar modelo', projectDescription: 'Seleccionar proyecto', skillDescription: 'Cargar habilidad en esta sesión' }, status: { idle: 'Listo cuando tú lo estés.', connecting: 'Conectando con el proveedor...', streaming: 'Pensando...', tool_call: 'Usando herramienta...', approval: 'Esperando aprobación...', running: 'Ejecutando...', error: 'Algo salió mal.' } };
  if (language === 'es') {
    Object.assign(chatText, { greeting: '¿Qué toca hoy', cancel: 'Cancelar generación', removeFiles: 'Quitar archivos añadidos', removeSkill: 'Quitar habilidad de esta sesión', removeExtension: 'Quitar extensión de esta sesión' });
    chatText.slash = { ...chatText.slash, skillDescription: 'Cargar habilidad en esta sesión' };
    chatText.status = { ...chatText.status, idle: 'Listo cuando tú lo estés.', approval: 'Esperando aprobación...', error: 'Algo salió mal.' };
  }
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const autonomousText = language === 'en'
    ? { label: 'Autonomous', description: 'Let the agent execute and verify the required tools', active: 'Active' }
    : { label: 'Autónomo', description: 'Dejá que el agente ejecute y verifique las tools necesarias', active: 'Activo' };
  const projectsSlashLabel = language === 'en' ? 'Projects' : 'Proyectos';
  const languageOptions = [
    { id: 'es', label: 'Español', description: 'Usar español', type: 'language' },
    { id: 'en', label: 'English', description: 'Use English', type: 'language' },
  ];
  const developmentOptions = [
    { id: 'build-feature', label: 'Desarrollar funcionalidad', description: 'Planificar, implementar y verificar', type: 'development', prompt: 'Desarrollá esta funcionalidad usando las tools necesarias. Primero inspeccioná el proyecto, proponé un plan breve, implementá los cambios y verificá que todo funcione.' },
    { id: 'debug-project', label: 'Investigar y corregir', description: 'Diagnosticar con tools', type: 'development', prompt: 'Investigá este problema usando las tools disponibles. Revisá el proyecto, encontrá la causa raíz, aplicá una solución y verificá el resultado.' },
    { id: 'review-changes', label: 'Revisar el proyecto', description: 'Analizar estado y próximos pasos', type: 'development', prompt: 'Revisá el estado actual del proyecto usando las tools necesarias. Señalá problemas importantes, proponé mejoras concretas y aplicá las que correspondan.' },
  ];
  const [copiedMessageIndex, setCopiedMessageIndex] = useState<number | null>(null);
  const [copiedToolLogIndex, setCopiedToolLogIndex] = useState<number | null>(null);
  const copyResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [input, setInput] = useState('');
  const [artifactReference, setArtifactReference] = useState<any>(null);
  const [browserReferences, setBrowserReferences] = useState<{ id: string; title: string; text: string; url?: string }[]>([]);
  const browserRefContainerRef = useRef<HTMLDivElement>(null);
  const [maxVisibleBrowserRefs, setMaxVisibleBrowserRefs] = useState(3);
  const [inputFocused, setInputFocused] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<ChatAttachment[]>([]);
  const chatPanelRef = useRef<HTMLDivElement>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [agentState, setAgentState] = useState('idle');
  const [connectionAttempt, setConnectionAttempt] = useState(1);
  const [agentElapsedMs, setAgentElapsedMs] = useState(0);
  const agentStartedAtRef = useRef(0);
  const [activeToolName, setActiveToolName] = useState('');
  const [computerUseActive, setComputerUseActive] = useState(false);
  const [pendingApprovals, setPendingApprovals] = useState<Array<{ id: string; toolName: string; input: unknown; summary: string }>>([]);
  const toolStateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const visualAnimationRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const [composerDocked, setComposerDocked] = useState(true);
  const composerDockedRef = useRef(false);

  useEffect(() => {
    if (window.localStorage.getItem(LANGUAGE_STORAGE_KEY) === 'en') setLanguage('en');
    const handleLanguageChange = (event: Event) => {
      const nextLanguage = (event as CustomEvent<{ language?: AppLanguage }>).detail?.language;
      if (nextLanguage === 'es' || nextLanguage === 'en') setLanguage(nextLanguage);
    };
    window.addEventListener('codeclub:language-change', handleLanguageChange);
    return () => window.removeEventListener('codeclub:language-change', handleLanguageChange);
  }, []);

  const [currentProvider, setCurrentProvider] = useState(defaultProvider);
  const [currentModel, setCurrentModel] = useState(defaultModel);
  const [settingsReady, setSettingsReady] = useState(false);
  const [username, setUsername] = useState('Usuario');
  const [showEmptyGreeting, setShowEmptyGreeting] = useState(true);
  const [credentialProvider, setCredentialProvider] = useState<CatalogItem | null>(null);
  const [credentialInput, setCredentialInput] = useState('');
  const credentialInputRef = useRef<HTMLInputElement>(null);
  const [customToolsFormat, setCustomToolsFormat] = useState<'json' | 'xml'>('json');
  const [customUrl, setCustomUrl] = useState('');
  const [customConfigError, setCustomConfigError] = useState('');
  const customUrlRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void invoke<string>('codeclub_get_username').then((name) => setUsername(name || 'Usuario')).catch(() => setUsername('Usuario'));
  }, []);

  const [menuOpen, setMenuOpen] = useState(false);
  const [commandKind, setCommandKind] = useState('');
  const [shiningAction, setShiningAction] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [projectOptions, setProjectOptions] = useState<ProjectOption[]>([]);
  const [skillOptions, setSkillOptions] = useState<SessionSkill[]>([]);
  const [activeSkills, setActiveSkills] = useState<SessionSkill[]>([]);
  const [autonomousMode, setAutonomousMode] = useState(false);
  const [activeExtensions, setActiveExtensions] = useState<CodeclubExtension[]>([]);
  const [availableExtensions, setAvailableExtensions] = useState<CodeclubExtension[]>(codeclubExtensions);
  const [enabledExtensions, setEnabledExtensions] = useState<Record<string, boolean>>(() => Object.fromEntries(codeclubExtensions.map((extension) => [extension.id, true])));
  const [activeCommandIndex, setActiveCommandIndex] = useState(0);
  const [activeProject, setActiveProject] = useState<any>(() => selectedProject ? { projectPath: selectedProject.projectPath, name: selectedProject.projectName || 'Proyecto' } : null);
  const [projectMeta, setProjectMeta] = useState<Record<string, any[]> | null>(null);
  const [expandedMenu, setExpandedMenu] = useState<'chat' | null>(null);
  const [newArtifactName, setNewArtifactName] = useState('');
  const [artifactSearch, setArtifactSearch] = useState<Record<string, string>>({});
  const [recentArtifactIds, setRecentArtifactIds] = useState<Record<string, string[]>>({});
  const [terminalCount, setTerminalCount] = useState(0);
  const [activeChat, setActiveChat] = useState<{chatId: string, projectPath: string, name?: string} | null>(null);
  const activeChatRef = useRef<{chatId: string, projectPath: string, projectName?: string, name?: string, customName?: boolean} | null>(null);
  const automaticTitleRef = useRef<string>('');
  const chatRuntimesRef = useRef(new Map<string, ChatRuntime>());
  const lastSelectedProjectRef = useRef<{ projectPath: string; projectName: string } | null | undefined>(selectedProject ? { projectPath: selectedProject.projectPath, projectName: selectedProject.projectName || 'Proyecto' } : undefined);
  const projectChangeNoticeRef = useRef<string | null>(null);
  const [workspaceMode, setWorkspaceMode] = useState('blank');
  const [selectedStructurePath, setSelectedStructurePath] = useState('');

  useEffect(() => {
    const loadSkills = async () => {
      try {
        const plugins = await loadAgentPlugins(activeProject?.projectPath || '');
        const pluginSkills = plugins.flatMap((plugin) => plugin.skills.map((skill) => ({ ...skill, id: `${plugin.id}:${skill.id}`, source: `plugin:${plugin.name}`, pluginRoot: plugin.root })));
        setSkillOptions(pluginSkills as SessionSkill[]);
      } catch { setSkillOptions([]); }
    };
    const handleSkillsChanged = (event: Event) => {
      const projectPath = (event as CustomEvent).detail?.projectPath;
      if (!projectPath || projectPath === activeProject?.projectPath) void loadSkills();
    };
    void loadSkills();
    window.addEventListener('codeclub:skills-changed', handleSkillsChanged);
    return () => window.removeEventListener('codeclub:skills-changed', handleSkillsChanged);
  }, [activeProject?.projectPath]);

  useEffect(() => {
    const loadEnabledExtensions = async () => {
      const all = codeclubExtensions;
      setAvailableExtensions(all);
      return Promise.all(all.map(async (extension) => [extension.id, await getSetting(`codeclub_extension_enabled_${extension.id}`, 'true') !== 'false'] as const))
      .then((entries) => setEnabledExtensions(Object.fromEntries(entries)));
    };
    const handleExtensionsChanged = () => { void loadEnabledExtensions(); };
    void loadEnabledExtensions();
    window.addEventListener('codeclub:extensions-changed', handleExtensionsChanged);
    return () => window.removeEventListener('codeclub:extensions-changed', handleExtensionsChanged);
  }, []);
  const agentStatusText = chatText.status[agentState as keyof typeof chatText.status] || chatText.status.idle;
  const isAgentBusy = isStreaming;
  const sendButtonActive = isAgentBusy || Boolean(input.trim()) || attachedFiles.length > 0 || Boolean(credentialProvider);
  useEffect(() => {
    if (!isStreaming) { setAgentElapsedMs(0); return undefined; }
    const updateElapsed = () => setAgentElapsedMs(Math.max(0, Date.now() - agentStartedAtRef.current));
    updateElapsed();
    const timer = window.setInterval(updateElapsed, 100);
    return () => window.clearInterval(timer);
  }, [isStreaming]);
  useEffect(() => { window.dispatchEvent(new CustomEvent('codeclub:agent-activity', { detail: { chatId: activeChat?.chatId, state: agentState, tool: activeToolName, agent: 'Desarrollo' } })); }, [activeChat?.chatId, agentState, activeToolName]);
  useEffect(() => {
    const handleArtifactReference = (event: Event) => {
      const detail = (event as CustomEvent<{ projectPath?: string; kind?: 'plan' | 'todo'; id?: string; title?: string }>).detail;
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
      const detail = (event as CustomEvent<{ title?: string; text?: string; url?: string }>).detail;
      if (!detail?.text) return;
      const newItem = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        title: detail.title || 'Referencia',
        text: detail.text,
        url: detail.url,
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
  const approvalResolversRef = useRef(new Map<string, (approved: boolean) => void>());
  const lastModelFetchRef = useRef<{ method: string; url: string; requestBody?: string; status?: number; statusText?: string; responseHeaders?: unknown; responseBody?: unknown; transportError?: string } | null>(null);
  const commandMenuRef = useRef<HTMLDivElement | null>(null);
  const commandMenuHostRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const chatInputRef = useRef<HTMLTextAreaElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
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
    const previous = lastSelectedProjectRef.current;
    const nextPath = selectedProject?.projectPath || null;
    if (previous !== undefined && previous?.projectPath !== nextPath) {
      projectChangeNoticeRef.current = nextPath
        ? `El usuario cambió el proyecto seleccionado a "${selectedProject?.projectName || 'Proyecto'}". Usá este proyecto como contexto de trabajo para este mensaje.`
        : 'El usuario quitó el proyecto seleccionado. Trabajá solo con contexto global hasta que elija otro.';
    }
    lastSelectedProjectRef.current = selectedProject ? { projectPath: selectedProject.projectPath, projectName: selectedProject.projectName || 'Proyecto' } : null;
    setActiveProject((current: any) => {
      if (!selectedProject) return null;
      if (current?.projectPath === selectedProject.projectPath) return current;
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
      const runtime = chatRuntimesRef.current.get(chat.chatId);
      const project = chat.projectPath ? {
        projectPath: chat.projectPath,
        projectName: chat.projectName || 'Proyecto',
      } : null;
      setActiveProject(project ? { projectPath: project.projectPath, name: project.projectName } : null);
      window.dispatchEvent(new CustomEvent('codeclub:project-selection-changed', {
        detail: project ? { selected: true, projectPath: project.projectPath, projectName: project.projectName } : { selected: false, keepChat: true },
      }));
      window.dispatchEvent(new CustomEvent('codeclub:active-project', { detail: project }));
      setMessages(runtime?.messages || []);
      setInput('');
      setAttachedFiles([]);
      setIsStreaming(Boolean(runtime && !runtime.controller.signal.aborted));
      setAgentState(runtime?.state || 'idle');
      setActiveToolName(runtime?.tool || '');
      setPendingApprovals(runtime?.pendingApprovals || []);
      approvalResolversRef.current = runtime?.approvalResolvers || new Map();
      abortControllerRef.current = runtime?.controller || null;
      const wasDocked = composerDockedRef.current;
      if (runtime?.messages?.length) return;
      try {
        if (!chat.projectPath) {
          const parsed = await readGlobalChatHistory(chat.chatId);
          setMessages(parsed);
          if (!wasDocked && parsed.length > 0) setComposerDocked(true);
          return;
        }
        const parsed = await readProjectChatHistory(chat.projectPath, chat.chatId);
        setMessages(parsed);
        if (!wasDocked && parsed.length > 0) setComposerDocked(true);
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
    };
    window.addEventListener('codeclub:open-empty-chat', handleOpenEmptyChat);
    return () => window.removeEventListener('codeclub:open-empty-chat', handleOpenEmptyChat);
  }, []);

  useEffect(() => {
    const handleManualChatRename = (event: Event) => {
      const detail = (event as CustomEvent<{ chatId?: string; newName?: string; automatic?: boolean }>).detail;
      const current = activeChatRef.current;
      if (!detail?.chatId || !detail.newName || detail.automatic || !current || current.chatId !== detail.chatId) return;
      activeChatRef.current = { ...current, name: detail.newName, customName: true };
      setActiveChat(activeChatRef.current);
    };
    window.addEventListener('codeclub:rename-chat', handleManualChatRename);
    return () => window.removeEventListener('codeclub:rename-chat', handleManualChatRename);
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
        const newMeta: any = await readProjectMeta(newPath) || { name: detail.projectName || 'Proyecto', path: newPath, created_at: new Date().toISOString(), chats: [] };
        if (!newMeta.chats.some((chat: any) => chat.id === current.chatId)) newMeta.chats.push({ id: current.chatId, name: chatName });
        await writeProjectMeta(newPath, newMeta);
        window.dispatchEvent(new CustomEvent('codeclub:project-meta-changed', { detail: { projectPath: oldPath } }));
        window.dispatchEvent(new CustomEvent('codeclub:project-meta-changed', { detail: { projectPath: newPath } }));
      } catch (error) { console.error('Error vinculando chat al proyecto:', error); }
    };
    window.addEventListener('codeclub:chat-project-changed', handleChatProjectChanged);
    return () => window.removeEventListener('codeclub:chat-project-changed', handleChatProjectChanged);
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
      setActiveProject(e.detail?.projectPath ? (current: any) => current?.projectPath === e.detail.projectPath ? current : e.detail : null);
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
          setProjectMeta(await readProjectMeta(activeProject.projectPath) as any);
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

  const openCommandMenu = (kind: string) => {
    setCommandKind(kind);
    setMenuOpen(true);
    setSearchQuery('');
    setActiveCommandIndex(0);
    setTimeout(() => commandMenuRef.current?.focus(), 10);
  };

  const readProjectsForCommandMenu = async () => {
    const bridge = (window as any).codeclub;
    if (typeof bridge?.listProjects === 'function') {
      const projects = await bridge.listProjects();
      return (projects || []).map((project: any) => ({ id: project.id, path: project.path, name: project.name }));
    }
    return readProjectIndex();
  };

  const toggleCommandMenu = (kind: string) => {
    if (menuOpen && commandKind === kind) {
      setMenuOpen(false);
      setCommandKind('');
      return;
    }
    if (kind === 'project') {
      void readProjectsForCommandMenu().then((projects) => {
        setProjectOptions([{ id: '__none__', label: chatText.noProject, type: 'project', projectPath: null, isNone: true }, ...projects.map((project: any) => ({ id: project.id || project.path, label: project.name, type: 'project', projectPath: project.path, projectId: project.id }))]);
        openCommandMenu(kind);
      });
      return;
    }
    openCommandMenu(kind);
  };

  const triggerActionShine = (action: string) => {
    setShiningAction(action);
    window.setTimeout(() => setShiningAction((current) => current === action ? '' : current), 1400);
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
        void readProjectsForCommandMenu().then((projects) => {
          setProjectOptions([{ id: '__none__', label: chatText.noProject, type: 'project', projectPath: null, isNone: true }, ...projects.map((project: any) => ({ id: project.id || project.path, label: project.name, type: 'project', projectPath: project.path, projectId: project.id }))]);
          openCommandMenu('project');
        });
      }
      if (kind === 'skill') {
        setSkillOptions((current) => current.length ? current : []);
        if (menuOpen && commandKind === kind) setMenuOpen(false);
        else openCommandMenu('skill');
      }
    };
    window.addEventListener('codeclub:open-command-menu', handleOpenCommandMenu);
    return () => window.removeEventListener('codeclub:open-command-menu', handleOpenCommandMenu);
  }, [menuOpen, commandKind]);

  const commandOptions: CatalogItem[] = commandKind === 'project' ? projectOptions : commandKind === 'skill' ? skillOptions.map((skill) => ({ ...skill, type: 'skill', label: skill.name })) : commandKind === 'language' ? languageOptions : commandKind === 'development' ? developmentOptions : catalog;
  const filteredCatalog = commandOptions.filter((item) => {
    const matchesKind = item.type === commandKind;
    const itemLabel = item.label || item.id || '';
    const matchesQuery = itemLabel.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesProvider = commandKind !== 'model' || item.providerId === currentProvider?.id;
    return matchesKind && matchesQuery && matchesProvider;
  });
  const activeSelection = commandKind === 'provider' ? currentProvider : commandKind === 'model' ? currentModel : commandKind === 'project' && activeProject ? { id: activeProject.projectPath, label: activeProject.name } : commandKind === 'language' ? { id: language, label: language === 'en' ? 'English' : 'Español' } : commandKind === 'command' && autonomousMode ? { id: 'autonomo', label: autonomousText.label } : null;
  const slashCommands: CatalogItem[] = [
    { id: 'proveedor', label: chatText.slash.provider, description: chatText.slash.providerDescription, aliases: ['proveedor', 'provider'], type: 'command', icon: Radar },
    { id: 'modelo', label: chatText.slash.model, description: chatText.slash.modelDescription, aliases: ['modelo', 'model'], type: 'command', icon: Box },
    { id: 'proyecto', label: projectsSlashLabel, description: chatText.slash.projectDescription, aliases: ['proyecto', 'proyectos', 'project', 'projects'], type: 'command', icon: Folder },
    { id: 'habilidad', label: chatText.slash.skill, description: chatText.slash.skillDescription, aliases: ['habilidad', 'skill'], type: 'command', icon: WandSparkles },
    { id: 'idioma', label: language === 'en' ? 'Language' : 'Idioma', description: language === 'en' ? 'Change language' : 'Cambiar idioma', aliases: ['idioma', 'language', 'lang'], type: 'command', icon: Languages },
    { id: 'desarrollo', label: language === 'en' ? 'Development' : 'Desarrollo', description: language === 'en' ? 'Insert a development prompt' : 'Inyectar un prompt de desarrollo', aliases: ['desarrollo', 'desarrollar', 'development', 'develop'], type: 'command', icon: Code2 },
    { id: 'autonomo', label: autonomousText.label, description: autonomousText.description, aliases: ['autonomo', 'autonomous'], type: 'command', icon: Orbit },
    ...availableExtensions.filter((extension) => enabledExtensions[extension.id]).map((extension) => ({ id: extension.id, label: extension.name, description: extension.description, type: 'extension' as const, icon: extensionIcons[extension.id] || Box, extension })),
  ].filter((command: CatalogItem) => command.label?.toLowerCase().includes(searchQuery.toLowerCase()) || command.aliases?.some((alias: string) => alias.includes(searchQuery.toLowerCase())));
  const commandMenuItems = commandKind === 'command'
    ? slashCommands
    : filteredCatalog.filter((item) => {
      if (!activeSelection) return true;
      if (item.id === activeSelection.id) return false;
      if (commandKind === 'project' && item.projectPath === activeProject?.projectPath) return false;
      return true;
    });
  const hasCommandMenuResults = commandMenuItems.length > 0;

  useEffect(() => {
    setActiveCommandIndex(0);
  }, [commandKind, searchQuery]);

  useEffect(() => {
    if (!menuOpen) return;
    const activeItem = commandMenuRef.current?.querySelector(`[data-command-index="${activeCommandIndex}"]`);
    activeItem?.scrollIntoView({ block: 'nearest' });
  }, [activeCommandIndex, menuOpen, commandMenuItems.length]);

  useEffect(() => {
    if (!composerDocked) return;
    messagesEndRef.current?.scrollIntoView({ block: 'end', behavior: 'auto' });
  }, [messages, isStreaming, pendingApprovals, composerDocked]);

  useEffect(() => {
    const chat = activeChatRef.current;
    if (isStreaming || !chat || chat.customName) return;
    const lastMessage = [...messages].reverse().find((message) => typeof message?.content === 'string' && message.content.trim());
    const rawTitle = lastMessage?.content?.trim();
    if (!rawTitle) return;
    const title = rawTitle.length > 120 ? `${rawTitle.slice(0, 120)}...` : rawTitle;
    if (automaticTitleRef.current === `${chat.chatId}:${title}`) return;
    automaticTitleRef.current = `${chat.chatId}:${title}`;
    window.dispatchEvent(new CustomEvent('codeclub:rename-chat', {
      detail: { chatId: chat.chatId, newName: title, projectPath: chat.projectPath, automatic: true },
    }));
  }, [messages, isStreaming]);

  useEffect(() => {
    if (!menuOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const button = (event.target as HTMLElement).closest('button') as HTMLButtonElement | null;
      const isCommandDockButton = ['provider', 'model', 'project'].includes(button?.dataset.commandMenuKind || '') || /^(Proveedor|Modelo|Proyecto):/.test(button?.getAttribute('aria-label') || '');
      if (commandMenuRef.current?.contains(event.target as Node) || button?.title === 'Proveedor, modelo y proyecto' || isCommandDockButton) return;
      setMenuOpen(false);
    };

    window.addEventListener('pointerdown', handlePointerDown);
    return () => window.removeEventListener('pointerdown', handlePointerDown);
  }, [menuOpen]);

  const handleItemClick = (item: CatalogItem) => {
    if (item.type === 'command') {
      if (item.id === 'proveedor' || item.id === 'modelo') {
        setInput('');
        setSearchQuery('');
        openCommandMenu(item.id === 'proveedor' ? 'provider' : 'model');
        return;
      }
      if (item.id === 'proyecto') {
        void readProjectsForCommandMenu().then((projects) => {
          setProjectOptions([{ id: '__none__', label: 'Sin proyecto', type: 'project', projectPath: null, isNone: true }, ...projects.map((project: any) => ({ id: project.id || project.path, label: project.name, type: 'project', projectPath: project.path, projectId: project.id }))]);
          openCommandMenu('project');
        });
        return;
      }
      if (item.id === 'habilidad') {
        setInput('');
        setSearchQuery('');
        openCommandMenu('skill');
        return;
      }
      if (item.id === 'idioma') {
        setInput('');
        setSearchQuery('');
        openCommandMenu('language');
        return;
      }
      if (item.id === 'desarrollo') {
        setInput('');
        setSearchQuery('');
        openCommandMenu('development');
        return;
      }
      if (item.id === 'autonomo') {
        setAutonomousMode((current) => !current);
        setInput('');
        setSearchQuery('');
        setMenuOpen(false);
        setCommandKind('');
        chatInputRef.current?.focus();
        return;
      }
      setInput(`/${item.id}`);
      setMenuOpen(false);
      chatInputRef.current?.focus();
      return;
    }
    if (item.type === 'skill') {
      setActiveSkills((current) => current.some((skill) => skill.id === item.id) ? current : [...current, item as SessionSkill]);
      setInput('');
      setSearchQuery('');
      setMenuOpen(false);
      setCommandKind('');
      chatInputRef.current?.focus();
      return;
    }
    if (item.type === 'language') {
      const nextLanguage = item.id === 'en' ? 'en' : 'es';
      setLanguage(nextLanguage);
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, nextLanguage);
      window.dispatchEvent(new CustomEvent('codeclub:language-change', { detail: { language: nextLanguage } }));
      setInput('');
      setSearchQuery('');
      setMenuOpen(false);
      setCommandKind('');
      chatInputRef.current?.focus();
      return;
    }
    if (item.type === 'development') {
      setInput(item.prompt);
      setSearchQuery('');
      setMenuOpen(false);
      setCommandKind('');
      requestAnimationFrame(() => chatInputRef.current?.focus());
      return;
    }
    if (item.type === 'extension') {
      setActiveExtensions((current) => current.some((extension) => extension.id === item.extension.id) ? current : [...current, item.extension]);
      setInput('');
      setSearchQuery('');
      setMenuOpen(false);
      setCommandKind('');
      chatInputRef.current?.focus();
      return;
    }
    if (item.type === 'project') {
      if (item.isNone) {
        setActiveProject(null);
        window.dispatchEvent(new CustomEvent('codeclub:project-selection-changed', { detail: { selected: false, keepChat: true } }));
        window.dispatchEvent(new CustomEvent('codeclub:active-project', { detail: { projectPath: null, projectName: '' } }));
        window.dispatchEvent(new CustomEvent('codeclub:project-switch', { detail: { id: 'home', name: 'Codeclub' } }));
        window.dispatchEvent(new CustomEvent('codeclub:open-empty-chat'));
      } else {
        setActiveProject({ projectPath: item.projectPath || '', name: item.label || item.id });
        window.dispatchEvent(new CustomEvent('codeclub:project-selection-changed', { detail: { selected: true, projectPath: item.projectPath, projectName: item.label } }));
        window.dispatchEvent(new CustomEvent('codeclub:active-project', { detail: { projectPath: item.projectPath, projectName: item.label } }));
        window.dispatchEvent(new CustomEvent('codeclub:project-switch', { detail: { id: item.projectId || item.projectPath, name: item.label, path: item.projectPath } }));
        void (window as any).codeclub?.switchProject?.(item.projectId || item.projectPath);
        window.dispatchEvent(new CustomEvent('codeclub:open-empty-chat'));
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
          getSetting<'json' | 'xml'>('codeclub_custom_tools_format', 'json'),
          getSetting('codeclub_custom_url', ''),
        ]).then(([format, url]) => {
          setCustomToolsFormat(format === 'xml' ? 'xml' : 'json');
          setCustomUrl(url);
          setCurrentProvider((current) => current ? { ...current, api: url } : current);
        });
      }
      setCurrentModel(defaultModel);
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
      setTimeout(() => (item.id === 'custom' ? customUrlRef.current : credentialInputRef.current)?.focus(), 0);
    } else {
      chatInputRef.current?.focus();
    }
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setMenuOpen(false);
      chatInputRef.current?.focus();
      return;
    }

    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter') {
      handleCommandMenuKeyDown(e);
    }
  };

  const handleCommandMenuKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    const selectableItems = commandMenuItems;
    if (e.key === 'Escape') {
      e.preventDefault();
      setMenuOpen(false);
      chatInputRef.current?.focus();
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (selectableItems.length === 0) return;
      setActiveCommandIndex((index) => Math.min(index + 1, selectableItems.length - 1));
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (selectableItems.length === 0) return;
      setActiveCommandIndex((index) => Math.max(index - 1, 0));
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      const index = activeCommandIndex >= 0 ? activeCommandIndex : 0;
      const selectedItem = selectableItems[index];
      if (selectedItem) handleItemClick(selectedItem);
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
      setSetting('codeclub_custom_tools_format', customToolsFormat),
      setSetting('codeclub_custom_url', customUrl.trim()),
    ]);
    setCurrentProvider((current) => current ? { ...current, api: customUrl.trim() } : current);
    setCustomConfigError('');
    setMenuOpen(false);
    setCommandKind('');
    chatInputRef.current?.focus();
  };

  const compactJson = (value: unknown) => {
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

  const escapeXml = (value: unknown) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

  const toolsAsXml = (tools: unknown) => {
    const items = Array.isArray(tools) ? tools : [];
    return `<tools>${items.map((item) => {
      const fn = item?.function || item || {};
      const parameters = typeof fn.parameters === 'string' ? fn.parameters : JSON.stringify(fn.parameters || {});
      return `<tool name="${escapeXml(fn.name)}" type="${escapeXml(item?.type || 'function')}"><description>${escapeXml(fn.description)}</description><parameters>${escapeXml(parameters)}</parameters></tool>`;
    }).join('')}</tools>`;
  };

  const clipDebug = (value: unknown, max = 20000) => {
    const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    if (!text) return '';
    return text.length > max ? `${text.slice(0, max)}\n...[truncated ${text.length - max} chars]` : text;
  };

  const errorChain = (error: unknown) => {
    const lines = [];
    let current: any = error;
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

  const formatDebugError = (error: unknown) => {
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

  const desktopModelFetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
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
      const response = await invoke<{ body: string; status: number; status_text?: string; headers?: Array<{ name: string; value: string }> }>('codeclub_http_fetch', {
        request: {
          url: request.url,
          method: request.method,
          headers: Array.from(request.headers.entries()).map(([name, value]) => ({ name, value })),
          body: requestBody || null,
        },
      });
      const headers = new Headers((response.headers || []).map((header) => [header.name, header.value] as [string, string]));
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
        transportError: error instanceof Error ? error.message : String(error),
      };
      throw error;
    }
  };

  const resolveToolApproval = (approvalId: string, approved: boolean) => {
    const resolver = approvalResolversRef.current.get(approvalId);
    if (!resolver) return;
    approvalResolversRef.current.delete(approvalId);
    setPendingApprovals((items) => items.filter((item) => item.id !== approvalId));
    resolver(approved);
  };

  const requestToolApproval = ({ toolName, input, summary }: { toolName: string; input: any; summary: string }) => {
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


  const appendToJsonl = async (msg: any, chatOverride = activeChatRef.current) => {
    const chat = chatOverride;
    if (!chat) return;
    if (!chat.projectPath) {
      const messages = await readGlobalChatHistory(chat.chatId);
      await writeGlobalChatHistory(chat.chatId, [...messages, msg]);
      await appendToTranscript(msg, chat);
      return;
    }
    try {
      const desktopWriter = (window as any).codeclub?.writeProjectChat;
      if (desktopWriter) {
        const current = await readProjectChatHistory(chat.projectPath, chat.chatId);
        await writeProjectChatHistory(chat.projectPath, chat.chatId, [...current, msg]);
        await logPersistence('append_chat_message', 'ok', { role: msg.role, chatId: chat.chatId, projectPath: chat.projectPath });
        await appendToTranscript(msg, chat);
        return;
      }
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
      await appendToTranscript(msg, chat);
    } catch (e) {
      console.error("FS Append Error:", e);
      await logPersistence('append_chat_message', 'error', {
        role: msg.role,
        chatId: chat?.chatId,
        projectPath: chat?.projectPath,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  };

  const appendToTranscript = async (msg: any, chat: typeof activeChatRef.current) => {
    if (!chat || !['user', 'assistant'].includes(msg?.role) || typeof msg?.content !== 'string' || !msg.content.trim()) return;
    const heading = msg.role === 'user' ? 'Usuario' : 'Codeclub';
    const markdown = `\n## ${heading} · ${new Date().toLocaleString()}\n\n${msg.content.trim()}\n`;
    if (!chat.projectPath) {
      await appendGlobalChatTranscript(chat.chatId, markdown);
      return;
    }
    const dir = await getProjectFilePath(chat.projectPath, 'chats');
    const path = await getProjectTranscriptPath(chat.projectPath, chat.chatId);
    await mkdir(dir, { recursive: true });
    const previous = (await exists(path)) ? await readTextFile(path) : `# Conversación ${chat.chatId}\n`;
    await writeTextFile(path, `${previous}${markdown}`);
  };

  const writeChatJsonl = async (nextMessages: any[], chatOverride = activeChatRef.current) => {
    const chat = chatOverride;
    if (!chat) return;
    if (!chat.projectPath) {
      await writeGlobalChatHistory(chat.chatId, nextMessages);
      return;
    }
    try {
      await writeProjectChatHistory(chat.projectPath, chat.chatId, nextMessages);
      await logPersistence('rewrite_chat_history', 'ok', {
        chatId: chat.chatId,
        projectPath: chat.projectPath,
        path: await getProjectChatPath(chat.projectPath, chat.chatId),
      });
    } catch (e) {
      await logPersistence('rewrite_chat_history', 'error', {
        chatId: chat?.chatId,
        projectPath: chat?.projectPath,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  };

  const sendMessage = async (content: string, baseMessages: any[] = messages, shouldRenameChat = messages.length === 0, replaceHistory = false, attachments: ChatAttachment[] = []) => {
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
    let pluginMcpClose: (() => Promise<unknown>) | undefined;
    const generationStartedAt = Date.now();
    let chat = activeChatRef.current;
    if (!chat) {
      chat = { chatId: `global-${Date.now()}`, projectPath: '' };
      activeChatRef.current = chat;
      setActiveChat(chat);
      const globalChats = await readGlobalChats();
      globalChats.push({ id: chat.chatId, name: 'Nuevo chat', customName: false, projectPath: '', projectName: 'Sin proyecto' });
      await writeGlobalChats(globalChats);
      window.dispatchEvent(new CustomEvent('codeclub:global-chat-changed'));
    }
    const chatId = chat.chatId;
    const runtime: ChatRuntime = { controller: abortController, state: 'connecting', tool: '', startedAt: generationStartedAt, messages: [], pendingApprovals: [], approvalResolvers: new Map() };
    chatRuntimesRef.current.set(chatId, runtime);
    abortControllerRef.current = abortController;
    approvalResolversRef.current = runtime.approvalResolvers;
    const isCurrentGeneration = () => !abortController.signal.aborted && chatRuntimesRef.current.get(chatId)?.controller === abortController;
    const isVisibleGeneration = () => isCurrentGeneration() && activeChatRef.current?.chatId === chatId;
    const publishRuntime = () => window.dispatchEvent(new CustomEvent('codeclub:agent-activity', { detail: { chatId, state: runtime.state, tool: runtime.tool, agent: 'Desarrollo' } }));
    const guardedSetAgentState = (state: string) => {
      if (!isCurrentGeneration()) return;
      runtime.state = state;
      publishRuntime();
      if (isVisibleGeneration()) setAgentState(state);
    };
    const guardedRequestToolApproval = ({ toolName, input, summary }: { toolName: string; input: any; summary: string }): Promise<boolean> => {
      if (!isCurrentGeneration()) return Promise.resolve(false);
      const approvalId = crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`;
      const approval = { id: approvalId, toolName, input, summary: summary || compactJson(input) };
      runtime.state = 'approval';
      runtime.pendingApprovals = [...runtime.pendingApprovals, approval];
      publishRuntime();
      if (isVisibleGeneration()) {
        setAgentState('approval');
        setPendingApprovals(runtime.pendingApprovals);
      }
      return new Promise<boolean>((resolve) => runtime.approvalResolvers.set(approvalId, resolve));
    };

    if (shouldRenameChat) window.dispatchEvent(new CustomEvent('codeclub:chat-created', { detail: { chatId: chat.chatId } }));

    const attachmentParts = attachments.length > 0 ? await readAttachmentParts(attachments) : [];
    const userMessage = { role: 'user', content, attachments: attachments.map(({ path, name, mediaType, size, previewUrl }) => ({ path, name, mediaType, size, previewUrl })) };
    const newMessages = [...baseMessages, userMessage];
    const pendingAssistant = { role: 'assistant', content: '', timeline: [], tools: [], agentName: 'Desarrollo' };
    runtime.messages = [...newMessages, pendingAssistant];
    setComposerDocked(true);
    setMessages(runtime.messages);
    setInput('');
    if (chatInputRef.current) chatInputRef.current.style.height = '22px';
    setIsStreaming(true);
    setConnectionAttempt(1);
    agentStartedAtRef.current = Date.now();
    setAgentState('connecting');
    publishRuntime();
    
    if (replaceHistory) {
      await writeChatJsonl(newMessages, chat);
    } else {
      await appendToJsonl(userMessage, chat);
    }

    try {
      if (!currentProvider || !currentModel) {
        throw new Error('Elegí un proveedor y un modelo antes de enviar.');
      }

      let apiKey = await getSetting(`${currentProvider.id}_api_key`, '');
      
      if ((!apiKey || apiKey === 'dummy-key') && currentProvider.id !== 'custom') {
        setCredentialProvider(currentProvider);
        setCredentialInput('');
        setCommandKind('credential');
        setMenuOpen(true);
        window.setTimeout(() => credentialInputRef.current?.focus(), 0);
        throw new Error(`API Key no configurada para ${currentProvider.label || currentProvider.id}. Por favor agregala en la configuración.`);
      }
      
      const provider = createOpenAICompatible({
        name: currentProvider.id,
        baseURL: currentProvider.api || 'https://api.openai.com/v1',
        apiKey,
        fetch: desktopModelFetch,
      });
      const contextProjectPath = activeProject?.projectPath || '';
      const projectChangeNotice = projectChangeNoticeRef.current;
      projectChangeNoticeRef.current = null;
      const runMode: AgentMode = 'development';
      let routeSpecialist: AgentSpecialist = 'primary';
      let assistantContent = '';
      let assistantReasoning = '';
      let assistantTools: any[] = [];
      let assistantTimeline: any[] = [];
      let executionStartedAt = Date.now();
      let latestUsage: any = null;
      const updateAssistantMessage = () => {
        runtime.messages = [...newMessages, { role: 'assistant', content: assistantContent, reasoning: assistantReasoning, timeline: assistantTimeline, tools: assistantTools, agentName: 'Desarrollo' }];
        if (isVisibleGeneration()) setMessages(runtime.messages);
      };
      const recordToolEvent = (name: string, input: any, output: any) => {
        runtime.tool = name;
        publishRuntime();
        if (isVisibleGeneration()) setActiveToolName(name);
        const runningIndex = [...assistantTools].map((event, index) => ({ event, index })).reverse().find(({ event }) => event.name === name && event.output?.status === 'running')?.index;
        const runningEvent = runningIndex === undefined ? null : assistantTools[runningIndex];
        const completedEvent = { ...runningEvent, id: runningIndex === undefined ? (crypto.randomUUID?.() || `${Date.now()}-${assistantTools.length}`) : assistantTools[runningIndex].id, name, input, output, at: new Date().toISOString(), durationMs: runningEvent?.durationMs ?? (runningEvent?.startedAt ? Date.now() - runningEvent.startedAt : null) };
        assistantTools = runningIndex === undefined ? [...assistantTools, completedEvent] : assistantTools.map((event, index) => index === runningIndex ? completedEvent : event);
        updateAssistantMessage();
        void appendExecutionLog({ projectPath: contextProjectPath, chatId: chat?.chatId, tool: name, input, output });
        if (['writeFile', 'runCommand', 'terminal'].includes(name)) window.dispatchEvent(new CustomEvent('codeclub:workspace-changed', { detail: { projectPath: contextProjectPath, tool: name } }));
        if (['todo', 'createPlan', 'updatePlan'].includes(name)) {
          window.dispatchEvent(new CustomEvent('codeclub:artifacts-changed', { detail: { projectPath: contextProjectPath } }));
          if (['createPlan', 'updatePlan'].includes(name)) {
            window.dispatchEvent(new CustomEvent('codeclub:open-artifacts', { detail: { projectPath: contextProjectPath } }));
          }
        }
      };
      const toolProjectPath = contextProjectPath || await invoke<string>('codeclub_get_system_root');
      const indexedProjects = await readProjectIndex();
      const developmentTools = createTools({
        projectPath: toolProjectPath,
        projectScoped: Boolean(contextProjectPath),
        recordToolEvent,
        setAgentState: guardedSetAgentState,
        requestToolApproval: guardedRequestToolApproval,
        provider,
        modelId: currentModel.id,
      });
      const externalMcpTools: Record<string, any> = {};
      try {
        const plugins = await loadAgentPlugins(contextProjectPath);
        const pluginMcp = await connectAllAgentPluginMcp(plugins);
        Object.assign(externalMcpTools, pluginMcp.tools);
        pluginMcpClose = pluginMcp.close;
      } catch (error) {
        console.warn('No se pudieron cargar los plugins Agent Plugins:', error);
      }
      let tools: Record<string, any> = {};
      let toolRoutingContext = 'La IA principal recibe directamente las tools necesarias y ejecuta el trabajo.';
      let beforeWorkspaceSnapshot: WorkspaceSnapshot = new Map();
      routeSpecialist = inferAgentSpecialist(content, runMode);
      const selectedToolset = Object.fromEntries(Object.entries(developmentTools).filter(([name]) => !['swarm', 'subagent', 'listAvailableTools'].includes(name)));
      const availableToolset = { ...selectedToolset, ...externalMcpTools };
      const dynamicToolAccess = createDynamicToolAccess(availableToolset, recordToolEvent);
      const artifactNames = ['createPlan', 'updatePlan', 'todo', 'getTaskStatus', 'switchProject'];
      const artifactTools = Object.fromEntries(artifactNames.filter((name) => selectedToolset[name]).map((name) => [name, selectedToolset[name]]));
      tools = { ...dynamicToolAccess, ...artifactTools, ...externalMcpTools };
      const routedToolset = tools;
      window.dispatchEvent(new CustomEvent('codeclub:agent-route', { detail: { mode: runMode, specialist: routeSpecialist, confidence: 1, reason: 'Una única IA ejecuta directamente las tools necesarias.' } }));
      try {
        const routing = await resolveToolsWithAI({
          model: provider(currentModel.id),
          mode: runMode,
          prompt: content,
          toolset: routedToolset,
          signal: abortController.signal,
          onUsage: async (usage) => {
            await appendGenerationUsage({
              id: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`,
              at: new Date().toISOString(),
              projectPath: contextProjectPath,
              chatId: chat?.chatId || '',
              mode: `${runMode}-tool-router`,
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
        tools = {
          ...routing.tools,
          searchTools: dynamicToolAccess.searchTools,
          executeTool: dynamicToolAccess.executeTool,
        };
        toolRoutingContext = `La IA de intención resolvió: ${routing.reason || 'intención detectada'} (confianza ${routing.confidence}). Tools habilitadas: ${Object.keys(tools).join(', ')}.`;
        void appendExecutionLog({ projectPath: contextProjectPath, chatId: chat?.chatId, tool: 'tool-router', input: { mode: runMode, specialist: routeSpecialist, prompt: content }, output: { confidence: routing.confidence, reason: routing.reason, requiresAction: routing.requiresAction, tools: Object.keys(tools) } });
      } catch (error) {
        const fallbackTools = selectToolsForPrompt(routedToolset, runMode, content);
        tools = {
          ...fallbackTools,
          searchTools: dynamicToolAccess.searchTools,
          executeTool: dynamicToolAccess.executeTool,
        };
        toolRoutingContext = `La IA de intención falló; se habilitó una selección determinista y acotada. Error: ${String(error)}`;
        void appendExecutionLog({ projectPath: contextProjectPath, chatId: chat?.chatId, tool: 'tool-router', input: { mode: runMode, specialist: routeSpecialist, prompt: content }, output: { status: 'fallback-deterministic', error: String(error), tools: Object.keys(tools) } });
      }
      beforeWorkspaceSnapshot = await readWorkspaceSnapshot(toolProjectPath);
      updateAssistantMessage();
      const activeSkillsContext = activeSkills.length > 0
        ? `Habilidades cargadas explícitamente para esta sesión:\n${activeSkills.map((skill) => `## ${skill.name}\n${skill.content.slice(0, 120000)}`).join('\n\n')}`
        : '';
      const activeExtensionsContext = activeExtensions.length > 0
        ? `Complementos activados explícitamente para esta sesión:\n${activeExtensions.map((extension) => `## ${extension.name}\n${extension.instruction}`).join('\n\n')}`
        : '';
      const system = [
        projectChangeNotice,
        activeSkillsContext,
        activeExtensionsContext,
        'Sos el agente de Desarrollo de Codeclub. Tu trabajo es entender el objetivo, ejecutar tools y entregar un resultado comprobable. Reportá siempre los errores reales de las tools; nunca describas una ejecución como "sin errores" si hubo una llamada fallida.',
        `Contexto: proyecto ${contextProjectPath || 'sin proyecto'}; proyectos indexados: ${indexedProjects.map((project) => `${project.name} (${project.path})`).join(', ') || 'ninguno'}.`,
        'Para capacidades operativas, consultá searchTools con palabras clave, leé el schema exacto y ejecutá la elegida mediante executeTool. No inventes nombres ni parámetros.',
        'Podés ejecutar directamente las tools de artifacts necesarias y verificá cada resultado antes de responder.',
        'La única IA es responsable de ejecutar acciones y persistir planes, TODOs y artifacts.',
        'Para PC o navegador usá un hijo custom con herramientas explícitas. Exigí estado observable después de cada acción. Nunca afirmes éxito sin el resultado real de una tool; redactá secretos y respondé en español.',
      ].filter(Boolean).join(' ');
      const xmlSystem = `<codeclub_agent>
  <identity>Agente principal de Codeclub</identity>
  <mode>Desarrollo</mode>
  <context>${escapeXml(system)}</context>
  <protocol>Coordinar hijos, ejecutar tools asignadas, verificar resultados y responder solo con evidencias comprobables.</protocol>
</codeclub_agent>`;
      // Algunos proveedores compatibles rechazan response_format junto con tools.
      // Los artifacts ya quedan validados y persistidos por sus tools; dejamos el
      // JSON forzado solo para respuestas sin ejecución de tools.
      const structuredOutput = Object.keys(tools).length === 0 ? getArtifactOutputConfig(content) : null;
      let structuredArtifactOutput: any = null;

      const runAssistant = async (retryInstruction = '') => {
        assistantContent = '';
        assistantReasoning = '';
        assistantTools = [];
        if (!retryInstruction) assistantTimeline = [];
        structuredArtifactOutput = null;
        executionStartedAt = Date.now();
        guardedSetAgentState('streaming');
        updateAssistantMessage();
        const executionMessages = retryInstruction ? [...newMessages, { role: 'user', content: `${retryInstruction}\n\nUse a different strategy or tool sequence; do not repeat the same failed call.` }] : newMessages;
        return runStream({
          model: provider(currentModel.id),
          system: xmlSystem,
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
              const last = assistantTimeline[assistantTimeline.length - 1];
              assistantTimeline = last?.type === 'thinking'
                ? assistantTimeline.map((item, index) => index === assistantTimeline.length - 1 ? { ...item, text: content } : item)
                : [...assistantTimeline, { type: 'thinking', id: crypto.randomUUID?.() || `${Date.now()}-thinking`, text: content }];
              updateAssistantMessage();
            },
            onStructuredOutput: (output) => {
              structuredArtifactOutput = output;
            },
            onAbort: ({ steps }) => {
              if (!isCurrentGeneration()) return;
              runtime.pendingApprovals = [];
              runtime.tool = '';
              guardedSetAgentState('idle');
              if (isVisibleGeneration()) setPendingApprovals([]);
              void appendExecutionLog({ projectPath: contextProjectPath, chatId: chat?.chatId, tool: 'generation.abort', input: { steps: steps.length }, output: { status: 'aborted' } });
            },
            onEnd: () => {
              if (!isCurrentGeneration()) return;
              runtime.tool = '';
              publishRuntime();
              if (isVisibleGeneration()) setActiveToolName('');
            },
            onStepEnd: ({ stepNumber, finishReason, toolCalls, usage, performance }) => {
              if (!isCurrentGeneration()) return;
              void appendExecutionLog({
                projectPath: contextProjectPath,
                chatId: chat?.chatId,
                tool: 'generation.step',
                input: { stepNumber, tools: (toolCalls || []).map((toolCall: any) => toolCall.toolName) },
                output: { finishReason, usage, performance: { stepTimeMs: performance?.stepTimeMs, responseTimeMs: performance?.responseTimeMs, outputTokensPerSecond: performance?.outputTokensPerSecond } },
              });
            },
            onToolExecutionStart: ({ callId, toolCall }) => {
              if (!isCurrentGeneration()) return;
              const name = toolCall?.toolName || 'tool';
              const innerToolName = name === 'executeTool' ? toolCall?.input?.name : name;
              if (String(innerToolName || '').startsWith('computer')) setComputerUseActive(true);
              const eventKey = callId || toolCall?.toolCallId || '';
              const existingIndex = eventKey ? assistantTools.findIndex((event) => event.callId === eventKey) : -1;
              const nextEvent = { id: existingIndex >= 0 ? assistantTools[existingIndex].id : (eventKey || crypto.randomUUID?.() || `${Date.now()}-${assistantTools.length}`), callId: eventKey, name, input: toolCall?.input || {}, output: { status: 'running' }, startedAt: Date.now(), durationMs: null, at: new Date().toISOString() };
              assistantTools = existingIndex >= 0 ? assistantTools.map((event, index) => index === existingIndex ? { ...event, ...nextEvent } : event) : [...assistantTools, nextEvent];
              assistantTimeline = [...assistantTimeline, { type: 'tool', id: nextEvent.id, name, input: nextEvent.input, status: 'running' }];
              runtime.tool = name;
              publishRuntime();
              if (isVisibleGeneration()) setActiveToolName(name);
              updateAssistantMessage();
              void appendExecutionLog({ projectPath: contextProjectPath, chatId: chat?.chatId, tool: 'tool.execution.start', input: { callId, toolCallId: toolCall?.toolCallId, toolName: toolCall?.toolName, input: toolCall?.input }, output: { status: 'started' } });
            },
            onToolExecutionEnd: ({ callId, toolCall, toolExecutionMs, toolOutput }) => {
              if (!isCurrentGeneration()) return;
              const toolResult = toolOutput?.output ?? toolOutput?.result ?? toolOutput;
              const toolStatus = toolOutput?.type === 'tool-result' && toolResult?.ok !== false ? 'completed' : 'error';
              const eventKey = callId || toolCall?.toolCallId || '';
              if (eventKey) {
                assistantTools = assistantTools.map((event) => event.callId === eventKey ? { ...event, durationMs: toolExecutionMs } : event);
                const toolEvent = assistantTools.find((event) => event.callId === eventKey);
                if (toolEvent) assistantTimeline = assistantTimeline.map((event) => event.id === toolEvent.id ? { ...event, status: toolStatus, output: toolOutput, durationMs: toolExecutionMs } : event);
              }
              updateAssistantMessage();
              void appendExecutionLog({ projectPath: contextProjectPath, chatId: chat?.chatId, tool: 'tool.execution.end', input: { callId, toolCallId: toolCall?.toolCallId, toolName: toolCall?.toolName }, output: { durationMs: toolExecutionMs, status: toolStatus } });
            },
            onToolCall: () => {
              if (!isCurrentGeneration()) return;
              if (toolStateTimerRef.current) clearTimeout(toolStateTimerRef.current);
              guardedSetAgentState('tool_call');
            },
            onToolResult: () => {
              if (!isCurrentGeneration()) return;
              if (toolStateTimerRef.current) clearTimeout(toolStateTimerRef.current);
              toolStateTimerRef.current = setTimeout(() => {
                toolStateTimerRef.current = null;
                if (!isCurrentGeneration() || abortController.signal.aborted) return;
                guardedSetAgentState('streaming');
              }, 2000);
            },
            onUsage: async (usage) => {
              const record: GenerationUsageRecord = {
                id: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`,
                at: new Date().toISOString(),
                projectPath: contextProjectPath,
                chatId: chat?.chatId || '',
                mode: runMode,
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
      const runAssistantWithRetry = async (instruction = '') => {
        let lastError: unknown;
        for (let attempt = 0; attempt < 5; attempt += 1) {
          try {
            if (attempt > 0) {
              setConnectionAttempt(attempt + 1);
              guardedSetAgentState('connecting');
            }
            return await runAssistant(instruction);
          } catch (error) {
            lastError = error;
            if (abortController.signal.aborted) throw error;
          }
        }
        throw lastError;
      };
      assistantContent = await runAssistantWithRetry();
      const structuredSummary = formatArtifactOutput(structuredArtifactOutput);
      if (structuredSummary) assistantContent = structuredSummary;
      if (!abortController.signal.aborted && !assistantContent?.trim()) {
        const toolFallback = formatToolExecutionFallback(runMode, routeSpecialist, assistantTools);
        if (toolFallback) assistantContent = toolFallback;
        else {
          guardedSetAgentState('streaming');
          assistantContent = await runAssistantWithRetry();
          const retryStructuredSummary = formatArtifactOutput(structuredArtifactOutput);
          if (retryStructuredSummary) assistantContent = retryStructuredSummary;
        }
      }
      if (!assistantContent?.trim()) throw new Error('El modelo no devolvió una respuesta después de reintentar.');

      let lastContinuationSignature = '';
      const initialSwarmEvents = assistantTools.filter((event) => event.name === 'swarm');
      const initialSwarmActions = initialSwarmEvents.map((event) => event.input?.action).filter(Boolean);
      const activeSwarmName = initialSwarmEvents.map((event) => event.output?.swarmName || event.input?.swarmName).find(Boolean) || '';
      const activeChildNames = initialSwarmEvents.map((event) => event.output?.childName || event.input?.childName).filter(Boolean);
      let swarmOpen = initialSwarmActions.includes('spawn') && !initialSwarmActions.includes('merge') && !initialSwarmActions.includes('stop');
      while (!abortController.signal.aborted) {
        const swarmEvents = assistantTools.filter((event) => event.name === 'swarm');
        const actions = swarmEvents.map((event) => event.input?.action).filter(Boolean);
        if (!swarmOpen || actions.includes('merge') || actions.includes('stop')) break;
        const signature = actions.join('|');
        const hasProgressAction = actions.some((action) => ['sendMessage', 'broadcast', 'wait'].includes(action));
        if ((signature && signature === lastContinuationSignature) || actions.includes('spawn') || !hasProgressAction) break;
        const evidence = swarmEvents.slice(-8).map((event) => ({ input: event.input, output: event.output })).filter((event) => event.output?.status !== 'running');
        lastContinuationSignature = signature;
        assistantContent = await runAssistantWithRetry(`Continuá el swarm ${activeSwarmName || 'activo'} existente con los hijos ${JSON.stringify(activeChildNames)}. No uses spawn: comunicá, esperá y luego ejecutá merge o stop. Evidencias: ${JSON.stringify(evidence).slice(0, 3000)}`);
        const retryStructuredSummary = formatArtifactOutput(structuredArtifactOutput);
        if (retryStructuredSummary) assistantContent = retryStructuredSummary;
        const continuationActions = assistantTools.filter((event) => event.name === 'swarm').map((event) => event.input?.action).filter(Boolean);
        if (continuationActions.includes('merge') || continuationActions.includes('stop')) swarmOpen = false;
      }

      if (!isCurrentGeneration() || abortController.signal.aborted) return;
      const changes = contextProjectPath ? summarizeWorkspaceDelta(beforeWorkspaceSnapshot, await readWorkspaceSnapshot(toolProjectPath)) : null;
      const usage = latestUsage as any;
      const assistantMessage = { role: 'assistant', content: assistantContent || 'La ejecución terminó sin texto final, pero las evidencias quedaron registradas.', timeline: assistantTimeline, tools: assistantTools, agentName: 'Desarrollo', meta: { provider: currentProvider.label || currentProvider.id, model: currentModel.label || currentModel.id, durationMs: Date.now() - executionStartedAt, status: 'completed', changes, usage: latestUsage ? { inputTokens: latestUsage.inputTokens, outputTokens: latestUsage.outputTokens, totalTokens: latestUsage.totalTokens, reasoningTokens: latestUsage.reasoningTokens } : null } };
      // La respuesta ya se muestra progresivamente durante el stream. Al finalizar
      // conservamos el contenido completo para evitar una burbuja vacíoa si la
      // animación visual se interrumpe al cambiar de estado.
      runtime.messages = [...newMessages, assistantMessage];
      if (isVisibleGeneration()) setMessages(runtime.messages);
      if (toolStateTimerRef.current) {
        clearTimeout(toolStateTimerRef.current);
        toolStateTimerRef.current = null;
      }
      runtime.state = 'idle';
      runtime.tool = '';
      publishRuntime();
      if (isVisibleGeneration()) {
        setIsStreaming(false);
        setActiveToolName('');
        setAgentState('idle');
      }
      const persistencePromise = replaceHistory
        ? writeChatJsonl([...newMessages, assistantMessage], chat)
        : appendToJsonl(assistantMessage, chat);
      const persistenceTimeout = new Promise<void>((resolve) => window.setTimeout(resolve, 8_000));
      void Promise.race([persistencePromise, persistenceTimeout]).catch((error) => {
        console.error('No se pudo guardar el historial del chat:', error);
      });
    } catch (error) {
      if (chatRuntimesRef.current.get(chatId)?.controller !== abortController) return;
      const wasCancelled = abortController.signal.aborted;
      if (!wasCancelled) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const isConfigurationError = errorMessage.includes('API Key no configurada');
        if (!isConfigurationError) console.error(formatDebugError(error));
        runtime.state = 'error';
        publishRuntime();
        if (isVisibleGeneration()) setAgentState('error');
      }
      const updateErrorMessages = (prev: any[]) => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last?.role === 'assistant' && last.content === '') {
          updated[updated.length - 1] = {
            ...last,
            content: '',
            meta: {
              provider: currentProvider.label || currentProvider.id,
              model: currentModel.label || currentModel.id,
              durationMs: Date.now() - generationStartedAt,
              status: wasCancelled ? 'cancelled' : 'error',
              errorName: error instanceof Error ? error.name : 'Error',
              configuration: (error instanceof Error ? error.message : String(error)).includes('API Key no configurada'),
            },
          };
        }
        return updated;
      };
      runtime.messages = updateErrorMessages(runtime.messages);
      if (activeChatRef.current?.chatId === chatId) setMessages(runtime.messages);
      await writeChatJsonl(runtime.messages, chat);
    } finally {
      if (pluginMcpClose) await pluginMcpClose().catch(() => undefined);
      if (chatRuntimesRef.current.get(chatId)?.controller !== abortController) return;
      if (toolStateTimerRef.current) {
        clearTimeout(toolStateTimerRef.current);
        toolStateTimerRef.current = null;
      }
      if (abortControllerRef.current === abortController) abortControllerRef.current = null;
      runtime.pendingApprovals = [];
      runtime.approvalResolvers.clear();
      if (activeChatRef.current?.chatId === chatId) {
        setIsStreaming(false);
        setActiveToolName('');
        setComputerUseActive(false);
        setAgentState((state) => state === 'error' && !abortController.signal.aborted ? 'error' : 'idle');
      }
      if (chatRuntimesRef.current.get(chatId)?.controller === abortController) chatRuntimesRef.current.delete(chatId);
    }
  };

  const cancelGeneration = () => {
    const controller = abortControllerRef.current;
    if (!controller) return;
    const chatId = activeChatRef.current?.chatId;
    const runtime = chatId ? chatRuntimesRef.current.get(chatId) : undefined;
    abortControllerRef.current = null;
    if (!controller.signal.aborted) controller.abort(new DOMException('Generación cancelada por el usuario.', 'AbortError'));
    if (toolStateTimerRef.current) {
      clearTimeout(toolStateTimerRef.current);
      toolStateTimerRef.current = null;
    }
    (runtime?.approvalResolvers || approvalResolversRef.current).forEach((resolve) => resolve(false));
    (runtime?.approvalResolvers || approvalResolversRef.current).clear();
    if (runtime && chatId) {
      runtime.state = 'idle';
      runtime.tool = '';
      runtime.pendingApprovals = [];
      chatRuntimesRef.current.delete(chatId);
      window.dispatchEvent(new CustomEvent('codeclub:agent-activity', { detail: { chatId, state: 'idle', tool: '', agent: 'Desarrollo' } }));
    }
    setPendingApprovals([]);
    setIsStreaming(false);
    setActiveToolName('');
    setComputerUseActive(false);
    setAgentState('idle');
  };

  useEffect(() => {
    const handleComputerEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !computerUseActive) return;
      event.preventDefault();
      cancelGeneration();
    };
    let unlisten: (() => void) | undefined;
    void safeListen('codeclub-computer-escape', () => {
      if (computerUseActive) cancelGeneration();
    }).then((dispose) => { unlisten = dispose; });
    window.addEventListener('keydown', handleComputerEscape);
    return () => {
      window.removeEventListener('keydown', handleComputerEscape);
      unlisten?.();
    };
  }, [computerUseActive]);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent('codeclub:computer-overlay-set', {
      detail: {
        active: computerUseActive,
        provider: currentProvider?.label || currentProvider?.id || defaultProvider?.label || defaultProvider?.id || 'Codeclub',
      },
    }));
  }, [computerUseActive, currentProvider, defaultProvider]);

  useEffect(() => () => {
    if (visualAnimationRef.current) clearInterval(visualAnimationRef.current);
  }, []);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if ((!input.trim() && attachedFiles.length === 0) || isAgentBusy) return;

    if (/^\/terminal$/i.test(input.trim())) {
      const rect = e.currentTarget.getBoundingClientRect();
      window.dispatchEvent(new CustomEvent('codeclub:open-terminal-panel', {
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
    setAttachedFiles([]);
    await sendMessage(input.trim(), messages, messages.length === 0, false, filesToSend);
  };

  useEffect(() => {
    if (panelId !== 'left') return undefined;
    const handleTestingAction = (event: Event) => {
      const action = (event as CustomEvent).detail?.action;
      if (action === 'assistant-overlay') {
        setComputerUseActive((active) => !active);
        return;
      }
      if (isAgentBusy) return;
      const prompts: Record<string, string> = {
        'test-swarm': '[TEST SWARM] El Padre debe usar solo swarm y listAvailableTools. Creá un swarm con un hijo read_only y otro developer; asignales tareas distintas, comunicate con ambos, esperá sus resultados y devolvé el estado y merge de evidencias. No modifiques archivos.',
        'test-artifacts': '[TEST ARTIFACTS] El agente debe gestionar un proyecto de prueba usando sus tools de artifacts: creá y actualizá un plan y un TODO. No modifiques archivos existentes.',
        'test-programmatic': '[TEST PROGRAMÁTICO] Usá swarm para crear un hijo developer con tools custom de listFiles, readFile, searchText y runCommand. Pedile inspeccionar el proyecto y ejecutar un diagnóstico seguro; el Padre debe revisar y resumir evidencias.',
        'test-custom-control': '[TEST CONTROL CUSTOM] Usá swarm para crear un hijo con template custom y asignale openBrowser, getBrowserState, browserAction, runCommand y terminal. Abrí https://example.com, observá el estado y realizá solo acciones seguras; devolvé evidencia real.',
        'test-timeline': '[TEST TIMELINE] Usá swarm con un hijo read_only y otro developer. Ejecutá tareas seguras en secuencia y devolvé solo el resumen final; quiero observar pensamiento, tools, hijos y evidencias en orden.',
        'test-browser': '[TEST NAVEGADOR] Usá swarm con un hijo custom. Abrí https://example.com, consultá getBrowserState, seleccioná una referencia segura y verificá el resultado. No uses URLs inválidas ni modifiques archivos.',
        'test-retry': '[TEST RETRY] Usá un hijo custom para intentar una operación de navegador segura. Si una tool falla, reintentá con una estrategia válida y devolvé únicamente el resultado final con la evidencia del error y la recuperación.',
        'test-capacity': '[TEST CAPACIDAD] Creá un swarm y asigná hasta cuatro hijos activos con tareas de lectura seguras. Cuando uno termine, creá otro para comprobar que el slot se libera. No modifiques archivos.',
        'test-all': '[TEST INTEGRAL] Verificá todo el flujo de agentes en modo Desarrollo, sin borrar ni modificar archivos. Inspeccioná el workspace con listFiles, searchText y readFile; ejecutá un comando seguro de diagnóstico; creá y actualizá un plan de prueba; consultá getExecutionLog; delegá una investigación a developer y otra a qa, en secuencia. Registrá cada resultado real, errores y tiempos, y devolvé un resumen final en español.',
        'braille-tools': '[TESTING BRAILLE] Usá Desarrollo y ejecutá tools reales, una por vez: listFiles con maxFiles=8, searchText con query "TODO" y maxMatches=5, readFile usando un archivo real devuelto por listFiles y getExecutionLog con limit=3. No edites archivos y devolvé el resumen en español.',
        'braille-specialists': '[TESTING BRAILLE] Usá Desarrollo y delegá dos especialistas reales, en secuencia: developer y qa. Cada uno debe inspeccionar el proyecto y devolver evidencias breves. No edites archivos; quiero ver cada llamada como una tool con su patrón Braille.',
        'braille-error': '[TESTING BRAILLE] Usá Desarrollo y llamá obligatoriamente readFile con la ruta inexistente "__codeclub_braille_missing__.txt" para producir un error real y mostrar el patrón Braille de error. Informá la evidencia sin inventar.',
        'braille-browser': '[TESTING BRAILLE] Usá Desarrollo: abrí https://example.com con openBrowser, observá con getBrowserState y ejecutá un scroll pequeño con browserAction. Verificá cada resultado; no edites archivos ni inventes estados.',
        'braille-complete': '[TESTING BRAILLE] Ejecutá una secuencia completa de tools reales en Desarrollo: listFiles, searchText, getExecutionLog, createPlan y updatePlan. El plan debe ser de prueba y persistirse en el workspace. Esperá cada resultado y devolvé los tiempos.',
        'markdown-rendering': '[TESTING MARKDOWN] Respondé únicamente con una demostración completa en Markdown, sin tools: encabezados H1/H2/H3, texto en **negrita**, *cursiva*, ~~tachado~~, enlace, cita, listas numeradas y con viñetas, código inline, bloque de código con lenguaje, regla horizontal y una tabla con encabezados, tres filas y alineación. Incluí emojis y caracteres especiales. No describas la prueba: renderizá directamente todos los elementos.',
      };
      Object.assign(prompts, {
        'assistant-browser-cursor': 'Probé el cursor durante el control del navegador integrado. Usá openBrowser para abrir https://example.com, consultá getBrowserState y luego ejecutá browserAction con type "move" usando el selector CSS de un elemento visible real. Observá que el overlay del agente y el cursor nativo de Codeclub se reflejen dentro del navegador, verificá el resultado real y no inventes movimiento si alguna tool falla.',
        'assistant-computer-cursor': 'Probé el movimiento del cursor nativo de Computer Use. Ejecutá computerListWindows, identificá una ventana visible real, consultá computerGetState y computerScreenshot, y después usá computerAction move con coordenadas derivadas de una ventana real para mover el cursor a un punto visible. Verificá con otra captura y reportá si el cursor y el overlay se reflejaron; no hagas clicks ni escribas.',
        'assistant-computer': 'Usa Computer Use sobre la aplicacion de escritorio de ChatGPT, no el navegador embebido y no openBrowser. Ejecuta las tools una por vez: primero computerListWindows; luego enfoca ChatGPT con computerAction focus y targetName; consulta computerGetState. Si solo devuelve Pane o no muestra TextBox/Input, ejecuta computerScreenshot, ubica visualmente el campo, haz computerAction click con x/y, luego computerAction type con "Hola GPT, te saluda Codeclub." y computerAction key con {ENTER}. Verifica el resultado real y no inventes que se envio si una tool falla.',
        'dev-computer': 'Hacé una verificación segura de Computer Use de forma secuencial, una tool por vez: primero computerListWindows, después computerGetState y al final computerScreenshot. No paralelices las tools. No hagas clicks, no escribas y no modifiques nada. Mostrá la evidencia real de cada tool.',
        'dev-inspect': 'Inspeccioná el workspace actual. Listá archivos, buscá algunos TODO y leé un archivo pequeño. Resumí qué herramientas usaste, cuánto tardó cada paso y qué evidencia encontraste. No modifiques nada.',
        'dev-plan': 'Creá un plan breve para verificar el workspace con tres pasos, actualizá el primer paso y consultá el estado final. Usá las tools directamente y devolvé los IDs y estados reales.',
        'dev-edit': 'Creá un archivo temporal dentro del workspace con una línea de texto, leelo para comprobarlo y después eliminálo. Verificá cada resultado y no toques archivos existentes.',
        'dev-browser': 'Abrí https://example.com, observá el estado del navegador y verificá que el título o contenido principal está disponible. No hagas acciones destructivas ni inventes resultados.',
        'dev-diagnostics': 'Hacé un diagnóstico completo y seguro del workspace: inspeccioná archivos, buscá TODOs, consultá el log de ejecución, verificá el estado de las tareas y medí cuánto tarda cada tool. No modifiques nada. Si encontrás un plan previo pendiente, reportalo como estado histórico y no lo presentes como parte de este diagnóstico. Si una tool falla y luego se corrige, informá ambos hechos.',
        'dev-recovery': 'Provocá un error controlado leyendo una ruta inexistente, registrá la evidencia y recuperate buscando un archivo real para leerlo. Informá claramente el fallo, la recuperación y los tiempos.',
        'web-folder': 'Usá la carpeta nueva que acabo de crear para este sitio web. Inspeccioná el workspace, identificá esa carpeta, verificá su ruta y devolveme evidencia real. No crees todavía la página ni otra carpeta.',
        'web-page': 'Usá la carpeta del sitio que acabamos de crear. Armá allí una página web simple y presentable, con sus archivos necesarios. Verificá la estructura y explicame qué quedó listo.',
        'web-debug': 'Abrí el sitio web que acabamos de preparar en el navegador. Inspeccioná su estado, probá la interacción principal y corregí cualquier problema que encuentres. Mostrame el resultado comprobable.',
        'test-labels': '[TEST LABELS] Ejecuta una operacion real y segura con un hijo read_only. Debes provocar y mostrar los estados Pensando, tool en ejecucion, resultado completado y resumen final. Ejecuta, no describas; no modifiques archivos.',
        'test-tools': '[TEST TOOLS] Usa listAvailableTools y crea un hijo developer con listFiles, readFile, searchText y runCommand. El hijo debe ejecutar las cuatro tools en secuencia con datos reales del workspace, sin modificar archivos. Comunicate, espera y mergea evidencias.',
        'test-swarm-visual': '[TEST SWARM VISUAL] Crea un swarm con dos hijos: read_only y developer. Asignales tareas distintas, envia un mensaje a cada uno, espera sus respuestas y haz merge. Muestra evidencias reales y resumen final; no modifiques archivos.',
        'test-error-visual': '[TEST ERROR RETRY] Crea un hijo read_only. Lee primero la ruta inexistente "__codeclub_visual_missing__.txt" para provocar un error real; luego reintenta con listFiles y lee un archivo existente. Resume error, recuperacion y evidencia. No modifiques archivos.',
        'test-format': '[TEST FORMATO FINAL] Ejecuta una consulta segura con un hijo read_only y devuelve un resumen final en Markdown con titulo, parrafos, negrita, cursiva, lista, codigo inline, bloque de codigo, cita y tabla. No muestres razonamiento crudo.',
      });
      if (prompts[action]) void sendMessage(prompts[action]);
    };
    window.addEventListener('codeclub:testing-action', handleTestingAction);
    return () => window.removeEventListener('codeclub:testing-action', handleTestingAction);
  }, [panelId, isAgentBusy, sendMessage]);

  const handleCopyMessage = async (content: string, messageIndex: number) => {
    try {
      if (!await copyText(content)) return;
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

  const handleCopyToolLog = async (tools: any[] = [], messageIndex: number) => {
    if (!tools.length) return;
    const log = tools.map((event) => `${event.at || ''} | ${event.name} | ${event.output?.status === 'running' ? 'running' : event.output?.error ? 'error' : 'completed'}\nInput: ${JSON.stringify(event.input ?? {}, null, 2)}\nOutput: ${JSON.stringify(event.output ?? {}, null, 2)}`).join('\n\n');
    try {
      if (!await copyText(log)) return;
      setCopiedToolLogIndex(messageIndex);
      window.setTimeout(() => setCopiedToolLogIndex((current) => current === messageIndex ? null : current), 3000);
    } catch (error) {
      console.error('No se pudo copiar el log de tools:', error);
    }
  };

  const handleRetryMessage = async (messageIndex: number) => {
    if (isAgentBusy) return;
    const message = messages[messageIndex];
    if (!message || message.role !== 'user') return;
    await sendMessage(message.content, messages.slice(0, messageIndex), false, true);
  };

  const previousUserMessageIndex = (assistantIndex: number) => {
    for (let index = assistantIndex - 1; index >= 0; index -= 1) {
      if (messages[index]?.role === 'user') return index;
    }
    return -1;
  };

  const addAttachmentPaths = async (paths: string[]) => {
    const attachments = await Promise.all(paths.map(async (path) => {
      const name = getAttachmentName(path);
      const mediaType = getAttachmentMediaType(path);
      let previewUrl: string | undefined;
      let previewText: string | undefined;
      if (mediaType.startsWith('image/')) {
        try {
          previewUrl = `data:${mediaType};base64,${bytesToBase64(await readDesktopFile(path))}`;
        } catch (error) {
          console.error(`No se pudo crear la preview de ${name}:`, error);
        }
      } else if (/\.(md|markdown|html?|css|scss|sass|less|js|mjs|cjs|jsx|ts|tsx|json|xml|yaml|yml|txt|csv|sql|py|rs|java|go|rb|php|sh|bat|ps1)$/i.test(name)) {
        try {
          previewText = (await readDesktopTextFile(path)).slice(0, 220);
        } catch (error) {
          console.error(`No se pudo leer la preview de ${name}:`, error);
        }
      }
      return { path, name, mediaType, previewUrl, previewText };
    }));
    setAttachedFiles((current) => {
      const next = [...current, ...attachments];
      return next.filter((file, index, list) => list.findIndex((item) => item.path === file.path) === index);
    });
  };

  const handleAttachFiles = async () => {
    try {
      const desktopPicker = (window as any).codeclub?.selectFiles;
      if (desktopPicker) {
        const files = await desktopPicker();
        if (files?.length) await addAttachmentPaths(files);
        return;
      }
      const selected = await open();
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

  if (workspaceMode === 'blank' && !activeProject) {
    return (
      <div style={{ width: '100%', height: '100%', minHeight: '100%', display: 'grid', placeItems: 'center', textAlign: 'center', color: 'rgba(216, 216, 216, 0.42)', fontSize: '13px' }}>
        Seleccioná un proyecto
      </div>
    );
  }

  if (workspaceMode === 'blank' && activeProject && false) {
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
              window.dispatchEvent(new CustomEvent('codeclub:open-terminal-panel', {
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
    <div ref={chatPanelRef} role="region" aria-label={`Chat${activeChat?.name ? `: ${activeChat.name}` : ''}`} className="chat-interface-container mx-auto grid h-full w-full max-w-[680px] min-w-0 grid-rows-[minmax(0,1fr)_auto] place-items-stretch gap-2.5 overflow-visible pb-[5vh]" onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; }} onDrop={handleComposerDrop}>
      {/* Zona de mensajes */}
      <div className={`messages-area relative min-h-0 h-full flex-col gap-1.5 overflow-y-auto overscroll-contain pb-2.5 [scrollbar-width:none] ${composerDocked ? 'flex' : 'hidden'}`} role="log" aria-label="Mensajes del chat" aria-live="polite" aria-relevant="additions text">
        <div aria-hidden="true" className="min-h-0 flex-1" />
        {showEmptyGreeting && <div aria-hidden={messages.length > 0} className={`pointer-events-none absolute inset-0 grid place-items-center whitespace-nowrap px-5 text-lg font-medium tracking-[-0.02em] text-(--codeclub-text-strong) transition-[opacity,transform] duration-300 ${messages.length === 0 ? 'translate-y-0 opacity-100' : 'translate-y-1 opacity-0'}`}>{chatText.greeting}, {username}?</div>}
        {messages.map((turnMessage, turnIndex) => {
          if (turnMessage.role !== 'user') return null;
          const assistantMessage = messages[turnIndex + 1]?.role === 'assistant' ? messages[turnIndex + 1] : null;
          const turnMessages = assistantMessage ? [turnMessage, assistantMessage] : [turnMessage];
          return <div className="chat-turn" key={`turn-${turnIndex}`} role="article" aria-label={`Intercambio ${turnIndex + 1}`} style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: turnIndex > 0 ? '32px' : 0 }}>
            {turnMessages.map((turnItem, turnOffset) => {
              const m = turnItem;
              const i = turnIndex + turnOffset;
              return <React.Fragment key={m.role === 'assistant' && isStreaming && i === messages.length - 1 ? `${i}-${m.content.length}` : i}>
            {m.role === 'user' && isStreaming && agentState !== 'error' && messages[i + 1]?.role === 'assistant' && i + 1 === messages.length - 1 && <ProcessingStatusStateFixed startedAt={agentStartedAtRef.current || Date.now()} provider={currentProvider?.label || currentProvider?.id || 'Proveedor'} model={currentModel?.label || currentModel?.id || 'Modelo'} state={agentState} attempt={connectionAttempt} />}
            {m.role === 'user' && messages[i + 1]?.role === 'assistant' && messages[i + 1]?.meta && !(isStreaming && i + 1 === messages.length - 1) && <CompletedStatusFixed language={language} provider={messages[i + 1].meta.provider} model={messages[i + 1].meta.model} durationMs={messages[i + 1].meta.durationMs} status={messages[i + 1].meta.status} errorName={messages[i + 1].meta.errorName} />}
            {m.role === 'user' && (
              <div aria-hidden="true" style={{ alignSelf: 'stretch', borderTop: '1px solid rgba(255, 255, 255, 0.08)', margin: '4px 0 38px' }} />
            )}
            {m.role === 'assistant' && m.meta?.status === 'error' ? <ErrorRecoveryNotice configurationError={m.meta.configuration === true} /> : <div className={m.role === 'assistant' ? 'chat-assistant-message' : 'chat-user-message'} style={{ alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', display: 'grid', justifyItems: m.role === 'user' ? 'end' : 'start', gap: '5px', maxWidth: '80%', marginTop: m.role === 'assistant' ? '50px' : 0 }}>
              {m.role === 'user' && m.attachments?.length > 0 && <div className="chat-attachments" aria-label="Archivos adjuntos">{m.attachments.map((file) => file.mediaType?.startsWith('image/') ? <div key={file.path || file.name} className="chat-attachment-card" title={file.name}><img src={file.previewUrl || convertFileSrc(file.path)} alt={file.name} /></div> : <div key={file.path || file.name} className="chat-attachment-card chat-attachment-file" title={file.name}>{file.previewText ? <pre className="chat-attachment-preview-text">{file.previewText}</pre> : <span>{file.name.split('.').pop()?.toUpperCase().slice(0, 6) || 'FILE'}</span>}</div>)}</div>}
              <div className={`w-fit max-w-full break-words text-sm leading-6 text-(--codeclub-text-strong) ${m.role === 'user' && m.content.trim() ? 'rounded-[24px_24px_4px_24px] bg-(--codeclub-user-bubble) px-5 py-3.5 leading-[1.4]' : ''}`}>
                <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]} components={{ p: ({ children }) => <p style={{ margin: m.role === 'user' ? 0 : '0 0 12px', lineHeight: m.role === 'user' ? 1.4 : 1.6 }}>{children}</p>, ul: ({ children }) => <ul style={{ margin: m.role === 'user' ? 0 : '10px 0 12px', paddingLeft: '22px' }}>{children}</ul>, ol: ({ children }) => <ol style={{ margin: m.role === 'user' ? 0 : '10px 0 12px', paddingLeft: '22px' }}>{children}</ol>, li: ({ children }) => <li style={{ margin: m.role === 'user' ? 0 : '4px 0' }}>{children}</li>, table: ({ children }) => <div style={{ overflowX: 'auto', margin: '12px 0' }}><table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>{children}</table></div>, th: ({ children }) => <th style={{ border: '1px solid #2b2b2b', padding: '7px 9px', background: '#1c1c1c', textAlign: 'left', fontWeight: 600 }}>{children}</th>, td: ({ children }) => <td style={{ border: '1px solid #2b2b2b', padding: '7px 9px', verticalAlign: 'top' }}>{children}</td>, h1: ({ children }) => <h1 style={{ margin: '18px 0 10px', fontSize: '20px' }}>{children}</h1>, h2: ({ children }) => <h2 style={{ margin: '16px 0 8px', fontSize: '17px' }}>{children}</h2>, h3: ({ children }) => <h3 style={{ margin: '14px 0 7px', fontSize: '15px' }}>{children}</h3> }}>{normalizeChatContent(m.displayContent || m.content)}</ReactMarkdown>
                {m.role === 'assistant' && isStreaming && agentState !== 'error' && i === messages.length - 1 && !m.content && <span className="chat-thinking-label" style={{ display: 'inline-block', color: 'rgba(216, 216, 216, 0.58)', fontSize: '13px' }}>Pensando</span>}
              </div>
              {m.role === 'assistant' && <ExecutionTimeline timeline={m.timeline} active={isStreaming && i === messages.length - 1} />}
              {m.role === 'assistant' && <AskUserCards tools={m.tools} onSelect={(answer) => void sendMessage(answer)} disabled={isAgentBusy} />}
              {m.role === 'assistant' && i === messages.length - 1 && <ApprovalCards approvals={pendingApprovals} onResolve={resolveToolApproval} />}
              {m.role === 'assistant' && <ChangeSummaryCard changes={m.meta?.changes} />}
              {m.role === 'assistant' && (!isStreaming || i !== messages.length - 1 || m.meta?.status === 'error') && <div style={{ alignSelf: 'start', display: 'flex', alignItems: 'center', gap: '4px', opacity: 0.72 }}>
                <button type="button" aria-label={copiedMessageIndex === i ? 'Mensaje copiado' : 'Copiar mensaje'} title={copiedMessageIndex === i ? 'Copiado' : 'Copiar'} onClick={() => void handleCopyMessage(m.content, i)} style={{ width: '22px', height: '22px', display: 'grid', placeItems: 'center', border: 0, borderRadius: '6px', background: 'transparent', color: copiedMessageIndex === i ? '#F8EAD8' : 'rgba(216, 216, 216, 0.62)', cursor: 'pointer', transition: 'color 700ms ease' }}>
                  {copiedMessageIndex === i ? <Check size={13} strokeWidth={2.2} /> : <Copy size={13} strokeWidth={2} />}
                </button>
                {m.role === 'assistant' && <button type="button" aria-label="Abrir Artifacts" title="Abrir Artifacts" onClick={() => { const projectPath = activeProject?.projectPath || activeChat?.projectPath || ''; if (projectPath) window.dispatchEvent(new CustomEvent('codeclub:active-project', { detail: { projectPath, projectName: activeProject?.name || '' } })); window.dispatchEvent(new CustomEvent('codeclub:open-artifacts', { detail: { projectPath } })); }} style={{ width: '22px', height: '22px', display: 'grid', placeItems: 'center', border: 0, borderRadius: '6px', background: 'transparent', color: 'rgba(216, 216, 216, 0.62)', cursor: 'pointer' }}><ListTodo size={13} strokeWidth={1.8} /></button>}
                {m.role === 'assistant' && m.tools?.length > 0 && <button type="button" aria-label={copiedToolLogIndex === i ? 'Log copiado' : 'Copiar log de tools'} title={copiedToolLogIndex === i ? 'Log copiado' : 'Copiar log de tools'} onClick={() => void handleCopyToolLog(m.tools, i)} style={{ width: '22px', height: '22px', display: 'grid', placeItems: 'center', border: 0, borderRadius: '6px', background: 'transparent', color: copiedToolLogIndex === i ? '#F8EAD8' : 'rgba(216, 216, 216, 0.62)', cursor: 'pointer', transition: 'color 700ms ease' }}>{copiedToolLogIndex === i ? <Check size={13} strokeWidth={2.2} /> : <Bug size={13} strokeWidth={1.8} />}</button>}
                {previousUserMessageIndex(i) >= 0 && <button type="button" aria-label="Regenerar respuesta" title="Regenerar respuesta" onClick={() => handleRetryMessage(previousUserMessageIndex(i))} disabled={isAgentBusy} style={{ width: '22px', height: '22px', display: 'grid', placeItems: 'center', border: 0, borderRadius: '6px', background: 'transparent', color: 'rgba(216, 216, 216, 0.62)', cursor: isAgentBusy ? 'not-allowed' : 'pointer' }}>
                  <RotateCcw size={13} strokeWidth={2} />
                </button>}
              </div>}
            </div>}
              </React.Fragment>;
            })}
          </div>;
        })}
        <div ref={messagesEndRef} aria-hidden="true" />
      </div>

      <div className="chat-composer relative grid w-full min-w-0 justify-self-center gap-2.5">
        <div className="composer-row flex w-full min-w-0 items-center gap-2">
          <div className="composer-box min-h-10 min-w-0 flex-1 overflow-hidden rounded-[22px] border border-(--codeclub-border-soft) bg-(--codeclub-surface-raised) p-0 shadow-none [&>[aria-label='Referencia de artifact']]:relative [&>[aria-label='Referencia de artifact']]:z-50 [&>[aria-label='Referencia de artifact']>span]:hidden">
          {artifactReference && <div className="flex min-h-[28px] items-center gap-2 px-4 py-1.5" aria-label="Referencia de artifact"><span className="shrink-0 text-[10px] uppercase tracking-[0.08em] text-[#666]">Referencia</span><button type="button" onClick={() => setArtifactReference(null)} className="min-w-0 max-w-[260px] truncate rounded-full border border-[#2b2b2b] bg-[#1a1a1a] px-2.5 py-1 text-left text-[10px] text-[#cfcfcf] hover:bg-[#202020]" title="Quitar referencia">@{artifactReference.kind} · {artifactReference.title}</button></div>}
          {browserReferences.length > 0 && (
            <div ref={browserRefContainerRef} className="file-preview-scrollbar flex min-h-[76px] w-full min-w-0 max-w-full flex-nowrap items-center gap-2 overflow-x-auto overflow-y-hidden border-b-0 px-3 py-1.5" aria-label="Referencias de navegador">
              {browserReferences.map((ref) => (
                <button
                  key={ref.id}
                  type="button"
                  onClick={() => setBrowserReferences((current) => current.filter((item) => item.id !== ref.id))}
                  className="browser-reference-preview relative grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-[10px] border-0 bg-[#161616] text-[#cfcfcf]"
                  title={`Quitar @${ref.title}`}
                >
                  <span className="browser-reference-preview-icon">
                    {getBrowserReferenceFavicon(ref) ? <img src={getBrowserReferenceFavicon(ref)} alt="" onError={(event) => { event.currentTarget.style.display = 'none'; }} /> : <Globe size={18} strokeWidth={1.7} />}
                  </span>
                  <span className="shrink-0 text-[#777] hover:text-[#eee]">×</span>
                </button>
              ))}
              {false && browserReferences.length > maxVisibleBrowserRefs && (
                <button
                  type="button"
                  onClick={() => setBrowserReferences([])}
                  className="shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-medium transition-[filter] hover:brightness-105"
                  style={{ borderColor: '#F8EAD8', color: '#111111', background: 'linear-gradient(135deg, #1687FF 0%, #67BAFF 38%, #F8EAD8 72%, #FFF3DF 100%)' }}
                  title="Quitar todas las referencias"
                >
                  +{browserReferences.length - maxVisibleBrowserRefs} referencias
                </button>
              )}
            </div>
          )}
           {attachedFiles.length > 0 && <div className="file-preview-scrollbar flex min-h-[76px] w-full min-w-0 max-w-full flex-nowrap items-center gap-2 overflow-x-auto overflow-y-hidden border-b-0 px-3 py-1.5" aria-label="Archivos adjuntos">{attachedFiles.map((file, index) => file.mediaType.startsWith('image/') ? <motion.button key={file.path} type="button" onClick={() => setAttachedFiles((current) => current.filter((_, fileIndex) => fileIndex !== index))} whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }} transition={{ type: 'spring', stiffness: 420, damping: 28 }} className="attachment-image-preview relative h-16 w-16 shrink-0 overflow-hidden rounded-[10px] border-0 bg-[#161616]" title={`Quitar ${file.name}`}><img src={file.previewUrl} alt={file.name} onError={(event) => { event.currentTarget.style.display = 'none'; }} className="attachment-image-preview-image h-full w-full object-cover" /><span className="attachment-image-preview-name absolute inset-x-1 bottom-1 truncate text-center text-[9px] text-white/75">{file.name}</span><span aria-hidden="true" className="attachment-image-preview-close pointer-events-none absolute inset-0 grid place-items-center text-white"><X size={18} strokeWidth={2.2} /></span></motion.button> : <motion.button key={file.path} type="button" onClick={() => setAttachedFiles((current) => current.filter((_, fileIndex) => fileIndex !== index))} whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }} transition={{ type: 'spring', stiffness: 420, damping: 28 }} className="attachment-file-preview relative grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-[10px] border-0 bg-[#161616] text-[10px] font-semibold uppercase tracking-[0.04em] text-[#cfcfcf]" title={`Quitar ${file.name}`}>{file.previewText ? <pre className="attachment-file-preview-text">{file.previewText}</pre> : <span className="attachment-file-preview-name" title={file.name}>{file.name}</span>}<span aria-hidden="true" className="attachment-file-preview-close pointer-events-none absolute inset-0 grid place-items-center text-white"><X size={18} strokeWidth={2.2} /></span></motion.button>)}</div>}
          {activeSkills.length > 0 && <div className="flex min-h-[28px] items-center gap-1.5 overflow-x-auto border-b border-[#202020] px-3 py-1.5" aria-label={chatText.activeSkills}>
            {activeSkills.map((skill) => <button key={skill.id} type="button" onClick={() => setActiveSkills((current) => current.filter((item) => item.id !== skill.id))} className="flex shrink-0 items-center gap-1 rounded-full border border-[#3d9bff]/50 bg-[#1687ff]/10 px-2.5 py-1 text-[10px] text-[#b9dcff] hover:bg-[#1687ff]/20" title="Quitar habilidad de esta sesión">
              <span className="max-w-[150px] truncate">{skill.name}</span><span className="text-[#8bc7ff]/70">×</span>
            </button>)}
          </div>}
          {activeExtensions.length > 0 && <div className="flex min-h-[28px] items-center gap-1.5 overflow-x-auto border-b border-[#202020] px-3 py-1.5" aria-label={chatText.activeExtensions}>
            {activeExtensions.map((extension) => { const Icon = extensionIcons[extension.id] || Box; return <button key={extension.id} type="button" onClick={() => setActiveExtensions((current) => current.filter((item) => item.id !== extension.id))} className="flex shrink-0 items-center gap-1 rounded-full border border-[#3d9bff]/50 bg-[#1687ff]/10 px-2.5 py-1 text-[10px] text-[#b9dcff] hover:bg-[#1687ff]/20" title="Quitar complemento de esta sesión"><Icon size={11} /><span>{extension.name}</span><span className="text-[#8bc7ff]/70">×</span></button>; })}
          </div>}
          <div ref={commandMenuHostRef} className="w-full" />
          <form onSubmit={handleSubmit} aria-label="Compositor de mensaje" className="composer-box-inner relative flex min-h-[70px] w-full min-w-0 flex-col items-stretch gap-1 rounded-[21px] border-0 bg-(--codeclub-surface-raised) px-1.5 pb-1 pl-4 pr-3 pt-2 [&>button.absolute]:hidden">
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
          <span id="chat-input-help" className="sr-only">Escribí un mensaje. Usa Shift+Enter para una nueva línea y / para abrir comandos.</span>
          <textarea
            ref={chatInputRef}
            disabled={isAgentBusy}
            rows={1}
            aria-multiline="true"
            aria-describedby="chat-input-help"
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
              target.style.height = `${Math.min(target.scrollHeight, 180)}px`;
              target.style.overflowY = target.scrollHeight > 180 ? 'auto' : 'hidden';
            }}
            onKeyDown={(e) => {
              const slashMenuActive = ['command', 'provider', 'model', 'project', 'skill', 'language', 'development'].includes(commandKind) && (menuOpen || commandKind === 'command');
              if (slashMenuActive && ['ArrowDown', 'ArrowUp', 'Enter', 'Escape'].includes(e.key)) {
                e.preventDefault();
                handleCommandMenuKeyDown(e);
                return;
              }
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
            aria-label={chatText.message}
            className={`order-1 min-h-[22px] h-auto max-h-[180px] w-full min-w-0 flex-none resize-none self-stretch overflow-y-hidden border-0 bg-transparent px-0 py-0.5 pr-2.5 text-xs leading-[1.4] text-(--codeclub-text-strong) outline-none placeholder:text-(--codeclub-text-muted) [scrollbar-width:none] ${isAgentBusy ? 'opacity-[0.55]' : 'opacity-100'}`}
            placeholder={agentStatusText}
          />
          {artifactReference && <button type="button" onClick={() => setArtifactReference(null)} className="absolute left-[16px] top-1/2 z-10 max-w-[130px] -translate-y-1/2 truncate rounded-full border border-[#2b2b2b] bg-[#1a1a1a] px-2.5 py-1 text-[10px] text-[#cfcfcf] hover:bg-[#202020]" title="Quitar referencia">@{artifactReference.kind} · {artifactReference.title}</button>}
          <div className="order-2 flex min-h-[30px] items-center justify-start gap-3">
            <button type="button" onClick={() => { triggerActionShine('attach'); void handleAttachFiles(); }} aria-label={chatText.attach} title={chatText.attach} className="composer-action group flex items-center justify-center gap-1.5 rounded-lg border-0 bg-transparent text-(--codeclub-text-muted) hover:bg-(--codeclub-surface-raised) hover:text-(--codeclub-text-strong)"><Paperclip className={attachedFiles.length > 0 ? 'text-(--codeclub-text-strong)' : ''} size={15} strokeWidth={1.8} /><span className={`composer-action-label text-[11px] ${shiningAction === 'attach' || attachedFiles.length > 0 ? 'composer-action-shine' : ''}`}>{chatText.attach}</span></button>
            <button type="button" data-command-menu-kind="provider" onClick={() => { triggerActionShine('provider'); toggleCommandMenu('provider'); }} aria-label={chatText.slash.provider} title={chatText.slash.provider} className={`composer-action group flex items-center justify-center gap-1.5 rounded-lg border-0 text-(--codeclub-text-muted) hover:bg-(--codeclub-surface-raised) hover:text-(--codeclub-text-strong) ${menuOpen && commandKind === 'provider' ? 'bg-(--codeclub-surface-raised) text-(--codeclub-text-muted)' : 'bg-transparent'}`}><Radar className={menuOpen && commandKind === 'provider' ? 'text-(--codeclub-text-strong)' : ''} size={15} strokeWidth={1.8} /><span className={`composer-action-label text-[11px] ${shiningAction === 'provider' || (menuOpen && commandKind === 'provider') ? 'composer-action-shine' : ''}`}>{chatText.slash.provider}</span></button>
            <button type="button" data-command-menu-kind="model" onClick={() => { triggerActionShine('model'); toggleCommandMenu('model'); }} aria-label={chatText.slash.model} title={chatText.slash.model} className={`composer-action group flex items-center justify-center gap-1.5 rounded-lg border-0 text-(--codeclub-text-muted) hover:bg-(--codeclub-surface-raised) hover:text-(--codeclub-text-strong) ${menuOpen && commandKind === 'model' ? 'bg-(--codeclub-surface-raised) text-(--codeclub-text-muted)' : 'bg-transparent'}`}><Box className={menuOpen && commandKind === 'model' ? 'text-(--codeclub-text-strong)' : ''} size={15} strokeWidth={1.8} /><span className={`composer-action-label text-[11px] ${shiningAction === 'model' || (menuOpen && commandKind === 'model') ? 'composer-action-shine' : ''}`}>{chatText.slash.model}</span></button>
            <motion.button type={isAgentBusy ? 'button' : 'submit'} onClick={isAgentBusy ? cancelGeneration : undefined} disabled={!sendButtonActive} animate={{ scale: sendButtonActive ? 1 : 0.94, opacity: sendButtonActive ? 1 : 0.62 }} whileHover={{ scale: sendButtonActive ? 1.06 : 0.98 }} whileTap={{ scale: 0.9 }} transition={{ type: 'spring', stiffness: 460, damping: 28 }} className={`send-button ml-auto flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full text-(--codeclub-text-strong) shadow-none transition-colors disabled:cursor-not-allowed ${sendButtonActive ? 'send-button-shine border border-(--codeclub-border-soft) bg-(--codeclub-send-active-radial)' : 'border border-transparent bg-(--codeclub-surface-raised)'}`} aria-label={isAgentBusy ? "Cancelar generación" : credentialProvider ? "Guardar credencial" : "Enviar"} title={isAgentBusy ? "Cancelar generación" : credentialProvider ? "Guardar credencial" : "Enviar"}>
            {isAgentBusy ? <Square size={13} strokeWidth={2.4} fill="currentColor" /> : <ArrowUp size={15} strokeWidth={2.2} />}
            </motion.button>
          </div>
          </form>
          </div>
        </div>

        {commandMenuHostRef.current && createPortal((<motion.div
          ref={commandMenuRef}
          tabIndex={-1}
          onKeyDown={handleCommandMenuKeyDown}
          role="listbox"
          aria-label="Comandos disponibles"
          aria-activedescendant={activeCommandIndex >= 0 ? `command-option-${activeCommandIndex}` : undefined}
          className={`command-menu ${menuOpen ? 'is-open' : ''}`}
          initial={false}
          animate={{ opacity: menuOpen ? 1 : 0, y: menuOpen ? 0 : -6, scale: menuOpen ? 1 : 0.985 }}
          transition={{ type: 'spring', stiffness: 420, damping: 32, mass: 0.7 }}
          style={{ position: 'static', width: 'calc(100% - 16px)', margin: '0 8px', display: menuOpen && (commandKind === 'credential' || commandKind === 'custom-config' || hasCommandMenuResults) ? 'grid' : 'none', gap: '8px', padding: '8px', border: 0, borderRadius: '10px', background: 'transparent', boxShadow: 'none', zIndex: 10, outline: 'none' }}
        >
          {commandKind !== 'credential' && commandKind !== 'custom-config' && <div style={{ position: 'relative' }}>
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder={commandKind === 'provider' ? chatText.searchProvider : commandKind === 'model' ? chatText.searchModel : commandKind === 'project' ? chatText.searchProject : commandKind === 'skill' ? chatText.searchSkill : chatText.searchCommand}
              style={{ boxSizing: 'border-box', width: '100%', height: '30px', padding: '0 32px 0 9px', borderRadius: '7px', background: 'transparent', fontSize: '11px', color: '#eeeeee', border: 0, outline: 'none' }}
            />
            <Search size={14} strokeWidth={1.8} aria-hidden="true" style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', color: 'rgba(238, 238, 238, 0.48)', pointerEvents: 'none' }} />
          </div>}
          {commandKind === 'credential' ? (
            <div style={{ position: 'relative', minHeight: '34px' }}>
              <KeyRound size={15} strokeWidth={1.8} className="credential-key-icon" style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
              <input
                ref={credentialInputRef}
                type="password"
                value={credentialInput}
                onChange={(event) => setCredentialInput(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); saveCredential(); } }}
                placeholder={`Escribí tu credencial de ${credentialProvider?.label || credentialProvider?.id}`}
                className="credential-menu-input"
                style={{ boxSizing: 'border-box', width: '100%', height: '34px', padding: '0 32px 0 10px', border: 0, borderRadius: '8px', background: 'transparent', color: '#eeeeee', fontSize: '12px', outline: 'none' }}
              />
            </div>
          ) : commandKind === 'custom-config' ? (
            <div style={{ display: 'grid', gap: '8px' }}>
              <div style={{ position: 'relative', minHeight: '34px' }}>
                {customUrl.trim() ? <button type="button" onClick={saveCustomProviderConfig} aria-label="Guardar URL" style={{ position: 'absolute', right: '4px', top: '50%', width: '26px', height: '26px', display: 'grid', placeItems: 'center', transform: 'translateY(-50%)', border: 0, borderRadius: '6px', background: 'transparent', color: '#d6d6d6', cursor: 'pointer' }}><Check size={15} strokeWidth={1.8} /></button> : <Globe size={15} strokeWidth={1.8} style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', color: '#d6d6d6', pointerEvents: 'none' }} />}
                <input ref={customUrlRef} value={customUrl} onChange={(event) => { setCustomUrl(event.target.value); setCustomConfigError(''); }} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); saveCustomProviderConfig(); } }} placeholder="URL del proveedor" style={{ boxSizing: 'border-box', width: '100%', height: '34px', padding: '0 32px 0 10px', border: 0, borderRadius: '8px', background: 'transparent', color: '#eeeeee', fontSize: '12px', outline: 'none' }} />
              </div>
              <div style={{ display: 'grid', gap: '5px', color: '#999999', fontSize: '11px' }}>
                Formato de tools
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px' }}>
                  {(['json', 'xml'] as const).map((format) => <button key={format} type="button" onClick={() => setCustomToolsFormat(format)} style={{ height: '30px', border: '1px solid #2b2b2b', borderRadius: '7px', background: customToolsFormat === format ? '#1E1E1E' : 'transparent', color: customToolsFormat === format ? '#eeeeee' : '#777777', fontSize: '11px' }}>{format.toUpperCase()}</button>)}
                </div>
              </div>
              {customConfigError && <span style={{ color: '#f28b82', fontSize: '11px' }}>{customConfigError}</span>}
            </div>
          ) : <div className="command-list" style={{ display: 'grid', gap: '4px', maxHeight: '300px', overflow: 'auto', scrollbarWidth: 'none', paddingBottom: '12px' }}>
            {activeSelection && (
              <div aria-current="true" style={{ minHeight: '30px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', borderRadius: '7px', background: '#1E1E1E', color: 'var(--codeclub-accent)', fontSize: '11px', padding: '0 9px' }}>
                <span className="flex items-center gap-2">{activeSelection.id === 'autonomo' && <Orbit size={14} strokeWidth={1.8} />}{activeSelection.label || activeSelection.id}</span>
                <small style={{ color: 'var(--codeclub-accent)', fontSize: '11px', opacity: 0.88 }}>{chatText.selected}</small>
              </div>
            )}
            {commandMenuItems.map((item, index) => (
              <motion.button
                key={item.id}
                id={`command-option-${index}`}
                role="option"
                aria-selected={index === activeCommandIndex}
                className={`command-menu-item ${index === activeCommandIndex ? 'is-active' : ''}`}
                type="button"
                data-command-index={index}
                onMouseDown={(event) => { event.preventDefault(); event.stopPropagation(); handleItemClick(item); }}
                onFocus={() => setActiveCommandIndex(index)}
                onMouseEnter={() => setActiveCommandIndex(index)}
                onMouseLeave={() => setActiveCommandIndex(-1)}
                animate={{ color: index === activeCommandIndex ? '#ffffff' : 'rgba(238, 238, 238, 0.78)' }}
                transition={{ duration: 0.16, ease: 'easeOut' }}
                style={{ position: 'relative', minHeight: '32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', border: 0, borderRadius: '7px', background: 'transparent', fontSize: '12px', padding: '0 9px', textAlign: 'left', cursor: 'pointer', overflow: 'hidden' }}
              >
                {index === activeCommandIndex && <motion.span layoutId="command-menu-active" transition={{ type: 'spring', stiffness: 520, damping: 34 }} aria-hidden="true" style={{ position: 'absolute', inset: 0, borderRadius: '7px', background: '#2F2F2F', zIndex: 0 }} />}
                <span className="relative z-[1] flex min-w-0 items-center gap-2">{item.icon && React.createElement(item.icon, { size: 14, strokeWidth: 1.8 })}<span className="truncate">{item.label}</span></span>
                <small className="relative z-[1]" style={{ color: 'rgba(216, 216, 216, 0.36)', fontSize: '11px' }}>
                  {item.id === 'autonomo' && autonomousMode ? autonomousText.active : item.type === 'command' ? item.description : item.type === 'language' ? item.description : item.type === 'development' ? item.description : item.type === 'provider' ? chatText.provider : item.type === 'project' ? chatText.project : item.type === 'skill' ? item.source : item.type === 'extension' ? chatText.extension : chatText.model}
                </small>
              </motion.button>
            ))}
          </div>}
        </motion.div>), commandMenuHostRef.current)}
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
      : extension === 'html' ? html()
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

const TOOL_BRAILLE_FRAMES: Record<string, string[]> = {
  listFiles: ['⠿', '⠾', '⠶', '⠷', '⠿'], readFile: ['⠶', '⠦', '⠴', '⠶'], searchText: ['⠤', '⠦', '⠴', '⠦'],
  writeFile: ['⠒', '⠓', '⠒', '⠑'], runCommand: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧'], terminal: ['⠙', '⠋', '⠹', '⠸', '⠼', '⠴'],
  openBrowser: ['⠳', '⠲', '⠦', '⠴', '⠳'], getBrowserState: ['⠼', '⠾', '⠿', '⠾', '⠼'], browserAction: ['⠦', '⠴', '⠲', '⠦'],
  askUser: ['⠴', '⠦', '⠴', '⠦'], createPlan: ['⠇', '⠧', '⠷', '⠇'], updatePlan: ['⠸', '⠼', '⠸'],
  todo: ['⠺', '⠻', '⠺', '⠻'], getTaskStatus: ['⠾', '⠿', '⠾'], getExecutionLog: ['⠫', '⠪', '⠫'],
  subagent: ['⠈', '⠉', '⠋', '⠙'],
};

const SPECIALIST_BRAILLE_FRAMES: Record<string, string[]> = {
  developer: ['⠈', '⠉', '⠋', '⠙'], frontend: ['⠈', '⠊', '⠒', '⠓'], backend: ['⠈', '⠐', '⠘', '⠸'], qa: ['⠈', '⠤', '⠦', '⠴'], security: ['⠈', '⠎', '⠴', '⠿'], documentation: ['⠈', '⠇', '⠧', '⠷'], computer_use: ['⠳', '⠲', '⠦', '⠴'],
};

function BrailleToolMark({ name, specialist, state }: { name: string; specialist?: string; state: 'running' | 'completed' | 'error' }) {
  const frames = (specialist && SPECIALIST_BRAILLE_FRAMES[specialist]) || TOOL_BRAILLE_FRAMES[name] || ['⠋', '⠙', '⠹', '⠸'];
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    setFrame(0);
    if (state !== 'running' || frames.length < 2) return undefined;
    const timer = window.setInterval(() => setFrame((current) => (current + 1) % frames.length), 150);
    return () => window.clearInterval(timer);
  }, [name, specialist, state, frames.length]);
  const glyph = state === 'error' ? '⠿' : state === 'completed' ? frames[frames.length - 1] : frames[frame];
  return <span className="codeclub-tool-braille" data-state={state} aria-hidden="true">{glyph}</span>;
}

const TOOL_ICONS: Record<string, any> = {
  listFiles: FolderTree, readFile: FileCode2, searchText: Search, writeFile: Pencil, runCommand: Terminal, terminal: Terminal,
  openBrowser: Globe, getBrowserState: Eye, browserAction: MousePointer2, computerGetState: Monitor, computerListWindows: Monitor, computerScreenshot: Camera, computerOcr: Camera, computerAction: MousePointer2, swarm: Orbit, subagent: Orbit, listAvailableTools: FolderOpen,
  createPlan: ListChecks, updatePlan: ListChecks, todo: ListTodo, getTaskStatus: ListTodo,
  getExecutionLog: ScrollText, askUser: MessageSquare,
};

function ToolIcon({ name }: { name: string }) {
  const Icon = TOOL_ICONS[name] || Code2;
  return <span style={{ display: 'grid', placeItems: 'center', width: '18px', height: '18px', flex: '0 0 18px', color: '#888' }}><Icon size={15} strokeWidth={1.7} /></span>;
}

function ProcessingStatus({ startedAt, provider, model }: { startedAt: number; provider: string; model: string }) {
  const [elapsed, setElapsed] = useState(() => Math.max(0, Date.now() - startedAt));
  useEffect(() => {
    const timer = window.setInterval(() => setElapsed(Math.max(0, Date.now() - startedAt)), 1000);
    return () => window.clearInterval(timer);
  }, [startedAt]);
  return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', padding: '0 0 12px', color: '#999', fontSize: '12px' }}><span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#777' }}>{provider} · {model}</span><span style={{ flexShrink: 0 }}>Procesando desde hace {formatProcessingDuration(elapsed)}</span></div>;
}

function CompletedStatus({ language, provider, model, durationMs }: { language: AppLanguage; provider: string; model: string; durationMs: number }) {
  return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', alignSelf: 'stretch', margin: '20px 0 -6px', color: 'rgba(216, 216, 216, 0.52)', fontSize: '12px', letterSpacing: '0.01em' }}><span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{provider} · {model}</span><span style={{ flexShrink: 0 }}>{language === 'en' ? 'Completed in' : 'Completado en'} {formatProcessingDuration(durationMs)}</span></div>;
}

function ProcessingStatusFixed({ startedAt, provider, model }: { startedAt: number; provider: string; model: string }) {
  const [elapsed, setElapsed] = useState(() => Math.max(0, Date.now() - startedAt));
  useEffect(() => {
    const timer = window.setInterval(() => setElapsed(Math.max(0, Date.now() - startedAt)), 1000);
    return () => window.clearInterval(timer);
  }, [startedAt]);
  return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', padding: '0 0 12px', color: '#999', fontSize: '12px' }}><span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#777' }}>{provider} · {model}</span><span style={{ flexShrink: 0 }}>Procesando desde hace {formatProcessingDuration(elapsed)}</span></div>;
}

function ProcessingStatusStateFixed({ startedAt, provider, model, state, attempt }: { startedAt: number; provider: string; model: string; state: string; attempt: number }) {
  const [elapsed, setElapsed] = useState(() => Math.max(0, Date.now() - startedAt));
  useEffect(() => {
    const timer = window.setInterval(() => setElapsed(Math.max(0, Date.now() - startedAt)), 1000);
    return () => window.clearInterval(timer);
  }, [startedAt]);
  const status = state === 'approval' ? 'Esperando aprobación' : state === 'tool_call' ? 'Ejecutando herramienta' : state === 'connecting' && attempt > 1 ? `Reconectando ${attempt}/5` : state === 'connecting' ? 'Conectando con el proveedor' : 'Pensando';
  const Icon = state === 'connecting' ? Wifi : state === 'approval' ? CircleHelp : state === 'tool_call' ? Terminal : MessageSquare;
  return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', padding: '0 0 12px', color: '#999', fontSize: '12px' }}><span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#777' }}>{provider} · {model}</span><span style={{ display: 'flex', alignItems: 'center', gap: '7px', flexShrink: 0 }}><Icon size={14} strokeWidth={1.7} aria-hidden="true" />{status} · {formatProcessingDuration(elapsed)}</span></div>;
}

function CompletedStatusFixed({ language, provider, model, durationMs, status, errorName }: { language: AppLanguage; provider: string; model: string; durationMs: number; status?: string; errorName?: string }) {
  const stateLabel = status === 'cancelled'
    ? (language === 'en' ? 'Cancelled by user' : 'Cancelado por el usuario')
    : status === 'error'
      ? errorName === 'TimeoutError' ? (language === 'en' ? 'Timed out at' : 'Tiempo agotado a los') : (language === 'en' ? 'Error at' : 'Error a los')
      : language === 'en' ? 'Completed in' : 'Completado en';
  const Icon = status === 'error' ? CircleHelp : status === 'cancelled' ? X : Check;
  return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', alignSelf: 'stretch', margin: '20px 0 -6px', color: status === 'error' ? 'rgba(220, 150, 150, 0.72)' : 'rgba(216, 216, 216, 0.52)', fontSize: '12px', letterSpacing: '0.01em' }}><span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{provider} · {model}</span><span style={{ display: 'flex', alignItems: 'center', gap: '7px', flexShrink: 0 }}><Icon size={14} strokeWidth={1.7} aria-hidden="true" />{stateLabel} {formatProcessingDuration(durationMs)}</span></div>;
}

const ERROR_RECOVERY_TIPS = [
  'Consejo: verificá que la API key corresponda al proveedor seleccionado.',
  'Consejo: algunos proveedores tardan unos segundos en aceptar una conexión nueva.',
  'Consejo: revisá la URL base y el modelo activo antes de volver a intentar.',
  'Consejo: si el error aparece de forma intermitente, puede ser una demora de red.',
  'Consejo: probá seleccionar nuevamente el proveedor y el modelo.',
];

function ErrorRecoveryNotice({ configurationError }: { configurationError: boolean }) {
  const [step, setStep] = useState(0);
  const [tipVisible, setTipVisible] = useState(false);
  const [tip] = useState(() => ERROR_RECOVERY_TIPS[Math.floor(Math.random() * ERROR_RECOVERY_TIPS.length)]);

  useEffect(() => {
    if (configurationError) {
      const timer = window.setTimeout(() => setTipVisible(true), 1800);
      return () => window.clearTimeout(timer);
    }
    if (step >= 5) {
      const timer = window.setTimeout(() => setTipVisible(true), 350);
      return () => window.clearTimeout(timer);
    }
    const timer = window.setTimeout(() => setStep((current) => Math.min(5, current + 1)), 420);
    return () => window.clearTimeout(timer);
  }, [configurationError, step]);

  const label = tipVisible ? tip : configurationError ? 'Revisando la configuración' : `Reconectando ${step + 1}/5`;
  return <div style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: '8px 0 2px', color: 'rgba(216, 216, 216, 0.58)', fontSize: '12px', lineHeight: '18px' }}>
    <span style={{ display: 'grid', width: '18px', height: '18px', flexShrink: 0, placeItems: 'center' }}>
      {!tipVisible ? <Wifi size={15} strokeWidth={1.7} aria-hidden="true" /> : <Lightbulb size={15} strokeWidth={1.7} aria-hidden="true" />}
    </span>
    <span style={{ display: 'block', lineHeight: '18px' }}>{label}</span>
  </div>;
}

function ExecutionTimeline({ timeline = [], active }: { timeline?: any[]; active: boolean }) {
  if (!active || !timeline.length) return null;
  const toolEvents = timeline.filter((event) => event.type === 'tool');
  if (!toolEvents.length) return null;
  const event = [...toolEvents].reverse().find((item) => item.status === 'running') || toolEvents[toolEvents.length - 1];
  const command = event.name === 'runCommand' ? [event.input?.command, ...(event.input?.args || [])].filter(Boolean).join(' ') : '';
  const detail = command || event.input?.path || event.input?.childName || event.input?.specialist || '';
  const label = detail ? `${event.name} ${detail}` : event.name;
  const failed = event.status === 'error' || event.output?.error;
  return <div style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: '10px 0 3px', color: failed ? '#d98b8b' : '#999', fontSize: '13px' }}><ToolIcon name={event.name} /><span className={event.status === 'running' && !failed ? 'chat-thinking-label chat-tool-thinking-label' : undefined}>{failed ? `Falló ${label}` : `${event.status === 'running' ? 'Ejecutando' : 'Ejecutado'} ${label}`}</span></div>;
}

function ComputerEvidence({ tools = [] }: { tools?: any[] }) {
  const events = tools.filter((event) => ['computerGetState', 'computerListWindows', 'computerScreenshot', 'computerAction'].includes(event.name) && event.output?.status !== 'running');
  const latest = events[events.length - 1];
  if (!latest) return null;
  const payload = latest.output?.output ?? latest.output?.result ?? latest.output;
  const screenshot = tools.slice().reverse().find((event) => event.name === 'computerScreenshot' && event.output?.status !== 'running');
  const screenshotPayload = screenshot?.output?.output ?? screenshot?.output?.result ?? screenshot?.output;
  const imageSrc = screenshotPayload?.data && screenshotPayload?.mimeType ? `data:${screenshotPayload.mimeType};base64,${screenshotPayload.data}` : '';
  const state = latest.name === 'computerGetState' ? payload : null;
  const controls = Array.isArray(state?.elements) ? state.elements.filter((element: any) => element.name).slice(0, 8) : [];
  return <div style={{ display: 'grid', gap: '7px', width: 'min(520px, 100%)', margin: '8px 0 2px', padding: '8px 10px', border: '1px solid #252525', borderRadius: '9px', background: '#151515', color: '#bdbdbd', fontSize: '11px' }}>
    {controls.length > 0 && <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>{controls.map((element: any) => <span key={element.id} style={{ border: '1px solid #2b2b2b', borderRadius: '5px', padding: '3px 5px', color: element.focused ? '#b9dcff' : '#999' }}>{element.role}: {element.name}</span>)}</div>}
    {imageSrc && <img src={imageSrc} alt="Captura de Computer Use" style={{ display: 'block', width: '100%', maxHeight: '220px', objectFit: 'contain', objectPosition: 'left center', borderRadius: '6px', background: '#101010' }} />}
  </div>;
}

function ToolExecutionCards({ tools = [] }: { tools?: any[] }) {
  const [visibleTools, setVisibleTools] = useState<any[]>([]);
  const latestKeyRef = useRef('');
  useEffect(() => {
    const latest = tools[tools.length - 1];
    if (!latest) { setVisibleTools([]); latestKeyRef.current = ''; return undefined; }
    const key = String(latest.id || latest.name);
    const running = latest.output?.status === 'running';
    if (latestKeyRef.current === key) {
      setVisibleTools([latest]);
      if (!running) {
        const timer = window.setTimeout(() => {
          setVisibleTools([]);
          latestKeyRef.current = '';
        }, 700);
        return () => window.clearTimeout(timer);
      }
      return undefined;
    }
    latestKeyRef.current = key;
    setVisibleTools((current) => [...current.slice(-1), latest]);
    const timer = window.setTimeout(() => {
      if (running) setVisibleTools((current) => current.slice(-1));
      else {
        setVisibleTools([]);
        latestKeyRef.current = '';
      }
    }, running ? 180 : 700);
    return () => window.clearTimeout(timer);
  }, [tools]);
  if (!visibleTools.length) return null;
  const latestKey = String(tools[tools.length - 1]?.id || tools[tools.length - 1]?.name);
  return <div style={{ position: 'relative', width: 'min(520px, 100%)', minHeight: '28px', margin: '4px 0 2px' }}>
    {visibleTools.map((event, index) => {
      const key = String(event.id || event.name);
      const running = event.output?.status === 'running';
      const failed = Boolean(event.output?.error) || event.output?.status === 'error';
      const status = failed ? 'Error' : running ? 'Ejecutando' : formatDuration(Number(event.durationMs || 0));
      const specialist = event.input?.specialist;
      return <div key={`${key}-${index}`} style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, minHeight: '28px', padding: '5px 8px', border: '1px solid #252525', borderRadius: '7px', background: '#151515', color: '#999', fontSize: '10px', animation: key === latestKey ? 'codeclub-tool-fade-in 180ms ease-out' : 'codeclub-tool-fade-out 180ms ease-in forwards' }}>
        <span style={{ display: 'grid', placeItems: 'center', flex: '0 0 16px', color: '#ffffff' }}><BrailleToolMark name={event.name} specialist={specialist} state={failed ? 'error' : running ? 'running' : 'completed'} /></span>
        <span style={{ minWidth: 0, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#cfcfcf', fontFamily: 'var(--font-mono, monospace)' }}>{event.name}</span>
        <span title={running ? 'Tool en ejecución' : `Tiempo de ejecución: ${status}`} style={{ flexShrink: 0, color: '#ffffff' }}>{status}</span>
      </div>;
    })}
    <style>{'@keyframes codeclub-tool-fade-in { from { opacity: 0; transform: translateY(-2px); } to { opacity: 1; transform: translateY(0); } } @keyframes codeclub-tool-fade-out { from { opacity: 1; transform: translateY(0); } to { opacity: 0; transform: translateY(2px); } }'}</style>
  </div>;
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
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', flexShrink: 0, color: failed ? '#c88787' : running ? '#aaa' : '#8fbe9b', fontSize: '10px' }}><span aria-hidden="true" style={{ color: failed ? '#d98b8b' : running ? '#d8d8d8' : '#8fbe9b', fontSize: '12px', lineHeight: 1 }}>{failed ? '!' : running ? '…' : '✓'}</span>{failed ? 'Error' : running ? 'Trabajando…' : 'Finalizado'}</span>
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

  const statusLabel = { pending: 'Pendiente', in_progress: 'En curso', completed: 'Completado', cancelled: 'Cancelado', blocked: 'Bloqueado' };
  const statusIcon = { pending: '○', in_progress: '◐', completed: '✓', cancelled: '⊘', blocked: '!' };
  return <div style={{ display: 'grid', gap: '7px', width: 'min(520px, 100%)', margin: '4px 0 2px' }}>
    <div style={{ display: 'grid', gap: '6px', padding: '8px 10px', border: '1px solid #2b2b2b', borderRadius: '9px', background: '#151515' }}>
      <div style={{ color: '#d8d8d8', fontSize: '11px', fontWeight: 600 }}>TODO</div>
      {todos.map((todo: any) => {
        const status = (todo.status || 'pending') as keyof typeof statusIcon;
        const color = '#999';
        return <div key={todo.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, minHeight: '30px', padding: '4px 7px', borderRadius: '7px', background: '#111' }}>
          <span aria-hidden="true" style={{ display: 'grid', placeItems: 'center', flex: '0 0 16px', width: '16px', height: '16px', color, fontSize: '14px', lineHeight: 1 }}>{statusIcon[status] || '·'}</span>
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
  const selectedContent = openFiles[selectedPath]?.content || '';
  const selectedParts = selectedPath.split('/').filter(Boolean);
  return <div className={`flex h-full w-full min-w-0 flex-col overflow-hidden text-[#d8d8d8] [&>div>aside>div:first-child]:hidden ${tree.length ? '' : '[&>div>aside]:hidden'}`}>
    {loading ? <div className="flex flex-1 items-center justify-center text-xs text-[#777777]">Cargando proyecto...</div> : <div className="flex min-h-0 flex-1"><aside className="flex w-[250px] shrink-0 flex-col border-r border-[var(--color-surface-8)] bg-transparent"><div className="flex items-center justify-between px-3 py-3"><span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#777777]">Archivos</span><span className="text-[10px] text-[#555555]">{entries.length}</span></div><div className="min-h-0 flex-1 overflow-auto px-2 pb-3 [scrollbar-width:none]">{error ? <div className="rounded-lg bg-[#2b1e1e] p-3 text-xs text-[#c28d8d]">{error}</div> : tree.length ? renderTree(tree) : <div className="p-3 text-xs text-[#777777]">No se encontraron archivos.</div>}</div></aside><main className="flex min-w-0 flex-1 flex-col bg-transparent">{selectedPath ? <><div className="flex h-10 shrink-0 items-center gap-1 border-b border-[var(--color-surface-8)] px-4 text-[11px] text-[#777777]">{selectedParts.map((part, index) => <React.Fragment key={`${part}-${index}`}><span className={index === selectedParts.length - 1 ? 'text-[#eeeeee]' : ''}>{part}</span>{index < selectedParts.length - 1 && <ChevronRight size={12} className="text-[#4d4d4d]" />}</React.Fragment>)}</div><div className="min-h-0 flex-1 overflow-hidden"><CodeMirrorFileEditor path={selectedPath} content={selectedContent} /></div></> : <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center"><div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-[var(--color-surface-8)] bg-[var(--color-surface-3)] text-[#777777]"><FileCode2 size={20} /></div><div><p className="m-0 text-sm text-[#bdbdbd]">Elegí un archivo</p><p className="m-1 text-xs text-[#666666]">Hacé click en cualquier archivo para abrirlo acá</p></div></div>}</main></div>}
  </div>;
}

function TabbedProjectView({ projectPath, initialSelectedPath = '', showFileTree, onToggleFileTree }: { projectPath?: string; initialSelectedPath?: string; showFileTree: boolean; onToggleFileTree?: () => void }) {
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
  const setShowFileTree = (_toggle?: (visible: boolean) => boolean) => onToggleFileTree?.();

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
  const selectedContent = files[selectedPath]?.content || '';
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

  return <div ref={panelRef} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; }} onDrop={handleFileDrop} className="flex h-full w-full min-w-0 flex-col overflow-hidden bg-[#171717] text-[#eeeeee] [&>div:first-child]:hidden">
    <div className="flex h-9 shrink-0 items-center justify-between border-b border-[#2b2b2b] px-4"><span className="text-[13px] leading-none">/</span><button type="button" onClick={() => setShowFileTree((visible) => !visible)} className="grid h-7 w-7 place-items-center rounded-[9px] bg-[#202020] text-[#eeeeee] hover:bg-[#2b2b2b]" title="Mostrar u ocultar árbol del workspace" aria-label="Mostrar u ocultar árbol del workspace"><FolderOpen size={16} /></button></div>
    {loading ? <div className="flex flex-1 items-center justify-center text-xs text-[#777777]">Cargando proyecto...</div> : <div className="flex min-h-0 flex-1">
      <main className="flex min-w-0 flex-1 flex-col bg-[#171717]">{tabs.length ? <><div className="flex h-8 shrink-0 items-end gap-1 overflow-x-auto border-b border-[#2b2b2b] bg-[#171717] px-2">{tabs.map((path) => <div key={path} className={`group flex h-7 max-w-[190px] min-w-[110px] items-center gap-2 border-x border-t px-3 text-[11px] ${selectedPath === path ? 'border-[#2b2b2b] bg-[#1c1c1c] text-[#eeeeee]' : 'border-transparent text-[#777777]'}`}><button type="button" onClick={() => setSelectedPath(path)} className="min-w-0 flex-1 truncate bg-transparent text-left">{path.split(/[\\/]/).pop()}</button><button type="button" onClick={() => closeFile(path)} className="rounded p-0.5 text-[#666666] hover:bg-white/10 hover:text-white" title="Cerrar archivo" aria-label={`Cerrar ${path}`}><X size={12} /></button></div>)}</div><div className="min-h-0 flex-1 overflow-hidden bg-transparent">{files[selectedPath] ? <FilePreview projectPath={projectPath || ''} file={files[selectedPath]} onChange={(content) => handleContentChange(selectedPath, content)} /> : <div className="p-4 text-xs text-[#777777]">Cargando archivo...</div>}</div></> : <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center"><FolderOpen size={44} strokeWidth={1.4} className="text-[#a7a7a7]" /><div><p className="m-0 text-[18px] font-semibold text-[#eeeeee]">Abrir archivo</p><p className="m-0 mt-3 max-w-[360px] text-[16px] leading-6 text-[#a7a7a7]">Selecciona un archivo del árbol del espacio de trabajo</p></div></div>}</main>
      {showFileTree && <aside className="flex w-[374px] shrink-0 flex-col border-l border-[#2b2b2b] bg-[#171717]"><div className="min-h-0 flex-1 overflow-auto px-3 py-3 [scrollbar-width:none]">{tree.length ? renderTree(tree) : <div className="p-3 text-sm text-[#777777]">No se encontraron archivos.</div>}</div></aside>}
    </div>}
  </div>;
}

export function ProjectPanelView({ projectPath, selectedPath, showFileTree = true, onToggleFileTree }: { projectPath?: string; selectedPath?: string; showFileTree?: boolean; onToggleFileTree?: () => void }) {
  return <TabbedProjectView projectPath={projectPath} initialSelectedPath={selectedPath} showFileTree={showFileTree} onToggleFileTree={onToggleFileTree} />;
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
