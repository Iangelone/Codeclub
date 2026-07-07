import React, { useEffect, useRef, useState } from 'react';
import { PanelBottomClose, Plus } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import '@xterm/xterm/css/xterm.css';

type ShellKind = 'auto' | 'powershell' | 'git-bash' | 'wsl' | 'cmd';

type TerminalInfo = {
  id: string;
  name: string;
  shell: ShellKind | string;
  cwd: string;
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

type TerminalAnchorRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

const STORAGE_KEY = 'codeclub_terminal_tabs_v1';

const shellOptions: { id: ShellKind; label: string }[] = [
  { id: 'auto', label: 'Default' },
  { id: 'powershell', label: 'PowerShell' },
  { id: 'cmd', label: 'Command Prompt' },
  { id: 'git-bash', label: 'Git Bash' },
  { id: 'wsl', label: 'WSL2' },
];

const readPersistedTerminals = () => {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') as TerminalInfo[];
  } catch {
    return [];
  }
};

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

export default function TerminalDock() {
  const [terminals, setTerminals] = useState<TerminalInfo[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [shellMenuOpen, setShellMenuOpen] = useState(false);
  const [shellMenuPosition, setShellMenuPosition] = useState({ left: 0 });
  const [dockStyle, setDockStyle] = useState<React.CSSProperties>({});
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const hostRef = useRef<HTMLDivElement | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  const plusButtonRef = useRef<HTMLButtonElement | null>(null);
  const activeIdRef = useRef<string | null>(null);
  const activeProjectPathRef = useRef<string | null>(null);
  const visibleTerminalCountRef = useRef(0);
  const terminalRef = useRef<any>(null);
  const fitRef = useRef<any>(null);
  const xtermRef = useRef<any>(null);
  const fitAddonRef = useRef<any>(null);
  const outputRef = useRef(new Map<string, string>());
  const loadedRef = useRef(false);
  const restoredRef = useRef(false);

  const visibleTerminals = terminals.filter((terminal) => !terminal.is_agent);
  const activeTerminal = visibleTerminals.find((terminal) => terminal.id === activeId) || null;

  const resolveActiveProjectPath = () => {
    if (activeProjectPathRef.current) return activeProjectPathRef.current;

    const selectedProject = document.querySelector<HTMLElement>('.project-card.is-selected');
    const activeRow = document.querySelector<HTMLElement>('.chat-row.is-active');
    const projectPath = selectedProject?.dataset.path || activeRow?.dataset.projectPath || null;

    if (projectPath) activeProjectPathRef.current = projectPath;
    return projectPath;
  };

  const positionFromAnchor = (anchorRect?: TerminalAnchorRect) => {
    if (!anchorRect) {
      setDockStyle({});
      return;
    }

    const panelRect = document.querySelector<HTMLElement>('.chat-panel')?.getBoundingClientRect();
    if (!panelRect) return;

    const dockHeight = Math.min(360, Math.max(220, window.innerHeight * 0.36));
    const rawBottom = panelRect.bottom - anchorRect.top + 10;
    const maxBottom = Math.max(72, panelRect.height - dockHeight - 12);
    const left = anchorRect.left - panelRect.left + anchorRect.width / 2;

    setDockStyle({
      left: `${left}px`,
      bottom: `${Math.min(rawBottom, maxBottom)}px`,
    });
  };

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
        background: '#101010',
        foreground: '#cfcfcf',
        cursor: '#d8d8d8',
        selectionBackground: '#404040',
        black: '#111111',
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
    if (activeId && isOpen) openTerminalView(activeId);
    return () => disposeActiveTerminal();
  }, [activeId, isOpen]);

  useEffect(() => {
    visibleTerminalCountRef.current = visibleTerminals.length;
  }, [visibleTerminals.length]);

  useEffect(() => {
    if (!loadedRef.current) return;
    const payload = terminals
      .filter((terminal) => !terminal.is_agent)
      .map(({ id, name, shell, cwd, is_agent, created_at, status }) => ({
        id,
        name,
        shell,
        cwd,
        is_agent,
        created_at,
        status,
      }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }, [terminals]);

  useEffect(() => {
    let cleanups: Array<() => void> = [];

    const setProjectPath = (event: Event) => {
      const detail = (event as CustomEvent).detail || {};
      if (!detail.projectPath) return;
      activeProjectPathRef.current = detail.projectPath;

      if (!restoredRef.current) {
        restoredRef.current = true;
        readPersistedTerminals().forEach((terminal) => {
          createTerminal(terminal.shell as ShellKind, {
            name: terminal.name,
            cwd: terminal.cwd || detail.projectPath,
            open: false,
          }).catch(console.error);
        });
      }
    };

    const openTerminalDock = (event: Event) => {
      const detail = (event as CustomEvent).detail || {};
      if (!resolveActiveProjectPath()) {
        setShellMenuOpen(false);
        setIsOpen(false);
        return;
      }
      positionFromAnchor(detail.anchorRect);
      if (detail.terminalId) setActiveId(detail.terminalId);
      setIsOpen((value) => {
        const next = detail.toggle ? !value : true;
        if (next && !detail.terminalId && visibleTerminalCountRef.current === 0) {
          queueMicrotask(() => createTerminal('auto').catch(console.error));
        }
        return next;
      });
    };

    const init = async () => {
      const existing = await invoke<TerminalInfo[]>('codeclub_terminal_list');
      if (existing.length > 0) {
        setTerminals(existing);
        setActiveId(existing.find((terminal) => !terminal.is_agent)?.id || null);
        restoredRef.current = true;
      }
      loadedRef.current = true;

      cleanups = await Promise.all([
        listen<TerminalInfo>('codeclub-terminal-created', (event) => {
          setTerminals((items) => upsertTerminal(items, event.payload));
          if (event.payload.is_agent) return;
          setActiveId(event.payload.id);
          setIsOpen(true);
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
    window.addEventListener('codeclub:open-chat', setProjectPath);
    window.addEventListener('codeclub:open-note', setProjectPath);
    window.addEventListener('codeclub:open-table', setProjectPath);
    window.addEventListener('codeclub:open-terminal-dock', openTerminalDock);
    init().catch(console.error);

    return () => {
      cleanups.forEach((cleanup) => cleanup());
      window.removeEventListener('codeclub:active-project', setProjectPath);
      window.removeEventListener('codeclub:open-chat', setProjectPath);
      window.removeEventListener('codeclub:open-note', setProjectPath);
      window.removeEventListener('codeclub:open-table', setProjectPath);
      window.removeEventListener('codeclub:open-terminal-dock', openTerminalDock);
    };
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const onResize = () => fitRef.current?.fit?.();
    window.addEventListener('resize', onResize);
    setTimeout(onResize, 30);
    return () => window.removeEventListener('resize', onResize);
  }, [isOpen, activeId]);

  const toggleShellMenu = () => {
    if (!resolveActiveProjectPath()) return;
    const rect = plusButtonRef.current?.getBoundingClientRect();
    const barRect = barRef.current?.getBoundingClientRect();
    if (rect && barRect) {
      const menuWidth = 158;
      setShellMenuPosition({
        left: Math.max(6, Math.min(rect.left - barRect.left, barRect.width - menuWidth - 6)),
      });
    }
    setShellMenuOpen((value) => !value);
  };

  const createTerminal = async (
    shell: ShellKind = 'powershell',
    options: { name?: string; cwd?: string; isAgent?: boolean; open?: boolean } = {},
  ) => {
    const projectPath = options.cwd || resolveActiveProjectPath();
    if (!options.isAgent && !projectPath) return null;
    const terminal = await invoke<TerminalInfo>('codeclub_terminal_create', {
      request: {
        shell,
        name: options.name,
        cwd: options.cwd,
        projectPath: options.cwd ? undefined : projectPath || undefined,
        isAgent: Boolean(options.isAgent),
      },
    });
    setTerminals((items) => upsertTerminal(items, terminal));
    if (terminal.is_agent) return terminal;
    setActiveId(terminal.id);
    setIsOpen(options.open !== false);
    return terminal;
  };

  const renameTerminal = async (terminal: TerminalInfo) => {
    if (!renameDraft.trim()) {
      setRenamingId(null);
      return;
    }
    const updated = await invoke<TerminalInfo>('codeclub_terminal_rename', {
      id: terminal.id,
      name: renameDraft.trim(),
    });
    setTerminals((items) => upsertTerminal(items, updated));
    setRenamingId(null);
  };

  const deleteTerminal = async (id: string) => {
    await invoke('codeclub_terminal_delete', { id });
    setTerminals((items) => {
      const next = items.filter((item) => item.id !== id);
      if (activeId === id) setActiveId(next.find((item) => !item.is_agent)?.id || null);
      return next;
    });
    outputRef.current.delete(id);
  };

  return (
    <div className={`terminal-dock ${isOpen ? 'is-open' : ''}`} style={dockStyle}>
      <div className="terminal-stage">
        {activeTerminal ? (
          <div ref={hostRef} className="terminal-host" />
        ) : (
          <div className="terminal-empty">
            <button type="button" onClick={() => createTerminal('auto')}>Crear terminal</button>
          </div>
        )}
      </div>
      <div ref={barRef} className="terminal-dock-bar">
        <div className="terminal-tabs" role="tablist" aria-label="Terminales">
          {visibleTerminals.map((terminal) => (
            <button
              key={terminal.id}
              type="button"
              className={`terminal-tab ${terminal.id === activeId ? 'is-active' : ''}`}
              onClick={() => {
                setActiveId(terminal.id);
                setIsOpen(true);
              }}
              onDoubleClick={() => {
                setRenamingId(terminal.id);
                setRenameDraft(terminal.name);
              }}
            >
              {renamingId === terminal.id ? (
                <input
                  value={renameDraft}
                  onChange={(event) => setRenameDraft(event.target.value)}
                  onBlur={() => renameTerminal(terminal)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') renameTerminal(terminal);
                    if (event.key === 'Escape') setRenamingId(null);
                  }}
                  autoFocus
                />
              ) : (
                <span>{terminal.name}</span>
              )}
              <b
                aria-label="Cerrar terminal"
                onClick={(event) => {
                  event.stopPropagation();
                  deleteTerminal(terminal.id);
                }}
              >
                x
              </b>
            </button>
          ))}
          <div className="terminal-new">
            <button ref={plusButtonRef} type="button" className="terminal-new-tab" aria-label="Nueva terminal" onClick={toggleShellMenu}>
              <Plus size={14} />
            </button>
          </div>
        </div>
        <div className="terminal-actions">
          <button type="button" aria-label="Ocultar terminal" onClick={() => setIsOpen(false)}>
            <PanelBottomClose size={14} />
          </button>
        </div>
        {shellMenuOpen && (
          <div className="terminal-shell-menu" style={{ left: shellMenuPosition.left }}>
            {shellOptions.map((shell) => (
              <button
                key={shell.id}
                type="button"
                onClick={() => {
                  createTerminal(shell.id);
                  setShellMenuOpen(false);
                }}
              >
                {shell.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
