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
        style={{
          minWidth: 0,
          minHeight: 0,
          overflow: 'hidden',
          display: 'grid',
          placeItems: 'center',
        }}
      >
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
          style={{
            minWidth: 0,
            minHeight: 0,
            overflow: 'hidden',
            display: 'grid',
            placeItems: 'center',
          }}
        >
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
