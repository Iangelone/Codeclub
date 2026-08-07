import React, { useEffect, useRef, useState } from 'react';
import { PanelBottomClose, Plus, X } from 'lucide-react';
import { nativeInvoke as invoke, safeListen as listen } from '../lib/runtime';
import '@xterm/xterm/css/xterm.css';
import { getSetting, setSetting } from '../lib/persistence';
import { LANGUAGE_STORAGE_KEY, rightSidebarTranslations, type AppLanguage } from '../lib/i18n';

type ShellKind = 'auto' | 'powershell' | 'git-bash' | 'wsl' | 'cmd';

type TerminalInfo = {
  id: string;
  name: string;
  shell: ShellKind | string;
  cwd: string;
  projectPath?: string;
  is_agent: boolean;
  created_at: string;
  status: string;
};

type TerminalOutputEvent = {
  id: string;
  stream: string;
  data: string;
};

type TerminalSnapshot = {
  info: TerminalInfo;
  output: string;
};

const STORAGE_KEY = 'codeclub_terminal_tabs_v1';

const shellLabels: Record<string, string> = {
  auto: 'Default',
  powershell: 'PowerShell',
  cmd: 'Command Prompt',
  'git-bash': 'Git Bash',
  wsl: 'WSL2',
};

const computeTerminalName = (shell: string, existing: TerminalInfo[]) => {
  const base = shellLabels[shell] || shell;
  const sameType = existing.filter((t) => t.shell === shell && !t.is_agent);
  if (sameType.length === 0) return base;
  return `${base} ${sameType.length + 1}`;
};

const readPersistedTerminals = () => getSetting<TerminalInfo[]>(STORAGE_KEY, []);

const upsertTerminal = (items: TerminalInfo[], next: TerminalInfo) => {
  const index = items.findIndex((item) => item.id === next.id);
  if (index === -1) return [...items, next];
  const copy = [...items];
  copy[index] = next;
  return copy;
};

const appendOutput = (map: Map<string, string>, id: string, data: string) => {
  const next = `${map.get(id) || ''}${data}`;
  map.set(id, next.length > 240_000 ? next.slice(next.length - 240_000) : next);
};

const MIN_HEIGHT = 180;
const MAX_HEIGHT_FRACTION = 0.8;

const POSITION_KEY = 'codeclub_terminal_pos';
const HEIGHT_KEY = 'codeclub_terminal_height';

const getDefaultPosition = () => {
  if (typeof window === 'undefined') return { x: 60, y: 60 };
  const dockWidth = Math.min(760, window.innerWidth - 64);
  const dockHeight = Math.min(360, Math.max(220, window.innerHeight * 0.36));
  return {
    x: Math.max(0, (window.innerWidth - dockWidth) / 2),
    y: Math.max(0, (window.innerHeight - dockHeight) / 2),
  };
};

const getDefaultHeight = () => {
  if (typeof window === 'undefined') return 300;
  return Math.min(360, Math.max(220, window.innerHeight * 0.36));
};

export default function TerminalDock({ embedded = false, terminalId }: { embedded?: boolean; terminalId?: string }) {
  const [language, setLanguage] = useState<AppLanguage>('es');
  const text = rightSidebarTranslations[language];
  const [mounted, setMounted] = useState(false);
  const [terminals, setTerminals] = useState<TerminalInfo[]>([]);
  const [activeProjectPath, setActiveProjectPath] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(embedded);
  const [position, setPosition] = useState<{ x: number; y: number }>(getDefaultPosition);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  const activeIdRef = useRef<string | null>(null);
  const activeProjectPathRef = useRef<string | null>(null);
  const visibleTerminalCountRef = useRef(0);
  const terminalRef = useRef<any>(null);
  const fitRef = useRef<any>(null);
  const xtermRef = useRef<any>(null);
  const fitAddonRef = useRef<any>(null);
  const outputRef = useRef(new Map<string, string>());
  const commandBuffersRef = useRef(new Map<string, string>());
  const loadedRef = useRef(false);
  const restoredRef = useRef(false);
  const [dockHeight, setDockHeight] = useState(getDefaultHeight);
  const dragRef = useRef({ isDragging: false, startX: 0, startY: 0, startPosX: 0, startPosY: 0 });
  const positionRef = useRef(position);
  positionRef.current = position;

  useEffect(() => {
    if (terminalId) setActiveId(terminalId);
  }, [terminalId]);

  useEffect(() => {
    const handleLanguageChange = (event: Event) => {
      const nextLanguage = (event as CustomEvent<{ language?: AppLanguage }>).detail?.language;
      if (nextLanguage === 'es' || nextLanguage === 'en') setLanguage(nextLanguage);
    };
    window.addEventListener('codeclub:language-change', handleLanguageChange);
    return () => window.removeEventListener('codeclub:language-change', handleLanguageChange);
  }, []);
  const resizeRef = useRef({ isResizing: false, startY: 0, startHeight: 0 });
  const dockHeightRef = useRef(dockHeight);
  dockHeightRef.current = dockHeight;

  useEffect(() => {
    void Promise.all([
      getSetting(POSITION_KEY, getDefaultPosition()),
      getSetting(HEIGHT_KEY, getDefaultHeight()),
    ]).then(([savedPosition, savedHeight]) => {
      if (savedPosition && typeof savedPosition.x === 'number' && typeof savedPosition.y === 'number') setPosition(savedPosition);
      const height = Number(savedHeight);
      if (Number.isFinite(height) && height >= MIN_HEIGHT && height <= window.innerHeight * MAX_HEIGHT_FRACTION) setDockHeight(height);
    });
  }, []);

  const visibleTerminals = terminals.filter((terminal) => {
    if (terminal.is_agent) return !activeProjectPath || terminal.projectPath === activeProjectPath;
    return (terminal.projectPath || null) === activeProjectPath;
  });
  const activeTerminal = visibleTerminals.find((terminal) => terminal.id === activeId) || null;

  const resolveActiveProjectPath = () => {
    return activeProjectPathRef.current;
  };

  const persistPosition = () => {
    try {
      void setSetting(POSITION_KEY, positionRef.current);
    } catch {}
  };

  const persistHeight = () => {
    try {
      void setSetting(HEIGHT_KEY, dockHeightRef.current);
    } catch {}
  };

  const clampPosition = (x: number, y: number) => {
    const dockWidth = Math.min(760, window.innerWidth - 64);
    const dockHeight = Math.min(360, Math.max(220, window.innerHeight * 0.36));
    return {
      x: Math.max(0, Math.min(x, window.innerWidth - dockWidth)),
      y: Math.max(0, Math.min(y, window.innerHeight - dockHeight)),
    };
  };

  const handleBarMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = {
      isDragging: true,
      startX: e.clientX,
      startY: e.clientY,
      startPosX: position.x,
      startPosY: position.y,
    };
  };

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!dragRef.current.isDragging) return;
      setPosition(
        clampPosition(
          dragRef.current.startPosX + (e.clientX - dragRef.current.startX),
          dragRef.current.startPosY + (e.clientY - dragRef.current.startY),
        ),
      );
    };
    const handleMouseUp = () => {
      if (!dragRef.current.isDragging) return;
      dragRef.current.isDragging = false;
      persistPosition();
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!resizeRef.current.isResizing) return;
      const maxHeight = window.innerHeight * MAX_HEIGHT_FRACTION;
      const newHeight = Math.max(MIN_HEIGHT, Math.min(maxHeight, resizeRef.current.startHeight + (e.clientY - resizeRef.current.startY)));
      setDockHeight(newHeight);
    };
    const handleMouseUp = () => {
      if (!resizeRef.current.isResizing) return;
      resizeRef.current.isResizing = false;
      persistHeight();
      fitRef.current?.fit?.();
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
          e.stopPropagation();
          setIsOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isOpen]);

  const disposeActiveTerminal = () => {
    terminalRef.current?.dispose?.();
    terminalRef.current = null;
    fitRef.current = null;
  };

  const openTerminalView = async (id: string) => {
    if (!hostRef.current) return;
    disposeActiveTerminal();
    if (!xtermRef.current || !fitAddonRef.current) {
      const [{ Terminal: XTerm }, { FitAddon }] = await Promise.all([
        import('@xterm/xterm'),
        import('@xterm/addon-fit'),
      ]);
      xtermRef.current = XTerm;
      fitAddonRef.current = FitAddon;
    }

    const term = new xtermRef.current({
      cursorBlink: true,
      cursorStyle: 'bar',
      convertEol: true,
      fontFamily: 'Cascadia Code, Cascadia Mono, Consolas, ui-monospace, monospace',
      fontSize: 12,
      lineHeight: 1.3,
      scrollback: 5000,
      allowTransparency: true,
      theme: {
        background: '#1A1A1A',
        foreground: '#cfcfcf',
        cursor: '#d8d8d8',
        selectionBackground: '#404040',
        black: '#101010',
        red: '#e57373',
        green: '#81c784',
        yellow: '#ffd54f',
        blue: '#64b5f6',
        magenta: '#ce93d8',
        cyan: '#4dd0e1',
        white: '#cfcfcf',
        brightBlack: '#555555',
        brightRed: '#ef5350',
        brightGreen: '#66bb6a',
        brightYellow: '#ffca28',
        brightBlue: '#42a5f5',
        brightMagenta: '#ab47bc',
        brightCyan: '#26c6da',
        brightWhite: '#ffffff',
      },
    });
    const fitAddon = new fitAddonRef.current();
    term.loadAddon(fitAddon);
    term.open(hostRef.current);
    fitAddon.fit();
    term.onData((data) => {
      const commandBuffer = `${commandBuffersRef.current.get(id) || ''}${data}`;
      const lines = commandBuffer.split(/[\r\n]/);
      if (lines.length > 1) {
        const command = lines.slice(0, -1).join('').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').trim();
      if (command) window.dispatchEvent(new CustomEvent('codeclub:terminal-command', { detail: { terminalId: id, command } }));
      }
      commandBuffersRef.current.set(id, lines[lines.length - 1] || '');
      invoke('codeclub_terminal_write', { id, data }).catch(() => {});
    });
    terminalRef.current = term;
    fitRef.current = fitAddon;

    try {
      const snapshot = await invoke<TerminalSnapshot>('codeclub_terminal_snapshot', { id });
      outputRef.current.set(id, snapshot.output || '');
      term.write(snapshot.output || '');
      setTerminals((items) => upsertTerminal(items, snapshot.info));
    } catch {
      term.write(outputRef.current.get(id) || '');
    }
  };

  useEffect(() => {
    activeIdRef.current = activeId;
    if (activeId && (embedded || isOpen)) openTerminalView(activeId);
    return () => disposeActiveTerminal();
  }, [activeId, isOpen, embedded]);

  useEffect(() => {
    visibleTerminalCountRef.current = visibleTerminals.length;
    window.dispatchEvent(new CustomEvent('codeclub:terminal-count-changed', {
      detail: { projectPath: activeProjectPath, count: visibleTerminals.length },
    }));
  }, [activeProjectPath, visibleTerminals.length]);

  useEffect(() => {
    if (!visibleTerminals.some((terminal) => terminal.id === activeId)) {
      setActiveId(visibleTerminals[0]?.id || null);
    }
  }, [activeProjectPath, terminals]);

  useEffect(() => {
    if (!loadedRef.current) return;
    const payload = terminals
      .filter((terminal) => !terminal.is_agent)
      .map(({ id, name, shell, cwd, projectPath, is_agent, created_at, status }) => ({
        id,
        name,
        shell,
        cwd,
        projectPath,
        is_agent,
        created_at,
        status,
      }));
    void setSetting(STORAGE_KEY, payload);
  }, [terminals]);

  useEffect(() => {
    let cleanups: Array<() => void> = [];

    const setProjectPath = (event: Event) => {
      const detail = (event as CustomEvent).detail || {};
      if (!detail.projectPath) return;
      activeProjectPathRef.current = detail.projectPath;
      setActiveProjectPath(detail.projectPath);

      if (!restoredRef.current) {
        restoredRef.current = true;
        void readPersistedTerminals().then((savedTerminals) => savedTerminals.forEach((terminal) => {
          createTerminal(terminal.shell as ShellKind, {
            cwd: terminal.cwd || detail.projectPath,
            projectPath: terminal.projectPath || detail.projectPath,
            open: false,
          }).catch(console.error);
        }));
      }
    };

    const handleProjectSelection = (event: Event) => {
      const detail = (event as CustomEvent).detail || {};
      if (detail.selected === true && detail.projectPath) {
        activeProjectPathRef.current = detail.projectPath;
        setActiveProjectPath(detail.projectPath);
        return;
      }
      activeProjectPathRef.current = null;
      setActiveProjectPath(null);
      setActiveId(null);
    };

    const init = async () => {
      const existing = await invoke<TerminalInfo[]>('codeclub_terminal_list');
      if (existing.length > 0) {
        setTerminals(existing);
        setActiveId(existing.find((terminal) => terminal.is_agent && (!activeProjectPathRef.current || terminal.projectPath === activeProjectPathRef.current))?.id || existing.find((terminal) => !terminal.is_agent)?.id || null);
        window.dispatchEvent(new CustomEvent('codeclub:terminal-list', { detail: { terminals: existing.filter((terminal) => !terminal.is_agent) } }));
        restoredRef.current = true;
      }
      loadedRef.current = true;

      cleanups = await Promise.all([
        listen<TerminalInfo>('codeclub-terminal-created', (event) => {
          setTerminals((items) => upsertTerminal(items, event.payload));
          setActiveId(event.payload.id);
          setIsOpen(true);
          if (embedded && !event.payload.is_agent) window.dispatchEvent(new CustomEvent('codeclub:terminal-created', { detail: event.payload }));
        }),
        listen<TerminalInfo>('codeclub-terminal-updated', (event) => {
          setTerminals((items) => upsertTerminal(items, event.payload));
        }),
        listen<string>('codeclub-terminal-deleted', (event) => {
          setTerminals((items) => items.filter((item) => item.id !== event.payload));
          outputRef.current.delete(event.payload);
          setActiveId((current) => (current === event.payload ? null : current));
        }),
        listen<{ id: string; code: number | null }>('codeclub-terminal-exit', (event) => {
          setTerminals((items) => items.map((item) => item.id === event.payload.id ? { ...item, status: 'exited' } : item));
        }),
        listen<TerminalOutputEvent>('codeclub-terminal-output', (event) => {
          appendOutput(outputRef.current, event.payload.id, event.payload.data);
          if (event.payload.id === activeIdRef.current) terminalRef.current?.write(event.payload.data);
        }),
      ]);
    };

    window.addEventListener('codeclub:active-project', setProjectPath);
    window.addEventListener('codeclub:project-selection-changed', handleProjectSelection);
    window.addEventListener('codeclub:open-chat', setProjectPath);
    init().catch(console.error);

    return () => {
      cleanups.forEach((cleanup) => cleanup());
      window.removeEventListener('codeclub:active-project', setProjectPath);
      window.removeEventListener('codeclub:project-selection-changed', handleProjectSelection);
      window.removeEventListener('codeclub:open-chat', setProjectPath);
    };
  }, []);

  useEffect(() => {
    if (!embedded && !isOpen) return;
    const onResize = () => fitRef.current?.fit?.();
    window.addEventListener('resize', onResize);
    setTimeout(onResize, 30);
    const observer = hostRef.current?.parentElement ? new ResizeObserver(() => fitRef.current?.fit?.()) : null;
    if (observer && hostRef.current?.parentElement) observer.observe(hostRef.current.parentElement);
    return () => {
      window.removeEventListener('resize', onResize);
      observer?.disconnect();
    };
  }, [isOpen, activeId, embedded]);

  // On close, save position
  useEffect(() => {
    if (!isOpen) persistPosition();
  }, [isOpen]);

  const createTerminal = async (
    shell: ShellKind = 'powershell',
    options: { cwd?: string; projectPath?: string; isAgent?: boolean; open?: boolean } = {},
  ) => {
    const projectPath = options.cwd || resolveActiveProjectPath();
    const name = computeTerminalName(shell, terminals);
    const terminal = await invoke<TerminalInfo>('codeclub_terminal_create', {
      request: {
        shell,
        name,
        cwd: options.cwd,
        projectPath: options.projectPath || (options.cwd ? undefined : projectPath || undefined),
        isAgent: Boolean(options.isAgent),
      },
    });
    setTerminals((items) => upsertTerminal(items, terminal));
    if (terminal.is_agent) return terminal;
    setActiveId(terminal.id);
    setIsOpen(options.open !== false);
    if (embedded) window.dispatchEvent(new CustomEvent('codeclub:terminal-created', { detail: terminal }));
    return terminal;
  };

  useEffect(() => {
    const handleNewTerminal = () => { void createTerminal('powershell'); };
    window.addEventListener('codeclub:new-terminal', handleNewTerminal);
    return () => window.removeEventListener('codeclub:new-terminal', handleNewTerminal);
  }, [activeProjectPath, terminals]);

  const deleteTerminal = async (id: string) => {
    const deleted = terminals.find((t) => t.id === id);
    await invoke('codeclub_terminal_delete', { id });
    setTerminals((prev) => {
      const next = prev.filter((item) => item.id !== id);
      if (activeId === id) setActiveId(next.find((item) => !item.is_agent)?.id || null);
      return next;
    });
    outputRef.current.delete(id);

    if (deleted && !deleted.is_agent) {
      const remaining = terminals
        .filter((t) => t.shell === deleted.shell && t.id !== id && !t.is_agent)
        .sort((a, b) => a.created_at.localeCompare(b.created_at));
      const base = shellLabels[deleted.shell] || deleted.shell;
      remaining.forEach(async (t, i) => {
        const newName = i === 0 ? base : `${base} ${i + 1}`;
        if (t.name !== newName) {
          const updated = await invoke<TerminalInfo>('codeclub_terminal_rename', {
            id: t.id,
            name: newName,
          });
          setTerminals((items) => upsertTerminal(items, updated));
        }
      });
    }
  };

  useEffect(() => {
    const handleCloseTerminal = (event: Event) => {
      const id = (event as CustomEvent<{ id?: string }>).detail?.id;
      if (id) void deleteTerminal(id);
    };
    window.addEventListener('codeclub:terminal-close', handleCloseTerminal);
    return () => window.removeEventListener('codeclub:terminal-close', handleCloseTerminal);
  }, [terminals, activeId]);

  if (!mounted || typeof document === 'undefined') return null;
  const terminalView = (
      <div
        className={embedded ? 'terminal-embedded flex h-full w-full min-h-0 min-w-0 flex-col overflow-hidden bg-[#1A1A1A]' : `terminal-floating ${isOpen ? 'is-open' : ''}`}
        style={{
          ...(embedded ? {} : { left: `${position.x}px`, top: `${position.y}px`, height: `${dockHeight}px` }),
        }}
      >
        {!embedded && <div
          className="terminal-resize-handle"
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            resizeRef.current = { isResizing: true, startY: e.clientY, startHeight: dockHeight };
          }}
        />}
        {!embedded && <div ref={barRef} className="terminal-floating-bar" onMouseDown={handleBarMouseDown}>
          <div className="terminal-tabs" role="tablist" aria-label={text.terminals}>
            {visibleTerminals.map((terminal) => (
              <div key={terminal.id} className={`terminal-tab ${terminal.id === activeId ? 'is-active' : ''}`} style={terminal.id === activeId ? { background: '#2B2B2B', color: '#eeeeee', border: '1px solid #3A3A3A' } : undefined}>
                <button type="button" className="terminal-tab-main" style={terminal.id === activeId ? { color: '#eeeeee' } : undefined} onClick={() => { setActiveId(terminal.id); setIsOpen(true); }} aria-label={`${text.activateTerminal} ${terminal.name}`}>
                  <span>{terminal.name}</span>
                </button>
                <button type="button" className="terminal-tab-close" style={terminal.id === activeId ? { color: '#eeeeee' } : undefined} onClick={() => void deleteTerminal(terminal.id)} aria-label={`${text.closeTerminal} ${terminal.name}`} title={text.closeTerminal}><X size={11} strokeWidth={2} /></button>
              </div>
            ))}
            <div className="terminal-new">
              <button type="button" className="terminal-new-tab" aria-label={text.newTerminal} onClick={() => void createTerminal('powershell')}>
                <Plus size={14} />
              </button>
            </div>
          </div>
          {!embedded && <div className="terminal-actions"><button type="button" aria-label={text.hideTerminal} title={text.hideTerminal} onClick={() => setIsOpen(false)}><PanelBottomClose size={14} /></button></div>}
        </div>}
        <div className="terminal-stage">
          {activeTerminal ? (
            <div ref={hostRef} className="terminal-host" />
          ) : (
            <div className="terminal-empty">
              <button type="button" onClick={() => void createTerminal('powershell')}>{text.createTerminal}</button>
            </div>
          )}
        </div>
      </div>
  );
  return embedded ? terminalView : <>{isOpen && <div className="terminal-floating-backdrop" onClick={() => setIsOpen(false)} />}{terminalView}</>;
}
