import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, FileCode2, Folder, FolderOpen, GitBranch, Plus, Search } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';

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
  return roots;
};

const iconForFile = (name: string) => {
  const extension = name.split('.').pop()?.toLowerCase();
  if (name === '.gitignore') return <GitBranch size={16} className="text-[#ef623b]" />;
  if (extension === 'md') return <span className="text-[15px] font-bold leading-none text-[#4fda73]">M↓</span>;
  if (extension === 'json' || extension === 'mjs' || extension === 'js' || extension === 'ts') return <span className="rounded bg-[#62551a] px-1 text-[10px] font-bold text-[#f6d84a]">JS</span>;
  return <FileCode2 size={16} className="text-[#a8a8a8]" />;
};

function FilesView({ projectPath }: { projectPath: string }) {
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [showTree, setShowTree] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadFiles = async () => {
    if (!projectPath) return;
    setLoading(true);
    try {
      const result = await invoke<FileEntry[]>('codeclub_list_files', { projectPath, maxFiles: 1200 });
      setEntries(result);
      setExpanded(new Set(result.filter((entry) => entry.kind === 'directory').map((entry) => entry.path)));
      setError('');
    } catch (reason) { setError(String(reason)); }
    finally { setLoading(false); }
  };

  useEffect(() => { void loadFiles(); }, [projectPath]);

  const tree = useMemo(() => buildTree(entries), [entries]);
  const matches = (node: FileNode) => !query.trim() || node.path.toLowerCase().includes(query.trim().toLowerCase());
  const renderTree = (nodes: FileNode[], depth = 0): React.ReactNode => nodes.filter((node) => matches(node) || node.children.some((child) => matches(child))).map((node) => {
    const isOpen = expanded.has(node.path) || Boolean(query.trim());
    const isDirectory = node.kind === 'directory';
    return <React.Fragment key={node.path}>
      <button type="button" onClick={() => isDirectory ? setExpanded((current) => { const next = new Set(current); next.has(node.path) ? next.delete(node.path) : next.add(node.path); return next; }) : window.dispatchEvent(new CustomEvent('codeclub:open-folders', { detail: { projectPath, path: node.path } }))} className="flex min-h-[30px] w-full items-center gap-2 rounded-md px-2 text-left text-[12px] text-[#eeeeee] transition-colors hover:bg-white/[0.04]" style={{ paddingLeft: `${8 + depth * 14}px` }}>
        <span className="w-4 shrink-0 text-[#8b8b8b]">{isDirectory && <ChevronRight size={15} className={isOpen ? 'rotate-90 transition-transform' : 'transition-transform'} />}</span>
        {isDirectory ? (isOpen ? <FolderOpen size={15} className="text-[#c8c8c8]" /> : <Folder size={15} className="text-[#c8c8c8]" />) : iconForFile(node.name)}
        <span className="min-w-0 flex-1 truncate">{node.name}</span>
      </button>
      {isDirectory && isOpen && renderTree(node.children, depth + 1)}
    </React.Fragment>;
  });

  return <div className="flex min-h-0 flex-1 flex-col bg-[#111111]">
    <div className="flex h-[34px] shrink-0 items-center justify-between border-b border-[#2b2b2b] bg-[#111111] px-2">
      <span className="text-[12px] leading-none text-[#eeeeee]">/</span>
      <button type="button" onClick={() => setShowTree((visible) => !visible)} className="grid h-7 w-7 place-items-center rounded-[7px] bg-[#202020] text-[#eeeeee] hover:bg-[#2b2b2b]" title="Mostrar u ocultar árbol del workspace" aria-label="Mostrar u ocultar árbol del workspace"><FolderOpen size={15} /></button>
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 [scrollbar-width:none]">
      {showTree && <><label className="mb-2 flex h-8 items-center gap-2 rounded-[10px] border border-[#353535] bg-[#1d1d1d] px-2.5 text-[#9a9a9a] focus-within:border-[#555555]"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} className="min-w-0 flex-1 bg-transparent text-[12px] text-[#eeeeee] outline-none placeholder:text-[#929292]" placeholder="Filtrar archivos..." aria-label="Filtrar archivos" /></label>
      {loading ? <div className="p-3 text-sm text-[#777777]">Cargando archivos...</div> : error ? <div className="p-3 text-sm text-[#c28d8d]">{error}</div> : tree.length ? renderTree(tree) : <div className="p-3 text-sm text-[#777777]">No se encontraron archivos.</div>}</>}
    </div>
  </div>;
}

export default function RightSidebar() {
  type RightTab = 'files' | 'review' | 'browser' | 'quotes';
  const labels: Record<RightTab, string> = { files: 'Archivos', review: 'Revisar', browser: 'Navegador', quotes: 'Cotizaciones' };
  const availableTabs: RightTab[] = ['files', 'review', 'browser', 'quotes'];
  const [tabs, setTabs] = React.useState<RightTab[]>([]);
  const [activeTab, setActiveTab] = React.useState<RightTab | null>(null);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [activeProjectPath, setActiveProjectPath] = useState('');
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
    if (!menuOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer);
  }, [menuOpen]);

  useEffect(() => {
    const handleProject = (event: Event) => setActiveProjectPath((event as CustomEvent<{ projectPath?: string }>).detail?.projectPath || '');
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

  const closeTab = (tab: RightTab) => {
    setTabs((current) => current.filter((item) => item !== tab));
    setActiveTab((current) => current === tab ? null : current);
  };

  return (
    <aside className="right-sidebar relative z-40 row-start-2 col-start-3 w-[360px] min-w-[360px] max-w-[360px] min-h-0 overflow-visible border-l border-[var(--color-surface-10)] bg-[var(--color-bg)] text-[#d8d8d8] shadow-[-4px_0_14px_rgba(0,0,0,0.16)]" aria-label="Panel lateral derecho">
      <div onPointerDown={startResize} className="absolute -left-[3px] top-0 z-20 h-full w-[6px] cursor-col-resize bg-transparent transition-colors hover:bg-[#2f2f2f]" aria-label="Redimensionar panel derecho" role="separator" />
      <div className="flex h-full w-[360px] min-w-[360px] flex-col">
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
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {activeTab === 'files' && <FilesView projectPath={activeProjectPath} />}
          {tabs.length === 0 && <div className="flex flex-1 items-center justify-center">
            <button type="button" onClick={() => setMenuOpen(true)} className="min-h-[30px] rounded-lg border border-[#202020] bg-transparent px-3 text-[11px] text-[#777777] transition-colors hover:bg-[#1c1c1c] hover:text-[#eeeeee]">
              Crear panel
            </button>
          </div>}
          {activeTab && activeTab !== 'files' && <div className="flex flex-1 items-center justify-center p-3 text-xs text-[#777777]">Panel {labels[activeTab]}</div>}
        </div>
      </div>
    </aside>
  );
}
