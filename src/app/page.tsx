'use client';
import { useEffect, useState } from 'react';

import Topbar from '../components/Topbar';
import SubTopbar from '../components/SubTopbar';
import WorkspaceLayout from '../components/WorkspaceLayout';
import { motion } from 'motion/react';

const LAYOUT_VISIBILITY_KEY = 'codeclub:layout-visibility';

export default function HomePage() {
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(false);
  const [topbarOpen, setTopbarOpen] = useState(true);
  const [activeProject, setActiveProject] = useState<{ name: string; path?: string }>({ name: 'Inicio' });
  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(LAYOUT_VISIBILITY_KEY) || 'null') as { leftOpen?: boolean; rightOpen?: boolean; topbarOpen?: boolean } | null;
      if (typeof saved?.leftOpen === 'boolean') setLeftOpen(saved.leftOpen);
      if (typeof saved?.rightOpen === 'boolean') setRightOpen(saved.rightOpen);
      if (typeof saved?.topbarOpen === 'boolean') setTopbarOpen(saved.topbarOpen);
    } catch { /* Si la preferencia no es válida, se usan los valores iniciales. */ }
    const handleProjectSwitch = (event: Event) => {
      const detail = (event as CustomEvent<{ name?: string; path?: string }>).detail;
      setActiveProject(detail?.path ? { name: detail.name || 'Proyecto', path: detail.path } : { name: 'Inicio' });
    };
    const handleRestoredProject = (event: Event) => {
      const detail = (event as CustomEvent<{ projectName?: string; projectPath?: string }>).detail;
      setActiveProject(detail?.projectPath ? { name: detail.projectName || 'Proyecto', path: detail.projectPath } : { name: 'Inicio' });
    };
    const persistVisibility = (next: { leftOpen?: boolean; rightOpen?: boolean; topbarOpen?: boolean }) => {
      try {
        const current = JSON.parse(window.localStorage.getItem(LAYOUT_VISIBILITY_KEY) || '{}') as Record<string, unknown>;
        window.localStorage.setItem(LAYOUT_VISIBILITY_KEY, JSON.stringify({ ...current, ...next }));
      } catch { /* La persistencia de preferencias es opcional. */ }
    };
    const openRightSidebar = () => { setRightOpen(true); persistVisibility({ rightOpen: true }); };
    window.addEventListener('codeclub:project-switch', handleProjectSwitch);
    window.addEventListener('codeclub:active-project', handleRestoredProject);
    window.addEventListener('codeclub:open-right-sidebar', openRightSidebar);
    return () => {
      window.removeEventListener('codeclub:project-switch', handleProjectSwitch);
      window.removeEventListener('codeclub:active-project', handleRestoredProject);
      window.removeEventListener('codeclub:open-right-sidebar', openRightSidebar);
    };
  }, []);
  const toggleLeft = () => setLeftOpen((open) => { const next = !open; try { window.localStorage.setItem(LAYOUT_VISIBILITY_KEY, JSON.stringify({ ...JSON.parse(window.localStorage.getItem(LAYOUT_VISIBILITY_KEY) || '{}'), leftOpen: next })); } catch { /* La persistencia de preferencias es opcional. */ } return next; });
  const toggleRight = () => setRightOpen((open) => { const next = !open; try { window.localStorage.setItem(LAYOUT_VISIBILITY_KEY, JSON.stringify({ ...JSON.parse(window.localStorage.getItem(LAYOUT_VISIBILITY_KEY) || '{}'), rightOpen: next })); } catch { /* La persistencia de preferencias es opcional. */ } return next; });
  const toggleTopbar = () => setTopbarOpen((open) => { const next = !open; try { window.localStorage.setItem(LAYOUT_VISIBILITY_KEY, JSON.stringify({ ...JSON.parse(window.localStorage.getItem(LAYOUT_VISIBILITY_KEY) || '{}'), topbarOpen: next })); } catch { /* La persistencia de preferencias es opcional. */ } return next; });
  return <main className="relative isolate grid h-screen max-h-screen grid-rows-[34px_auto_minmax(0,1fr)] min-w-[320px] min-h-0 overflow-hidden bg-transparent text-(--codeclub-text) font-sans">
      <Topbar leftOpen={leftOpen} rightOpen={rightOpen} topbarOpen={topbarOpen} onToggleLeft={toggleLeft} onToggleRight={toggleRight} onToggleTopbar={toggleTopbar} />
      <motion.div initial={false} animate={{ height: topbarOpen ? 44 : 0, opacity: topbarOpen ? 1 : 0 }} transition={{ type: 'spring', stiffness: 420, damping: 34 }} className="relative z-50 min-h-0 overflow-visible"><SubTopbar activeProject={activeProject} /></motion.div>
      <WorkspaceLayout leftOpen={leftOpen} rightOpen={rightOpen} />
  </main>;
}
