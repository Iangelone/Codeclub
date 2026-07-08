import React, { useEffect, useRef, useState, useCallback } from 'react';
import ChatInterface from './ChatInterface.tsx';

const SPLIT_KEY = 'codeclub_panel_split';
const MODE_KEY = 'codeclub_panel_mode';

const MIN_SPLIT = 25;
const MAX_SPLIT = 75;

const getInitialMode = (): 'single' | 'split' => {
  try {
    const saved = localStorage.getItem(MODE_KEY);
    if (saved === 'split') return 'split';
  } catch {}
  return 'single';
};

const getInitialSplit = (): number => {
  try {
    const saved = localStorage.getItem(SPLIT_KEY);
    if (saved) {
      const n = parseFloat(saved);
      if (!isNaN(n) && n >= MIN_SPLIT && n <= MAX_SPLIT) return n;
    }
  } catch {}
  return 50;
};

export default function WorkspaceManager({ catalog, defaultProvider, defaultModel }) {
  const [panelMode, setPanelMode] = useState<'single' | 'split'>('single');
  const [splitPercent, setSplitPercent] = useState(50);
  const [activePanel, setActivePanel] = useState<'left' | 'right'>('left');
  const [dragOverPanel, setDragOverPanel] = useState<'left' | 'right' | null>(null);
  const [mounted, setMounted] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const isDragging = useRef(false);

  useEffect(() => {
    setPanelMode(getInitialMode());
    setSplitPercent(getInitialSplit());
    setMounted(true);
  }, []);

  // Persist mode
  useEffect(() => {
    if (mounted) localStorage.setItem(MODE_KEY, panelMode);
  }, [panelMode, mounted]);

  // Persist split
  useEffect(() => {
    if (mounted) localStorage.setItem(SPLIT_KEY, String(splitPercent));
  }, [splitPercent, mounted]);

  // Listen for panel mode events from topbar
  useEffect(() => {
    const handlePanelMode = (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      if (detail.mode === 'single' || detail.mode === 'split') {
        setPanelMode(detail.mode);
      }
    };

    window.addEventListener('codeclub:panel-mode', handlePanelMode);
    return () => window.removeEventListener('codeclub:panel-mode', handlePanelMode);
  }, []);

  // Broadcast current mode for topbar icon sync
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('codeclub:panel-mode-changed', { detail: { mode: panelMode } }));
  }, [panelMode]);

  // Divider drag logic
  const handleDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const percent = Math.max(MIN_SPLIT, Math.min(MAX_SPLIT, (x / rect.width) * 100));
      setSplitPercent(percent);
    };

    const handleMouseUp = () => {
      if (!isDragging.current) return;
      isDragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  const leftStateRef = useRef<string | 'blank'>('blank');
  const rightStateRef = useRef<string | 'blank'>('blank');

  useEffect(() => {
    const trackEvent = (panel: 'left' | 'right') => (e: Event) => {
      const detail = (e as CustomEvent).detail;
      const id = detail?.chatId || detail?.noteId || detail?.tableId;
      const kind = e.type.split(':open-')[1];
      const key = id ? `${kind}:${id}` : 'blank';
      if (panel === 'left') leftStateRef.current = key;
      else rightStateRef.current = key;
    };
    const names = ['chat', 'note', 'table', 'blank'];
    const listeners = names.flatMap(kind => [
      { name: `codeclub:panel-left:open-${kind}`, handler: trackEvent('left') },
      { name: `codeclub:panel-right:open-${kind}`, handler: trackEvent('right') },
    ]);
    listeners.forEach(({ name, handler }) => window.addEventListener(name, handler));
    return () => listeners.forEach(({ name, handler }) => window.removeEventListener(name, handler));
  }, []);

  // Intercept sidebar events and route to active panel
  useEffect(() => {
    const routeEvent = (originalName: string) => (e: Event) => {
      const detail = (e as CustomEvent).detail;
      const id = detail?.chatId || detail?.noteId || detail?.tableId;
      const kind = originalName.replace('open-', '');
      const key = id ? `${kind}:${id}` : 'blank';

      let finalTarget = activePanel === 'left' ? 'left' : 'right';

      if (key !== 'blank') {
        if (leftStateRef.current === key) {
          setActivePanel('left');
          finalTarget = 'left';
        } else if (rightStateRef.current === key && panelMode === 'split') {
          setActivePanel('right');
          finalTarget = 'right';
        }
      }

      // In single mode, always route to left
      const panelTarget = panelMode === 'single' ? 'left' : finalTarget;

      window.dispatchEvent(new CustomEvent(`codeclub:panel-${panelTarget}:${originalName}`, {
        detail,
      }));
    };

    const events = ['open-chat', 'open-note', 'open-table', 'open-blank'];
    const handlers = events.map((name) => {
      const handler = routeEvent(name);
      window.addEventListener(`codeclub:${name}`, handler);
      return { name: `codeclub:${name}`, handler };
    });

    return () => {
      handlers.forEach(({ name, handler }) => {
        window.removeEventListener(name, handler);
      });
    };
  }, [activePanel, panelMode]);

  const gridColumns = panelMode === 'split'
    ? `${splitPercent}% 1px ${100 - splitPercent}%`
    : '1fr';

  const handleDragOver = (e: React.DragEvent, panel: 'left' | 'right') => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverPanel !== panel) setDragOverPanel(panel);
  };

  const handleDragEnter = (e: React.DragEvent, panel: 'left' | 'right') => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDragLeave = (e: React.DragEvent, panel: 'left' | 'right') => {
    e.preventDefault();
    const related = e.relatedTarget as Node | null;
    if (!e.currentTarget.contains(related)) {
      setDragOverPanel(null);
    }
  };

  const handleDrop = (e: React.DragEvent, panel: 'left' | 'right') => {
    e.preventDefault();
    setDragOverPanel(null);
    try {
      let data = e.dataTransfer.getData('application/json');
      if (!data) data = e.dataTransfer.getData('text/plain');
      if (!data) return;
      const payload = JSON.parse(data);
      const { kind, id, name, projectPath } = payload;
      const key = `${kind}:${id}`;

      setActivePanel(panel);

      const otherPanel = panel === 'left' ? 'right' : 'left';
      const otherRef = panel === 'left' ? rightStateRef : leftStateRef;
      if (otherRef.current === key && panelMode === 'split') {
        window.dispatchEvent(new CustomEvent(`codeclub:panel-${otherPanel}:open-blank`, { detail: {} }));
      }

      window.dispatchEvent(new CustomEvent(`codeclub:panel-${panel}:open-${kind}`, {
        detail: { projectPath, [`${kind}Id`]: id, name }
      }));
    } catch (err) {
      console.error("Drop failed:", err);
    }
  };

  const DropOverlay = ({ show }: { show: boolean }) => {
    if (!show) return null;
    return (
      <div style={{
        position: 'absolute',
        inset: '12px',
        background: 'rgba(255, 255, 255, 0.03)',
        backdropFilter: 'blur(8px)',
        borderRadius: '16px',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        display: 'grid',
        placeItems: 'center',
        zIndex: 100,
        pointerEvents: 'none',
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.2)'
      }}>
        <div style={{
          background: 'rgba(0, 0, 0, 0.4)',
          padding: '12px 24px',
          borderRadius: '30px',
          color: '#eeeeee',
          fontSize: '14px',
          fontWeight: 500,
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          border: '1px solid rgba(255, 255, 255, 0.05)'
        }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14"/></svg>
          Soltar para abrir
        </div>
      </div>
    );
  };

  return (
    <div
      ref={containerRef}
      className="workspace-panels"
      style={{
        width: '100%',
        height: '100%',
        display: 'grid',
        gridTemplateColumns: gridColumns,
        transition: isDragging.current ? 'none' : 'grid-template-columns 280ms cubic-bezier(0.22, 1, 0.36, 1)',
        overflow: 'hidden',
        minWidth: 0,
        minHeight: 0,
      }}
    >
      {/* Left panel (always visible) */}
      <div
        className={`workspace-pane ${activePanel === 'left' ? 'is-active-pane' : ''}`}
        onClick={() => setActivePanel('left')}
        onDragEnter={(e) => handleDragEnter(e, 'left')}
        onDragOver={(e) => handleDragOver(e, 'left')}
        onDragLeave={(e) => handleDragLeave(e, 'left')}
        onDrop={(e) => handleDrop(e, 'left')}
        style={{
          minWidth: 0,
          minHeight: 0,
          overflow: 'hidden',
          display: 'grid',
          placeItems: 'center',
          position: 'relative',
        }}
      >
        <DropOverlay show={dragOverPanel === 'left'} />
        <ChatInterface
          catalog={catalog}
          defaultProvider={defaultProvider}
          defaultModel={defaultModel}
          panelId="left"
          eventPrefix="codeclub:panel-left"
        />
      </div>

      {/* Divider (only in split mode) */}
      {panelMode === 'split' && (
        <div
          className="workspace-divider"
          onMouseDown={handleDividerMouseDown}
        >
          <div className="workspace-divider-line" />
        </div>
      )}

      {/* Right panel (only in split mode) */}
      {panelMode === 'split' && (
        <div
          className={`workspace-pane ${activePanel === 'right' ? 'is-active-pane' : ''}`}
          onClick={() => setActivePanel('right')}
          onDragEnter={(e) => handleDragEnter(e, 'right')}
          onDragOver={(e) => handleDragOver(e, 'right')}
          onDragLeave={(e) => handleDragLeave(e, 'right')}
          onDrop={(e) => handleDrop(e, 'right')}
          style={{
            minWidth: 0,
            minHeight: 0,
            overflow: 'hidden',
            display: 'grid',
            placeItems: 'center',
            position: 'relative',
          }}
        >
          <DropOverlay show={dragOverPanel === 'right'} />
          <ChatInterface
            catalog={catalog}
            defaultProvider={defaultProvider}
            defaultModel={defaultModel}
            panelId="right"
            eventPrefix="codeclub:panel-right"
          />
        </div>
      )}
    </div>
  );
}
