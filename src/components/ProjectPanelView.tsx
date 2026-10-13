/** Project file tabs, previews and editor; native I/O stays behind the runtime bridge. */
import React, { useEffect, useRef, useState } from 'react';
import { ArrowUp, Braces, ChevronDown, ChevronRight, Copy, Eye, FileCode2, Folder, Folders as FolderOpen, Pencil, X } from 'lucide-react';
import { createPortal } from 'react-dom';
import { generateManifest } from 'material-icon-theme';
import mammoth from 'mammoth';
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
import { desktopFileUrl as convertFileSrc, nativeInvoke as invoke, readDesktopBytes as readFile, readDesktopText as readTextFile, writeDesktopText as writeTextFile } from '../lib/runtime';
import { rightSidebarTranslations, useAppLanguage } from '../lib/i18n';
import { useDialogAccessibility, useFileTreeKeyboard, usePopupKeyboard } from './ui/use-accessible-overlay';
import { useOrbPalette } from './OrbPaletteProvider';
import { MemoizedChatMarkdown } from './ChatMarkdown';

type ProjectFileEntry = { path: string; kind: string; size?: number };
type FileTreeNode = { name: string; path: string; kind: 'directory' | 'file'; children: FileTreeNode[]; extension?: string };

const materialIconManifest = generateManifest({});

function MaterialFileIcon({ name, kind, size = 17 }: { name: string; kind: FileTreeNode['kind']; size?: number }) {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const associations = kind === 'directory' ? materialIconManifest.folderNames : materialIconManifest.fileNames;
  const extension = name.includes('.') ? name.split('.').pop()?.toLowerCase() : undefined;
  const iconName = associations?.[name.toLowerCase()] ?? (extension ? materialIconManifest.fileExtensions?.[extension] : undefined) ?? (kind === 'directory' ? materialIconManifest.folder : materialIconManifest.file);
  const iconPath = iconName ? materialIconManifest.iconDefinitions?.[iconName]?.iconPath : undefined;
  const iconFile = iconPath?.split('/').pop();
  // Relative to the exported app document, also when Electron uses file://.
  const source = iconFile ? `./material-icons/${iconFile}` : null;
  if (kind === 'file' && (extension === 'json' || extension === 'jsonl')) return <Braces size={size} strokeWidth={1.5} className="shrink-0 text-[#f9a825]" />;
  if (!source || failedSource === source) return kind === 'directory' ? <Folder size={size} aria-hidden="true" className="shrink-0 text-[#a89b72]" /> : <FileCode2 size={size} aria-hidden="true" className="shrink-0 text-[#999999]" />;
  return <img src={source} alt="" aria-hidden="true" onError={() => setFailedSource(source)} style={{ width: size, height: size }} className="shrink-0" />;
}

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
      : extension === 'html' || extension === 'htm' ? html()
      : extension === 'css' || extension === 'scss' ? css()
      : extension === 'json' ? json()
      : extension === 'md' || extension === 'mdx' || extension === 'markdown' ? markdown()
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

function FilePreview({ projectPath, file, preview = true, onChange }: { projectPath: string; file: OpenFile; preview?: boolean; onChange?: (content: string) => void }) {
  const language = useAppLanguage();
  const extension = getExtension(file.path);
  const sourcePath = file.fsPath || `${projectPath}/${file.path}`;
  if (file.error) return <div className="p-4 text-xs text-[#c28d8d]">{file.error}</div>;
  if (imageExtensions.has(extension)) return <div className="flex h-full items-center justify-center overflow-auto p-6"><img src={convertFileSrc(sourcePath)} alt={file.path} className="max-h-full max-w-full object-contain" /></div>;
  if (extension === 'pdf') return <iframe title={file.path} src={convertFileSrc(sourcePath)} sandbox="allow-same-origin" className="h-full w-full border-0 bg-white" />;
  if ((extension === 'html' || extension === 'htm') && preview) return <iframe title={file.path} srcDoc={file.content} sandbox="" className="h-full w-full border-0 bg-white" />;
  if (['md', 'markdown', 'mdx'].includes(extension) && preview) return <div className="h-full overflow-auto p-6"><article className="chat-markdown chat-markdown-assistant max-w-none break-words text-sm leading-6"><MemoizedChatMarkdown content={file.content} /></article></div>;
  if ((extension === 'csv' || extension === 'tsv') && preview) {
    const rows = parseCsv(file.content);
    return <div className="h-full overflow-auto p-4"><table className="min-w-full border-collapse text-left text-xs"><tbody>{rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((value, cellIndex) => rowIndex === 0 ? <th key={cellIndex} className="border border-[#2b2b2b] bg-[#1c1c1c] px-3 py-2 font-medium text-[#eeeeee]">{value}</th> : <td key={cellIndex} className="border border-[#2b2b2b] px-3 py-2 text-[#bdbdbd]">{value}</td>)}</tr>)}</tbody></table></div>;
  }
  if (extension === 'docx') return file.html ? <article className="prose max-w-none overflow-auto bg-white p-8 text-black" dangerouslySetInnerHTML={{ __html: file.html }} /> : <div className="p-4 text-xs text-[#8f8f8f]">{language === 'en' ? 'Converting document...' : 'Convirtiendo documento...'}</div>;
  return <CodeMirrorFileEditor path={file.path} content={file.content} onChange={onChange} />;
}

/** Project file pane embedded beside chat; references return to the composer through `codeclub:file-reference`. */
function TabbedProjectView({ projectPath, projectName, initialSelectedPath = '', showFileTree, onToggleFileTree }: { projectPath?: string; projectName?: string; initialSelectedPath?: string; showFileTree: boolean; onToggleFileTree?: () => void }) {
  const language = useAppLanguage();
  const { palette } = useOrbPalette();
  const text = rightSidebarTranslations[language];
  const [loading, setLoading] = useState(true);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const modalScrollRef = useRef<HTMLDivElement | null>(null);
  const fileDialogRef = useRef<HTMLElement | null>(null);
  useDialogAccessibility(fileDialogRef, Boolean(showFileTree), () => onToggleFileTree?.());
  const [entries, setEntries] = useState<ProjectFileEntry[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  useFileTreeKeyboard(fileDialogRef, Boolean(showFileTree), expanded, entries);
  const [tabs, setTabs] = useState<string[]>([]);
  const [previewModes, setPreviewModes] = useState<Record<string, boolean>>({});
  const [selectedPath, setSelectedPath] = useState(initialSelectedPath);
  const [fileContextMenu, setFileContextMenu] = useState<{ path: string; x: number; y: number } | null>(null);
  const fileContextMenuRef = useRef<HTMLDivElement | null>(null);
  usePopupKeyboard(fileContextMenuRef, Boolean(fileContextMenu), () => setFileContextMenu(null));
  const [files, setFiles] = useState<Record<string, OpenFile>>({});
  const saveTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const panelRef = useRef<HTMLDivElement>(null);
  const draggedFileRef = useRef<{ projectPath: string; path: string } | null>(null);
  const [, setError] = useState('');
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
  const supportsPreviewToggle = (path: string) => ['md', 'markdown', 'mdx', 'html', 'htm', 'csv', 'tsv'].includes(getExtension(path));
  const isPreviewMode = (path: string) => previewModes[path] ?? true;

  const openFile = async (path: string, replaceCurrent = false, fsPath?: string) => {
    if (!projectPath) return;
    const requestedTabPath = normalizeTabPath(fsPath || path);
    const existingTab = tabs.find((item) => item.toLowerCase() === requestedTabPath.toLowerCase());
    const tabPath = existingTab || requestedTabPath;
    const displayPath = fsPath ? fsPath.split(/[\\/]/).filter(Boolean).pop() || path : path;
    setSelectedPath(tabPath);
    window.dispatchEvent(new CustomEvent('codeclub:recent-item', { detail: { kind: 'file', path: tabPath, name: displayPath, projectPath } }));
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
      // Ignore drag data that was not produced by the project indexer.
    }
  };

  useEffect(() => () => Object.values(saveTimersRef.current).forEach((timer) => clearTimeout(timer)), []);

  useEffect(() => {
    if (!fileContextMenu) return undefined;
    const closeMenu = (event: PointerEvent) => { if (!fileContextMenuRef.current?.contains(event.target as Node)) setFileContextMenu(null); };
    const closeWithEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setFileContextMenu(null); };
    window.addEventListener('pointerdown', closeMenu);
    window.addEventListener('keydown', closeWithEscape);
    return () => { window.removeEventListener('pointerdown', closeMenu); window.removeEventListener('keydown', closeWithEscape); };
  }, [fileContextMenu]);

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
    setFileContextMenu(null);
    setTabs((current) => {
      const index = current.indexOf(path);
      const next = current.filter((item) => item !== path);
      if (selectedPath === path) setSelectedPath(next[index - 1] || next[index] || '');
      return next;
    });
    setFiles((current) => { const next = { ...current }; delete next[path]; return next; });
  };

  const closeOtherFiles = (path: string) => {
    setTabs([path]);
    setSelectedPath(path);
    setFiles((current) => ({ [path]: current[path] }));
    setFileContextMenu(null);
  };

  const closeFilesToRight = (path: string) => {
    const index = tabs.indexOf(path);
    if (index < 0) return;
    const remaining = tabs.slice(0, index + 1);
    setTabs(remaining);
    setFiles((current) => Object.fromEntries(remaining.filter((item) => current[item]).map((item) => [item, current[item]])));
    setFileContextMenu(null);
  };

  const tree = buildFileTree(entries);
  const renderTree = (nodes: FileTreeNode[], depth = 0): React.ReactNode => nodes.map((node, index) => {
    const isOpen = expanded.has(node.path);
    return <React.Fragment key={node.path}>
      <button id={`project-tree-${encodeURIComponent(node.path)}`} type="button" role="treeitem" aria-level={depth + 1} aria-posinset={index + 1} aria-setsize={nodes.length} aria-expanded={node.kind === 'directory' ? isOpen : undefined} aria-current={selectedPath === node.path ? true : undefined} onContextMenu={(event) => { if (node.kind !== 'file' || !projectPath) return; event.preventDefault(); const path = `${projectPath.replace(/[\/]+$/, '')}\\${node.path.replace(/\//g, '\\')}`; window.dispatchEvent(new CustomEvent('codeclub:file-reference', { detail: { path } })); onToggleFileTree?.(); }} onClick={() => node.kind === 'directory' ? setExpanded((current) => { const next = new Set(current); next.has(node.path) ? next.delete(node.path) : next.add(node.path); return next; }) : void openFile(node.path)} className={`flex w-full items-center gap-1.5 rounded-md border px-2 py-1.5 text-left text-[12px] ${selectedPath === node.path ? 'border-[#3d9bff] bg-[#3d9bff12] text-[#eeeeee]' : 'border-transparent text-[#bdbdbd] hover:bg-[var(--color-surface-3)]'}`} style={{ paddingLeft: `${8 + depth * 14}px` }}>
        {node.kind === 'directory' ? (isOpen ? <ChevronDown size={13} aria-hidden="true" /> : <ChevronRight size={13} aria-hidden="true" />) : <span className="w-[13px]" />}
        <MaterialFileIcon name={node.name} kind={node.kind} />
        <span className="min-w-0 flex-1 truncate">{node.name}</span>
      </button>
      {node.kind === 'directory' && isOpen && renderTree(node.children, depth + 1)}
    </React.Fragment>;
  });

  return <div ref={panelRef} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; }} onDrop={handleFileDrop} className="codeclub-project-files flex h-full w-full min-w-0 flex-col overflow-hidden rounded-tl-lg bg-[#111111] text-[#eeeeee] [&>div:first-child]:hidden">
    <div className="flex h-9 shrink-0 items-center justify-between border-b border-[#2b2b2b] px-4"><span className="text-[13px] leading-none">/</span><button type="button" onClick={() => setShowFileTree()} className="grid h-7 w-7 place-items-center rounded-[9px] bg-[#202020] text-[#eeeeee] hover:bg-[#2b2b2b]" title={text.toggleTree} aria-label={text.toggleTree}><FolderOpen size={16} /></button></div>
    {loading ? <div className="flex flex-1 items-center justify-center text-xs text-[#999999]">{text.loadingFiles}</div> : <div className="flex min-h-0 flex-1">
      <section aria-label={language === 'en' ? 'Open files and preview' : 'Archivos abiertos y vista previa'} className="flex min-w-0 flex-1 flex-col bg-[#111111]">{tabs.length ? <><div role="group" aria-label={language === 'en' ? 'Open files' : 'Archivos abiertos'} className="file-tabs-scrollbar flex h-9 shrink-0 items-center gap-1 overflow-x-auto overflow-y-hidden border-b border-[#2b2b2b] bg-transparent px-2">{tabs.map((path) => { const fileName = path.split(/[\\/]/).pop() || path; return <div key={path} onContextMenu={(event) => { event.preventDefault(); setFileContextMenu({ path, x: event.clientX, y: event.clientY }); }} className={`group flex h-7 max-w-[190px] min-w-[110px] shrink-0 items-center gap-2 rounded-md px-2.5 text-[11px] transition-colors ${selectedPath === path ? 'text-[#eeeeee]' : 'text-[#999999] hover:text-[#bdbdbd]'}`}><MaterialFileIcon name={fileName} kind="file" /><button type="button" onClick={() => setSelectedPath(path)} aria-pressed={selectedPath === path} className="min-w-0 flex-1 truncate bg-transparent text-left">{fileName}</button><span className="ml-auto flex shrink-0 items-center gap-0.5">{supportsPreviewToggle(path) && <button type="button" onClick={() => setPreviewModes((current) => ({ ...current, [path]: !isPreviewMode(path) }))} className="grid h-5 w-5 shrink-0 place-items-center rounded-md text-[#999999] transition-colors hover:bg-white/10 hover:text-(--codeclub-text-strong)" title={isPreviewMode(path) ? (language === 'en' ? 'Edit file' : 'Editar archivo') : (language === 'en' ? 'Preview file' : 'Previsualizar archivo')} aria-label={`${isPreviewMode(path) ? (language === 'en' ? 'Edit' : 'Editar') : (language === 'en' ? 'Preview' : 'Previsualizar')}: ${path}`}>{isPreviewMode(path) ? <Pencil size={11} strokeWidth={1.8} /> : <Eye size={12} strokeWidth={1.8} />}</button>}<button type="button" onClick={() => closeFile(path)} className={`grid h-5 w-5 shrink-0 place-items-center rounded-md text-[#999999] transition-opacity hover:bg-white/10 hover:text-white ${selectedPath === path ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100'}`} title={text.closeTab} aria-label={`${text.closeTab}: ${path}` }><X size={12} /></button></span></div>; })}</div><div className="min-h-0 flex-1 overflow-hidden bg-transparent">{files[selectedPath] ? <FilePreview projectPath={projectPath || ''} file={files[selectedPath]} preview={isPreviewMode(selectedPath)} onChange={(content) => handleContentChange(selectedPath, content)} /> : <div className="p-4 text-xs text-[#999999]">{text.loadingFile}</div>}</div></> : <div className="flex h-full flex-col items-center justify-center px-5 text-center"><div><p className="mt-3 mb-0 text-[12px] text-(--codeclub-text-strong)">{projectName || projectPath?.split(/[\\/]/).filter(Boolean).pop()}</p><p className="mt-1 mb-0 text-[11px] leading-5 text-(--codeclub-text-muted)">{text.selectFile}</p></div></div>}</section>
{showFileTree && typeof document !== 'undefined' && createPortal(<div className="fixed inset-0 z-[2147483647] flex items-center justify-center bg-black/60 p-4 backdrop-blur-[3px]" style={{ '--codeclub-accent': palette.accent } as React.CSSProperties} onMouseDown={(event) => { if (event.target === event.currentTarget) onToggleFileTree?.(); }}><section ref={fileDialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label={language === 'en' ? 'Project files' : 'Archivos del proyecto'} className="codeclub-file-dialog relative flex h-[min(480px,80dvh)] w-[min(640px,92vw)] flex-col overflow-hidden rounded-[20px] border border-[#151515] bg-[#111111] shadow-2xl shadow-black/60"><header className="flex shrink-0 items-center justify-between border-b border-[#202020] px-4 py-2"><h2 className="m-0 text-[13px] font-medium">{language === 'en' ? 'Project files' : 'Archivos del proyecto'}</h2><button type="button" onClick={() => onToggleFileTree?.()} aria-label={language === 'en' ? 'Close project files' : 'Cerrar archivos del proyecto'} title={language === 'en' ? 'Close project files' : 'Cerrar archivos del proyecto'} className="grid h-7 w-7 place-items-center rounded-md text-[#aaaaaa] hover:bg-white/10"><X size={14} aria-hidden="true" /></button></header><div ref={modalScrollRef} onScroll={(event) => setShowScrollTop(event.currentTarget.scrollTop > 180)} className="project-files-modal-scroll min-h-0 flex-1 overflow-auto p-4">{loading ? <div className="grid h-full place-items-center text-xs text-[#999999]">{text.loadingFiles}</div> : tree.length ? <><section aria-label={language === 'en' ? 'Folders' : 'Carpetas'}><h3 className="mb-3 mt-0 text-[12px] font-semibold text-[#a8a8a8]">{language === 'en' ? 'Folders' : 'Carpetas'}</h3><div className="grid grid-cols-[repeat(auto-fill,minmax(144px,1fr))] gap-2">{tree.filter((node) => node.kind === 'directory').map((node) => <button key={node.path} type="button" onClick={() => document.getElementById(`project-tree-${encodeURIComponent(node.path)}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })} className="group flex h-[52px] min-w-0 items-center gap-2 rounded-xl border-0 bg-[#161616] px-3 text-left transition-colors hover:bg-[color-mix(in_srgb,var(--codeclub-accent)_9%,#161616)] focus-visible:outline-2 focus-visible:outline-(--codeclub-accent)" aria-label={`${language === 'en' ? 'Go to folder' : 'Ir a la carpeta'} ${node.name}`}><MaterialFileIcon name={node.name} kind={node.kind} size={22} /><span className="min-w-0 flex-1"><span className="block truncate text-[12px] font-medium text-[#e3e3e3]">{node.name}</span><span className="mt-0.5 block text-[10px] text-[#999999]">{node.children.length} {language === 'en' ? 'items' : 'elementos'}</span></span><ChevronRight size={15} className="shrink-0 text-[#686868] transition-transform group-hover:translate-x-0.5 group-hover:text-(--codeclub-accent)" aria-hidden="true"/></button>)}</div></section><section className="mt-4" aria-label={language === 'en' ? 'All files' : 'Todos los archivos'}><h3 className="mb-2 mt-0 text-[12px] font-semibold text-[#a8a8a8]">{language === 'en' ? 'All files' : 'Todos los archivos'}</h3><div role="tree" aria-label={language === 'en' ? 'Project files' : 'Archivos del proyecto'}>{renderTree(tree)}</div></section></> : <div className="p-3 text-sm text-[#999999]">{text.noFiles}</div>}</div><button type="button" onClick={() => modalScrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })} tabIndex={showScrollTop ? 0 : -1} aria-hidden={!showScrollTop} aria-label={language === 'en' ? 'Back to top' : 'Volver arriba'} title={language === 'en' ? 'Back to top' : 'Volver arriba'} className={`absolute bottom-3 left-1/2 grid h-8 w-8 -translate-x-1/2 place-items-center rounded-full border border-white/[0.08] bg-[#242424]/95 text-(--codeclub-text) shadow-md shadow-black/35 backdrop-blur transition-all duration-200 focus-visible:outline-2 focus-visible:outline-(--codeclub-accent) ${showScrollTop ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-2 opacity-0'}`}><ArrowUp size={13} aria-hidden="true" /></button></section></div>, document.body)}{fileContextMenu && <div ref={fileContextMenuRef} className="fixed z-[1100] grid w-52 gap-0.5 rounded-xl border border-white/[0.08] bg-[#2C2C2C]/95 p-1 shadow-2xl backdrop-blur-xl" style={{ left: fileContextMenu.x, top: fileContextMenu.y }} role="menu" aria-label={text.openFile}><button type="button" onClick={() => closeFile(fileContextMenu.path)} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-(--codeclub-text) hover:bg-(--codeclub-hover) hover:text-(--codeclub-text-strong)" role="menuitem"><X size={14} aria-hidden="true" />{text.closeTab}</button><button type="button" onClick={() => closeOtherFiles(fileContextMenu.path)} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-(--codeclub-text) hover:bg-(--codeclub-hover) hover:text-(--codeclub-text-strong)" role="menuitem"><Copy size={14} aria-hidden="true" />{text.closeOtherTabs}</button><button type="button" onClick={() => closeFilesToRight(fileContextMenu.path)} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-(--codeclub-text) hover:bg-(--codeclub-hover) hover:text-(--codeclub-text-strong)" role="menuitem"><ChevronRight size={14} aria-hidden="true" />{text.closeTabsToRight}</button></div>}
    </div>}
  </div>;
}

export function ProjectPanelView({ projectPath, projectName, selectedPath, showFileTree = true, onToggleFileTree }: { projectPath?: string; projectName?: string; selectedPath?: string; showFileTree?: boolean; onToggleFileTree?: () => void }) {
  return <TabbedProjectView projectPath={projectPath} projectName={projectName} initialSelectedPath={selectedPath} showFileTree={showFileTree} onToggleFileTree={onToggleFileTree} />;
}
