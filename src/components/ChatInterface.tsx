/** Owns composer and stream presentation; model steps use the shared engine, durable chat data uses storage APIs, and native I/O uses preload. */
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useChatHistory } from './use-chat-history';
import { accessibilityTranslations } from '../lib/i18n';
import { usePopupKeyboard } from './ui/use-accessible-overlay';
import { generateTurnSummary } from '../lib/turn-summary';
import { buildChatContext } from '../lib/chat-context';
import { sameSession, useSharedSessions, type SharedSession } from '../lib/shared-sessions';
import { ArrowUp, BookOpen, BookPlus, Box, Braces, Orbit, PackagePlus, PlugZap, Check, ChevronDown, Code2, Copy, FileText, FileType2, Globe, KeyRound, Languages, LayoutTemplate, MessageSquare, Monitor, MoreHorizontal, Paperclip, Presentation, Radar, RotateCcw, Search, ScrollText, Square, Table2, Terminal, Folder, WandSparkles, X } from 'lucide-react';
import { copyText, safeListen, desktopFileUrl as convertFileSrc, nativeInvoke as invoke, fileExists as exists, makeDirectory as mkdir, readDesktopBytes as readFile, readDesktopText as readTextFile, removeDesktopFile as remove, writeDesktopText as writeTextFile, selectDesktopFiles as open } from '../lib/runtime';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createGoogle } from '@ai-sdk/google';
import { createGateway, jsonSchema, tool } from 'ai';
import { AnimatePresence, motion, useAnimationControls, useReducedMotion } from 'motion/react';
import { createPortal } from 'react-dom';
import { createDynamicToolAccess, createTools, inferAgentSpecialist, selectToolsForPrompt, resolveToolsWithAI, type AgentMode, type AgentSpecialist } from '../lib/engine/tools';
import { runStream } from '../lib/engine/run';
import { getProjectFilePath, getSetting, logPersistence, setSetting } from '../lib/persistence';
import { appendGenerationUsage, type GenerationUsageRecord } from '../lib/usage';
import { appendExecutionLog } from '../lib/execution-log';
import { appendGlobalChatTranscript, getProjectChatPath, getProjectTranscriptPath, readGlobalChatHistory, readGlobalChats, readProjectIndex, readProjectMeta, writeGlobalChatHistory, writeGlobalChats, writeProjectMeta, type ProjectMeta } from '../lib/projectManager';
import { chatResources, ORBS_STORAGE_KEY, parseOrbs, type ChatResource, type OrbDefinition } from '../lib/chat-resources';
import { resourceMenuTranslations } from '../lib/i18n';
import { codeclubExtensions, type CodeclubExtension } from '../lib/extensions';
import { developmentEnglishTranslations, savedProviderTranslations, activityTranslations, aiCredentialTranslations, chatHistoryTranslations, chatActionTranslations, agentTextSelectionTranslations, LANGUAGE_STORAGE_KEY, type AppLanguage } from '../lib/i18n';
import { connectAllAgentPluginMcp, loadAgentPlugins } from '../lib/agent-plugins';
import OrbPaletteButton from './ui/OrbPaletteButton';
import { ORB_PALETTES, useOrbPalette } from './OrbPaletteProvider';
import { credentialKeyFor, credentialTargetFor, modelIdFor, modelMatchesProvider, usesGateway } from '../lib/ai-routing';

import { MemoizedChatMarkdown } from './ChatMarkdown';
import { ApprovalCards, AskUserCards, LiveTurnProgress, ProcessingStatusStateFixed, PyramidMark, TurnActivity } from './ChatActivity';
import { readWorkspaceSnapshot, summarizeWorkspaceDelta, type WorkspaceSnapshot } from '../lib/workspace-changes';
import { bytesToBase64, getAttachmentName, getAttachmentMediaType, readAttachmentParts, readDesktopFile, readDesktopTextFile, readProjectChatHistory, writeProjectChatHistory, type ChatAttachment } from '../lib/chat-files';
import { createDesktopModelTransport, type ModelFetchDebug } from '../lib/desktop-model-transport';
import { getArtifactOutputConfig, formatArtifactOutput, formatToolExecutionFallback } from '../lib/chat-artifacts';

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
function formatChatTime(value: unknown, language: AppLanguage) {
  const date = value ? new Date(value as string | number) : new Date();
  if (Number.isNaN(date.getTime())) return '--:--';
  return new Intl.DateTimeFormat(language === 'en' ? 'en-US' : 'es-AR', { hour: 'numeric', minute: '2-digit' }).format(date);
}
type CatalogItem = { id: string; type?: string; label?: string; name?: string; description?: string; aliases?: string[]; source?: string; [key: string]: any };
type ProjectOption = CatalogItem & { path?: string; projectPath?: string | null; projectId?: string; isNone?: boolean };
type SessionSkill = CatalogItem & { name: string; source: string; content: string; pluginRoot?: string };
type ChatInterfaceProps = { catalog: CatalogItem[]; defaultProvider: CatalogItem; defaultModel: CatalogItem; panelId?: string; eventPrefix?: string; selectedProject?: { projectPath: string; projectName?: string } | null; blockedPanelState?: string; floating?: boolean; onDraftChange?: (draft: string) => void; composerLeading?: React.ReactNode; agentOrb?: OrbDefinition };
function compactCommandDescription(description?: string): string {
  const words = description?.trim().split(/\s+/).filter(Boolean) || [];
  return words.slice(0, 2).join(' ') + (words.length > 2 ? '...' : '');
}

const resourceCreationIcons = { Extension: PackagePlus, Skill: BookPlus, Mcp: PlugZap, Orb: Orbit };

const extensionIcons: Record<string, any> = { documents: FileText, pdf: FileType2, spreadsheets: Table2, presentations: Presentation, 'template-creator': LayoutTemplate };
type ChatRuntime = {
  runId?: string;
  publish?: () => void;
  approvalTimers?: Map<string, ReturnType<typeof setTimeout>>;
  expectedTotal?: number;
  controller: AbortController;
  state: string;
  tool: string;
  startedAt: number;
  messages: any[];
  pendingApprovals: any[];
  approvalResolvers: Map<string, (approved: boolean) => void>;
};

const getVisibleUserContent = (message: any) => {
  if (typeof message?.displayContent === 'string') return message.displayContent;
  return String(message?.content || '').replace(/\n\nReferencia \d+: @[\s\S]*$/m, '').trim();
};
const normalizeChatContent = (value: unknown) => {
  const text = String(value ?? '');
  if (text.includes('No pude completar la respuesta') || text.includes('La respuesta tard')) return '';
  return text;
};
/** Reused by main, split, and floating surfaces; callers provide project scope and panel-specific event names. */
export default function ChatInterface({ catalog: baseCatalog, defaultProvider, defaultModel, panelId = 'left', eventPrefix = 'codeclub', selectedProject, blockedPanelState = 'blank', floating = false, onDraftChange, composerLeading, agentOrb }: ChatInterfaceProps) {
  const catalog = baseCatalog;
  const { palette } = useOrbPalette();
  const orbPaletteIndex = ORB_PALETTES.indexOf(palette);
  const [language, setLanguage] = useState<AppLanguage>('es');
  const chatText = language === 'en' ? { greeting: 'What are we working on today', send: 'Send', cancel: 'Cancel generation', message: 'Message', attach: 'Attach', removeFiles: 'Remove added files', activeSkills: 'Active skills', activeExtensions: 'Active extensions', removeSkill: 'Remove skill from this session', removeExtension: 'Remove extension from this session', selected: 'Selected', provider: 'provider', model: 'model', project: 'project', skill: 'skill', extension: 'extension', command: 'command', searchProvider: 'Search provider', searchModel: 'Search active provider model', searchProject: 'Search project', searchSkill: 'Search skill', searchCommand: 'Search command', noProject: 'No project', slash: { provider: 'Provider', model: 'Model', project: 'Project', skill: 'Skill', providerDescription: 'Select provider', modelDescription: 'Select model', projectDescription: 'Select project', skillDescription: 'Load skill in this session' }, status: { idle: 'Ready when you are.', connecting: 'Connecting to provider...', streaming: 'Thinking...', tool_call: 'Using tool...', approval: 'Waiting for approval...', running: 'Running...', error: 'Something went wrong.' } } : { greeting: '¿Qué toca hoy', send: 'Enviar', cancel: 'Cancelar generación', message: 'Mensaje', attach: 'Adjuntar', removeFiles: 'Quitar archivos añadidos', activeSkills: 'Habilidades activas', activeExtensions: 'Extensiones activas', removeSkill: 'Quitar habilidad de esta sesión', removeExtension: 'Quitar extensión de esta sesión', selected: 'Seleccionado', provider: 'proveedor', model: 'modelo', project: 'proyecto', skill: 'habilidad', extension: 'extensión', command: 'comando', searchProvider: 'Buscar proveedor', searchModel: 'Buscar modelo del proveedor activo', searchProject: 'Buscar proyecto', searchSkill: 'Buscar habilidad', searchCommand: 'Buscar comando', noProject: 'Sin proyecto', slash: { provider: 'Proveedor', model: 'Modelo', project: 'Proyecto', skill: 'Habilidad', providerDescription: 'Seleccionar proveedor', modelDescription: 'Seleccionar modelo', projectDescription: 'Seleccionar proyecto', skillDescription: 'Cargar habilidad en esta sesión' }, status: { idle: 'Listo cuando tú lo estés.', connecting: 'Conectando con el proveedor...', streaming: 'Pensando...', tool_call: 'Usando herramienta...', approval: 'Esperando aprobación...', running: 'Ejecutando...', error: 'Algo salió mal.' } };
  if (language === 'es') {
    Object.assign(chatText, { greeting: '¿Qué toca hoy', cancel: 'Cancelar generación', removeFiles: 'Quitar archivos añadidos', removeSkill: 'Quitar habilidad de esta sesión', removeExtension: 'Quitar extensión de esta sesión' });
    chatText.slash = { ...chatText.slash, skillDescription: 'Cargar habilidad en esta sesión' };
    chatText.status = { ...chatText.status, idle: 'Listo cuando tú lo estés.', approval: 'Esperando aprobación...', error: 'Algo salió mal.' };
  }
  const historyWindow = useChatHistory();
  const { messages, setMessages } = historyWindow;
  const projectsSlashLabel = language === 'en' ? 'Projects' : 'Proyectos';
  const isDevelopmentBuild = process.env.NODE_ENV === 'development';
  const languageOptions = [
    { id: 'es', label: 'Español', description: language === 'en' ? 'Use Spanish' : 'Usar español', type: 'language' },
    { id: 'en', label: 'English', description: language === 'en' ? 'Use English' : 'Usar inglés', type: 'language' },
  ];
  const developmentOptions = [
    { id: 'build-feature', label: 'Desarrollar funcionalidad', description: 'Planificar, implementar y verificar', type: 'development', prompt: 'Desarrollá esta funcionalidad usando las tools necesarias. Primero inspeccioná el proyecto, proponé un plan breve, implementá los cambios y verificá que todo funcione.' },
    { id: 'debug-project', label: 'Investigar y corregir', description: 'Diagnosticar con tools', type: 'development', prompt: 'Investigá este problema usando las tools disponibles. Revisá el proyecto, encontrá la causa raíz, aplicá una solución y verificá el resultado.' },
    { id: 'review-changes', label: 'Revisar el proyecto', description: 'Analizar estado y próximos pasos', type: 'development', prompt: 'Revisá el estado actual del proyecto usando las tools necesarias. Señalá problemas importantes, proponé mejoras concretas y aplicá las que correspondan.' },
    { id: 'test-list-files', label: 'Test: listar archivos', description: 'Probar exploración del workspace', type: 'development', prompt: 'Usá listFiles para inspeccionar el workspace activo. Informá la ruta, cantidad y una muestra de archivos reales; no modifiques nada.' },
    { id: 'test-read-file', label: 'Test: leer archivo', description: 'Probar lectura de archivos', type: 'development', prompt: 'Usá listFiles para elegir un archivo de texto real y luego usá readFile para leerlo. Devolvé evidencia de ambas tools; no modifiques nada.' },
    { id: 'test-search-text', label: 'Test: buscar texto', description: 'Probar búsqueda en el código', type: 'development', prompt: 'Usá searchText para buscar una cadena real y común del proyecto. Mostrá rutas, líneas y previews devueltos por la tool; no inventes coincidencias ni modifiques nada.' },
    { id: 'test-ask-user', label: 'Test: preguntar al usuario', description: 'Probar pausa de aclaración', type: 'development', prompt: 'Usá askUser para preguntarme qué archivo o área del proyecto querés que inspeccione después. Esperá mi respuesta y no ejecutes acciones adicionales.' },
    { id: 'test-create-plan', label: 'Test: crear plan', description: 'Probar planes persistentes', type: 'development', prompt: 'Creá un plan de prueba persistente con createPlan para inspeccionar el workspace, verificar una ruta y revisar el log. No edites archivos.' },
    { id: 'test-update-plan', label: 'Test: actualizar plan', description: 'Probar cambios de estado', type: 'development', prompt: 'Usá getTaskStatus para encontrar el plan activo y luego updatePlan para marcar un paso real como in_progress. Informá los resultados y no edites archivos.' },
    { id: 'test-todos', label: 'Test: TODOs', description: 'Probar tareas persistentes', type: 'development', prompt: 'Usá todo para agregar un TODO de prueba claramente identificado, luego listalo y finalmente actualizalo a completed. Informá cada resultado real.' },
    { id: 'test-task-status', label: 'Test: estado de tareas', description: 'Probar lectura de planes y TODOs', type: 'development', prompt: 'Usá getTaskStatus para leer el plan y los TODOs persistentes del proyecto activo. Devolvé el estado real sin crear ni modificar nada.' },
    { id: 'test-execution-log', label: 'Test: log de ejecución', description: 'Probar auditoría de tools', type: 'development', prompt: 'Usá getExecutionLog con un límite pequeño para leer el log estructurado de ejecución. Resumí tools, tiempos y resultados reales; no modifiques nada.' },
    { id: 'test-run-command', label: 'Test: ejecutar comando', description: 'Probar comandos seguros', type: 'development', prompt: 'Usá runCommand para ejecutar un comando seguro y de solo lectura que confirme el sistema y la ruta del workspace. Verificá la salida real y no modifiques archivos.' },
    { id: 'test-terminal', label: 'Test: terminal persistente', description: 'Probar procesos de terminal', type: 'development', prompt: 'Usá terminal para iniciar un proceso corto y seguro en segundo plano, observá el resultado y cerralo si corresponde. Informá el estado real sin dejar procesos innecesarios.' },
    { id: 'test-open-browser', label: 'Test: abrir navegador', description: 'Probar navegador integrado', type: 'development', prompt: 'Usá openBrowser para abrir https://example.com dentro del navegador integrado. Confirmá la URL real y no interactúes todavía con la página.' },
    { id: 'test-browser-state', label: 'Test: estado del navegador', description: 'Probar observación web', type: 'development', prompt: 'Usá getBrowserState para observar el navegador integrado actual. Informá URL, título y elementos visibles devueltos por la tool; no inventes datos.' },
    { id: 'test-browser-action', label: 'Test: acción en navegador', description: 'Probar interacción web', type: 'development', prompt: 'Abrí https://example.com con openBrowser, observá con getBrowserState y ejecutá una acción segura de scroll pequeño con browserAction. Verificá cada resultado real.' },
    { id: 'test-list-windows', label: 'Test: listar ventanas', description: 'Probar control de PC', type: 'development', prompt: 'Usá computerListWindows para listar las ventanas visibles de Windows. Informá títulos, procesos y handles reales sin interactuar ni modificar nada.' },
    { id: 'test-computer-state', label: 'Test: estado de ventana', description: 'Probar UI Automation', type: 'development', prompt: 'Usá computerListWindows, elegí una ventana visible segura y consultá su estado con computerGetState. Devolvé evidencia real sin ejecutar acciones.' },
    { id: 'test-screenshot', label: 'Test: captura de pantalla', description: 'Probar captura del escritorio', type: 'development', prompt: 'Usá computerScreenshot para capturar el escritorio actual. Confirmá que la evidencia fue devuelta y describí solo lo observable, sin inventar.' },
    { id: 'test-ocr', label: 'Test: OCR de pantalla', description: 'Probar lectura visual', type: 'development', prompt: 'Usá computerScreenshot y luego computerOcr para leer el texto visible de la captura. Informá texto y coordenadas reales, sin interactuar con ventanas.' },
    { id: 'test-computer-action', label: 'Test: acción de PC', description: 'Probar mouse y teclado', type: 'development', prompt: 'Usá computerListWindows y computerGetState para localizar una ventana segura. Luego ejecutá con computerAction únicamente una acción reversible de focus y verificá el estado posterior.' },
    { id: 'test-subagent', label: 'Test: subagente', description: 'Probar delegación especializada', type: 'development', prompt: 'Delegá a un subagente read_only la tarea de listar y resumir la estructura del workspace. Esperá su resultado, verificá la evidencia y no modifiques archivos.' },
    { id: 'test-tool-discovery', label: 'Test: descubrir tools', description: 'Probar búsqueda y ejecución dinámica', type: 'development', prompt: 'Usá searchTools con una consulta vacía o amplia para descubrir las tools disponibles. Luego ejecutá mediante executeTool una tool segura de lectura usando su esquema exacto y reportá ambos resultados.' },
    { id: 'test-write-file', label: 'Test: escribir archivo', description: 'Probar escritura controlada', type: 'development', prompt: 'Creá mediante writeFile el archivo temporal __codeclub_tool_test__.txt con una línea de texto, leelo con readFile, verificá su contenido y eliminá el archivo temporal usando una tool segura. Informá cada evidencia.' },
    { id: 'test-create-skill', label: 'Test: crear skill', description: 'Probar Agent Plugins', type: 'development', prompt: 'Creá una skill de prueba mínima y claramente identificada con createSkill en el alcance del proyecto activo. Verificá que devuelva pluginPath y skillPath; no sobrescribas plugins existentes.' },
    { id: 'test-create-extension', label: 'Test: crear extensión', description: 'Probar extensiones de agente', type: 'development', prompt: 'Creá una extensión de prueba mínima y claramente identificada con createExtension en el alcance del proyecto activo. Verificá su resultado y no sobrescribas extensiones existentes.' },
    { id: 'test-delete-extension', label: 'Test: eliminar extensión', description: 'Probar limpieza de plugins', type: 'development', prompt: 'Usá deleteExtension únicamente sobre una extensión de prueba creada previamente por este flujo. Verificá la respuesta real y no elimines extensiones existentes.' },
    { id: 'test-create-mcp', label: 'Test: crear MCP', description: 'Probar configuración MCP', type: 'development', prompt: 'Creá un servidor MCP de prueba claramente identificado con createMcpServer usando una configuración segura y no ejecutable. Verificá el manifiesto generado y no conectes servicios reales.' },
    { id: 'test-delete-mcp', label: 'Test: eliminar MCP', description: 'Probar limpieza de servidores', type: 'development', prompt: 'Usá deleteMcpServer únicamente sobre un servidor MCP de prueba creado previamente por este flujo. Verificá la respuesta real y no elimines servidores existentes.' },
    { id: 'test-switch-project', label: 'Test: cambiar proyecto', description: 'Probar contexto de workspace', type: 'development', prompt: 'Usá switchProject para consultar o seleccionar explícitamente un proyecto disponible, verificá el proyecto activo con una lectura segura y no cambies archivos.' },
    { id: 'test-full-development-flow', label: 'Test: flujo completo', description: 'Probar ciclo de desarrollo', type: 'development', prompt: 'Ejecutá un flujo completo y verificable: inspeccioná archivos con listFiles, buscá texto con searchText, leé un archivo con readFile, creá un plan con createPlan, agregá un TODO con todo, ejecutá un comando seguro con runCommand, consultá getExecutionLog y resumí toda la evidencia. No modifiques archivos.' },
    { id: 'markdown-rendering', label: language === 'en' ? 'Test: Markdown rendering' : 'Test: renderizado Markdown', description: language === 'en' ? 'Render every supported Markdown element' : 'Renderizar todos los elementos Markdown compatibles', type: 'development', prompt: '[TESTING MARKDOWN] Respondé únicamente con una demostración completa en Markdown, sin tools: encabezados H1/H2/H3, texto en **negrita**, *cursiva*, ~~tachado~~, enlace, cita, listas numeradas y con viñetas, código inline, bloque de código con lenguaje, regla horizontal y una tabla con encabezados, tres filas y alineación. Incluí emojis y caracteres especiales. No describas la prueba: renderizá directamente todos los elementos.' },
  ].map(command => language === 'en' ? { ...command, ...developmentEnglishTranslations[command.id], prompt: `${command.prompt}\n\nRespond in English.` } : command);
  const [copiedMessageIndex, setCopiedMessageIndex] = useState<number | null>(null);
  const [moreMenuIndex, setMoreMenuIndex] = useState<number | null>(null);
  const responseMenuRef = useRef<HTMLDivElement | null>(null);
  usePopupKeyboard(responseMenuRef, moreMenuIndex !== null, () => setMoreMenuIndex(null), moreMenuIndex);
  const visibleHistoryStart = historyWindow.range.current.start;
  useEffect(() => {
    setMoreMenuIndex(null);
    setCopiedMessageIndex(null);
  }, [visibleHistoryStart]);
  useEffect(() => {
    if (moreMenuIndex === null) return;
    const closeMenu = (event: MouseEvent) => {
      if (!(event.target as HTMLElement).closest('[data-message-actions]')) setMoreMenuIndex(null);
    };
    document.addEventListener('mousedown', closeMenu);
    return () => document.removeEventListener('mousedown', closeMenu);
  }, [moreMenuIndex]);
  const copyResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [input, setInput] = useState('');
  useEffect(() => { onDraftChange?.(input); }, [input, onDraftChange]);
  const [agentTextSelection, setAgentTextSelection] = useState<{ text: string; top: number; left: number } | null>(null);
  const [selectionCommentOpen, setSelectionCommentOpen] = useState(false);
  const [selectionComment, setSelectionComment] = useState('');
  const [artifactReferences, setArtifactReferences] = useState<{ kind: 'plan' | 'todo'; id: string; title: string }[]>([]);
  const [browserReferences, setBrowserReferences] = useState<{ id: string; title: string; text: string; url?: string; markerId?: string }[]>([]);
  const [selectedTextReferences, setSelectedTextReferences] = useState<{ id: string; text: string; comment?: string }[]>([]);
  const browserRefContainerRef = useRef<HTMLDivElement>(null);
  const [maxVisibleBrowserRefs, setMaxVisibleBrowserRefs] = useState(3);
  const [attachedFiles, setAttachedFiles] = useState<ChatAttachment[]>([]);
  const [attachmentProgress,setAttachmentProgress] = useState('');
  const [attachmentError,setAttachmentError] = useState(false);
  const chatPanelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const hideSelectionBar = (event?: Event) => {
      if (event?.target instanceof Element && event.target.closest('.chat-selection-toolbar-wrap')) return;
      setAgentTextSelection(null);
      setSelectionCommentOpen(false);
      setSelectionComment('');
    };
    const handleSelectionChange = () => {
      if (document.activeElement instanceof Element && document.activeElement.closest('.chat-selection-toolbar-wrap')) return;
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || !selection.toString().trim()) { hideSelectionBar(); return; }
      const rootFor = (node: Node | null) => (node instanceof Element ? node : node?.parentElement)?.closest('.chat-markdown-assistant') || null;
      const root = rootFor(selection.anchorNode);
      if (!root || root !== rootFor(selection.focusNode)) { hideSelectionBar(); return; }
      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      if (!rect.width && !rect.height) { hideSelectionBar(); return; }
      const barWidth = Math.min(286, window.innerWidth - 16);
      const left = Math.max(8, Math.min(window.innerWidth - barWidth - 8, rect.left + rect.width / 2 - barWidth / 2));
      const preferredTop = rect.top > 58 ? rect.top - 48 : rect.bottom + 8;
      const top = Math.max(8, Math.min(window.innerHeight - 48, preferredTop));
      setAgentTextSelection({ text: selection.toString().trim(), top, left });
    };
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('.chat-selection-toolbar-wrap')) return;
      if (target?.closest('.chat-markdown-assistant')) {
        setSelectionCommentOpen(false);
        setSelectionComment('');
        return;
      }
      hideSelectionBar();
    };
    document.addEventListener('selectionchange', handleSelectionChange);
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('scroll', hideSelectionBar, true);
    window.addEventListener('resize', hideSelectionBar);
    return () => {
      document.removeEventListener('selectionchange', handleSelectionChange);
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('scroll', hideSelectionBar, true);
      window.removeEventListener('resize', hideSelectionBar);
    };
  }, []);
  const [isStreaming, setIsStreaming] = useState(false);
  const [agentState, setAgentState] = useState('idle');
  const agentStartedAtRef = useRef(0);
  const [activeToolName, setActiveToolName] = useState('');
  const [computerUseActive, setComputerUseActive] = useState(false);
  const [computerContext, setComputerContext] = useState<{ action: string; x: number; y: number; handle?: number; processId?: number; title?: string } | null>(null);
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
  const [currentModel, setCurrentModel] = useState<CatalogItem | null>(defaultModel);
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
  const [searchQuery, setSearchQuery] = useState('');
  const [projectOptions, setProjectOptions] = useState<ProjectOption[]>([]);
  const resourceText = resourceMenuTranslations[language];
  const resourceProjectRef = useRef<string | null>(null);
  const [resourceOptions, setResourceOptions] = useState<ChatResource[]>([]);
  const [selectedResources, setSelectedResources] = useState<ChatResource[]>([]);
  const [skillOptions, setSkillOptions] = useState<SessionSkill[]>([]);
  const [activeSkills, setActiveSkills] = useState<SessionSkill[]>([]);
  const [activeExtensions, setActiveExtensions] = useState<CodeclubExtension[]>([]);
  const availableExtensions = codeclubExtensions;
  const [activeCommandIndex, setActiveCommandIndex] = useState(0);
  const [activeProject, setActiveProject] = useState<any>(() => selectedProject ? { projectPath: selectedProject.projectPath, name: selectedProject.projectName || 'Proyecto' } : null);
  const [projectMeta, setProjectMeta] = useState<Record<string, any[]> | null>(null);
  const [expandedMenu, setExpandedMenu] = useState<'chat' | null>(null);
  const [artifactSearch, setArtifactSearch] = useState<Record<string, string>>({});
  const [recentArtifactIds, setRecentArtifactIds] = useState<Record<string, string[]>>({});
  const [terminalCount, setTerminalCount] = useState(0);
  const [activeChat, setActiveChat] = useState<{chatId: string, projectPath: string, name?: string} | null>(null);
  const activeChatRef = useRef<{chatId: string, projectPath: string, projectName?: string, name?: string, customName?: boolean} | null>(null);
  const sharedSessions = useSharedSessions();
  const sharedSessionsRef = useRef<SharedSession[]>([]);
  sharedSessionsRef.current = sharedSessions;
  useEffect(() => {
    const chat = activeChatRef.current;
    const session = sharedSessions.find(item => sameSession(chat,item) && !item.localOwner && !item.external);
    if (!chat || !session) return;
    if (session.messages.length) historyWindow.restore(chat,session.messages);
    setIsStreaming(session.busy);
    setAgentState(session.state);
    setActiveToolName(session.tool);
    setPendingApprovals(session.approvals);
  }, [sharedSessions, activeChat?.chatId, activeChat?.projectPath]);
  useEffect(() => {
    const unsubscribe = (window as any).codeclub?.onSessionCommand?.((command: any) => {
      const runtime = chatRuntimesRef.current.get(command.chat.chatId);
      if (!runtime || runtime.runId !== command.runId) return;
      if (command.action === 'cancel') {
        runtime.controller.abort();
        runtime.approvalResolvers.forEach(resolve=>resolve(false));
        runtime.approvalResolvers.clear();
      } else {
        const resolve=runtime.approvalResolvers.get(command.approvalId);
        runtime.approvalResolvers.delete(command.approvalId);
        runtime.pendingApprovals=runtime.pendingApprovals.filter(item=>item.id!==command.approvalId);
        clearTimeout(runtime.approvalTimers?.get(command.approvalId));
        runtime.approvalTimers?.delete(command.approvalId);
        resolve?.(command.action==='approve');
        if(sameSession(activeChatRef.current,command.chat))setPendingApprovals(runtime.pendingApprovals);
      }
      runtime.publish?.();
    });
    return ()=>unsubscribe?.();
  }, []);
  const chatLoadSequenceRef = useRef(0);
  const automaticTitleRef = useRef<string>('');
  const chatRuntimesRef = useRef(new Map<string, ChatRuntime>());
  const lastSelectedProjectRef = useRef<{ projectPath: string; projectName: string } | null | undefined>(selectedProject ? { projectPath: selectedProject.projectPath, projectName: selectedProject.projectName || 'Proyecto' } : undefined);
  const [workspaceMode, setWorkspaceMode] = useState(floating ? 'chat' : 'blank');

  useEffect(() => {
    const publishTrace = () => {
      window.dispatchEvent(new CustomEvent('codeclub:trace-update', { detail: {
        chatId: activeChatRef.current?.chatId,
        projectPath: activeChatRef.current?.projectPath || activeProject?.projectPath,
        projectName: activeChatRef.current?.projectName || activeProject?.name,
        context: { provider: currentProvider.label || currentProvider.id, model: currentModel?.label || currentModel?.id || '' },
        messages: messages.map((message) => ({
          role: message.role,
          content: message.content || '',
          displayContent: message.displayContent,
          reasoning: message.reasoning || '',
          progress: message.progress || '',
          timeline: message.timeline || [],
          tools: message.tools || [],
          meta: message.meta || null,
        })),
      } }));
    };
    window.addEventListener('codeclub:trace-request', publishTrace);
    return () => window.removeEventListener('codeclub:trace-request', publishTrace);
  }, [activeProject, currentModel, currentProvider, messages]);

  useEffect(() => {
    let disposed = false;
    let revision = 0;
    const projectIdentity = activeProject?.projectPath || '';
    if (resourceProjectRef.current !== projectIdentity) {
      resourceProjectRef.current = projectIdentity;
      setResourceOptions([]);
      setSkillOptions([]);
      setSelectedResources(previous => previous.filter(resource => resource.scope === 'global'));
      setActiveSkills(previous => previous.filter(skill => skill.scope === 'global'));
    }
    const loadResources = async () => {
      const current = ++revision;
      try {
        const [plugins, orbs] = await Promise.all([loadAgentPlugins(activeProject?.projectPath || ''), getSetting<unknown>(ORBS_STORAGE_KEY, [])]);
        if (disposed || current !== revision) return;
        const pluginSkills = plugins.flatMap(plugin => plugin.skills.map(skill => ({ ...skill, id: `${plugin.scope}:${plugin.id}:${skill.id}`, pluginId: plugin.id, skillId: skill.id, source: `${plugin.name} · ${resourceMenuTranslations[language][plugin.scope]}`, pluginRoot: plugin.root, readOnly: !!plugin.builtIn })));
        const resources = chatResources(plugins, parseOrbs(orbs));
        setSkillOptions(pluginSkills as SessionSkill[]);
        setResourceOptions(resources);
        setSelectedResources(previous => previous.filter(item => resources.some(resource => resource.id === item.id && resource.kind === item.kind)));
        setActiveSkills(previous => previous.filter(item => pluginSkills.some(skill => skill.id === item.id)));
      } catch {
        if (!disposed && current === revision) { setSkillOptions([]); setResourceOptions([]); }
      }
    };
    const changed = () => { void loadResources(); };
    void loadResources();
    const events = ['codeclub:skills-changed', 'codeclub:extensions-changed', 'codeclub:mcp-changed', 'codeclub:orbs-changed'];
    events.forEach(name => window.addEventListener(name, changed));
    return () => { disposed = true; events.forEach(name => window.removeEventListener(name, changed)); };
  }, [activeProject?.projectPath, language]);

  const agentStatusText = chatText.status[agentState as keyof typeof chatText.status] || chatText.status.idle;
  const isAgentBusy = isStreaming;
  const sendButtonActive = isAgentBusy || Boolean(input.trim()) || attachedFiles.length > 0 || Boolean(browserReferences.length) || selectedTextReferences.length > 0 || artifactReferences.length > 0 || Boolean(computerContext) || Boolean(credentialProvider);
  useEffect(() => { window.dispatchEvent(new CustomEvent('codeclub:agent-activity', { detail: { chatId: activeChat?.chatId, state: agentState, tool: activeToolName, agent: 'Desarrollo' } })); }, [activeChat?.chatId, agentState, activeToolName]);
  useEffect(() => {
    const handleArtifactReference = (event: Event) => {
      const detail = (event as CustomEvent<{ projectPath?: string; kind?: 'plan' | 'todo'; id?: string; title?: string }>).detail;
      if (!detail?.kind || !detail.id || !detail.title) return;
      if (detail.projectPath && detail.projectPath !== activeProject?.projectPath) return;
      const reference = { kind: detail.kind, id: detail.id, title: detail.title } as const;
      setArtifactReferences((current) => current.some((item) => item.kind === reference.kind && item.id === reference.id) ? current : [...current, reference]);
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
      const detail = (event as CustomEvent<{ title?: string; text?: string; url?: string; markerId?: string }>).detail;
      if (!detail?.text) return;
      const newItem = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        title: detail.title || 'Referencia',
        text: detail.text,
        url: detail.url,
        markerId: detail.markerId,
      };
      setBrowserReferences((current) => {
        if (current.some((item) => newItem.markerId ? item.markerId === newItem.markerId : item.text === newItem.text)) return current;
        return [...current, newItem];
      });
      requestAnimationFrame(() => chatInputRef.current?.focus());
    };
    const handleRemoveBrowserReference = (event: Event) => {
      const markerId = (event as CustomEvent<{ markerId?: string }>).detail?.markerId;
      if (markerId) setBrowserReferences((current) => current.filter((item) => item.markerId !== markerId));
    };
    window.addEventListener('codeclub:browser-reference', handleBrowserReference);
    window.addEventListener('codeclub:remove-browser-reference', handleRemoveBrowserReference);
    return () => {
      window.removeEventListener('codeclub:browser-reference', handleBrowserReference);
      window.removeEventListener('codeclub:remove-browser-reference', handleRemoveBrowserReference);
    };
  }, []);
  useEffect(() => {
    const publishOrder = () => window.dispatchEvent(new CustomEvent('codeclub:browser-reference-order', { detail: { total: browserReferences.length, items: browserReferences.flatMap((reference, index) => reference.markerId ? [{ markerId: reference.markerId, number: index + 1 }] : []) } }));
    window.addEventListener('codeclub:browser-reference-order-request', publishOrder);
    publishOrder();
    return () => window.removeEventListener('codeclub:browser-reference-order-request', publishOrder);
  }, [browserReferences]);
  const approvalResolversRef = useRef(new Map<string, (approved: boolean) => void>());
  const lastModelFetchRef = useRef<ModelFetchDebug | null>(null);
  const commandMenuRef = useRef<HTMLDivElement | null>(null);
  const commandMenuHostRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const chatInputRef = useRef<HTMLTextAreaElement | null>(null);
  const resizeChatInput = () => {
    requestAnimationFrame(() => {
      const target = chatInputRef.current;
      if (!target) return;
      target.style.height = '22px';
      const maxHeight = 144;
      target.style.height = `${Math.min(target.scrollHeight, maxHeight)}px`;
      target.style.overflowY = target.scrollHeight > maxHeight ? 'auto' : 'hidden';
    });
  };
  useEffect(() => {
    resizeChatInput();
  }, [input]);
  const messagesAreaRef = useRef<HTMLDivElement | null>(null);
  const pendingChatScrollRef = useRef<string | null>(null);
  const chatAnimations = useAnimationControls();
  const reducedMotion = useReducedMotion();
  const [chatTransitionPhase, setChatTransitionPhase] = useState<'idle' | 'exiting' | 'loading' | 'entering'>('idle');
  const beginChatTransition = async () => {
    const sequence = ++chatLoadSequenceRef.current;
    pendingChatScrollRef.current = null;
    setChatTransitionPhase('exiting');
    chatAnimations.stop();
    await chatAnimations.start({ opacity: 0, transition: { duration: reducedMotion ? 0 : 0.09, ease: 'easeOut' } });
    if (sequence !== chatLoadSequenceRef.current) return null;
    setChatTransitionPhase('loading');
    return sequence;
  };
  useEffect(() => () => { chatLoadSequenceRef.current++; chatAnimations.stop(); }, [chatAnimations]);
  const turnIndexes = useMemo(() => {
    if (floating) {
      const lastUser = messages.findLastIndex(message => message.role === 'user');
      return lastUser >= 0 ? [lastUser] : messages.length ? [0] : [];
    }
    return messages.flatMap((message, index) => message.role === 'user' || index === 0 ? [index] : []);
  },[messages,floating]);
  const virtualizeTurns = turnIndexes.length > 30;
  const turnVirtualizer = useVirtualizer<HTMLDivElement,HTMLDivElement>({
    count:turnIndexes.length,
    getScrollElement:()=>messagesAreaRef.current,
    estimateSize:()=>240,
    getItemKey:index=>`${activeChatRef.current?.projectPath||''}:${activeChatRef.current?.chatId||'new'}:${messages[turnIndexes[index]]?.historyIndex??turnIndexes[index]}`,
    overscan:4,
    anchorTo:'end',
    followOnAppend:false,
    scrollEndThreshold:80,
    enabled:composerDocked && virtualizeTurns,
  });
  const totalTurnHeight = virtualizeTurns ? turnVirtualizer.getTotalSize() : 0;
  const scrollMessagesToEnd = () => {
    if (virtualizeTurns) turnVirtualizer.scrollToEnd({ behavior: 'auto' });
    else if (messagesAreaRef.current) messagesAreaRef.current.scrollTop = messagesAreaRef.current.scrollHeight;
  };
  const shouldAutoScrollMessagesRef = useRef(true);
  const handleMessagesScroll = () => {
    const area = messagesAreaRef.current;
    if (!area) return;
    shouldAutoScrollMessagesRef.current = area.scrollHeight - area.scrollTop - area.clientHeight < 80;
    if (pendingChatScrollRef.current || chatTransitionPhase !== 'idle') return;
    if (!floating && !isAgentBusy && !historyWindow.loading) {
      if(area.scrollTop<120 && historyWindow.range.current.start>0) void historyWindow.adjacent('older');
      else if(shouldAutoScrollMessagesRef.current) void historyWindow.adjacent('newer');
    }
  };
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
      const loadSequence = await beginChatTransition();
      if (loadSequence === null) return;
      pendingChatScrollRef.current = `${chat.projectPath || ''}:${chat.chatId}`;
      rememberRecentArtifact('chat', chat);
      setWorkspaceMode('chat');
      setActiveChat(chat);
      activeChatRef.current = chat;
      void (window as any).codeclub?.sessionSelect?.(chat);
      const runtime = chatRuntimesRef.current.get(chat.chatId);
      const remote = sharedSessionsRef.current.find(item=>sameSession(chat,item)&&!item.localOwner&&item.busy);
      const project = chat.projectPath ? {
        projectPath: chat.projectPath,
        projectName: chat.projectName || 'Proyecto',
      } : null;
      setActiveProject(project ? { projectPath: project.projectPath, name: project.projectName } : null);
      window.dispatchEvent(new CustomEvent('codeclub:project-selection-changed', {
        detail: project ? { selected: true, projectPath: project.projectPath, projectName: project.projectName } : { selected: false, keepChat: true },
      }));
      window.dispatchEvent(new CustomEvent('codeclub:active-project', { detail: project }));
      historyWindow.restore(chat,runtime?.messages || remote?.messages || []);
      shouldAutoScrollMessagesRef.current = true;
      setInput('');
      setAttachedFiles([]);
      setIsStreaming(Boolean(runtime && !runtime.controller.signal.aborted) || Boolean(remote?.busy));
      setAgentState(runtime?.state || remote?.state || 'idle');
      setActiveToolName(runtime?.tool || remote?.tool || '');
      setPendingApprovals(runtime?.pendingApprovals || remote?.approvals || []);
      approvalResolversRef.current = runtime?.approvalResolvers || new Map();
      abortControllerRef.current = runtime?.controller || null;
      const wasDocked = composerDockedRef.current;
      if (runtime?.messages?.length || remote?.messages.length) return;
      try {
        if (!chat.projectPath) {
          const loaded = await historyWindow.open(chat, () => readGlobalChatHistory(chat.chatId));
          if (loadSequence !== chatLoadSequenceRef.current) return;
          if (!wasDocked && loaded) setComposerDocked(true);
          return;
        }
        const loaded = await historyWindow.open(chat, () => readProjectChatHistory(chat.projectPath,chat.chatId));
        if (loadSequence !== chatLoadSequenceRef.current) return;
        if (!wasDocked && loaded) setComposerDocked(true);
      } catch (err) {
        console.error("Error loading chat:", err);
      }
    };
    // OrbSidebar emits this after clearing the named chat in storage.
    // This listener belongs to the same panel and is removed with its open-chat listener.
    const handleHistoryCleared = (event: Event) => {
      const chat = activeChatRef.current;
      if (!agentOrb || !chat || chat.chatId !== (event as CustomEvent).detail?.chatId) return;
      chatRuntimesRef.current.delete(chat.chatId);
      historyWindow.restore(chat, []);
      setInput(''); setAttachedFiles([]); setIsStreaming(false); setAgentState('idle'); setActiveToolName('');
    };
    const clearEventName = `${eventPrefix}:history-cleared`;
    window.addEventListener(clearEventName, handleHistoryCleared);
    const eventName = `${eventPrefix}:open-chat`;
    window.addEventListener(eventName, handleOpenChat);
    return () => { window.removeEventListener(eventName, handleOpenChat); window.removeEventListener(clearEventName, handleHistoryCleared); };
  }, [eventPrefix]);

  useEffect(() => {
    const handleOpenEmptyChat = async () => {
      if (await beginChatTransition() === null) return;
      pendingChatScrollRef.current = null;
      historyWindow.reset();
      setMenuOpen(false);
      setCredentialProvider(null);
      setWorkspaceMode('chat');
      activeChatRef.current = null;
      setActiveChat(null);
      setMessages([]);
      setInput('');
      setAttachedFiles([]);
      setPendingApprovals([]);
      setIsStreaming(false);
      setActiveToolName('');
      abortControllerRef.current = null;
      setAgentState('idle');
    };
    window.addEventListener('codeclub:open-empty-chat', handleOpenEmptyChat);
    return () => window.removeEventListener('codeclub:open-empty-chat', handleOpenEmptyChat);
  }, []);

  useEffect(() => {
    const chat = activeChat;
    const target = pendingChatScrollRef.current;
    if (chatTransitionPhase === 'exiting' || historyWindow.loading || !composerDocked) return;
    const sequence = chatLoadSequenceRef.current;
    const reveal = () => {
      if (sequence !== chatLoadSequenceRef.current || chatTransitionPhase !== 'loading') return;
      setChatTransitionPhase('entering');
      void chatAnimations.start({ opacity: 1, transition: { duration: reducedMotion ? 0 : 0.14, ease: 'easeOut' } }).then(() => {
        if (sequence === chatLoadSequenceRef.current) setChatTransitionPhase('idle');
      });
    };
    if (!chat || turnIndexes.length === 0) {
      pendingChatScrollRef.current = null;
      reveal();
      return;
    }
    if (target !== `${chat.projectPath || ''}:${chat.chatId}`) return;
    let frame = 0;
    const settleStartedAt = performance.now();
    let stableFrames = 0;
    let previousHeight = -1;
    let previousTop = -1;
    let previousViewport = -1;
    let previousLastTop = -1;
    scrollMessagesToEnd();
    const settle = () => {
      if (sequence !== chatLoadSequenceRef.current) return;
      const area = messagesAreaRef.current;
      if (!area) return;
      const lastTurn = area.querySelector<HTMLElement>('.chat-turn.is-last');
      const lastTop = lastTurn?.getBoundingClientRect().top ?? -1;
      const atEnd = Math.abs(area.scrollHeight - area.scrollTop - area.clientHeight) <= 1;
      let ready = document.fonts.status !== 'loading';
      const images = area.getElementsByTagName('img');
      for (let index = 0; ready && index < images.length; index++) ready = images[index].complete;
      const unchanged = area.scrollHeight === previousHeight && area.scrollTop === previousTop && area.clientHeight === previousViewport && Math.abs(lastTop - previousLastTop) < 0.5;
      stableFrames = atEnd && ready && unchanged ? stableFrames + 1 : 0;
      previousHeight = area.scrollHeight;
      previousTop = area.scrollTop;
      previousViewport = area.clientHeight;
      previousLastTop = lastTop;
      if (stableFrames >= 4 || performance.now() - settleStartedAt >= 2000) {
        shouldAutoScrollMessagesRef.current = true;
        pendingChatScrollRef.current = null;
        reveal();
        return;
      }
      if (!atEnd) scrollMessagesToEnd();
      frame = requestAnimationFrame(settle);
    };
    frame = requestAnimationFrame(settle);
    return () => cancelAnimationFrame(frame);
  }, [activeChat?.chatId, activeChat?.projectPath, historyWindow.loading, messages.length, composerDocked, turnIndexes.length, chatTransitionPhase]);

  useEffect(() => {
    const area = messagesAreaRef.current;
    if (floating || !area || !activeChat || !composerDocked || historyWindow.loading || chatTransitionPhase !== 'idle' || moreMenuIndex !== null || isAgentBusy || historyWindow.range.current.start === 0) return;
    if (area.scrollHeight <= area.clientHeight + 1) void historyWindow.adjacent('older');
  }, [activeChat?.chatId, activeChat?.projectPath, composerDocked, historyWindow.loading, messages.length, isAgentBusy, totalTurnHeight, chatTransitionPhase, moreMenuIndex]);

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
      if (chatRuntimesRef.current.has(current.chatId)) return;
      const oldPath = current.projectPath;
      const newPath = detail.projectPath;
      const chatName = (current as any).name || 'Chat';
      activeChatRef.current = { ...current, projectPath: newPath, projectName: detail.projectName, name: chatName };
      setActiveChat(activeChatRef.current);
      try {
        if ((window as any).codeclub?.chatCopy) {
          await (window as any).codeclub.chatCopy(oldPath,newPath,current.chatId);
          if(oldPath){const meta=await readProjectMeta(oldPath);if(meta){meta.chats=meta.chats.filter(item=>item.id!==current.chatId);await writeProjectMeta(oldPath,meta);}}
          else {await writeGlobalChats((await readGlobalChats()).filter(item=>item.id!==current.chatId));}
          if(newPath){const meta: ProjectMeta=await readProjectMeta(newPath)||{name:detail.projectName||'Proyecto',path:newPath,created_at:new Date().toISOString(),chats:[]};if(!meta.chats.some(item=>item.id===current.chatId))meta.chats.push({id:current.chatId,name:chatName,customName:current.customName});await writeProjectMeta(newPath,meta);}
          else {const chats=await readGlobalChats();if(!chats.some(item=>item.id===current.chatId))chats.push({id:current.chatId,name:chatName,customName:current.customName,projectPath:'',projectName:'Sin proyecto'});await writeGlobalChats(chats);}
          await (window as any).codeclub.chatDelete(oldPath,current.chatId);
          window.dispatchEvent(new CustomEvent('codeclub:project-meta-changed',{detail:{projectPath:oldPath}}));
          window.dispatchEvent(new CustomEvent('codeclub:project-meta-changed',{detail:{projectPath:newPath}}));
          window.dispatchEvent(new CustomEvent('codeclub:global-chat-changed'));
          if(activeChatRef.current?.chatId===current.chatId&&activeChatRef.current?.projectPath===newPath)await historyWindow.open(activeChatRef.current);
          return;
        }
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
    // Keep the settled empty state while history changes behind the transition.
    if (chatTransitionPhase === 'idle') setShowEmptyGreeting(messages.length === 0);
  }, [messages.length, chatTransitionPhase]);

  useEffect(() => {
    const handleActiveProject = (e: any) => {
      setActiveProject(e.detail?.projectPath ? (current: any) => current?.projectPath === e.detail.projectPath ? current : e.detail : null);
      setExpandedMenu(null);
    };
    window.addEventListener('codeclub:active-project', handleActiveProject);

    // Recover the current project when this panel mounts after the project-change event.
    const selectedProject = document.querySelector<HTMLElement>('.project-card.is-selected');
    if (selectedProject) {
      const projectPath = selectedProject.dataset.path;
      const name = selectedProject.querySelector('.project-row span')?.textContent || 'Proyecto';
      if (projectPath) setActiveProject({ projectPath, name });
    }

    return () => window.removeEventListener('codeclub:active-project', handleActiveProject);
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (workspaceMode === 'blank' && activeProject) {
      const loadMeta = async () => {
        try {
          const meta = await readProjectMeta(activeProject.projectPath);
          if (!cancelled) setProjectMeta(meta as any);
        } catch (e) {
          console.error(e);
          if (!cancelled) setProjectMeta(null);
        }
      };
      loadMeta();
    } else setProjectMeta(null);
    return () => { cancelled = true; };
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
    let cancelled = false;
    let request = 0;
    const restore = () => { if (agentOrb) { setCurrentProvider(defaultProvider); setCurrentModel(defaultModel); setSettingsReady(true); return; } const version = ++request; void Promise.all([
      getSetting('codeclub_last_provider_id', ''),
      getSetting('codeclub_last_model_id', ''),
    ]).then(([savedProviderId, savedModelId]) => {
      if (cancelled || version !== request) return;
      const savedProvider = savedProviderId ? catalog.find((item) => item.type === 'provider' && item.id === savedProviderId) : null;
      const activeProvider = savedProvider || defaultProvider;
      const savedModel = savedModelId ? catalog.find((item) => item.type === 'model' && (item.gatewayId === savedModelId || item.id === savedModelId) && modelMatchesProvider(item, activeProvider)) : null;
      const providerModel = catalog.find((item) => item.type === 'model' && modelMatchesProvider(item, activeProvider));
      setCurrentProvider(activeProvider);
      setCurrentModel(savedModel || providerModel || (activeProvider.id === 'custom' ? defaultModel : null));
      setSettingsReady(true);
    }).catch(() => { if (!cancelled && version === request) setSettingsReady(true); }); };
    restore();
    window.addEventListener('codeclub:settings-changed', restore);
    return () => { cancelled = true; window.removeEventListener('codeclub:settings-changed', restore); };
  }, [catalog, defaultProvider, defaultModel, agentOrb?.providerId, agentOrb?.modelId]);

  useEffect(() => {
    if (!agentOrb && settingsReady && currentProvider) void setSetting('codeclub_last_provider_id', currentProvider.id);
  }, [currentProvider, settingsReady, agentOrb]);

  useEffect(() => {
    if (!agentOrb && settingsReady && currentModel) void setSetting('codeclub_last_model_id', currentModel.gatewayId || currentModel.id);
  }, [currentModel, settingsReady, agentOrb]);

  useEffect(() => {
    if (!currentProvider) return;
    const modelBelongsToProvider = currentModel && modelMatchesProvider(currentModel, currentProvider);
    if (modelBelongsToProvider) return;
    const providerModel = catalog.find((item) => item.type === 'model' && modelMatchesProvider(item, currentProvider));
    if (providerModel) setCurrentModel(providerModel);
  }, [catalog, currentModel, currentProvider]);

  const openCommandMenu = (kind: string) => {
    if (agentOrb && ['provider', 'model', 'credential'].includes(kind)) return;
    setCommandKind(kind);
    setMenuOpen(true);
    setSearchQuery('');
    setActiveCommandIndex(0);
    setTimeout(() => commandMenuRef.current?.focus(), 10);
  };

  useEffect(() => {
    window.dispatchEvent(new CustomEvent('codeclub:slash-menu-state', { detail: { active: menuOpen } }));
  }, [menuOpen]);

  useEffect(() => {
    const handleToggleSlashMenu = () => {
      if (menuOpen) {
        setMenuOpen(false);
        setCommandKind('');
        setSearchQuery('');
        requestAnimationFrame(() => chatInputRef.current?.focus());
        return;
      }
      openCommandMenu('command');
    };
    window.addEventListener('codeclub:toggle-slash-menu', handleToggleSlashMenu);
    return () => window.removeEventListener('codeclub:toggle-slash-menu', handleToggleSlashMenu);
  }, [menuOpen]);

  const readProjectsForCommandMenu = async () => {
    const bridge = (window as any).codeclub;
    if (typeof bridge?.listProjects === 'function') {
      const projects = await bridge.listProjects();
      const normalized = (projects || []).map((project: any) => ({ id: project.id, path: project.path, name: project.name }));
      try {
        const openProjectIds = JSON.parse(window.localStorage.getItem('codeclub:open-projects') || 'null');
        if (Array.isArray(openProjectIds)) return normalized.filter((project: any) => openProjectIds.includes(project.id));
      } catch { /* A damaged saved index falls back to the complete index. */ }
      return normalized;
    }
    const projects = await readProjectIndex();
    try {
      const openProjectIds = JSON.parse(window.localStorage.getItem('codeclub:open-projects') || 'null');
      if (Array.isArray(openProjectIds)) return projects.filter((project: any) => openProjectIds.includes(project.id));
      } catch { /* A damaged saved index falls back to the complete index. */ }
    return projects;
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
    const handleOpenProjectsChanged = () => {
      if (commandKind !== 'project' || !menuOpen) return;
      void readProjectsForCommandMenu().then((projects) => {
        setProjectOptions([{ id: '__none__', label: chatText.noProject, type: 'project', projectPath: null, isNone: true }, ...projects.map((project: any) => ({ id: project.id || project.path, label: project.name, type: 'project', projectPath: project.path, projectId: project.id }))]);
      });
    };
    window.addEventListener('codeclub:open-command-menu', handleOpenCommandMenu);
    window.addEventListener('codeclub:open-projects-changed', handleOpenProjectsChanged);
    return () => { window.removeEventListener('codeclub:open-command-menu', handleOpenCommandMenu); window.removeEventListener('codeclub:open-projects-changed', handleOpenProjectsChanged); };
  }, [menuOpen, commandKind]);

  const [savedCredentialKeys, setSavedCredentialKeys] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!menuOpen || commandKind !== 'provider') return;
    let active = true;
    const keys = [...new Set(catalog.filter(item => item.type === 'provider' && (!item.gatewayOnly || item.id === 'ai-gateway')).map(item => credentialKeyFor(item)))];
    const bridge = (window as any).codeclub;
    void Promise.all(keys.map(async key => {
      try {
        // Ask only whether the vault contains the credential; never read its value.
        const present = bridge?.credentialPresent ? await bridge.credentialPresent(key) : Boolean(await getSetting(key, ''));
        return present ? key : null;
      } catch { return null; }
    })).then(results => {
      if (active) setSavedCredentialKeys(new Set(results.filter((key): key is string => key !== null)));
    });
    return () => { active = false; };
  }, [menuOpen, commandKind, catalog]);

  const commandOptions: CatalogItem[] = commandKind === 'project' ? projectOptions : commandKind === 'skill' ? skillOptions.map((skill) => ({ ...skill, type: 'skill', label: skill.name })) : commandKind === 'language' ? languageOptions : commandKind === 'development' ? developmentOptions : catalog;
  const filteredCatalog = commandOptions.filter((item) => {
    const matchesKind = item.type === commandKind;
    const normalizedQuery = searchQuery.trim().toLowerCase();
    const searchableText = [item.id, item.label, item.name, item.providerId, item.providerName, item.description]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    const matchesQuery = searchableText.includes(normalizedQuery);
    const matchesProvider = commandKind !== 'model' || Boolean(currentProvider && modelMatchesProvider(item, currentProvider));
    return matchesKind && matchesQuery && matchesProvider;
  });
  const activeSelection: CatalogItem | null = commandKind === 'provider' ? currentProvider : commandKind === 'model' ? currentModel : commandKind === 'project' && activeProject ? { id: activeProject.projectPath, label: activeProject.name } : commandKind === 'language' ? { id: language, label: language === 'en' ? 'English' : 'Español' } : null;
  const slashCommands: CatalogItem[] = [
    { id: 'adjuntar', label: chatText.attach, description: language === 'en' ? 'Attach files to the message' : 'Adjuntar archivos al mensaje', aliases: ['adjuntar', 'attach'], type: 'command', icon: Paperclip },
    { id: 'proveedor', label: chatText.slash.provider, description: chatText.slash.providerDescription, aliases: ['proveedor', 'provider'], type: 'command', icon: Radar },
    { id: 'modelo', label: chatText.slash.model, description: chatText.slash.modelDescription, aliases: ['modelo', 'model'], type: 'command', icon: Box },
    { id: 'credencial', label: language === 'en' ? 'Credential' : 'Credencial', description: language === 'en' ? 'Replace the active provider credential' : 'Reemplazar la credencial del proveedor activo', aliases: ['credencial', 'credential', 'api', 'key', 'token'], type: 'command', icon: KeyRound },
    { id: 'proyecto', label: projectsSlashLabel, description: chatText.slash.projectDescription, aliases: ['proyecto', 'proyectos', 'project', 'projects'], type: 'command', icon: Folder },
    { id: 'habilidad', label: chatText.slash.skill, description: chatText.slash.skillDescription, aliases: ['habilidad', 'skill'], type: 'command', icon: WandSparkles },
    { id: 'idioma', label: language === 'en' ? 'Language' : 'Idioma', description: language === 'en' ? 'Change language' : 'Cambiar idioma', aliases: ['idioma', 'language', 'lang'], type: 'command', icon: Languages },
    ...(isDevelopmentBuild ? [{ id: 'desarrollo', label: language === 'en' ? 'Development' : 'Desarrollo', description: language === 'en' ? 'Insert a development prompt' : 'Inyectar un prompt de desarrollo', aliases: ['desarrollo', 'desarrollar', 'development', 'develop'], type: 'command' as const, icon: Code2 }] : []),
    { id: 'overlay', label: computerUseActive ? (language === 'en' ? 'Disable Computer Use overlay' : 'Desactivar overlay de Computer Use') : (language === 'en' ? 'Enable Computer Use overlay' : 'Activar overlay de Computer Use'), description: language === 'en' ? 'Show or hide the PC control overlay' : 'Mostrar u ocultar el overlay de control de PC', aliases: ['overlay', 'overlay-pc', 'computer-overlay'], type: 'command', icon: Monitor },
    ...skillOptions.map(skill => ({ ...skill, type: 'skill', label: skill.name, aliases: [skill.name.toLowerCase(), 'skill', 'habilidad'], icon: BookOpen })),
    ...resourceOptions.map(resource => ({ id: `${resource.kind}:${resource.id}`, type: 'resource', label: resource.name, description: `${resourceText[resource.kind]} · ${resourceText[resource.scope]}`, aliases: [resource.kind, resourceText[resource.kind].toLowerCase()], icon: resource.kind === 'orb' ? PyramidMark : resource.kind === 'mcp' ? Braces : Box, resource })),
    ...(['Extension', 'Skill', 'Mcp', 'Orb'] as const).map(kind => ({ id: `create-resource-${kind}`, type: 'resource-create', label: resourceText[`create${kind}`], description: resourceText.createDescription, aliases: [`crear ${kind.toLowerCase()}`, `create ${kind.toLowerCase()}`], icon: resourceCreationIcons[kind], resourceKind: kind })),
    ...availableExtensions.map((extension) => ({ id: extension.id, label: extension.name, description: extension.description, type: 'extension' as const, icon: extensionIcons[extension.id] || Box, extension })),
  ].filter((command: CatalogItem) => !agentOrb || !['proveedor', 'modelo', 'credencial'].includes(command.id)).filter((command: CatalogItem) => [command.label, command.description, command.id].some(value => value?.toLowerCase().includes(searchQuery.toLowerCase())) || command.aliases?.some((alias: string) => alias.includes(searchQuery.toLowerCase())));
  const commandMenuItems = commandKind === 'command'
    ? slashCommands
    : filteredCatalog.filter((item) => {
      if (!activeSelection) return true;
      if ((item.gatewayId || item.id) === (activeSelection.gatewayId || activeSelection.id)) return false;
      if (commandKind === 'project' && item.projectPath === activeProject?.projectPath) return false;
      return true;
    });
  const isSavedProvider = (item: CatalogItem) => item.id === 'custom' || ((!item.gatewayOnly || item.id === 'ai-gateway') && savedCredentialKeys.has(credentialKeyFor(item)));
  if (commandKind === 'provider') {
    commandMenuItems.sort((a, b) => Number(isSavedProvider(b)) - Number(isSavedProvider(a)));
  }
  const hasCommandMenuResults = commandMenuItems.length > 0;

  useEffect(() => {
    setActiveCommandIndex(0);
  }, [commandKind, searchQuery]);

  useEffect(() => {
    if (!menuOpen) {
      setCredentialProvider(null);
      setCredentialInput('');
      setCommandKind((kind) => kind === 'credential' ? '' : kind);
    }
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const activeItem = commandMenuRef.current?.querySelector(`[data-command-index="${activeCommandIndex}"]`);
    activeItem?.scrollIntoView({ block: 'nearest' });
  }, [activeCommandIndex, menuOpen, commandMenuItems.length]);

  useEffect(() => {
    if (!composerDocked || chatTransitionPhase !== 'idle' || pendingChatScrollRef.current || !shouldAutoScrollMessagesRef.current) return;
    scrollMessagesToEnd();
  }, [messages, isStreaming, pendingApprovals, composerDocked]);

  useEffect(() => {
    const chat = activeChatRef.current;
    if (isStreaming || !chat || chat.customName) return;
    // Paging through older turns must not rename the chat to an older summary.
    if (historyWindow.range.current.start + messages.length < historyWindow.range.current.total) return;
    const lastMessage = [...messages].reverse().find((message) => message.role === 'assistant' && typeof message.turnSummary === 'string' && message.turnSummary.trim());
    const rawTitle = lastMessage?.turnSummary?.trim();
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
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('[data-slash-menu-toggle]')) return;
      const button = target?.closest('button') as HTMLButtonElement | null;
      const isCommandDockButton = ['provider', 'model', 'project'].includes(button?.dataset.commandMenuKind || '') || /^(Proveedor|Modelo|Proyecto):/.test(button?.getAttribute('aria-label') || '');
      if (commandMenuRef.current?.contains(event.target as Node) || button?.title === 'Proveedor, modelo y proyecto' || isCommandDockButton) return;
      setMenuOpen(false);
    };

    window.addEventListener('pointerdown', handlePointerDown);
    return () => window.removeEventListener('pointerdown', handlePointerDown);
  }, [menuOpen]);

  const handleItemClick = async (item: CatalogItem) => {
    if (item.type === 'command') {
      if (item.id === 'adjuntar') {
        setInput('');
        setSearchQuery('');
        setMenuOpen(false);
        setCommandKind('');
        void handleAttachFiles();
        chatInputRef.current?.focus();
        return;
      }
      if (item.id === 'proveedor' || item.id === 'modelo') {
        setInput('');
        setSearchQuery('');
        openCommandMenu(item.id === 'proveedor' ? 'provider' : 'model');
        return;
      }
      if (item.id === 'credencial') {
        const provider = currentProvider || defaultProvider;
        if (!provider || provider.id === 'custom') return;
        setCredentialProvider(credentialTargetFor(provider, currentModel));
        setCredentialInput('');
        setInput('');
        setSearchQuery('');
        setCommandKind('credential');
        setMenuOpen(true);
        window.setTimeout(() => credentialInputRef.current?.focus(), 0);
        return;
      }
      if (item.id === 'proyecto') {
        void readProjectsForCommandMenu().then((projects) => {
          setProjectOptions([{ id: '__none__', label: language === 'en' ? 'No project' : 'Sin proyecto', type: 'project', projectPath: null, isNone: true }, ...projects.map((project: any) => ({ id: project.id || project.path, label: project.name, type: 'project', projectPath: project.path, projectId: project.id }))]);
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
      if (item.id === 'overlay') {
        setComputerUseActive((current) => !current);
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
    if (item.type === 'resource' || item.type === 'resource-create') {
      if (item.type === 'resource') setSelectedResources(previous => previous.some(resource => resource.id === item.resource.id && resource.kind === item.resource.kind) ? previous : [...previous, item.resource]);
      setInput(item.type === 'resource-create' ? `${resourceText.createPrompt} ${item.resourceKind.toLowerCase()}. ` : '');
      setSearchQuery(''); setMenuOpen(false); setCommandKind('');
      requestAnimationFrame(() => chatInputRef.current?.focus());
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
      resizeChatInput();
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
    let needsProviderCredential = false;
    if (item.type === 'provider') {
      setCurrentProvider(item);
      const isCustomProvider = item.id === 'custom';
      const providerModels = catalog.filter((candidate) => candidate.type === 'model' && modelMatchesProvider(candidate, item));
      const nextModel = providerModels[0] || (isCustomProvider ? defaultModel : null);
      const requiresCredential = !isCustomProvider && (usesGateway(item, nextModel) || item.requiresApiKey !== false);
      const savedCredential = requiresCredential ? await getSetting(credentialKeyFor(item, nextModel), '') : '';
      const needsCredential = requiresCredential && (!savedCredential || savedCredential === 'dummy-key');
      needsProviderCredential = needsCredential;
      setCurrentModel(nextModel);
      setCredentialProvider(needsCredential ? credentialTargetFor(item, nextModel) : null);
      setCredentialInput('');
      setInput('');
      setCommandKind(isCustomProvider ? 'custom-config' : needsCredential ? 'credential' : '');
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
    } else if (item.type === 'model') {
      setCurrentModel(item);
      setCredentialProvider(null);
      const selectedProvider = currentProvider || defaultProvider;
      const requiresCredential = selectedProvider.id !== 'custom' && (usesGateway(selectedProvider, item) || selectedProvider.requiresApiKey !== false);
      const savedCredential = requiresCredential ? await getSetting(credentialKeyFor(selectedProvider, item), '') : '';
      if (requiresCredential && (!savedCredential || savedCredential === 'dummy-key')) {
        setCredentialProvider(credentialTargetFor(selectedProvider, item));
        setCredentialInput('');
        setInput('');
        setSearchQuery('');
        setCommandKind('credential');
        setMenuOpen(true);
        window.setTimeout(() => credentialInputRef.current?.focus(), 0);
        return;
      }
    }
    if (item.type !== 'provider') {
      setInput((prev) => prev.replace(/\/(proveedor|modelo)$/i, '').trimStart());
    }
    if (item.type === 'provider' && (item.id === 'custom' || needsProviderCredential)) {
      setMenuOpen(true);
    } else {
      setMenuOpen(false);
      setCommandKind('');
    }
    if (item.type === 'provider' && (item.id === 'custom' || needsProviderCredential)) {
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

  const saveCredential = async () => {
    if (!credentialProvider || !credentialInput.trim()) return;
    const key=credentialKeyFor(credentialProvider);
    try {
    const credentialOrigin = key === 'ai_gateway_api_key' ? 'https://ai-gateway.vercel.sh' : credentialProvider.api;
    if (!credentialOrigin) throw new Error('El catálogo no indica un endpoint para este proveedor.');
    if((window as any).codeclub?.credentialSet)await (window as any).codeclub.credentialSet(key,credentialInput.trim(),credentialOrigin);
    else await setSetting(key,credentialInput.trim());
    setCredentialProvider(null);
    setCredentialInput('');
    setMenuOpen(false);
    setCommandKind('');
    chatInputRef.current?.focus();
    } catch { setCustomConfigError(activityTranslations[language].failed); }
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

  const { desktopModelFetch, formatDebugError, userFacingProviderError } = createDesktopModelTransport({ currentProvider, currentModel, customToolsFormat, lastModelFetchRef });

  const resolveToolApproval = (approvalId: string, approved: boolean) => {
    const resolver = approvalResolversRef.current.get(approvalId);
    if (!resolver) { const chat=activeChatRef.current;if(chat)void (window as any).codeclub?.sessionCommand?.(chat,approved?'approve':'deny',approvalId);return; }
    approvalResolversRef.current.delete(approvalId);
    const runtime=chatRuntimesRef.current.get(activeChatRef.current?.chatId||'');
    if(runtime){runtime.pendingApprovals=runtime.pendingApprovals.filter(item=>item.id!==approvalId);clearTimeout(runtime.approvalTimers?.get(approvalId));runtime.approvalTimers?.delete(approvalId);runtime.publish?.();}
    setPendingApprovals((items) => items.filter((item) => item.id !== approvalId));
    resolver(approved);
  };

  const appendToJsonl = async (msg: any, chatOverride = activeChatRef.current) => {
    const chat = chatOverride;
    if (!chat) return;
    if ((window as any).codeclub?.chatAppend) {
      const total = await (window as any).codeclub.chatAppend(chat.projectPath,chat.chatId,msg);
      const runtime=chatRuntimesRef.current.get(chat.chatId);if(runtime)runtime.expectedTotal=total;
      await appendToTranscript(msg,chat);
      return;
    }
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
    if ((window as any).codeclub?.chatTranscript) { await (window as any).codeclub.chatTranscript(chat.projectPath,chat.chatId,markdown); return; }
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
    if ((window as any).codeclub?.chatSaveTail) {
      const runtime=chatRuntimesRef.current.get(chat.chatId);
      const total=await (window as any).codeclub.chatSaveTail(chat.projectPath,chat.chatId,nextMessages[0]?.historyIndex??0,nextMessages,runtime?.expectedTotal);
      if(runtime)runtime.expectedTotal=total;
      return;
    }
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

  const sendMessage = async (content: string, baseMessages: any[] = messages, shouldRenameChat = messages.length === 0, replaceHistory = false, attachments: ChatAttachment[] = [], resumeAskUserId?: string, mobileRequestId?:string) => {
    if (visualAnimationRef.current) {
      clearInterval(visualAnimationRef.current);
      visualAnimationRef.current = null;
    }
    const messageArtifactReferences = mobileRequestId?[]:artifactReferences;
    const messageSelectedTextReferences = mobileRequestId?[]:selectedTextReferences;
    const visibleContent = content;
    const messageResourceReferences: ChatResource[] = mobileRequestId ? [] : [...selectedResources, ...activeSkills.map(skill => ({ id: skill.id, kind: 'skill' as const, name: skill.name, scope: skill.scope || 'global', pluginId: skill.pluginId, skillId: skill.skillId, readOnly: !!skill.readOnly })), ...activeExtensions.map(extension => ({ id: extension.id, kind: 'extension' as const, name: extension.name, scope: 'global' as const, readOnly: true }))];
    if (messageResourceReferences.length) content += `\n\nSelected Codeclub resources (identities only; selection alone does not authorize mutations): ${JSON.stringify(messageResourceReferences)}`;

    if (messageArtifactReferences.length > 0) {
      const refsText = messageArtifactReferences.map((reference, index) => `Referencia de artifact ${index + 1}: @${reference.kind} "${reference.title}" (id: ${reference.id})`).join('\n');
      content = `${content}\n\n${refsText}`;
      setArtifactReferences([]);
    }
    const messageComputerContext = mobileRequestId?null:computerContext;
    if (messageComputerContext) {
      content = `${content}\n\nContexto de Computer Use: acción "${messageComputerContext.action}" en la ventana "${messageComputerContext.title || 'desconocida'}", coordenadas de pantalla (${messageComputerContext.x}, ${messageComputerContext.y}), handle ${messageComputerContext.handle || 'n/d'}, proceso ${messageComputerContext.processId || 'n/d'}. Usá este contexto para guiar la próxima acción y verificá el estado real.`;
      setComputerContext(null);
    }
    const messageBrowserReferences = mobileRequestId?[]:browserReferences;
    if (messageBrowserReferences.length > 0) {
      const refsText = messageBrowserReferences
        .map((ref, idx) => `Referencia ${idx + 1}: @${ref.title}\nContenido seleccionado:\n${ref.text}`)
        .join('\n\n');
      content = `${content}\n\n${refsText}`;
      setBrowserReferences([]);
    }
    if (messageSelectedTextReferences.length > 0) {
      const refsText = messageSelectedTextReferences
        .map((ref) => `${ref.comment ? `Comentario sobre el texto seleccionado:\n${ref.comment}\n\n` : ''}Texto seleccionado:\n${ref.text}`)
        .join('\n\n');
      content = `${content}${content.trim() ? '\n\n' : ''}${refsText}`;
      setSelectedTextReferences([]);
    }
    const abortController = new AbortController();
    let pluginMcpClose: (() => Promise<unknown>) | undefined;
    const generationStartedAt = Date.now();
    let chat = activeChatRef.current;
    if (!chat) {
      const projectPath = activeProject?.projectPath || '';
      const projectName = activeProject?.name || 'Proyecto';
      chat = { chatId: `${projectPath ? 'project' : 'global'}-${Date.now()}`, projectPath, projectName };
      activeChatRef.current = chat;
      setActiveChat(chat);
      if (projectPath) {
        const projectMeta: ProjectMeta = await readProjectMeta(projectPath) || { name: projectName, path: projectPath, created_at: new Date().toISOString(), chats: [] };
        if (!projectMeta.chats.some((item) => item.id === chat?.chatId)) projectMeta.chats.push({ id: chat.chatId, name: 'Nuevo chat', customName: false });
        await writeProjectMeta(projectPath, projectMeta);
        window.dispatchEvent(new CustomEvent('codeclub:project-meta-changed', { detail: { projectPath } }));
      } else {
        const globalChats = await readGlobalChats();
        globalChats.push({ id: chat.chatId, name: 'Nuevo chat', customName: false, projectPath: '', projectName: 'Sin proyecto' });
        await writeGlobalChats(globalChats);
        window.dispatchEvent(new CustomEvent('codeclub:global-chat-changed'));
      }
    }
    const chatId = chat.chatId;
    if (!replaceHistory && (window as any).codeclub?.chatPage) {
      const latest = await (window as any).codeclub.chatPage(chat.projectPath,chatId,undefined,80);
      baseMessages=latest.messages;
      if(activeChatRef.current?.chatId===chatId&&activeChatRef.current?.projectPath===chat.projectPath) historyWindow.restore(chat,baseMessages);
    }
    let runId: string | undefined;
    try { await (window as any).codeclub?.sessionSelect?.(chat);runId=await (window as any).codeclub?.sessionClaim?.(chat); }
    catch { if(!mobileRequestId)setInput(visibleContent); return; }
    const runtime: ChatRuntime = { runId, controller: abortController, state: 'connecting', tool: '', startedAt: generationStartedAt, messages: [], pendingApprovals: [], approvalResolvers: new Map(), approvalTimers:new Map() };
    chatRuntimesRef.current.set(chatId, runtime);
    runtime.expectedTotal=historyWindow.range.current.total;
    abortControllerRef.current = abortController;
    approvalResolversRef.current = runtime.approvalResolvers;
    const isCurrentGeneration = () => !abortController.signal.aborted && chatRuntimesRef.current.get(chatId)?.controller === abortController;
    const isVisibleGeneration = () => isCurrentGeneration() && activeChatRef.current?.chatId === chatId;
    let lastPublish=0;
    let lastStatus='';
    const publishRuntime = () => {
      window.dispatchEvent(new CustomEvent('codeclub:agent-activity', { detail: { chatId, state: runtime.state, tool: runtime.tool, agent: 'Desarrollo' } }));
      const status=`${runtime.state}|${runtime.tool}|${runtime.pendingApprovals.map(item=>item.id).join(',')}`;
      if(runId && (status!==lastStatus || Date.now()-lastPublish>=100)){
        lastStatus=status;lastPublish=Date.now();void (window as any).codeclub?.sessionPublish?.(chat,runId,{state:runtime.state,tool:runtime.tool,busy:true,messages:runtime.messages,approvals:runtime.pendingApprovals})?.catch(()=>undefined);
      }
    };
    runtime.publish=publishRuntime;
    const guardedSetAgentState = (state: string) => {
      if (!isCurrentGeneration()) return;
      runtime.state = state;
      publishRuntime();
      if (isVisibleGeneration()) setAgentState(state);
    };
    const guardedRequestToolApproval = ({ toolName, input, summary }: { toolName: string; input: any; summary: string }): Promise<boolean> => {
      if (!isCurrentGeneration()) return Promise.resolve(false);
      const approvalId = crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`;
      const approval = { id: approvalId, toolName, summary: summary || `${toolName} · ${String(input?.command||input?.path||input?.url||compactJson(input)).slice(0,300)}`, expiresAt:Date.now()+120000 };
      runtime.state = 'approval';
      runtime.pendingApprovals = [...runtime.pendingApprovals, approval];
      publishRuntime();
      if (isVisibleGeneration()) {
        setAgentState('approval');
        setPendingApprovals(runtime.pendingApprovals);
      }
      return new Promise<boolean>((resolve) => {
        runtime.approvalResolvers.set(approvalId,resolve);
        runtime.approvalTimers?.set(approvalId,setTimeout(()=>{
          runtime.approvalResolvers.delete(approvalId);runtime.approvalTimers?.delete(approvalId);
          runtime.pendingApprovals=runtime.pendingApprovals.filter(item=>item.id!==approvalId);
          if(isVisibleGeneration())setPendingApprovals(runtime.pendingApprovals);
          publishRuntime();resolve(false);
        },120000));
      });
    };

    if (shouldRenameChat) window.dispatchEvent(new CustomEvent('codeclub:chat-created', { detail: { chatId: chat.chatId } }));

    let attachmentParts: Awaited<ReturnType<typeof readAttachmentParts>> = [];
    try {attachmentParts = attachments.length > 0 ? await readAttachmentParts(attachments) : [];}
    catch {
      chatRuntimesRef.current.delete(chatId);abortControllerRef.current=null;
      if(!mobileRequestId)setInput(visibleContent);setAttachmentError(true);setIsStreaming(false);
      if(runId)await (window as any).codeclub?.sessionPublish?.(chat,runId,{state:'error',tool:'',busy:false,messages:baseMessages,approvals:[]})?.catch(()=>undefined);
      return;
    }
    const pendingAskUser = [...baseMessages].reverse().flatMap((message) => message.role === 'assistant' ? (message.tools || []) : []).find((event: any) => event.name === 'askUser' && event.output?.status === 'awaiting_user' && !event.answer);
    const resolvedAskUserId = resumeAskUserId || pendingAskUser?.id;
    const contextualBaseMessages = resolvedAskUserId
      ? baseMessages.map((message) => message.role === 'assistant' && message.tools?.some((event: any) => event.id === resolvedAskUserId)
        ? { ...message, tools: message.tools.map((event: any) => event.id === resolvedAskUserId ? { ...event, answer: visibleContent } : event) }
        : message)
      : baseMessages;
    const userMessage = { ...(mobileRequestId?{mobileRequestId}:{}), historyIndex: (baseMessages[0]?.historyIndex??historyWindow.range.current.start)+baseMessages.length, role: 'user', content, resourceReferences: messageResourceReferences, displayContent: resumeAskUserId ? '' : visibleContent, createdAt: Date.now(), hidden: Boolean(resumeAskUserId), artifactReferences: messageArtifactReferences, browserReferences: messageBrowserReferences, selectedTextReferences: messageSelectedTextReferences, computerContext: messageComputerContext, attachments: attachments.map(({ path, name, mediaType, size, previewUrl }) => ({ path, name, mediaType, size, previewUrl })) };
    const newMessages = [...contextualBaseMessages, userMessage];
    const pendingAssistant = { role: 'assistant', content: '', timeline: [], tools: [], agentName: 'Desarrollo' };
    runtime.messages = [...newMessages, pendingAssistant];
    shouldAutoScrollMessagesRef.current = true;
    setComposerDocked(true);
    setMessages(runtime.messages);
    setInput('');
    if (chatInputRef.current) chatInputRef.current.style.height = '22px';
    setIsStreaming(true);
    agentStartedAtRef.current = Date.now();
    setAgentState('connecting');
    publishRuntime();

    try {
    if (replaceHistory) {
      await writeChatJsonl(newMessages, chat);
    } else {
      await appendToJsonl(userMessage, chat);
    }

      if (!currentProvider || !currentModel) {
        throw new Error('Elegí un proveedor y un modelo antes de enviar.');
      }

      const useGateway = usesGateway(currentProvider, currentModel);
      const credentialKey = credentialKeyFor(currentProvider, currentModel);
      let apiKey = await getSetting(credentialKey, '');

      const requiresCredential = useGateway || currentProvider.requiresApiKey !== false;
      if ((!apiKey || apiKey === 'dummy-key') && currentProvider.id !== 'custom' && requiresCredential) {
        setCredentialProvider(credentialTargetFor(currentProvider, currentModel));
        setCredentialInput('');
        setCommandKind('credential');
        setMenuOpen(true);
        window.setTimeout(() => credentialInputRef.current?.focus(), 0);
        throw new Error(`API Key no configurada para ${useGateway ? 'AI Gateway' : currentProvider.label || currentProvider.id}. Por favor agregala en la configuración.`);
      }

      const selectedModelReference = modelIdFor(currentProvider, currentModel);
      if (!useGateway && !currentProvider.api) throw new Error('El catálogo no indica un endpoint compatible para este proveedor.');
      const configuredHeaders = await getSetting<Record<string, string>>(`codeclub_provider_headers_${currentProvider.id}`, {});
      const requestHeaders: Record<string, string> = { 'user-agent': 'Codeclub', 'x-codeclub-session': chat.chatId };
      for (const [name, value] of Object.entries(configuredHeaders)) {
        if (typeof value === 'string' && /^[a-z0-9-]+$/i.test(name) && !['authorization', 'cookie', 'host'].includes(name.toLowerCase())) requestHeaders[name] = value.replaceAll('${chatId}', chat.chatId);
      }
      const provider = useGateway ? createGateway({ apiKey: apiKey || undefined, fetch:desktopModelFetch }) : currentProvider.id === 'google' ? createGoogle({
        name: 'google',
        baseURL: currentProvider.api,
        apiKey,
        headers: requestHeaders,
        fetch: desktopModelFetch,
      }) : createOpenAICompatible({
        name: currentProvider.id,
        baseURL: currentProvider.api,
        apiKey,
        headers: requestHeaders,
        fetch: desktopModelFetch,
      });
      const contextProjectPath = activeProject?.projectPath || '';
      const runMode: AgentMode = 'development';
      let routeSpecialist: AgentSpecialist = 'primary';
      let assistantContent = '';
      const assistantBoundaries: number[] = [];
      const assistantBubbles = (message: any) => {
        const offsets = [...new Set([0, ...assistantBoundaries])].filter(offset => offset < message.content.length);
        return offsets.length < 2 ? [message] : offsets.map((offset, index) => ({ ...message, content: message.content.slice(offset, offsets[index + 1]).trim(), ...(index < offsets.length - 1 ? { tools: [], timeline: [], reasoning: '', progress: '', meta: undefined } : {}) }))
          .filter((bubble, index, bubbles) => index === bubbles.length - 1 || bubble.content.length > 0)
          .map((bubble, index) => ({ ...bubble, historyIndex: userMessage.historyIndex + 1 + index }));
      };
      let assistantReasoning = '';
      let assistantProgress = '';
      let assistantTools: any[] = [];
      let assistantTimeline: any[] = [];
      let executionStartedAt = Date.now();
      let latestUsage: any = null;
      let modelCalls: any[] = [];
      let executionSequence = 0;
      const executionCallQueues = new Map<string, string[]>();
      let assistantUpdateFrame: number | null = null;
      const updateAssistantMessage = () => {
        runtime.messages = [...newMessages, ...assistantBubbles({ role: 'assistant', content: assistantContent, reasoning: assistantReasoning, progress: assistantProgress, timeline: assistantTimeline, tools: assistantTools, agentName: 'Desarrollo', meta: { modelCalls } })];
        if (isVisibleGeneration()) setMessages(runtime.messages);
        publishRuntime();
      };
      const scheduleAssistantMessageUpdate = () => {
        if (assistantUpdateFrame !== null) return;
        assistantUpdateFrame = window.requestAnimationFrame(() => {
          assistantUpdateFrame = null;
          updateAssistantMessage();
        });
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
        }
      };
      const orbBrowserOnly = Boolean(agentOrb && agentOrb.allowComputer === false);
      if (agentOrb?.requiresAdministrator && !orbBrowserOnly && !(await invoke<{ elevated: boolean }>('codeclub_admin_status')).elevated) throw new Error('TASK_ADMIN_REQUIRED');
      const toolProjectPath = contextProjectPath || await invoke<string>('codeclub_get_system_root');
      const developmentTools = createTools({
        chatId,
        projectPath: toolProjectPath,
        projectScoped: Boolean(contextProjectPath),
        recordToolEvent,
        setAgentState: guardedSetAgentState,
        // Orb tool approval is enforced by the outer wrapper below.
        requestToolApproval: agentOrb ? () => Promise.resolve(true) : guardedRequestToolApproval,
        provider,
        modelId: selectedModelReference,
        providerId: currentProvider.id,
      });
      const externalMcpTools: Record<string, any> = {};
      let loadedPlugins: Awaited<ReturnType<typeof loadAgentPlugins>> = [];
      try {
        loadedPlugins = orbBrowserOnly ? [] : await loadAgentPlugins(contextProjectPath);
        const pluginMcp = await connectAllAgentPluginMcp(loadedPlugins);
        Object.assign(externalMcpTools, pluginMcp.tools);
        pluginMcpClose = pluginMcp.close;
      } catch (error) {
        console.warn('No se pudieron cargar los plugins Agent Plugins:', error);
      }
      let tools: Record<string, any> = {};
      let beforeWorkspaceSnapshot: WorkspaceSnapshot = new Map();
      routeSpecialist = inferAgentSpecialist(content, runMode);
      const selectedToolset = Object.fromEntries(Object.entries(developmentTools).filter(([name]) => !['swarm', 'subagent', 'listAvailableTools'].includes(name)));
      const browserTools = new Set(['openBrowser', 'getBrowserState', 'browserAction', 'askUser']);
      const readOnlyTools = new Set(['listFiles', 'readFile', 'searchText', 'getTaskStatus', 'getExecutionLog', 'getBrowserState', 'androidListDevices', 'androidGetState', 'androidScreenshot', 'askUser']);
      const availableToolset = Object.fromEntries(Object.entries({ ...selectedToolset, ...externalMcpTools }).filter(([name]) => !orbBrowserOnly || browserTools.has(name)).map(([name, definition]: [string, any]) => [name, !agentOrb ? definition : { ...definition, execute: async (input: any, options: any) => {
        if (!agentOrb.maximumAutonomy && !readOnlyTools.has(name) && !await guardedRequestToolApproval({ toolName: name, input, summary: name })) return { cancelled: true };
        return definition.execute(input, options);
      } }]));
      const searchChatContext = async (query: string, page: number, pageSize: number) => {
        const normalized = query.toLowerCase().trim();
        const sources: Array<{ id: string; title: string; project: string; projectPath?: string; chatId: string }> = [];
        const globalChats = await readGlobalChats();
        sources.push(...globalChats.map((item) => ({ id: `global:${item.id}`, title: item.name, project: item.projectName || 'Sin proyecto', chatId: item.id })));
        if (contextProjectPath) {
          const meta = await readProjectMeta(contextProjectPath);
          sources.push(...(meta?.chats || []).map((item) => ({ id: `project:${item.id}`, title: item.customName ? item.name : item.name || 'Chat', project: meta?.name || 'Proyecto activo', projectPath: contextProjectPath, chatId: item.id })));
        }
        const matches = [];
        for (const source of sources) {
          const messages = (window as any).codeclub?.chatSearch ? (await (window as any).codeclub.chatSearch(source.projectPath||'',source.chatId,normalized)).map((content:string)=>({content})) : source.projectPath ? await readProjectChatHistory(source.projectPath, source.chatId) : await readGlobalChatHistory(source.chatId);
          const excerpts = messages.map((message: any) => String(message?.displayContent || message?.content || '')).filter((text: string) => !normalized || text.toLowerCase().includes(normalized));
          if (normalized && !source.title.toLowerCase().includes(normalized) && excerpts.length === 0) continue;
          matches.push({ id: source.id, title: source.title, project: source.project, excerpts: excerpts.slice(-2).map((text: string) => text.slice(0, 500)) });
        }
        const start = (Math.max(page, 1) - 1) * pageSize;
        return { query, page: Math.max(page, 1), pageSize, total: matches.length, hasMore: start + pageSize < matches.length, results: matches.slice(start, start + pageSize) };
      };
      const dynamicToolAccess = createDynamicToolAccess(availableToolset, recordToolEvent, { plugins: loadedPlugins, searchChatContext });
      const artifactNames = ['createPlan', 'updatePlan', 'todo', 'getTaskStatus', 'switchProject'];
      const artifactTools = Object.fromEntries(artifactNames.filter((name) => availableToolset[name]).map((name) => [name, availableToolset[name]]));
      // MCP definitions stay in the searchable catalog and become callable only after discovery.
      tools = { ...dynamicToolAccess, ...artifactTools };
      const routedToolset = tools;
      window.dispatchEvent(new CustomEvent('codeclub:agent-route', { detail: { mode: runMode, specialist: routeSpecialist, confidence: 1, reason: 'Una única IA ejecuta directamente las tools necesarias.' } }));
      try {
        const routing = await resolveToolsWithAI({
          model: provider(selectedModelReference),
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
        void appendExecutionLog({ projectPath: contextProjectPath, chatId: chat?.chatId, tool: 'tool-router', input: { mode: runMode, specialist: routeSpecialist, prompt: content }, output: { confidence: routing.confidence, reason: routing.reason, requiresAction: routing.requiresAction, tools: Object.keys(tools) } });
      } catch (error) {
        const fallbackTools = selectToolsForPrompt(routedToolset, runMode, content);
        tools = {
          ...fallbackTools,
          searchTools: dynamicToolAccess.searchTools,
          executeTool: dynamicToolAccess.executeTool,
        };
        void appendExecutionLog({ projectPath: contextProjectPath, chatId: chat?.chatId, tool: 'tool-router', input: { mode: runMode, specialist: routeSpecialist, prompt: content }, output: { status: 'fallback-deterministic', error: String(error), tools: Object.keys(tools) } });
      }
      tools = {
        ...tools,
        reportProgress: tool({
          description: 'Show a short, user-facing status of the current task or phase. Call before substantial work and when the phase changes. This is a concise progress label, not private reasoning.',
          inputSchema: jsonSchema<any>({ type: 'object', properties: { summary: { type: 'string', minLength: 2, maxLength: 120, description: 'A brief natural-language phrase describing what you are doing, in the user\'s language.' } }, required: ['summary'], additionalProperties: false }),
          execute: async ({ summary }: { summary: string }) => {
            assistantProgress = String(summary || '').replace(/\s+/g, ' ').trim().slice(0, 120);
            assistantTimeline = [...assistantTimeline, { type: 'progress', id: crypto.randomUUID(), text: assistantProgress }];
            updateAssistantMessage();
            return { ok: true, summary: assistantProgress };
          },
        }),
      };
      beforeWorkspaceSnapshot = orbBrowserOnly ? new Map() : await readWorkspaceSnapshot(toolProjectPath);
      updateAssistantMessage();
      const system = [
        'You are Codeclub\'s coding agent. Think and operate internally in English. On demand, discover and use tools, skills, plugins, and prior chat context. Before substantial coding tasks, search for a relevant engineering skill and load it when it clearly applies. Verify real results; never invent. Reply in the user\'s language.',
        activeSkills.length ? `The user activated these skills for this session. Follow their relevant workflow while respecting the user's request and project instructions:\n\n${activeSkills.map((skill) => `## ${skill.name}\n\n${skill.content}`).join('\n\n')}` : '',
        'For substantial work, call reportProgress before starting and when moving to a new phase. Use one brief user-facing phrase in the user\'s language (for example, "Inspecting the project" or "Implementing the selected text actions"). These are progress updates, not chain-of-thought; never reveal private reasoning. Do not call it for routine short answers.',
        activeExtensions.length ? `The user selected these built-in extensions for this session: ${activeExtensions.map(extension => `${extension.name}: ${extension.instruction}`).join('\n')}` : '',
        'Codeclub resource management: discover exact targets with listResources. Use createExtension/createSkill/createMcpServer for new packages; editPluginResource for existing manifests or skills; deleteSkill removes only a skill; manageMcpServer updates/removes only the named server; manageOrb handles global orbs. Preserve unrelated resources and scopes. Built-in resources are read-only; create a personal copy when needed. Selected references identify targets but are not requests to mutate them.',
      ].filter(Boolean).join(' ');
      // Some compatible providers reject response_format when tools are enabled.
      // Artifact tools already validate and persist their output, so require JSON
      // only for responses that do not execute tools.
      const structuredOutput = Object.keys(tools).length === 0 ? getArtifactOutputConfig(content) : null;
      let structuredArtifactOutput: any = null;

      const runAssistant = async (retryInstruction = '') => {
        assistantBoundaries.length = 0;
        assistantContent = '';
        assistantReasoning = '';
        assistantTools = [];
        if (!retryInstruction) assistantTimeline = [];
        structuredArtifactOutput = null;
        executionStartedAt = Date.now();
        guardedSetAgentState('streaming');
        updateAssistantMessage();
        const storedContext = (window as any).codeclub?.chatContext ? await (window as any).codeclub.chatContext(chat.projectPath,chatId) : null;
        const contextualMessages = buildChatContext(storedContext?.messages || newMessages,storedContext?.summary||'',currentModel.contextWindow);
        const executionMessages: any[] = retryInstruction ? [...contextualMessages, { role: 'user', content: `${retryInstruction}\n\nUse a different strategy or tool sequence; do not repeat the same failed call.` }] : contextualMessages;
        return runStream({
          maxSteps: 128,
          model: provider(selectedModelReference),
          contextWindow:currentModel.contextWindow,
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
            onAssistantMessageStart: offset => { assistantBoundaries.push(offset); },
            onTextDelta: (content) => {
              if (!isCurrentGeneration()) return;
              assistantContent = content;
              scheduleAssistantMessageUpdate();
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
            onModelCall: (metrics) => {
              if (!isCurrentGeneration()) return;
              modelCalls = [...modelCalls.filter(call => call.callId !== metrics.callId), metrics];
              void appendExecutionLog({ projectPath: contextProjectPath, chatId: chat?.chatId, tool: `generation.model.${metrics.status}`, input: { callId: metrics.callId, stepNumber: metrics.stepNumber, attempt: metrics.attempt }, output: metrics });
              updateAssistantMessage();
            },
            onStepEnd: ({ stepNumber, finishReason, toolCalls, usage, performance }) => {
              if (!isCurrentGeneration()) return;
              void appendExecutionLog({
                projectPath: contextProjectPath,
                chatId: chat?.chatId,
                tool: 'generation.step',
                input: { stepNumber, tools: (toolCalls || []).map((toolCall: any) => toolCall.toolName) },
                output: { finishReason, usage, performance: { stepTimeMs: performance?.stepTimeMs, responseTimeMs: performance?.responseTimeMs, timeToFirstOutputMs: performance?.timeToFirstOutputMs, toolExecutionMs: performance?.toolExecutionMs, outputTokensPerSecond: performance?.outputTokensPerSecond } },
              });
            },
            onToolExecutionStart: ({ callId, toolCall }) => {
              if (!isCurrentGeneration()) return;
              const name = toolCall?.toolName || 'tool';
              if (name === 'reportProgress') {
                runtime.tool = '';
                publishRuntime();
                if (isVisibleGeneration()) setActiveToolName('');
                return;
              }
              const innerToolName = name === 'executeTool' ? toolCall?.input?.name : name;
              if (String(innerToolName || '').startsWith('computer')) setComputerUseActive(true);
              const sourceCallId = callId || toolCall?.toolCallId || '';
              const eventKey = `${sourceCallId || 'tool'}:${++executionSequence}`;
              const queueKey = `${sourceCallId}|${name}`;
              executionCallQueues.set(queueKey, [...(executionCallQueues.get(queueKey) || []), eventKey]);
              const nextEvent = { id: eventKey, callId: eventKey, sourceCallId, name, input: toolCall?.input || {}, output: { status: 'running' }, startedAt: Date.now(), durationMs: null, at: new Date().toISOString() };
              assistantTools = [...assistantTools, nextEvent];
              assistantTimeline = [...assistantTimeline, { type: 'tool', id: nextEvent.id, name, input: nextEvent.input, status: 'running' }];
              runtime.tool = name;
              publishRuntime();
              if (isVisibleGeneration()) setActiveToolName(String(innerToolName || name));
              updateAssistantMessage();
              void appendExecutionLog({ projectPath: contextProjectPath, chatId: chat?.chatId, tool: 'tool.execution.start', input: { callId: eventKey, sourceCallId, toolCallId: toolCall?.toolCallId, toolName: toolCall?.toolName, input: toolCall?.input }, output: { status: 'started' } });
            },
            onToolExecutionEnd: ({ callId, toolCall, toolExecutionMs, toolOutput }) => {
              if (!isCurrentGeneration()) return;
              if (toolCall?.toolName === 'reportProgress') return;
              const toolResult = toolOutput?.output ?? toolOutput?.result ?? toolOutput;
              const toolStatus = toolOutput?.type === 'tool-result' && toolResult?.ok !== false ? 'completed' : 'error';
              const sourceCallId = callId || toolCall?.toolCallId || '';
              const name = toolCall?.toolName || 'tool';
              const queueKey = `${sourceCallId}|${name}`;
              const queuedKeys = executionCallQueues.get(queueKey) || [];
              const eventKey = queuedKeys.shift() || '';
              if (queuedKeys.length) executionCallQueues.set(queueKey, queuedKeys); else executionCallQueues.delete(queueKey);
              if (eventKey) {
                const output = toolOutput?.type === 'tool-result' ? toolResult : { ok: false, error: String(toolOutput?.error?.message || toolOutput?.error || 'TOOL_EXECUTION_FAILED').slice(0, 4000), errorType: toolOutput?.error?.name || 'Error' };
                assistantTools = assistantTools.map((event) => event.callId === eventKey ? { ...event, output, durationMs: toolExecutionMs } : event);
                const toolEvent = assistantTools.find((event) => event.callId === eventKey);
                if (toolEvent) assistantTimeline = assistantTimeline.map((event) => event.id === toolEvent.id ? { ...event, status: toolStatus, output, durationMs: toolExecutionMs } : event);
              }
              updateAssistantMessage();
              void appendExecutionLog({ projectPath: contextProjectPath, chatId: chat?.chatId, tool: 'tool.execution.end', input: { callId: eventKey || `${sourceCallId}:unmatched`, sourceCallId, toolCallId: toolCall?.toolCallId, toolName: toolCall?.toolName }, output: { durationMs: toolExecutionMs, status: toolStatus } });
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
                if (isVisibleGeneration()) setActiveToolName('');
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
      assistantContent = await runAssistant();
      const structuredSummary = formatArtifactOutput(structuredArtifactOutput);
      if (structuredSummary) assistantContent = structuredSummary;
      if (!abortController.signal.aborted && !assistantContent?.trim()) {
        const toolFallback = formatToolExecutionFallback(runMode, routeSpecialist, assistantTools);
        if (toolFallback) assistantContent = toolFallback;
        else {
          guardedSetAgentState('streaming');
          assistantContent = await runAssistant();
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
        assistantContent = await runAssistant(`Continuá el swarm ${activeSwarmName || 'activo'} existente con los hijos ${JSON.stringify(activeChildNames)}. No uses spawn: comunicá, esperá y luego ejecutá merge o stop. Evidencias: ${JSON.stringify(evidence).slice(0, 3000)}`);
        const retryStructuredSummary = formatArtifactOutput(structuredArtifactOutput);
        if (retryStructuredSummary) assistantContent = retryStructuredSummary;
        const continuationActions = assistantTools.filter((event) => event.name === 'swarm').map((event) => event.input?.action).filter(Boolean);
        if (continuationActions.includes('merge') || continuationActions.includes('stop')) swarmOpen = false;
      }

      if (!isCurrentGeneration() || abortController.signal.aborted) return;
      const changes = contextProjectPath ? summarizeWorkspaceDelta(beforeWorkspaceSnapshot, await readWorkspaceSnapshot(toolProjectPath)) : null;
      const { summary: turnSummary } = await generateTurnSummary({ model: provider(selectedModelReference) as any, request: visibleContent || content, response: assistantContent, language, signal: abortController.signal, projectPath: contextProjectPath || '', chatId, providerId: currentProvider.id, modelId: currentModel.id });
      if (!isCurrentGeneration()) return;
      const assistantMessage = { turnSummary, historyIndex: userMessage.historyIndex+1, role: 'assistant', content: assistantContent || 'La ejecución terminó sin texto final, pero las evidencias quedaron registradas.', progress: assistantProgress, timeline: assistantTimeline, tools: assistantTools, agentName: 'Desarrollo', meta: { modelCalls, provider: currentProvider.label || currentProvider.id, model: currentModel.label || currentModel.id, durationMs: Date.now() - executionStartedAt, status: 'completed', changes, usage: latestUsage ? { inputTokens: latestUsage.inputTokens, outputTokens: latestUsage.outputTokens, totalTokens: latestUsage.totalTokens, reasoningTokens: latestUsage.reasoningTokens } : null } };
      if (assistantUpdateFrame !== null) {
        window.cancelAnimationFrame(assistantUpdateFrame);
        assistantUpdateFrame = null;
      }
      // The stream already displays the response progressively. Keep its final
      // content so a state change cannot leave an empty bubble if animation stops.
      runtime.messages = [...newMessages, ...assistantBubbles(assistantMessage)];
      if (isVisibleGeneration()) setMessages(runtime.messages);
      if (toolStateTimerRef.current) {
        clearTimeout(toolStateTimerRef.current);
        toolStateTimerRef.current = null;
      }
      runtime.state = 'idle';
      runtime.tool = '';
      publishRuntime();
      if (isVisibleGeneration()) {
        setActiveToolName('');
      }
      const persistencePromise = replaceHistory
        ? writeChatJsonl([...newMessages, ...assistantBubbles(assistantMessage)], chat)
        : (async () => { for (const bubble of assistantBubbles(assistantMessage)) await appendToJsonl(bubble, chat); })();
      await persistencePromise;
      if (turnSummary) window.dispatchEvent(new CustomEvent('codeclub:rename-chat', { detail: { chatId: chat.chatId, projectPath: chat.projectPath, newName: turnSummary, automatic: true } }));
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
        if (last?.role === 'assistant') {
          const userFacingError = wasCancelled
            ? (language === 'en' ? 'Generation cancelled.' : 'Generación cancelada.')
            : userFacingProviderError(error, language);
          updated[updated.length - 1] = {
            ...last,
            content: last.content || userFacingError,
            meta: {
              ...last.meta,
              provider: currentProvider?.label || currentProvider?.id || 'Proveedor',
              model: currentModel?.label || currentModel?.id || 'Modelo',
              durationMs: Date.now() - generationStartedAt,
              status: wasCancelled ? 'cancelled' : 'error',
              errorName: error instanceof Error ? error.name : 'Error',
              configuration: (error instanceof Error ? error.message : String(error)).includes('API Key no configurada'),
              errorMessage: userFacingError,
            },
          };
        }
        return updated;
      };
      runtime.messages = updateErrorMessages(runtime.messages);
      if (activeChatRef.current?.chatId === chatId) setMessages(runtime.messages);
      try {
        if (!(error instanceof Error && error.message.includes('CHAT_HISTORY_CONFLICT'))) await writeChatJsonl(runtime.messages, chat);
      } catch (persistenceError) {
        console.error('No se pudo guardar el error del proveedor en el historial:', persistenceError);
      }
    } finally {
      if (pluginMcpClose) await pluginMcpClose().catch(() => undefined);
      if (chatRuntimesRef.current.get(chatId)?.controller !== abortController) return;
      if (toolStateTimerRef.current) {
        clearTimeout(toolStateTimerRef.current);
        toolStateTimerRef.current = null;
      }
      if (abortControllerRef.current === abortController) abortControllerRef.current = null;
      runtime.pendingApprovals = [];
      runtime.approvalTimers?.forEach(timer=>clearTimeout(timer));
      runtime.approvalTimers?.clear();
      runtime.approvalResolvers.clear();
      const awaitingAnswer=runtime.messages.some(message=>message.tools?.some((tool:any)=>tool.name==='askUser'&&tool.output?.status==='awaiting_user'&&!tool.answer));
      if(runId)await (window as any).codeclub?.sessionPublish?.(chat,runId,{state:abortController.signal.aborted?'cancelled':runtime.state==='error'?'error':awaitingAnswer?'question':'finished',tool:'',busy:false,messages:runtime.messages,approvals:[]})?.catch(()=>undefined);
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
    if (!controller) {const chat=activeChatRef.current;if(chat)void (window as any).codeclub?.sessionCommand?.(chat,'cancel');return;}
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
    let unlistenNative: (() => void) | undefined;
    void safeListen('codeclub-computer-escape', () => {
      if (computerUseActive) cancelGeneration();
    }).then((dispose) => { unlisten = dispose; });
    const nativeEscape = (window as any).codeclub?.onComputerEscape;
    if (typeof nativeEscape === 'function') unlistenNative = nativeEscape(() => { if (computerUseActive) cancelGeneration(); });
    window.addEventListener('keydown', handleComputerEscape);
    return () => {
      window.removeEventListener('keydown', handleComputerEscape);
      unlisten?.();
      unlistenNative?.();
    };
  }, [computerUseActive]);

  useEffect(() => {
    const listener = (payload: any) => setComputerContext(payload?.action ? payload : null);
    const subscribe = (window as any).codeclub?.onComputerContext;
    if (typeof subscribe !== 'function') return undefined;
    return subscribe(listener);
  }, []);

  useEffect(() => {
    const detail = {
      active: computerUseActive,
      provider: currentProvider?.label || currentProvider?.id || defaultProvider?.label || defaultProvider?.id || 'Codeclub',
      language,
    };
    window.dispatchEvent(new CustomEvent('codeclub:computer-overlay-set', { detail }));
    void (window as any).codeclub?.setComputerOverlay?.({ active: computerUseActive, language, paletteIndex: orbPaletteIndex });
  }, [computerUseActive, currentProvider, defaultProvider, language, orbPaletteIndex]);

  useEffect(() => () => {
    if (visualAnimationRef.current) clearInterval(visualAnimationRef.current);
  }, []);

  const dismissAgentTextSelection = () => {
    setAgentTextSelection(null);
    setSelectionCommentOpen(false);
    setSelectionComment('');
    window.getSelection()?.removeAllRanges();
  };
  const addSelectedTextToChat = (comment = '') => {
    if (!agentTextSelection) return;
    setSelectedTextReferences((current) => [...current, { id: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`, text: agentTextSelection.text, ...(comment.trim() ? { comment: comment.trim() } : {}) }]);
    setComposerDocked(true);
    dismissAgentTextSelection();
    requestAnimationFrame(() => chatInputRef.current?.focus());
  };
  const askForMoreDetails = () => {
    if (!agentTextSelection || isAgentBusy) return;
    const selectedText = agentTextSelection.text.split(/\r?\n/).map((line) => `> ${line}`).join('\n');
    const prompt = `${agentTextSelectionTranslations[language].detailPrompt}\n\n${selectedText}`;
    dismissAgentTextSelection();
    void sendMessage(prompt, messages, false);
  };

  const mobileSendRef=useRef(sendMessage);mobileSendRef.current=sendMessage;
  useEffect(()=>{
    if(!activeChat||isAgentBusy||chatTransitionPhase!=='idle')return;
    let active=true,polling=false;
    // Claim mobile sends through the normal engine without replacing the desktop composer draft.
    const poll=async()=>{if(polling)return;polling=true;let item:any;try{item=await (window as any).codeclub?.mobileTake?.(activeChat);if(item&&active&&activeChatRef.current?.chatId===item.chat.chatId&&activeChatRef.current?.projectPath===item.chat.projectPath){await mobileSendRef.current(item.text,undefined,false,false,[],undefined,item.id);}}finally{if(item)await (window as any).codeclub?.mobileRelease?.(item.id);polling=false;}};
    const timer=window.setInterval(()=>void poll().catch(()=>undefined),1000);void poll().catch(()=>undefined);
    return()=>{active=false;window.clearInterval(timer);};
  },[activeChat,isAgentBusy,chatTransitionPhase]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (chatTransitionPhase === 'exiting' || chatTransitionPhase === 'loading') return;
    if ((!input.trim() && attachedFiles.length === 0 && browserReferences.length === 0 && selectedTextReferences.length === 0 && artifactReferences.length === 0 && !computerContext) || isAgentBusy) return;

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

  const handleCopyTrace = async () => {
    const chat = activeChatRef.current;
    if (!chat) return;
    const visibleMessages = [...messages];
    const rangeStart = historyWindow.range.current.start;
    try {
      const bridge = (window as any).codeclub;
      // Load the whole persisted chat on demand; the mounted window is bounded.
      const completeMessages = bridge?.chatAll ? await bridge.chatAll(chat.projectPath, chat.chatId)
        : chat.projectPath ? await readProjectChatHistory(chat.projectPath, chat.chatId) : await readGlobalChatHistory(chat.chatId);
      for (const [index, message] of visibleMessages.entries()) completeMessages[message.historyIndex ?? rangeStart + index] = message;
      const tracedMessages = completeMessages.map((message: any) => {
        if (message?.role !== 'assistant') return message;
        const tools = Array.isArray(message.tools) ? message.tools : [];
        const fileChanges = message.meta?.changes?.fileChanges || [];
        const hasActivity = Boolean(message.progress) || tools.length > 0 || (message.timeline || []).some((event: any) => event.type === 'tool') || fileChanges.length > 0;
        const components = ['MemoizedChatMarkdown'];
        if (hasActivity) components.push('TurnActivity');
        if (tools.some((event: any) => event.name === 'askUser')) components.push('AskUserCards');
        return {
          ...message,
          tracePresentation: {
            component: 'ChatInterface',
            source: 'src/components/ChatInterface.tsx',
            children: components,
            activity: hasActivity ? {
              component: 'TurnActivity',
              source: 'src/components/ChatInterface.tsx',
              props: ['progress', 'timeline', 'tools', 'meta.changes', 'active', 'language'],
              summary: { progress: message.progress || '', actionCount: tools.length, changedFiles: fileChanges.length, additions: message.meta?.changes?.additions ?? 0, deletions: message.meta?.changes?.deletions ?? 0 },
              contents: {
                actions: tools.map((event: any, index: number) => ({ id: event.id || event.callId || null, component: event.name, input: event.input ?? {}, outputPath: `tools.${index}.output`, status: event.output?.status || event.status || (event.output?.ok === false || event.output?.error || event.output?.code > 0 ? 'error' : 'completed'), durationMs: event.durationMs ?? null })),
                commands: tools.flatMap((event: any, index: number) => event.name === 'runCommand' ? [{ component: 'runCommand', toolIndex: index, command: [event.input?.command, ...(event.input?.args || [])].filter(Boolean).join(' '), outputPath: `tools.${index}.output`, displays: ['stdout', 'stderr', 'code'] }] : []),
                files: fileChanges,
              },
            } : null,
          },
        };
      });
      const trace = {
        schemaVersion: 2,
        capturedAt: new Date().toISOString(),
        chat: { id: chat.chatId, projectPath: chat.projectPath, name: chat.name || null },
        selection: { provider: currentProvider.id, model: currentModel?.id || null },
        presentation: { component: 'ChatInterface', source: 'src/components/ChatInterface.tsx', activityComponent: 'TurnActivity', activityStyles: 'src/app/globals.css (.turn-activity)' },
        messages: tracedMessages,
      };
      if (!await copyText(JSON.stringify(trace, null, 2))) return;
    } catch (error) {
      console.error('No se pudo copiar la trazabilidad:', error);
    }
  };

  const addAttachmentPaths = async (paths: string[]) => {
    setAttachmentError(false);
    setAttachmentProgress(`${activityTranslations[language].attaching} 0/${paths.length}`);
    let prepared=0;
    try {
    const attachments = await Promise.all(paths.map(async (path) => {
      const name = getAttachmentName(path);
      const mediaType = getAttachmentMediaType(path);
      let previewUrl: string | undefined;
      let previewText: string | undefined;
      if (mediaType.startsWith('image/')) {
        try {
          previewUrl = `data:${mediaType};base64,${bytesToBase64(await readDesktopFile(path))}`;
        } catch (error) {
          setAttachmentError(true);
          console.error(`No se pudo crear la preview de ${name}:`, error);
        }
      } else if (/\.(md|markdown|html?|css|scss|sass|less|js|mjs|cjs|jsx|ts|tsx|json|xml|yaml|yml|txt|csv|sql|py|rs|java|go|rb|php|sh|bat|ps1)$/i.test(name)) {
        try {
          previewText = (await readDesktopTextFile(path)).slice(0, 220);
        } catch (error) {
          setAttachmentError(true);
          console.error(`No se pudo leer la preview de ${name}:`, error);
        }
      }
      prepared++;setAttachmentProgress(`${activityTranslations[language].attaching} ${prepared}/${paths.length} · ${name}`);
      return { path, name, mediaType, previewUrl, previewText };
    }));
    setAttachedFiles((current) => {
      const next = [...current, ...attachments];
      return next.filter((file, index, list) => list.findIndex((item) => item.path === file.path) === index);
    });
    } finally { setAttachmentProgress(''); }
  };

  // Emitter: ProjectPanelView file tree (`codeclub:file-reference`, { path }). Consumer: composer attachments below; listener is removed with this effect.
  useEffect(() => {
    const handleFileReference = (event: Event) => {
      const path = (event as CustomEvent<{ path?: string }>).detail?.path;
      if (!path) return;
      void addAttachmentPaths([path]).then(() => requestAnimationFrame(() => chatInputRef.current?.focus()));
    };
    window.addEventListener('codeclub:file-reference', handleFileReference);
    return () => window.removeEventListener('codeclub:file-reference', handleFileReference);
  }, [language]);

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
          setArtifactReferences((current) => current.some((item) => item.kind === artifact.kind && item.id === artifact.id) ? current : [...current, { kind: artifact.kind, id: artifact.id, title: artifact.name }]);
          return;
        }
      } catch {
        // This is not an artifact reference; continue with native project files.
      }
    }
    const droppedFiles = Array.from(event.dataTransfer.files || []) as (File & { path?: string })[];
    const paths = droppedFiles.map((file) => (window as any).codeclub?.getPathForFile?.(file) || file.path).filter(Boolean) as string[];
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
                          aria-label={language === 'en' ? 'Clear search' : 'Limpiar búsqueda'}
                          onClick={() => setArtifactSearch((current) => ({ ...current, [kind]: '' }))}
                          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-0 bg-transparent p-0 text-[#999999] hover:bg-[var(--color-surface-5)] hover:text-[#eeeeee]"
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

  return (
    <div ref={chatPanelRef} role="region" aria-label={`Chat${activeChat?.name ? `: ${activeChat.name}` : ''}`} className={`chat-interface-container @container mx-auto flex h-full w-full max-w-[760px] min-w-0 flex-col ${floating ? 'gap-0' : 'gap-4'} overflow-visible px-3 pb-5`} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; }} onDrop={handleComposerDrop}>
      {agentTextSelection && createPortal(<div className="chat-selection-toolbar-wrap" style={{ top: agentTextSelection.top, left: agentTextSelection.left, '--selection-accent': palette.accent } as React.CSSProperties} onPointerDown={(event) => event.preventDefault()}>
        {!selectionCommentOpen && <div className="chat-selection-toolbar" role="toolbar" aria-label={agentTextSelectionTranslations[language].toolbar}>
          <button type="button" onClick={() => { setSelectionCommentOpen(true); setSelectionComment(''); }}>{agentTextSelectionTranslations[language].addToChat}</button>
          <span className="chat-selection-toolbar-divider" aria-hidden="true" />
          <button type="button" disabled={isAgentBusy} onClick={askForMoreDetails}>{agentTextSelectionTranslations[language].moreDetails}</button>
        </div>}
        {selectionCommentOpen && <form className="chat-selection-comment" onSubmit={(event) => { event.preventDefault(); addSelectedTextToChat(selectionComment); }}>
          <input autoFocus type="text" value={selectionComment} onChange={(event) => setSelectionComment(event.target.value)} placeholder={agentTextSelectionTranslations[language].commentPlaceholder} aria-label={agentTextSelectionTranslations[language].commentPlaceholder} onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); setSelectionCommentOpen(false); } }} />
          <button type="submit" aria-label={agentTextSelectionTranslations[language].addToChat} title={agentTextSelectionTranslations[language].addToChat}><ArrowUp size={16} strokeWidth={2} /></button>
        </form>}
      </div>, document.body)}
      {/* Conversation messages */}
      {historyWindow.loading && <div role="status" className="text-center text-[11px] text-(--codeclub-text-muted)">{chatHistoryTranslations[language].loading}</div>}
      {historyWindow.error && <div role="alert" className="flex items-center justify-center gap-2 text-[11px] text-(--codeclub-text-muted)">{chatHistoryTranslations[language].failed}<button type="button" onClick={()=>{const chat=activeChatRef.current;if(chat)void historyWindow.open(chat);}} className="text-(--codeclub-accent-bright)">{chatHistoryTranslations[language].retry}</button></div>}
      {!floating && historyWindow.range.current.start+messages.length<historyWindow.range.current.total && <button type="button" title={chatHistoryTranslations[language].latest} aria-label={chatHistoryTranslations[language].latest} className="self-end rounded-full p-1 text-(--codeclub-text-muted) hover:bg-(--codeclub-hover)" onClick={()=>{const chat=activeChatRef.current;if(chat){shouldAutoScrollMessagesRef.current=true;void historyWindow.open(chat);}}}><ChevronDown size={16}/></button>}
      <div className={`relative min-h-0 flex-1 ${composerDocked ? 'flex' : 'hidden'}`}>
        {!floating && showEmptyGreeting && <div data-chat-greeting className="pointer-events-none absolute inset-0 grid place-items-center px-5 text-center text-lg font-medium tracking-[-0.02em] text-(--codeclub-text-strong)">{chatText.greeting}, {username}?</div>}
      <motion.div ref={messagesAreaRef} initial={false} animate={chatAnimations} data-chat-transition={chatTransitionPhase} aria-busy={chatTransitionPhase !== 'idle' || historyWindow.loading || (isAgentBusy && pendingApprovals.length === 0 && agentState !== 'question')} onScroll={handleMessagesScroll} className={`messages-area relative min-h-0 min-w-0 flex-1 flex-col overflow-y-auto overscroll-contain [overflow-anchor:none] bg-transparent [scrollbar-width:none] ${composerDocked ? 'flex' : 'hidden'} ${chatTransitionPhase === 'idle' ? '' : 'pointer-events-none'}`} role="log" aria-label={language === 'en' ? 'Chat messages' : 'Mensajes del chat'} aria-live="polite" aria-relevant="additions text">
        <div aria-hidden="true" className="min-h-0 flex-1" />

        <div className="relative w-full shrink-0" style={virtualizeTurns ? { height: totalTurnHeight } : undefined}>
        {(virtualizeTurns ? turnVirtualizer.getVirtualItems() : turnIndexes.map((messageIndex, index) => ({ index, start: 0, key: `${activeChat?.projectPath || ''}:${activeChat?.chatId || 'new'}:${messages[messageIndex]?.historyIndex ?? messageIndex}` }))).map((virtualTurn) => {
          const turnIndex=turnIndexes[virtualTurn.index];
          const turnMessage=messages[turnIndex];
          const nextTurnIndex = turnIndexes[virtualTurn.index + 1] ?? messages.length;
          const groupedMessages = messages.slice(turnIndex, nextTurnIndex);
          const assistants = groupedMessages.filter(message => message.role === 'assistant');
          const resolvedAskUserTurn = assistants.some(message => message.tools?.some((event: any) => event.name === 'askUser' && event.answer));
          if (resolvedAskUserTurn) return null;
          const orbInitiated = turnMessage.source === 'orb-trigger' || Boolean(activeChat?.chatId.startsWith('scheduled-') && (turnMessage.historyIndex ?? turnIndex) === 0 && assistants.some(message => message.agentName));
          const liveTurn = isStreaming && nextTurnIndex === messages.length;
          const finalAssistant = assistants.at(-1);
          const turnMessages = (floating ? assistants : groupedMessages).filter(message => !message.hidden && !(orbInitiated && message === turnMessage && message.role === 'user') && (message.role !== 'assistant' || message === finalAssistant || Boolean(String(message.displayContent || message.content || '').trim())) && (liveTurn || message.role !== 'assistant' || message === finalAssistant));
          const turnTime = formatChatTime(turnMessage.createdAt || turnMessage.timestamp, language);
          const isProcessingTurn = Boolean((!turnMessage.hidden || orbInitiated) && isStreaming && agentState !== 'error' && assistants.length && nextTurnIndex === messages.length);
          const hasErrorTurn = assistants.some(message => message.meta?.status === 'error');
          const isLastTurn = nextTurnIndex === messages.length;
          return <div ref={virtualizeTurns ? turnVirtualizer.measureElement : undefined} data-index={virtualTurn.index} className={`chat-turn ${isLastTurn ? 'is-last' : ''}`} key={virtualTurn.key} role="article" aria-label={`Intercambio ${(turnMessage.historyIndex??turnIndex) + 1}`} style={{ position:virtualizeTurns ? 'absolute' : 'relative',top:0,left:0,width:'100%',transform:virtualizeTurns ? `translateY(${virtualTurn.start}px)` : undefined,display: 'flex', flexDirection: 'column', gap: '16px', paddingBottom: floating ? 0 : isLastTurn ? 8 : 16 }}>
            {!floating&&<span className="chat-turn-time" aria-label={`Hora ${turnTime}`}>
              <span>{turnTime}</span>
              {isProcessingTurn && <ProcessingStatusStateFixed startedAt={agentStartedAtRef.current || Date.now()} language={language} />}
              {hasErrorTurn && <span className="chat-turn-advice">{language === 'en' ? 'Check the selected provider and model.' : 'Revisá el proveedor y modelo seleccionados.'}</span>}
            </span>}

            {turnMessages.map((turnItem, turnOffset) => {
              const m = turnItem;
              const i = turnIndex + groupedMessages.indexOf(turnItem);
              const isLiveAssistant = m.role === 'assistant' && isStreaming && i === messages.length - 1;
              return <React.Fragment key={`${m.role}-${i}`}>
            {<motion.div initial={false} animate={{ opacity: 1 }} transition={{ duration: 0.2, ease: 'easeOut' }} className={`group/message ${m.role === 'assistant' ? 'chat-assistant-message' : 'chat-user-message'} ${m.meta?.status === 'error' ? 'chat-error-message' : ''}`} style={{ alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', display: 'grid', justifyItems: m.role === 'user' ? 'end' : 'start', gap: '8px', maxWidth: m.role === 'user' ? '76%' : '100%', minWidth: 0 }}>
              {m.role === 'user' && (m.resourceReferences?.length > 0 || m.artifactReferences?.length > 0 || m.browserReferences?.length > 0 || m.selectedTextReferences?.length > 0 || m.attachments?.length > 0) && <div className="chat-reference-row" aria-label={language === 'en' ? 'References and files' : 'Referencias y archivos'}>
                {m.resourceReferences?.map((resource: ChatResource) => <div key={`${resource.kind}:${resource.id}`} className="chat-reference-card" title={`${resourceText[resource.kind]} · ${resourceText[resource.scope]}`}><span className="chat-reference-title">{resource.name}</span></div>)}
                {m.artifactReferences?.map((ref: { kind: 'plan' | 'todo'; id: string; title: string }) => <div key={`${ref.kind}-${ref.id}`} className="chat-reference-card chat-artifact-reference-card" title={`@${ref.kind} · ${ref.title}`}><span className="chat-reference-kind">@{ref.kind}</span><span className="chat-reference-title">{ref.title}</span></div>)}
                {m.browserReferences?.map((ref: { id: string; title: string; text: string; url?: string }, referenceIndex: number) => <div key={ref.id || `${ref.title}-${referenceIndex}`} className="chat-reference-card chat-browser-reference-card" title={ref.title}><span className="chat-browser-reference-number">{referenceIndex + 1}</span>{getBrowserReferenceFavicon(ref) ? <img src={getBrowserReferenceFavicon(ref)} alt="" className="chat-reference-favicon" /> : <Globe size={16} className="chat-reference-favicon chat-reference-fallback-icon" aria-hidden="true" />}<span className="chat-reference-title">{ref.title}</span></div>)}
                {m.selectedTextReferences?.map((ref: { id: string; text: string; comment?: string }) => <div key={ref.id} className="chat-reference-card chat-selected-text-reference-card" title={ref.comment ? `${ref.comment}\n\n${ref.text}` : ref.text}><span className="chat-selected-text-content">{ref.text}</span><span className="chat-selected-text-label">{agentTextSelectionTranslations[language].selectedReference}</span></div>)}
                {m.attachments?.map((file: ChatAttachment) => file.mediaType?.startsWith('image/') ? <div key={file.path || file.name} className="chat-reference-card chat-attachment-card" title={file.name}><img src={file.previewUrl || convertFileSrc(file.path)} alt={file.name} /></div> : <div key={file.path || file.name} className="chat-reference-card chat-attachment-card chat-attachment-file" title={file.name}>{file.previewText ? <pre className="chat-attachment-preview-text">{file.previewText}</pre> : <span>{file.name.split('.').pop()?.toUpperCase().slice(0, 6) || 'FILE'}</span>}</div>)}
              </div>}
              {isLiveAssistant && agentState !== 'error' && <LiveTurnProgress message={m} language={language} />}
              {(m.role === 'user' || m.content || m.displayContent || m.meta?.status === 'error') && <div className={`chat-markdown min-w-0 max-w-full break-words [overflow-wrap:anywhere] text-sm leading-6 text-(--codeclub-text-strong) ${m.role === 'user' ? 'chat-markdown-user' : 'chat-markdown-assistant chat-agent-bubbles'} ${m.role === 'user' && getVisibleUserContent(m).trim() ? 'w-fit overflow-hidden rounded-[20px] rounded-br-[5px] border-0 bg-[#2B2B2B] px-3.5 py-[9px]' : 'w-full'}`}>
                <motion.div

                  initial={false}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.24, ease: 'easeOut' }}
                >
                <MemoizedChatMarkdown content={normalizeChatContent(m.role === 'user' ? getVisibleUserContent(m) : (m.meta?.status === 'error' ? (m.meta.errorMessage || (language === 'en' ? 'No response' : 'Sin respuesta')) : (m.displayContent || m.content)))} />
                </motion.div>
              </div>}
              {m.role === 'assistant' && <AskUserCards tools={m.tools} onSelect={(answer, questionId) => void sendMessage(answer, messages, false, false, [], questionId)} onRespondInChat={() => {
                setComposerDocked(true);
                requestAnimationFrame(() => {
                  chatInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  chatInputRef.current?.focus();
                });
              }} disabled={isAgentBusy} />}
              {m.role === 'assistant' && i === messages.length - 1 && <ApprovalCards approvals={pendingApprovals} onResolve={resolveToolApproval} />}
              {!floating && m.role === 'assistant' && (!liveTurn || m.meta?.status === 'error') && <div data-message-actions={i} className="message-actions relative flex items-center gap-1 self-start">
                <button type="button" aria-label={copiedMessageIndex === i ? chatActionTranslations[language].copied : chatActionTranslations[language].copy} title={copiedMessageIndex === i ? chatActionTranslations[language].copied : chatActionTranslations[language].copy} onClick={() => void handleCopyMessage(m.content, i)} className={`grid h-6 w-6 place-items-center rounded-md border-0 bg-transparent transition-colors hover:bg-white/[0.06] ${copiedMessageIndex === i ? 'text-(--codeclub-accent-bright)' : 'text-(--codeclub-text-muted)'}`}>{copiedMessageIndex === i ? <Check size={12} strokeWidth={1.8} /> : <Copy size={12} strokeWidth={1.8} />}</button>
                <button type="button" aria-label={chatActionTranslations[language].more} title={chatActionTranslations[language].more} aria-haspopup="menu" aria-expanded={moreMenuIndex === i} onClick={() => setMoreMenuIndex((current) => current === i ? null : i)} className="grid h-6 w-6 place-items-center rounded-md border-0 bg-transparent text-(--codeclub-text-muted) transition-colors hover:bg-white/[0.06] hover:text-(--codeclub-text-strong)"><MoreHorizontal size={13} strokeWidth={1.8} /></button>
                <AnimatePresence>{moreMenuIndex === i && <motion.div ref={responseMenuRef} role="menu" aria-label={chatActionTranslations[language].more} initial={{ opacity: 0, y: 6, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 6, scale: 0.96 }} transition={{ duration: 0.14, ease: 'easeOut' }} className="absolute bottom-[calc(100%+8px)] left-0 z-30 grid w-[184px] max-w-[calc(100vw-16px)] gap-0.5 rounded-xl border border-[#333333] bg-[#2B2B2B] p-1 shadow-2xl">
                  {previousUserMessageIndex(i) >= 0 && <button type="button" role="menuitem" disabled={isAgentBusy} onClick={() => { handleRetryMessage(previousUserMessageIndex(i)); setMoreMenuIndex(null); }} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[11px] text-(--codeclub-text-strong) hover:bg-white/[0.06] disabled:opacity-40"><RotateCcw size={12} />{chatActionTranslations[language].regenerate}</button>}
                  <button type="button" role="menuitem" onClick={() => { void handleCopyTrace(); setMoreMenuIndex(null); }} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[11px] text-(--codeclub-text-strong) hover:bg-white/[0.06]"><ScrollText size={12} />{chatActionTranslations[language].trace}</button>
                </motion.div>}</AnimatePresence>
              </div>}
              </motion.div>}
              </React.Fragment>;
            })}
          </div>;
        })}
        </div>
      </motion.div>

      </div>

      <div className="chat-composer composer-row flex w-full min-w-0 shrink-0 items-center gap-2 bg-transparent">
          <div className="composer-box relative min-h-10 min-w-0 flex-1 overflow-visible rounded-[22px] border border-(--codeclub-border-soft) bg-(--codeclub-surface-raised) p-0 shadow-none">
          {computerContext && <div className="flex min-h-[28px] items-center gap-2 border-b border-[#202020] px-4 py-1.5" aria-label={language === 'en' ? 'Computer Use context' : 'Contexto de Computer Use'}><span className="shrink-0 rounded-full border border-[#3D9BFF]/60 bg-[#1687FF]/10 px-2 py-0.5 text-[10px] font-medium text-[#8BC7FF]">PC</span><span className="min-w-0 flex-1 truncate text-[10px] text-[#bdbdbd]">{computerContext.title || (language === 'en' ? 'Unknown window' : 'Ventana desconocida')} · ({computerContext.x}, {computerContext.y})</span><button type="button" onClick={() => setComputerContext(null)} className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-[#999999] hover:bg-white/[0.08] hover:text-[#eee]" title={language === 'en' ? 'Remove Computer Use context' : 'Quitar contexto de Computer Use'} aria-label={language === 'en' ? 'Remove Computer Use context' : 'Quitar contexto de Computer Use'}><X size={12} /></button></div>}
          {attachmentProgress&&<p className="m-0 truncate py-1 text-[10px] text-[#8bc7ff]" role="status">{attachmentProgress}</p>}
          {attachmentError&&<p className="m-0 py-1 text-[10px] text-[#aaa]" role="alert">{activityTranslations[language].attachmentFailed}</p>}
          {(artifactReferences.length > 0 || browserReferences.length > 0 || selectedTextReferences.length > 0 || attachedFiles.length > 0) && (
            <div ref={browserRefContainerRef} className="file-preview-scrollbar flex min-h-[76px] w-full min-w-0 max-w-full flex-nowrap items-center gap-2 overflow-x-auto overflow-y-hidden border-b-0 px-3 py-1.5" aria-label={language === 'en' ? 'References and files' : 'Referencias y archivos'}>
              {artifactReferences.map((reference) => <button key={`${reference.kind}-${reference.id}`} type="button" onClick={() => setArtifactReferences((current) => current.filter((item) => item.kind !== reference.kind || item.id !== reference.id))} className="attachment-artifact-preview relative grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-[10px] border-0 bg-[#161616] text-left text-[#cfcfcf]" aria-label={`${accessibilityTranslations[language].remove}: ${reference.title}`} title={`${accessibilityTranslations[language].remove}: ${reference.title}`}><span className="absolute left-1 top-1 text-[8px] uppercase tracking-[0.04em] text-[#858585]">@{reference.kind}</span><span className="absolute inset-x-1 bottom-1 line-clamp-2 text-center text-[8px] leading-[10px] text-[#d6d6d6]">{reference.title}</span><span aria-hidden="true" className="attachment-artifact-remove pointer-events-none absolute inset-0 z-10 grid place-items-center bg-[#161616]/80 text-[#eeeeee]"><span className="grid h-6 w-6 place-items-center rounded-full bg-[#252525] text-[#bdbdbd]"><X size={13} strokeWidth={2} /></span></span></button>)}
              {browserReferences.map((ref, index) => <button key={ref.id} type="button" onClick={() => { setBrowserReferences((current) => current.filter((item) => item.id !== ref.id)); if (ref.markerId) window.dispatchEvent(new CustomEvent('codeclub:remove-browser-marker', { detail: { markerId: ref.markerId } })); }} className="browser-reference-preview relative grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-[10px] border-0 bg-[#161616] px-1 text-left text-[#cfcfcf]" aria-label={`${accessibilityTranslations[language].remove}: ${ref.title}`} title={`${accessibilityTranslations[language].remove}: ${ref.title}`}>
                <span className="absolute left-1 top-1 z-[1] grid h-4 w-4 place-items-center rounded-full bg-(--codeclub-accent) text-[9px] font-semibold text-[#111111]">{index + 1}</span>
                {getBrowserReferenceFavicon(ref) ? <img src={getBrowserReferenceFavicon(ref)} alt="" className="h-7 w-7 rounded-md object-contain" /> : <span className="grid h-7 w-7 place-items-center rounded-md bg-[#202020] text-[#8BC7FF]"><Globe size={14} /></span>}
                <span className="absolute inset-x-1 bottom-1 truncate text-center text-[9px] text-[#d6d6d6]">{ref.title}</span>
                <span aria-hidden="true" className="browser-reference-remove pointer-events-none absolute inset-0 grid place-items-center bg-[#161616]/80 text-[#eeeeee]"><span className="grid h-6 w-6 place-items-center rounded-full bg-[#252525] text-[#bdbdbd]"><X size={13} strokeWidth={2} /></span></span>
              </button>)}
              {selectedTextReferences.map((ref) => <button key={ref.id} type="button" aria-label={`${agentTextSelectionTranslations[language].removeReference}: ${ref.text}`} onClick={() => setSelectedTextReferences((current) => current.filter((item) => item.id !== ref.id))} className="browser-reference-preview chat-selected-text-preview relative grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-[10px] border-0 bg-[#161616] px-1 text-left text-[#cfcfcf]" title={`${agentTextSelectionTranslations[language].removeReference}: ${ref.comment ? `${ref.comment} · ` : ''}${ref.text}`}>
                <span className="chat-selected-text-content">{ref.text}</span>
                <span className="chat-selected-text-label">{agentTextSelectionTranslations[language].selectedReference}</span>
                <span aria-hidden="true" className="browser-reference-remove pointer-events-none absolute inset-0 grid place-items-center bg-[#161616]/80 text-[#eeeeee]"><span className="grid h-6 w-6 place-items-center rounded-full bg-[#252525] text-[#bdbdbd]"><X size={13} strokeWidth={2} /></span></span>
              </button>)}
              {false && browserReferences.length > maxVisibleBrowserRefs && (
                <button
                  type="button"
                  onClick={() => setBrowserReferences([])}
                  className="shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-medium transition-[filter] hover:brightness-105"
                  style={{ borderColor: '#F8EAD8', color: '#111111', background: 'linear-gradient(135deg, #1687FF 0%, #67BAFF 38%, #F8EAD8 72%, #FFF3DF 100%)' }}
                  title={language === 'en' ? 'Remove all references' : 'Quitar todas las referencias'}
                >
                  +{browserReferences.length - maxVisibleBrowserRefs} referencias
                </button>
              )}
           {attachedFiles.length > 0 && <div className="contents" aria-label={language === 'en' ? 'Attached files' : 'Archivos adjuntos'}>{attachedFiles.map((file, index) => file.mediaType.startsWith('image/') ? <motion.button key={file.path} type="button" aria-label={`${accessibilityTranslations[language].remove}: ${file.name}`} onClick={() => setAttachedFiles((current) => current.filter((_, fileIndex) => fileIndex !== index))} whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }} transition={{ type: 'spring', stiffness: 420, damping: 28 }} className="attachment-image-preview relative h-16 w-16 shrink-0 overflow-hidden rounded-[10px] border-0 bg-[#161616]" title={`${language === 'en' ? 'Remove' : 'Quitar'} ${file.name}`}><img src={file.previewUrl} alt={file.name} onError={(event) => { event.currentTarget.style.display = 'none'; }} className="attachment-image-preview-image h-full w-full object-cover" /><span className="attachment-image-preview-name absolute inset-x-1 bottom-1 truncate text-center text-[9px] text-white/75">{file.name}</span><span aria-hidden="true" className="attachment-image-preview-close pointer-events-none absolute inset-0 grid place-items-center text-white"><X size={18} strokeWidth={2.2} /></span></motion.button> : <motion.button key={file.path} type="button" onClick={() => setAttachedFiles((current) => current.filter((_, fileIndex) => fileIndex !== index))} whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }} transition={{ type: 'spring', stiffness: 420, damping: 28 }} className="attachment-file-preview relative grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-[10px] border-0 bg-[#161616] text-[10px] font-semibold uppercase tracking-[0.04em] text-[#cfcfcf]" title={`${language === 'en' ? 'Remove' : 'Quitar'} ${file.name}`}>{file.previewText ? <pre className="attachment-file-preview-text">{file.previewText}</pre> : <span className="attachment-file-preview-name" title={file.name}>{file.name}</span>}<span aria-hidden="true" className="attachment-file-preview-close pointer-events-none absolute inset-0 grid place-items-center text-white"><X size={18} strokeWidth={2.2} /></span></motion.button>)}</div>}
            </div>
          )}
          {selectedResources.length > 0 && <div className="flex min-h-[28px] flex-wrap items-center gap-1.5 border-b border-[#202020] px-3 py-1.5" aria-label={resourceText.resources}>
            {selectedResources.map(resource => <button key={`${resource.kind}:${resource.id}`} type="button" aria-label={`${resourceText.remove}: ${resource.name}`} title={`${resourceText.remove}: ${resource.name}`} onClick={() => setSelectedResources(previous => previous.filter(item => item.id !== resource.id || item.kind !== resource.kind))} className="flex items-center gap-1 rounded-full border border-[#2b2b2b] bg-[#191919] px-2.5 py-1 text-[10px] text-[#b9dcff]"><span>{resourceText[resource.kind]} · {resource.name}</span><X size={10} aria-hidden="true" /></button>)}
          </div>}
          {activeSkills.length > 0 && <div className="flex min-h-[28px] items-center gap-1.5 overflow-x-auto border-b border-[#202020] px-3 py-1.5" aria-label={chatText.activeSkills}>
            {activeSkills.map((skill) => <button key={skill.id} type="button" onClick={() => setActiveSkills((current) => current.filter((item) => item.id !== skill.id))} className="flex shrink-0 items-center gap-1 rounded-full border border-[#3d9bff]/50 bg-[#1687ff]/10 px-2.5 py-1 text-[10px] text-[#b9dcff] hover:bg-[#1687ff]/20" aria-label={`${chatText.removeSkill}: ${skill.name}`} title={chatText.removeSkill}>
              <span className="max-w-[150px] truncate">{skill.name}</span><span className="text-[#8bc7ff]/70">×</span>
            </button>)}
          </div>}
          {activeExtensions.length > 0 && <div className="flex min-h-[28px] items-center gap-1.5 overflow-x-auto border-b border-[#202020] px-3 py-1.5" aria-label={chatText.activeExtensions}>
            {activeExtensions.map((extension) => { const Icon = extensionIcons[extension.id] || Box; return <button key={extension.id} type="button" onClick={() => setActiveExtensions((current) => current.filter((item) => item.id !== extension.id))} className="flex shrink-0 items-center gap-1 rounded-full border border-[#3d9bff]/50 bg-[#1687ff]/10 px-2.5 py-1 text-[10px] text-[#b9dcff] hover:bg-[#1687ff]/20" aria-label={`${chatText.removeExtension}: ${extension.name}`} title={chatText.removeExtension}><Icon size={11} /><span>{extension.name}</span><span className="text-[#8bc7ff]/70">×</span></button>; })}
          </div>}
          <div ref={commandMenuHostRef} className="absolute inset-x-0 bottom-full z-40 mb-2" />
          <form onSubmit={handleSubmit} aria-label={language === 'en' ? 'Message composer' : 'Compositor de mensaje'} className="composer-box-inner relative flex min-h-[44px] w-full min-w-0 flex-col items-stretch gap-0 rounded-none border-0 bg-transparent px-1.5 pb-3 pl-4 pr-3 pt-3 @max-[520px]:pl-3 @max-[520px]:pr-2 [&>button.absolute]:hidden">
           {false && (
          <button type="button" onClick={handleAttachFiles} className="text-white/40 hover:text-white transition-colors" aria-label={language === 'en' ? 'Add files' : 'Añadir archivos'} style={{ flex: '0 0 28px', width: '28px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center', border: 0, background: 'transparent', cursor: 'pointer' }}>
            <Paperclip size={16} strokeWidth={1.8} />
          </button>
          )}
          {false && attachedFiles.length > 0 && (
            <button
              type="button"
              onClick={() => setAttachedFiles([])}
              className="shrink-0 bg-[var(--color-surface-3)] text-[#bdbdbd] hover:bg-[var(--color-surface-7)] hover:text-[#eeeeee] transition-colors"
              aria-label={chatText.removeFiles}
              title={chatText.removeFiles}
              style={{ minHeight: '24px', display: 'flex', alignItems: 'center', padding: '0 9px', border: '1px solid var(--color-surface-8, #2b2b2b)', borderRadius: '999px', fontSize: '11px', cursor: 'pointer' }}
            >
              Añadido {attachedFiles.length}
            </button>
          )}
          <span id="chat-input-help" className="sr-only">{language === 'en' ? 'Write a message. Use Shift+Enter for a new line and / to open commands.' : 'Escribí un mensaje. Usá Shift+Enter para una nueva línea y / para abrir comandos.'}</span>
          <span className="chat-input-orb absolute left-3 top-3 z-10 grid h-[22px] w-[22px] place-items-center rounded-full">
            {composerLeading || <OrbPaletteButton size={22} className="h-[22px] w-[22px]" />}
          </span>
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
              if (!value.trim()) setArtifactReferences([]);
              if (value === '/' || (value.startsWith('/') && !value.includes(' '))) {
                setCommandKind('command');
                setSearchQuery(value.slice(1));
                setMenuOpen(true);
              } else if (commandKind === 'command') {
                setMenuOpen(false);
              }
            }}
            onInput={() => {
              resizeChatInput();
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
            onFocus={() => { if (commandKind !== 'credential') setMenuOpen(false); }}
            aria-label={chatText.message}
            className={`order-1 min-h-[22px] h-auto max-h-[240px] w-full min-w-0 flex-none resize-none self-stretch overflow-y-hidden box-border border-0 bg-transparent py-0.5 pl-8 pr-10 text-xs leading-[1.4] text-(--codeclub-text-strong) outline-none placeholder:text-(--codeclub-text-muted) [scrollbar-width:none] ${isAgentBusy ? 'opacity-[0.55]' : 'opacity-100'}`}
            placeholder={agentStatusText}
          />
          <div className="absolute right-3 top-2 z-20 flex min-h-[30px] min-w-0 items-center justify-end gap-3 @max-[520px]:gap-1.5">
            <motion.button type={isAgentBusy ? 'button' : 'submit'} onPointerDown={(event) => { if (!isAgentBusy) return; event.preventDefault(); event.stopPropagation(); cancelGeneration(); }} onClick={isAgentBusy ? cancelGeneration : undefined} disabled={!sendButtonActive} animate={{ scale: sendButtonActive ? 1 : 0.94, opacity: sendButtonActive ? 1 : 0.62 }} whileHover={{ scale: sendButtonActive ? 1.06 : 0.98 }} whileTap={{ scale: 0.9 }} transition={{ type: 'spring', stiffness: 460, damping: 28 }} className={`send-button ml-auto flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full text-(--codeclub-text-strong) shadow-none transition-colors disabled:cursor-not-allowed ${sendButtonActive ? 'send-button-shine border border-(--codeclub-border-soft) bg-(--codeclub-send-active-radial)' : 'border border-transparent bg-(--codeclub-surface-raised)'}`} aria-label={isAgentBusy ? chatText.cancel : credentialProvider ? (language === 'en' ? 'Save credential' : 'Guardar credencial') : chatText.send} title={isAgentBusy ? chatText.cancel : credentialProvider ? (language === 'en' ? 'Save credential' : 'Guardar credencial') : chatText.send}>
            {isAgentBusy ? <Square size={13} strokeWidth={2.4} fill="currentColor" /> : <ArrowUp size={15} strokeWidth={2.2} />}
            </motion.button>
          </div>
          </form>
          </div>
        {commandMenuHostRef.current && createPortal((<motion.div
          ref={commandMenuRef}
          tabIndex={-1}
          onKeyDown={handleCommandMenuKeyDown}
          role="listbox"
          aria-label={language === 'en' ? 'Available commands' : 'Comandos disponibles'}
          aria-activedescendant={activeCommandIndex >= 0 ? `command-option-${activeCommandIndex}` : undefined}
          className={`command-menu ${menuOpen ? 'is-open' : ''}`}
          initial={false}
          animate={{ opacity: menuOpen ? 1 : 0, y: menuOpen ? 0 : -6, scale: menuOpen ? 1 : 0.985 }}
          transition={{ type: 'spring', stiffness: 420, damping: 32, mass: 0.7 }}
          style={{ position: 'relative', maxHeight: 'min(360px, 55dvh)', overflowY: 'auto', overscrollBehavior: 'contain', width: 'calc(100% - 12px)', margin: '0 6px', display: menuOpen ? 'grid' : 'none', gap: '4px', padding: '8px', border: '1px solid #2B2B2B', borderRadius: '14px', background: '#191919', boxShadow: '0 12px 32px #0006', zIndex: 10, outline: 'none' }}
        >
          {commandKind !== 'credential' && commandKind !== 'custom-config' && <div style={{ position: 'relative' }}>
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder={commandKind === 'provider' ? chatText.searchProvider : commandKind === 'model' ? chatText.searchModel : commandKind === 'project' ? chatText.searchProject : commandKind === 'skill' ? chatText.searchSkill : chatText.searchCommand}
              style={{ boxSizing: 'border-box', width: '100%', height: '28px', padding: '0 28px 0 8px', borderRadius: '7px', background: 'transparent', fontSize: '11px', color: '#eeeeee', border: 0, outline: 'none' }}
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
                onChange={(event) => {setCredentialInput(event.target.value);setCustomConfigError('');}}
                onKeyDown={(event) => { if (event.key !== 'Enter' && event.key !== 'Escape') return; event.preventDefault(); event.stopPropagation(); if (event.key === 'Enter' && credentialInput.trim()) { saveCredential(); return; } setCredentialProvider(null); setCredentialInput(''); setMenuOpen(false); setCommandKind(''); chatInputRef.current?.focus(); }}
                placeholder={`${aiCredentialTranslations[language].enter} ${credentialProvider?.gatewayOnly ? 'Vercel AI Gateway' : credentialProvider?.label || credentialProvider?.id}`}
                className="credential-menu-input"
                style={{ boxSizing: 'border-box', width: '100%', height: '34px', padding: '0 32px 0 10px', border: 0, borderRadius: '8px', background: 'transparent', color: '#eeeeee', fontSize: '12px', outline: 'none' }}
              />
              {customConfigError&&<span role="alert" className="text-[11px] text-[#aaa]">{customConfigError}</span>}
            </div>
          ) : commandKind === 'custom-config' ? (
            <div style={{ display: 'grid', gap: '8px' }}>
              <div style={{ position: 'relative', minHeight: '34px' }}>
                {customUrl.trim() ? <button type="button" onClick={saveCustomProviderConfig} aria-label={language === 'en' ? 'Save URL' : 'Guardar URL'} style={{ position: 'absolute', right: '4px', top: '50%', width: '26px', height: '26px', display: 'grid', placeItems: 'center', transform: 'translateY(-50%)', border: 0, borderRadius: '6px', background: 'transparent', color: '#d6d6d6', cursor: 'pointer' }}><Check size={15} strokeWidth={1.8} /></button> : <Globe size={15} strokeWidth={1.8} style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', color: '#d6d6d6', pointerEvents: 'none' }} />}
                <input ref={customUrlRef} value={customUrl} onChange={(event) => { setCustomUrl(event.target.value); setCustomConfigError(''); }} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); saveCustomProviderConfig(); } }} placeholder={language === 'en' ? 'Provider URL' : 'URL del proveedor'} style={{ boxSizing: 'border-box', width: '100%', height: '34px', padding: '0 32px 0 10px', border: 0, borderRadius: '8px', background: 'transparent', color: '#eeeeee', fontSize: '12px', outline: 'none' }} />
              </div>
              <div style={{ display: 'grid', gap: '5px', color: '#999999', fontSize: '11px' }}>
                {language === 'en' ? 'Tool format' : 'Formato de herramientas'}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px' }}>
                  {(['json', 'xml'] as const).map((format) => <button key={format} type="button" onClick={() => setCustomToolsFormat(format)} style={{ height: '30px', border: '1px solid #2b2b2b', borderRadius: '7px', background: customToolsFormat === format ? '#1E1E1E' : 'transparent', color: customToolsFormat === format ? '#eeeeee' : '#777777', fontSize: '11px' }}>{format.toUpperCase()}</button>)}
                </div>
              </div>
              {customConfigError && <span style={{ color: '#f28b82', fontSize: '11px' }}>{customConfigError}</span>}
            </div>
          ) : <div className="command-list" style={{ display: 'grid', gap: '2px', maxHeight: '280px', overflow: 'auto', scrollbarWidth: 'none', paddingBottom: '6px' }}>
            {activeSelection && (
              <div aria-current="true" style={{ minHeight: '30px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', borderRadius: '7px', background: '#1E1E1E', color: 'var(--codeclub-accent)', fontSize: '11px', padding: '0 9px' }}>
                <span className="flex items-center gap-2">{activeSelection.label || activeSelection.id}</span>
                <small style={{ color: 'var(--codeclub-accent)', fontSize: '11px', opacity: 0.88 }}>{chatText.selected}</small>
              </div>
            )}
            {!hasCommandMenuResults && <div role="status" style={{ minHeight: '32px', display: 'grid', placeItems: 'center', padding: '8px 9px', color: 'rgba(216, 216, 216, 0.48)', fontSize: '11px' }}>{language === 'en' ? 'No results found' : 'No se encontraron resultados'}</div>}
            {commandMenuItems.map((item, index) => (
              <motion.button
                key={item.gatewayId || item.id}
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
                style={{ position: 'relative', minHeight: '28px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', border: 0, borderRadius: '7px', background: 'transparent', fontSize: '12px', padding: '0 7px', textAlign: 'left', cursor: 'pointer', overflow: 'hidden' }}
              >
                <motion.span aria-hidden="true" animate={{ opacity: index === activeCommandIndex ? 1 : 0 }} transition={{ duration: 0.12, ease: 'easeOut' }} style={{ position: 'absolute', inset: 0, borderRadius: '7px', background: '#2F2F2F', zIndex: 0, pointerEvents: 'none' }} />
                <span className="relative z-[1] flex min-w-0 items-center gap-2">{item.icon && React.createElement(item.icon, { size: 14, strokeWidth: 1.8 })}<span className="truncate">{item.label}</span></span>
                <small className="relative z-[1]" style={{ color: 'rgba(216, 216, 216, 0.36)', fontSize: '11px' }}>
                  {compactCommandDescription(item.type === 'command' ? item.description : item.type === 'language' ? item.description : item.type === 'development' ? item.description : item.type === 'provider' ? (isSavedProvider(item) ? savedProviderTranslations[language].recent : chatText.provider) : item.type === 'project' ? chatText.project : item.type === 'skill' ? item.source : item.type === 'extension' ? chatText.extension : ['resource', 'resource-create'].includes(item.type || '') ? item.description : chatText.model)}
                </small>
              </motion.button>
            ))}
          </div>}
        </motion.div>), commandMenuHostRef.current)}
      </div>
    </div>
  );
}
