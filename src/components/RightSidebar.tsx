import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, ChevronRight, File, FileCode2, FileImage, FileText, Folder, FolderOpen, Folders, GitBranch, LockKeyhole, LogOut, MessageCircle, Plus, RefreshCw, Search } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { whatsappContextStore } from '../lib/store';
import { readAgentState, writeAgentState, type AgentState, type TaskStatus } from '../lib/engine/planning';
import { readBusinessWorkspace, writeBusinessWorkspace, type BusinessWorkspace } from '../lib/projectManager';

type FileEntry = { path: string; kind: 'file' | 'directory' };
type FileNode = FileEntry & { name: string; children: FileNode[] };

const buildTree = (entries: FileEntry[]) => {
  const roots: FileNode[] = [];
  const nodes = new Map<string, FileNode>();
  const sorted = entries.slice().sort((a, b) => a.path.localeCompare(b.path));
  for (const entry of sorted) {
    const parts = entry.path.replace(/\\/g, '/').split('/').filter(Boolean);
    let parent: FileNode | undefined;
    parts.forEach((part, index) => {
      const path = parts.slice(0, index + 1).join('/');
      let node = nodes.get(path);
      if (!node) {
        node = { path, name: part, kind: index === parts.length - 1 ? entry.kind : 'directory', children: [] };
        nodes.set(path, node);
        (parent ? parent.children : roots).push(node);
      }
      parent = node;
    });
  }
  const sortNodes = (items: FileNode[]) => {
    items.sort((a, b) => Number(b.kind === 'directory') - Number(a.kind === 'directory') || a.name.localeCompare(b.name));
    items.forEach((item) => sortNodes(item.children));
  };
  sortNodes(roots);
  return roots;
};

const iconForFile = (name: string) => {
  const extension = name.split('.').pop()?.toLowerCase() || '';
  if (name === '.env' || name.startsWith('.env.')) return <span className="flex h-4 w-4 shrink-0 items-center justify-center"><LockKeyhole size={15} className="text-[#e6c35c]" /></span>;
  if (name === '.gitignore') return <span className="flex h-4 w-4 shrink-0 items-center justify-center"><GitBranch size={16} className="text-[#ef623b]" /></span>;
  if (extension === 'md') return <span className="flex h-4 w-4 shrink-0 items-center justify-center text-[11px] font-bold leading-none text-[#4fda73]">M↓</span>;
  if (extension === 'js' || extension === 'jsx') return <span className="flex h-4 w-4 shrink-0 items-center justify-center"><span className="rounded bg-[#62551a] px-0.5 text-[8px] font-bold text-[#f6d84a]">JS</span></span>;
  if (extension === 'ts' || extension === 'tsx' || extension === 'mjs' || extension === 'cjs') return <span className="flex h-4 w-4 shrink-0 items-center justify-center"><span className="rounded bg-[#245b73] px-0.5 text-[8px] font-bold text-[#8bd5ff]">TS</span></span>;
  if (extension === 'json' || extension === 'jsonc') return <span className="flex h-4 w-4 shrink-0 items-center justify-center"><svg viewBox="0 0 32 32" aria-hidden="true"><path fill="#f5de19" d="M4.014 14.976a2.5 2.5 0 0 0 1.567-.518a2.38 2.38 0 0 0 .805-1.358a15.3 15.3 0 0 0 .214-2.944q.012-2.085.075-2.747a5.2 5.2 0 0 1 .418-1.686a3 3 0 0 1 .755-1.018A3.05 3.05 0 0 1 9 4.125A6.8 6.8 0 0 1 10.544 4h.7v1.96h-.387a2.34 2.34 0 0 0-1.723.468a3.4 3.4 0 0 0-.425 2.092a36 36 0 0 1-.137 4.133a4.7 4.7 0 0 1-.768 2.06A4.6 4.6 0 0 1 6.1 16a3.8 3.8 0 0 1 1.992 1.754a8.9 8.9 0 0 1 .618 3.865q0 2.435.05 2.9a1.76 1.76 0 0 0 .504 1.181a2.64 2.64 0 0 0 1.592.337h.387V28h-.7a6.8 6.8 0 0 1-1.544-.125a3.05 3.05 0 0 1-1.149-.581a3 3 0 0 1-.755-1.018a5.2 5.2 0 0 1-.418-1.686q-.062-.662-.075-2.747a15.3 15.3 0 0 0-.214-2.944a2.38 2.38 0 0 0-.805-1.358a2.5 2.5 0 0 0-1.567-.518Zm23.972 2.035a2.5 2.5 0 0 0-1.567.524a2.4 2.4 0 0 0-.805 1.361a16.5 16.5 0 0 0-.212 3.109a24 24 0 0 1-.169 3.234a3.35 3.35 0 0 1-.681 1.63a2.97 2.97 0 0 1-1.324.93a5.7 5.7 0 0 1-1.773.2h-.7V26.04h.387a2.64 2.64 0 0 0 1.592-.337a1.76 1.76 0 0 0 .506-1.186q.05-.462.05-2.9a8.9 8.9 0 0 1 .618-3.865A3.8 3.8 0 0 1 25.9 16a4.6 4.6 0 0 1-1.7-1.286a4.7 4.7 0 0 1-.768-2.06a36 36 0 0 1-.137-4.133a3.4 3.4 0 0 0-.425-2.092a2.34 2.34 0 0 0-1.723-.468h-.387V4h.7a6.8 6.8 0 0 1 1.54.125a3.05 3.05 0 0 1 1.149.581a3 3 0 0 1 .755 1.018a5.2 5.2 0 0 1 .418 1.686q.062.662.075 2.747a15.3 15.3 0 0 1-.212 3.109a2.38 2.38 0 0 1-.805 1.355a2.5 2.5 0 0 1-1.567.518Z" /></svg></span>;
  if (extension === 'html' || extension === 'htm') return <span className="flex h-4 w-4 shrink-0 items-center justify-center"><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#e44d26" d="M1.5 0h21l-1.9 21.5L12 24l-8.6-2.5L1.5 0Z" /><path fill="#f16529" d="M12 2v20.2l7-2 1.6-18.2H12Z" /><path fill="#fff" d="M12 6.2H5.5l.1 1.3.7 7.1H12v-2.4H8.5l-.2-2.4H12V6.2Zm0 11.3-3-.8-.2-2.4H6.5l.4 4.2 5.1 1.4v-2.4Z" /><path fill="#ebebeb" d="M12 6.2v2.4h3.6l-.2 2.4H12v2.4h5.5l.1-1.3.7-7.1H12Zm0 8.1v2.4l3-.8-.2-1.6H12Z" /></svg></span>;
  if (extension === 'xml' || extension === 'svg') return <span className="flex h-4 w-4 shrink-0 items-center justify-center"><FileCode2 size={16} className="text-[#f28c5b]" /></span>;
  if (extension === 'css' || extension === 'scss' || extension === 'sass' || extension === 'less') return <span className="flex h-4 w-4 shrink-0 items-center justify-center"><FileCode2 size={16} className="text-[#6ab7ff]" /></span>;
  if (extension === 'txt' || extension === 'log' || extension === 'csv') return <span className="flex h-4 w-4 shrink-0 items-center justify-center"><FileText size={16} className="text-[#b8b8b8]" /></span>;
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp'].includes(extension)) return <span className="flex h-4 w-4 shrink-0 items-center justify-center"><FileImage size={16} className="text-[#c084fc]" /></span>;
  const languageLabels: Record<string, string> = {
    js: 'JS', jsx: 'JSX', mjs: 'JS', cjs: 'JS', ts: 'TS', tsx: 'TSX', py: 'PY', rb: 'RB', php: 'PHP', java: 'JAVA', kt: 'KT', kts: 'KT', swift: 'SW',
    rs: 'RS', go: 'GO', c: 'C', h: 'C', cc: 'C++', cpp: 'C++', hpp: 'C++', cs: 'C#', fs: 'F#', fsx: 'F#', vb: 'VB', scala: 'SC', dart: 'DART', lua: 'LUA', r: 'R', jl: 'JL',
    ex: 'EX', exs: 'EXS', erl: 'ERL', hrl: 'ERL', clj: 'CLJ', cljs: 'CLJS', hs: 'HS', lhs: 'HS', ml: 'ML', mli: 'MLI', sql: 'SQL', sh: 'SH', bash: 'SH', zsh: 'SH', fish: 'SH',
    ps1: 'PS', psm1: 'PS', bat: 'BAT', cmd: 'CMD', pl: 'PL', pm: 'PL', groovy: 'GR', pas: 'PAS', asm: 'ASM', s: 'ASM', zig: 'ZIG', nim: 'NIM', cr: 'CR', sol: 'SOL',
  };
  const languageColors: Record<string, string> = { js: '#f6d84a', jsx: '#61dafb', ts: '#6ab7ff', tsx: '#6ab7ff', py: '#6aa84f', rb: '#d45b64', php: '#b39ddb', java: '#e58b63', kt: '#c084fc', swift: '#f28c5b', rs: '#d9a066', go: '#72c7d6', cs: '#9bd36a', dart: '#55c2e8', lua: '#7b9fe8', sql: '#d6a85c', sh: '#8fd18a', ps1: '#6ab7ff', zig: '#f0a35b', sol: '#9b9b9b' };
  const label = languageLabels[extension];
  if (label) return <span className="flex h-4 w-4 shrink-0 items-center justify-center"><span title={extension} className="text-[7px] font-bold leading-none" style={{ color: languageColors[extension] || '#d9a066' }}>{label}</span></span>;
  return <span className="flex h-4 w-4 shrink-0 items-center justify-center"><File size={16} className="text-[#a8a8a8]" /></span>;
};

function FilesView({ projectPath }: { projectPath: string }) {
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [showTree, setShowTree] = useState(true);
  const [selectedPath, setSelectedPath] = useState('');
  const [selectedContent, setSelectedContent] = useState('');
  const [fileLoading, setFileLoading] = useState(false);
  const treeScrollRef = useRef<HTMLDivElement>(null);
  const treeScrollTopRef = useRef(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadFiles = async () => {
    if (!projectPath) return;
    setLoading(true);
    try {
      const result = await invoke<FileEntry[]>('codeclub_list_files', { projectPath, maxFiles: 1200 });
      setEntries(result);
      // Un proyecto grande puede contener miles de carpetas (por ejemplo node_modules).
      // Mantenerlas cerradas evita montar todo el árbol de golpe y conserva el layout.
      setExpanded(new Set());
      setError('');
    } catch (reason) { setError(String(reason)); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    setSelectedPath('');
    setSelectedContent('');
    setQuery('');
    treeScrollTopRef.current = 0;
    void loadFiles();
  }, [projectPath]);

  useEffect(() => {
    if (treeScrollRef.current) treeScrollRef.current.scrollTop = treeScrollTopRef.current;
  });

  const openFile = async (path: string) => {
    if (!projectPath) return;
    setSelectedPath(path);
    setFileLoading(true);
    try {
      setSelectedContent(await invoke<string>('codeclub_read_file', { projectPath, path }));
    } catch (reason) {
      setSelectedContent(`No se pudo abrir el archivo:\n${String(reason)}`);
    } finally { setFileLoading(false); }
  };

  const tree = useMemo(() => buildTree(entries), [entries]);
  const matches = (node: FileNode) => !query.trim() || node.path.toLowerCase().includes(query.trim().toLowerCase());
  const renderTree = (nodes: FileNode[], depth = 0): React.ReactNode => nodes.filter((node) => matches(node) || node.children.some((child) => matches(child))).map((node) => {
    const isOpen = expanded.has(node.path) || Boolean(query.trim());
    const isDirectory = node.kind === 'directory';
    return <React.Fragment key={node.path}>
      <button type="button" onClick={() => isDirectory ? setExpanded((current) => { const next = new Set(current); next.has(node.path) ? next.delete(node.path) : next.add(node.path); return next; }) : void openFile(node.path)} className={`flex min-h-[30px] w-max min-w-full items-center gap-2 whitespace-nowrap rounded-md px-2 text-left text-[12px] transition-colors hover:bg-white/[0.04] ${selectedPath === node.path ? 'bg-[#1e1e1e] text-[#eeeeee]' : 'text-[#eeeeee]'}`} style={{ paddingLeft: `${8 + depth * 14}px` }}>
        <span className="w-4 shrink-0 text-[#8b8b8b]">{isDirectory && <ChevronRight size={15} className={isOpen ? 'rotate-90 transition-transform' : 'transition-transform'} />}</span>
        {isDirectory ? (isOpen ? <FolderOpen size={15} className="text-[#c8c8c8]" /> : <Folder size={15} className="text-[#c8c8c8]" />) : iconForFile(node.name)}
        <span className="whitespace-nowrap">{node.name}</span>
      </button>
      {isDirectory && isOpen && <div className="relative"><span className="pointer-events-none absolute bottom-0 top-0 border-l border-[#2b2b2b]" style={{ left: `${8 + depth * 14}px` }} />{renderTree(node.children, depth + 1)}</div>}
    </React.Fragment>;
  });

  return <div className="flex h-full max-h-full min-h-0 flex-1 flex-col overflow-hidden bg-[#111111]">
    <div className="flex h-[34px] shrink-0 items-center justify-between border-b border-[#2b2b2b] bg-[#111111] px-2">
      <span className="min-w-0 truncate text-[12px] leading-none text-[#eeeeee]">{selectedPath ? `/${selectedPath.replace(/\\/g, '/')}` : '/'}</span>
      <button type="button" onClick={() => setShowTree((visible) => !visible)} className="grid h-7 w-7 place-items-center rounded-[7px] bg-[#202020] text-[#eeeeee] hover:bg-[#2b2b2b]" title="Mostrar u ocultar árbol del workspace" aria-label="Mostrar u ocultar árbol del workspace"><FolderOpen size={15} /></button>
    </div>
    <div className="flex h-0 min-h-0 max-h-full flex-1 overflow-hidden">
      <main className="flex h-full min-w-0 min-h-0 flex-1 flex-col bg-[#111111]">
        {selectedPath ? <div className="flex min-h-0 flex-1 flex-col">{fileLoading ? <div className="flex flex-1 items-center justify-center text-xs text-[#777777]">Cargando archivo...</div> : <pre className="file-preview-scrollbar m-0 min-h-0 flex-1 overflow-auto whitespace-pre-wrap p-4 font-mono text-[12px] leading-5 text-[#d8d8d8]">{selectedContent}</pre>}</div> : <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center"><Folders size={42} strokeWidth={1.5} className="text-[#a7a7a7]" /><div className="max-w-[300px]"><p className="m-0 text-[18px] font-semibold text-[#eeeeee]">Abrir archivo</p><p className="m-0 mt-2 text-[14px] leading-5 text-[#a7a7a7]">Selecciona un archivo del árbol del espacio de trabajo</p></div></div>}
      </main>
      <aside className={`h-full max-h-full min-h-0 self-stretch flex shrink-0 flex-col border-l border-[#2b2b2b] bg-[#121212] transition-[width,transform,opacity] duration-200 ease-out ${showTree ? 'w-[35%]' : 'w-0 translate-x-full opacity-0 pointer-events-none'}`}>
        <div className="mt-0 flex h-0 min-h-0 flex-1 flex-col px-3 py-3">
          <label className="mb-2 flex h-8 shrink-0 items-center gap-2 rounded-[10px] border border-[#353535] bg-[#1d1d1d] px-2.5 text-[#9a9a9a] focus-within:border-[#555555]"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} className="min-w-0 flex-1 bg-transparent text-[12px] text-[#eeeeee] outline-none placeholder:text-[#929292]" placeholder="Filtrar archivos..." aria-label="Filtrar archivos" /></label>
          <div ref={treeScrollRef} onScroll={(event) => { treeScrollTopRef.current = event.currentTarget.scrollTop; }} style={{ overscrollBehavior: 'none', overflowAnchor: 'none' }} className="h-0 min-h-0 flex-1 overflow-x-auto overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {loading ? <div className="p-3 text-sm text-[#777777]">Cargando archivos...</div> : error ? <div className="p-3 text-sm text-[#c28d8d]">{error}</div> : tree.length ? renderTree(tree) : <div className="p-3 text-sm text-[#777777]">No se encontraron archivos.</div>}
          </div>
        </div>
      </aside>
    </div>
  </div>;
}

function WhatsAppTerminalView() {
  const [logs, setLogs] = useState<string[]>(['$ whatsapp bridge --persistent']);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    const appendLog = (message: string) => setLogs((current) => [...current, `${new Date().toLocaleTimeString()}  ${message}`].slice(-500));
    const connect = async () => {
      unlisten = await listen<any>('codeclub:whatsapp-event', (event) => {
        const payload = event.payload || {};
        if (payload.type === 'qr') { setRefreshing(false); appendLog('QR generado; escanealo desde WhatsApp > Dispositivos vinculados'); }
        else if (payload.type === 'ready') { setRefreshing(false); whatsappContextStore.set({ ...whatsappContextStore.get(), connected: true, account: payload.name || payload.phone }); appendLog(`Conectado como ${payload.name || payload.phone || 'cuenta desconocida'}`); }
        else if (payload.type === 'chats') { whatsappContextStore.set({ ...whatsappContextStore.get(), chats: payload.chats || [] }); appendLog(`Conversaciones recibidas: ${payload.chats?.length || 0}`); }
        else if (payload.type === 'message') { const current = whatsappContextStore.get(); const chatId = payload.chat?.id; whatsappContextStore.set({ ...current, chats: chatId ? [payload.chat, ...current.chats.filter((chat) => chat.id !== chatId)] : current.chats, messages: chatId ? { ...current.messages, [chatId]: [...(current.messages[chatId] || []), payload.message].slice(-300) } : current.messages }); appendLog(`Mensaje recibido en ${payload.chat?.name || payload.chat?.id || 'chat'}`); }
        else if (payload.type === 'chat_messages') { const current = whatsappContextStore.get(); whatsappContextStore.set({ ...current, messages: { ...current.messages, [payload.chatId]: payload.messages || [] } }); }
        else if (payload.type === 'error') appendLog(`ERROR ${payload.message || 'sin detalle'}`);
        else if (payload.type === 'disconnected') appendLog(payload.reason || 'WhatsApp desconectado');
        else if (payload.type === 'session_reset') appendLog(payload.reason || 'Sesión reiniciada');
        else if (payload.type === 'logged_out') appendLog('Sesión cerrada');
        else appendLog(JSON.stringify(payload));
      });
      if (disposed) return;
      try {
        await invoke('codeclub_whatsapp_start');
        appendLog('Bridge iniciado');
      } catch (error) { appendLog(`ERROR ${String(error)}`); }
    };
    void connect();
    return () => { disposed = true; unlisten?.(); void invoke('codeclub_whatsapp_stop').catch(() => undefined); };
  }, []);

  return <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-[#111111]">
    <div className="flex h-[34px] shrink-0 items-center justify-between border-b border-[#2b2b2b] bg-[#111111] px-2 text-[12px] text-[#eeeeee]">
      <span>WhatsApp</span>
      <div className="flex items-center gap-1">
        <button type="button" onClick={() => { setRefreshing(true); setLogs((current) => [...current, `${new Date().toLocaleTimeString()}  Actualizando bridge...`].slice(-500)); void invoke('codeclub_whatsapp_refresh').catch((error) => { setRefreshing(false); setLogs((current) => [...current, `ERROR ${String(error)}`].slice(-500)); }); }} className="grid h-7 w-7 place-items-center rounded-[7px] bg-[#202020] text-[#eeeeee] hover:bg-[#2b2b2b]" title="Actualizar WhatsApp" aria-label="Actualizar WhatsApp"><RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} /></button>
        <button type="button" onClick={() => { setLogs((current) => [...current, `${new Date().toLocaleTimeString()}  Cerrando sesión...`].slice(-500)); void invoke('codeclub_whatsapp_logout').catch((error) => setLogs((current) => [...current, `ERROR ${String(error)}`].slice(-500))); }} className="grid h-7 w-7 place-items-center rounded-[7px] bg-[#202020] text-[#eeeeee] hover:bg-[#2b2b2b]" title="Cerrar sesión de WhatsApp" aria-label="Cerrar sesión de WhatsApp"><LogOut size={14} /></button>
      </div>
    </div>
    <pre className="file-preview-scrollbar m-0 min-h-0 flex-1 overflow-auto whitespace-pre-wrap bg-[#101010] p-3 font-mono text-[11px] leading-5 text-[#b9b9b9]">{logs.join('\n')}</pre>
  </div>;
}

function LegacyWhatsAppView() {
  const [query, setQuery] = useState('');
  const [showConversations, setShowConversations] = useState(true);
  const [qr, setQr] = useState('');
  const [status, setStatus] = useState('Conectando con WhatsApp...');
  const [chats, setChats] = useState<Array<{ id: string; name: string; unreadCount: number; timestamp?: number; pinned?: number }>>([]);
  const [activeChatId, setActiveChatId] = useState('');
  const [messages, setMessages] = useState<Record<string, Array<{ id: string; body: string; fromMe: boolean }>>>({});
  const [input, setInput] = useState('');
  const [chatDebug, setChatDebug] = useState('Esperando datos de WhatsApp...');
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    const handleEvent = (payload: any) => {
      if (payload.type === 'qr') { setRefreshing(false); setQr(payload.dataUrl); setStatus('Escaneá el código QR con WhatsApp'); }
      if (payload.type === 'ready') {
        setQr('');
        setRefreshing(false);
        const account = payload.name || payload.phone;
        setStatus(account ? `Conectado como ${account}` : 'Conectado');
      }
      if (payload.type === 'session_reset') { setRefreshing(false); setQr(''); setChats([]); setActiveChatId(''); setStatus('Sesión expirada. Generando un nuevo QR...'); }
      if (payload.type === 'logged_out') {
        setRefreshing(false);
        setQr('');
        setChats([]);
        setActiveChatId('');
        setMessages({});
        setChatDebug('Sesión limpia. Esperando nuevas conversaciones...');
        setStatus('Sesión cerrada. Generando un nuevo QR...');
        setTimeout(() => { if (!disposed) void invoke('codeclub_whatsapp_start').catch((error) => setStatus(String(error))); }, 300);
      }
      if (payload.type === 'error') setStatus(payload.message || 'No se pudo conectar con WhatsApp');
      if (payload.type === 'disconnected') { setRefreshing(false); setQr(''); setStatus(payload.reason || 'WhatsApp desconectado'); }
      if (payload.type === 'chats') {
        const nextChats = payload.chats || [];
        setChats(nextChats);
        setChatDebug(`Evento recibido: ${nextChats.length} conversaciones`);
      }
      if (payload.type === 'message') {
        setChats((current) => [payload.chat, ...current.filter((chat) => chat.id !== payload.chat.id)]);
        setMessages((current) => ({ ...current, [payload.chat.id]: [...(current[payload.chat.id] || []).filter((message) => message.id !== payload.message.id), payload.message] }));
      }
      if (payload.type === 'chat_messages') setMessages((current) => ({ ...current, [payload.chatId]: payload.messages || [] }));
    };
    const connect = async () => {
      unlisten = await listen<any>('codeclub:whatsapp-event', (event) => handleEvent(event.payload));
      if (disposed) return;
      try {
        await invoke('codeclub_whatsapp_start');
      } catch (error) { setStatus(String(error)); }
    };
    void connect();
    return () => { disposed = true; unlisten?.(); void invoke('codeclub_whatsapp_stop').catch(() => undefined); };
  }, []);

  const activeChat = chats.find((chat) => chat.id === activeChatId);
  const activeChatNumber = activeChat?.id.split('@')[0] || '';
  const activeChatTitle = activeChat
    ? activeChat.name === activeChatNumber
      ? `WhatsApp - ${activeChatNumber}`
      : `WhatsApp - ${activeChatNumber} - ${activeChat.name}`
    : 'WhatsApp';
  const visibleChats = chats
    .filter((chat) => chat.name.toLowerCase().includes(query.toLowerCase()))
    .sort((left, right) => {
      const pinnedOrder = Number(Boolean(right.pinned)) - Number(Boolean(left.pinned));
      return pinnedOrder || ((right.timestamp || 0) - (left.timestamp || 0));
    });
  const sendMessage = async () => {
    const body = input.trim();
    if (!body || !activeChatId) return;
    await invoke('codeclub_whatsapp_send', { chatId: activeChatId, body });
    setMessages((current) => ({ ...current, [activeChatId]: [...(current[activeChatId] || []), { id: `local-${Date.now()}`, body, fromMe: true }] }));
    setInput('');
  };
  const openChat = async (chatId: string) => {
    setActiveChatId(chatId);
    await invoke('codeclub_whatsapp_get_messages', { chatId }).catch(() => undefined);
  };

  return <div className="flex h-full max-h-full min-h-0 flex-1 flex-col overflow-hidden bg-[#111111]">
    <div className="flex h-[34px] shrink-0 items-center justify-between border-b border-[#2b2b2b] bg-[#111111] px-2">
      <span className="min-w-0 truncate text-[12px] leading-none text-[#eeeeee]">{activeChatTitle}</span>
      <div className="flex items-center gap-1">
        <button type="button" onClick={() => { setRefreshing(true); setChatDebug('Actualizando conversaciones...'); void invoke('codeclub_whatsapp_refresh').catch((error) => { setRefreshing(false); setChatDebug(String(error)); }); }} className="grid h-7 w-7 place-items-center rounded-[7px] bg-[#202020] text-[#eeeeee] hover:bg-[#2b2b2b]" title="Actualizar conversaciones" aria-label="Actualizar conversaciones">
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
        </button>
        <button type="button" onClick={() => { setStatus('Cerrando sesión de WhatsApp...'); void invoke('codeclub_whatsapp_logout').catch((error) => setStatus(String(error))); }} className="grid h-7 w-7 place-items-center rounded-[7px] bg-[#202020] text-[#eeeeee] hover:bg-[#2b2b2b]" title="Cerrar sesión de WhatsApp" aria-label="Cerrar sesión de WhatsApp">
          <LogOut size={14} />
        </button>
        <button type="button" onClick={() => setShowConversations((visible) => !visible)} className="grid h-7 w-7 place-items-center rounded-[7px] bg-[#202020] text-[#eeeeee] hover:bg-[#2b2b2b]" title={showConversations ? 'Ocultar conversaciones' : 'Mostrar conversaciones'} aria-label={showConversations ? 'Ocultar conversaciones' : 'Mostrar conversaciones'}>
          <MessageCircle size={15} />
        </button>
      </div>
    </div>
    <div className="flex h-0 min-h-0 max-h-full flex-1 overflow-hidden">
      <main className="flex h-full min-w-0 min-h-0 flex-1 flex-col bg-[#111111]">
        {qr ? <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center"><img src={qr} alt="Código QR de WhatsApp" className="h-[220px] w-[220px] rounded-xl bg-white p-2" /><div><p className="m-0 text-[17px] font-semibold text-[#eeeeee]">Vincular WhatsApp</p><p className="m-0 mt-2 text-[13px] leading-5 text-[#a7a7a7]">Abrí WhatsApp en tu teléfono y escaneá este código</p></div></div> : activeChat ? <div className="flex min-h-0 flex-1 flex-col"><div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">{(messages[activeChatId] || []).map((message) => <div key={message.id} className={`max-w-[78%] rounded-lg px-2.5 py-1.5 text-[12px] ${message.fromMe ? 'self-end bg-[#1e3a2b] text-[#e2f4e9]' : 'self-start bg-[#1d1d1d] text-[#eeeeee]'}`}>{message.body}</div>)}</div><div className="shrink-0 border-t border-[#2b2b2b] p-2"><div className="flex items-center gap-2 rounded-full border border-[#353535] bg-[#1d1d1d] px-3 py-1"><input value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void sendMessage(); }} className="min-w-0 flex-1 bg-transparent py-1 text-[12px] text-[#eeeeee] outline-none" placeholder="Escribí un mensaje..." /><button type="button" onClick={() => void sendMessage()} className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#79c893] text-[#111111]" aria-label="Enviar mensaje" title="Enviar mensaje"><ArrowUpRight size={16} strokeWidth={2} /></button></div></div></div> : <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center"><MessageCircle size={42} strokeWidth={1.5} className="text-[#a7a7a7]" /><div className="max-w-[300px]"><p className="m-0 text-[18px] font-semibold text-[#eeeeee]">{status}</p><p className="m-0 mt-2 text-[14px] leading-5 text-[#a7a7a7]">Seleccioná un chat cuando WhatsApp esté conectado</p></div></div>}
      </main>
      <aside className={`h-full max-h-full min-h-0 shrink-0 overflow-hidden border-l border-[#2b2b2b] bg-[#121212] transition-[width,transform,opacity] duration-200 ease-out ${showConversations ? 'w-[35%]' : 'w-0 translate-x-full opacity-0 border-l-0 pointer-events-none'}`}>
        <div className="flex h-full min-h-0 flex-1 flex-col px-3 py-3">
          <label className="mb-2 flex h-8 shrink-0 items-center gap-2 rounded-[10px] border border-[#353535] bg-[#1d1d1d] px-2.5 text-[#9a9a9a] focus-within:border-[#555555]"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} className="min-w-0 flex-1 bg-transparent text-[12px] text-[#eeeeee] outline-none placeholder:text-[#929292]" placeholder="Buscar conversaciones..." aria-label="Buscar conversaciones" /></label>
          <div className="min-h-0 flex-1 max-h-full overflow-y-auto bg-[#121212] p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">{visibleChats.length ? visibleChats.map((chat) => <button key={chat.id} type="button" onClick={() => void openChat(chat.id)} className={`flex min-h-[34px] w-full items-center gap-2 rounded-md px-2 text-left text-[12px] ${activeChatId === chat.id ? 'bg-[#1e1e1e] text-[#eeeeee]' : 'text-[#cccccc] hover:bg-white/[0.04]'}`}><MessageCircle size={14} className="shrink-0 text-[#79c893]" /><span className="min-w-0 flex-1 truncate">{chat.name}</span>{chat.unreadCount > 0 && <span className="text-[10px] text-[#79c893]">{chat.unreadCount}</span>}</button>) : <div className="px-2 py-4 text-center"><p className="m-0 text-[12px] text-[#777777]">{query ? 'No se encontraron conversaciones.' : 'No hay conversaciones disponibles.'}</p><p className="m-0 mt-2 text-[10px] text-[#555555]">{chatDebug}</p></div>}</div>
        </div>
      </aside>
    </div>
  </div>;
}

export default function RightSidebar() {
  type RightTab = 'files' | 'review' | 'browser' | 'artifacts' | 'whatsapp';
  const labels: Record<RightTab, string> = { files: 'Archivos', review: 'Revisar', browser: 'Navegador', artifacts: 'Artifacts', whatsapp: 'WhatsApp' };
  const availableTabs: RightTab[] = ['files', 'review', 'browser', 'artifacts', 'whatsapp'];
  const [tabs, setTabs] = React.useState<RightTab[]>([]);
  const [activeTab, setActiveTab] = React.useState<RightTab | null>(null);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [activeProjectPath, setActiveProjectPath] = useState('');
  const [activeProjectName, setActiveProjectName] = useState('');
  const [artifactState, setArtifactState] = useState<AgentState>({ plan: null, plans: [], todos: [] });
  const [businessState, setBusinessState] = useState<BusinessWorkspace | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const resizingRef = useRef(false);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      if (!resizingRef.current) return;
      const leftWidth = document.body.classList.contains('has-sidebar') ? 264 : 0;
      const availableWidth = Math.max(0, window.innerWidth - leftWidth);
      const minimum = availableWidth * 0.35;
      const maximum = availableWidth - minimum;
      const width = Math.min(maximum, Math.max(minimum, window.innerWidth - event.clientX));
      document.body.style.setProperty('--right-panel-width', `${width}px`);
    };
    const stopResize = () => { resizingRef.current = false; document.body.style.removeProperty('user-select'); };
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', stopResize);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', stopResize);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadArtifacts = async () => {
      if (!activeProjectPath) { setArtifactState({ plan: null, plans: [], todos: [] }); setBusinessState(null); return; }
      const next = await readAgentState(activeProjectPath);
      if (!cancelled) setArtifactState(next);
      const business = await readBusinessWorkspace(activeProjectPath);
      if (!cancelled) setBusinessState(business);
    };
    void loadArtifacts();
    const handleArtifactsChanged = (event: Event) => {
      const projectPath = (event as CustomEvent<{ projectPath?: string }>).detail?.projectPath;
      if (!projectPath || projectPath === activeProjectPath) void loadArtifacts();
    };
    window.addEventListener('codeclub:artifacts-changed', handleArtifactsChanged);
    return () => { cancelled = true; window.removeEventListener('codeclub:artifacts-changed', handleArtifactsChanged); };
  }, [activeProjectPath, activeTab]);

  useEffect(() => {
    if (!menuOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer);
  }, [menuOpen]);

  useEffect(() => {
    const handleProject = (event: Event) => {
      const detail = (event as CustomEvent<{ projectPath?: string; projectName?: string }>).detail;
      const projectPath = detail?.projectPath || '';
      setActiveProjectPath(projectPath);
      setActiveProjectName(detail?.projectName || projectPath.split(/[\\/]/).pop() || '');
    };
    window.addEventListener('codeclub:active-project', handleProject);
    window.addEventListener('codeclub:project-selection-changed', handleProject);
    return () => {
      window.removeEventListener('codeclub:active-project', handleProject);
      window.removeEventListener('codeclub:project-selection-changed', handleProject);
    };
  }, []);

  const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    resizingRef.current = true;
    document.body.style.userSelect = 'none';
  };

  const addTab = () => {
    setMenuOpen((open) => !open);
  };

  const createTab = (tab: RightTab) => {
    setTabs((current) => current.includes(tab) ? current : [...current, tab]);
    setActiveTab(tab);
    setMenuOpen(false);
  };

  useEffect(() => {
    const openArtifacts = (event: Event) => {
      const projectPath = (event as CustomEvent<{ projectPath?: string }>).detail?.projectPath;
      if (projectPath && projectPath !== activeProjectPath) setActiveProjectPath(projectPath);
      setTabs((current) => current.includes('artifacts') ? current : [...current, 'artifacts']);
      setActiveTab('artifacts');
      setMenuOpen(false);
    };
    window.addEventListener('codeclub:open-artifacts', openArtifacts);
    return () => window.removeEventListener('codeclub:open-artifacts', openArtifacts);
  }, [activeProjectPath]);

  const closeTab = (tab: RightTab) => {
    setTabs((current) => current.filter((item) => item !== tab));
    setActiveTab((current) => current === tab ? null : current);
  };

  return (
    <aside className="right-sidebar relative z-40 row-start-2 col-start-3 h-full max-h-full min-w-0 min-h-0 overflow-hidden border-l border-[var(--color-surface-10)] bg-[var(--color-bg)] text-[#d8d8d8] shadow-[-4px_0_14px_rgba(0,0,0,0.16)]" aria-label="Panel lateral derecho">
      <div onPointerDown={startResize} className="absolute -left-[3px] top-0 z-20 h-full w-[6px] cursor-col-resize bg-transparent transition-colors hover:bg-[#2f2f2f]" aria-label="Redimensionar panel derecho" role="separator" />
      <div className="flex h-full min-w-[264px] flex-col">
        <div className="terminal-tabs h-[34px] shrink-0 border-b border-[var(--color-surface-10)] px-1" style={{ overflow: 'visible' }}>
          {tabs.map((tab) => (
            <button key={tab} type="button" onDoubleClick={() => closeTab(tab)} onClick={() => setActiveTab(tab)} className={`terminal-tab h-[30px] min-w-0 flex-1 justify-center rounded-[6px] border-0 px-3 text-[10px] ${activeTab === tab ? 'is-active' : ''}`}>
              {labels[tab]}
            </button>
          ))}
          <div ref={menuRef} className="terminal-new relative">
          <button type="button" onClick={addTab} className="terminal-new-tab h-[30px] w-7 rounded-[6px]" aria-label="Nueva tab" title="Nueva tab">
            <Plus size={13} strokeWidth={1.8} />
          </button>
          {menuOpen && <div className="terminal-shell-menu left-[calc(100%+4px)] right-auto top-[34px] z-[100]" role="menu">
            {availableTabs.map((tab) => <button key={tab} type="button" onClick={() => createTab(tab)} disabled={tabs.includes(tab)} className="disabled:cursor-default disabled:opacity-35" role="menuitem">{labels[tab]}</button>)}
          </div>}
          </div>
        </div>
        <div className="flex h-0 min-h-0 flex-1 flex-col overflow-hidden">
          {activeTab === 'files' && <FilesView projectPath={activeProjectPath} />}
          {activeTab === 'artifacts' && <ArtifactsView state={artifactState} business={businessState} projectPath={activeProjectPath} projectName={activeProjectName} hasProject={Boolean(activeProjectPath)} />}
          {tabs.includes('whatsapp') && <div className={activeTab === 'whatsapp' ? 'flex h-full min-h-0 flex-1' : 'hidden'}><WhatsAppTerminalView /></div>}
          {tabs.length === 0 && <div className="flex flex-1 items-center justify-center">
            <button type="button" onClick={() => setMenuOpen(true)} className="min-h-[30px] rounded-lg border border-[#202020] bg-transparent px-3 text-[11px] text-[#777777] transition-colors hover:bg-[#1c1c1c] hover:text-[#eeeeee]">
              Crear panel
            </button>
          </div>}
          {activeTab && !['files', 'artifacts', 'whatsapp'].includes(activeTab) && <div className="flex flex-1 items-center justify-center p-3 text-xs text-[#777777]">Panel {labels[activeTab]}</div>}
        </div>
      </div>
    </aside>
  );
}

function ArtifactsView({ state, business, projectPath, projectName, hasProject }: { state: AgentState; business: BusinessWorkspace | null; projectPath: string; projectName: string; hasProject: boolean }) {
  const pushReference = (kind: 'plan' | 'todo' | 'quote', id: string, title: string) => {
    window.dispatchEvent(new CustomEvent('codeclub:artifact-reference', { detail: { projectPath, kind, id, title } }));
  };
  const plans = state.plans?.length ? state.plans : state.plan ? [state.plan] : [];
  const removePlan = async (id: string) => {
    const current = await readAgentState(projectPath);
    const nextPlans = (current.plans || (current.plan ? [current.plan] : [])).filter((plan) => plan.id !== id);
    await writeAgentState(projectPath, { ...current, plans: nextPlans, plan: nextPlans[nextPlans.length - 1] || null });
    window.dispatchEvent(new CustomEvent('codeclub:artifacts-changed', { detail: { projectPath } }));
  };
  const removeTodo = async (id: string) => {
    const current = await readAgentState(projectPath);
    await writeAgentState(projectPath, { ...current, todos: current.todos.filter((todo) => todo.id !== id) });
    window.dispatchEvent(new CustomEvent('codeclub:artifacts-changed', { detail: { projectPath } }));
  };
  const removeQuote = async (id: string) => {
    const current = await readBusinessWorkspace(projectPath);
    if (!current) return;
    await writeBusinessWorkspace(projectPath, { ...current, quotes: current.quotes.filter((quote: any) => quote.id !== id) });
    window.dispatchEvent(new CustomEvent('codeclub:artifacts-changed', { detail: { projectPath } }));
  };
  if (!hasProject) return <div className="flex flex-1 items-center justify-center p-5 text-center text-[11px] text-[#777]">Seleccioná un proyecto para ver sus artifacts.</div>;
  const getTodoFromEvent = (event: React.SyntheticEvent) => {
    const row = (event.target as HTMLElement).closest('div.rounded-md');
    const titles = Array.from(row?.querySelectorAll('[title]') || []).map((element) => element.getAttribute('title'));
    return state.todos.find((todo) => titles.includes(todo.title));
  };
  return <div onDoubleClick={(event) => { const todo = getTodoFromEvent(event); if (todo) void removeTodo(todo.id); }} onContextMenu={(event) => { const todo = getTodoFromEvent(event); if (todo) { event.preventDefault(); pushReference('todo', todo.id, todo.title); } }} onMouseMove={(event) => { const row = (event.target as HTMLElement).closest('div.rounded-md') as HTMLElement | null; if (row) row.style.cursor = 'pointer'; }} className="h-full max-h-full min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 [scrollbar-width:thin] [scrollbar-color:#2b2b2b_transparent] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[#2b2b2b] [&_section+section]:mt-4">
    <div className="mb-4 flex items-center justify-between">
      <div><div className="text-[12px] font-medium text-[#eee]">Artifacts</div><div className="mt-0.5 text-[10px] text-[#666]">Elementos generados y utilizados por la IA.</div></div>
      <span className="max-w-[120px] truncate text-right text-[10px] text-[#555]" title={projectName}>{projectName}</span>
    </div>
    {plans.length > 0 && <section className="mb-4"><div className="mb-2 text-[10px] font-medium uppercase tracking-[0.08em] text-[#666]">PLAN</div><div className="grid gap-3">{plans.map((plan) => <div key={plan.id} onDoubleClick={() => void removePlan(plan.id)} onContextMenu={(event) => { event.preventDefault(); pushReference('plan', plan.id, plan.title); }} className="cursor-pointer rounded-lg border border-[#202020] bg-[#151515] p-2.5">
      <div className="mb-2 flex items-center justify-between gap-2"><span className="min-w-0 truncate text-[11px] font-medium text-[#ddd]">{plan.title}</span><ArtifactStatus status={plan.status} /></div>
      <div className="grid gap-1.5">{plan.steps.map((step) => <div key={step.id} className="flex min-w-0 items-center gap-2 text-[10px]"><ArtifactStatus status={step.status} /><span title={step.title} className="min-w-0 truncate text-[#999]">{step.title}</span></div>)}</div>
    </div>)}</div><div className="mt-4 h-px bg-[#202020]" /></section>}
    {state.todos.length > 0 ? <section className="grid gap-1.5"><div className="mb-1 text-[10px] font-medium uppercase tracking-[0.08em] text-[#666]">TODO</div>{state.todos.map((todo) => <div key={todo.id} className="flex min-w-0 items-center gap-2 rounded-md bg-[#151515] px-2 py-1.5"><ArtifactStatus status={todo.status} /><span title={todo.title} className="min-w-0 flex-1 truncate text-[11px] text-[#bbb]">{todo.title}</span></div>)}</section> : !state.plan && <div className="rounded-lg border border-dashed border-[#252525] px-3 py-5 text-center text-[11px] text-[#666]">Todavía no hay TODOs ni planes.</div>}
    {business?.quotes?.length ? <section className={`grid gap-2 ${state.plan || state.todos.length ? 'border-t border-[#202020] pt-4' : ''}`}><div className="text-[10px] font-medium uppercase tracking-[0.08em] text-[#666]">COTIZACIONES</div>{business.quotes.map((quote: any) => <QuoteArtifact key={quote.id} quote={quote} onRemove={() => void removeQuote(quote.id)} onReference={() => pushReference('quote', quote.id, quote.title || 'Cotización')} />)}</section> : null}
  </div>;
}

function QuoteArtifact({ quote, onRemove, onReference }: { quote: any; onRemove: () => void; onReference: () => void }) {
  const formatMoney = (value: number) => { try { return new Intl.NumberFormat('es-AR', { style: 'currency', currency: quote.currency || 'USD', maximumFractionDigits: 2 }).format(Number(value || 0)); } catch { return `${quote.currency || 'USD'} ${Number(value || 0).toFixed(2)}`; } };
  return <section onDoubleClick={onRemove} onContextMenu={(event) => { event.preventDefault(); onReference(); }} className="cursor-pointer overflow-hidden rounded-lg border border-[#202020] bg-[#151515] [&_thead]:bg-[#101010] [&_thead_tr]:text-[#777]">
    <div className="border-b border-[#202020] px-2.5 py-2"><div className="truncate text-[11px] font-medium text-[#ddd]">{quote.title || 'Cotización'}</div><div title={quote.description} className="mt-1 overflow-hidden text-ellipsis whitespace-nowrap text-[10px] text-[#777]">{quote.description}</div></div>
    <div className="overflow-x-auto"><table className="w-full border-collapse text-left text-[10px]"><thead><tr className="border-b border-[#202020] text-[#666]"><th className="px-2.5 py-1.5 font-medium">Ítem</th><th className="px-1 py-1.5 text-right font-medium">Cant.</th><th className="px-2.5 py-1.5 text-right font-medium">Total</th></tr></thead><tbody>{(quote.items || []).map((item: any, index: number) => <tr key={`${quote.id}-${index}`} className="border-b border-[#1d1d1d] text-[#aaa]"><td title={item.description} className="max-w-[130px] truncate px-2.5 py-1.5">{item.description}</td><td className="px-1 py-1.5 text-right">{item.quantity}</td><td className="px-2.5 py-1.5 text-right">{formatMoney(item.total ?? Number(item.quantity || 0) * Number(item.unitPrice || 0))}</td></tr>)}</tbody><tfoot><tr><td colSpan={2} className="px-2.5 py-2 text-right font-medium text-[#bbb]">Total</td><td className="px-2.5 py-2 text-right font-medium text-[#eee]">{formatMoney(quote.total)}</td></tr></tfoot></table></div>
  </section>;
}

function ArtifactStatus({ status }: { status: TaskStatus }) {
  const values: Record<TaskStatus, [string, string]> = { pending: ['•', '#777'], in_progress: ['◐', '#d8d8d8'], completed: ['✓', '#8fbe9b'], blocked: ['×', '#d98b8b'] };
  const [icon, color] = values[status] || values.pending;
  return <span title={status} style={{ color }} className="grid h-4 w-4 shrink-0 place-items-center text-[12px] leading-none">{icon}</span>;
}
