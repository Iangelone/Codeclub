'use client';
import { useEffect, useState } from 'react';

import Topbar from '../components/Topbar';
import SubTopbar from '../components/SubTopbar';
import WorkspaceLayout from '../components/WorkspaceLayout';
import { motion } from 'motion/react';

export default function HomePage() {
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(false);
  const [topbarOpen, setTopbarOpen] = useState(true);
  const [activeProject, setActiveProject] = useState<{ name: string; path?: string }>({ name: 'Inicio' });
  useEffect(() => {
    const handleProjectSwitch = (event: Event) => {
      const detail = (event as CustomEvent<{ name?: string; path?: string }>).detail;
      setActiveProject(detail?.path ? { name: detail.name || 'Proyecto', path: detail.path } : { name: 'Inicio' });
    };
    const handleRestoredProject = (event: Event) => {
      const detail = (event as CustomEvent<{ projectName?: string; projectPath?: string }>).detail;
      setActiveProject(detail?.projectPath ? { name: detail.projectName || 'Proyecto', path: detail.projectPath } : { name: 'Inicio' });
    };
    const openRightSidebar = () => setRightOpen(true);
    window.addEventListener('codeclub:project-switch', handleProjectSwitch);
    window.addEventListener('codeclub:active-project', handleRestoredProject);
    window.addEventListener('codeclub:open-right-sidebar', openRightSidebar);
    return () => {
      window.removeEventListener('codeclub:project-switch', handleProjectSwitch);
      window.removeEventListener('codeclub:active-project', handleRestoredProject);
      window.removeEventListener('codeclub:open-right-sidebar', openRightSidebar);
    };
  }, []);
  return <main className="relative isolate grid h-screen max-h-screen grid-rows-[34px_auto_minmax(0,1fr)] min-w-[320px] min-h-0 overflow-hidden bg-transparent text-(--codeclub-text) font-sans">
      <Topbar leftOpen={leftOpen} rightOpen={rightOpen} topbarOpen={topbarOpen} onToggleLeft={() => setLeftOpen((open) => !open)} onToggleRight={() => setRightOpen((open) => !open)} onToggleTopbar={() => setTopbarOpen((open) => !open)} />
      <motion.div initial={false} animate={{ height: topbarOpen ? 44 : 0, opacity: topbarOpen ? 1 : 0 }} transition={{ type: 'spring', stiffness: 420, damping: 34 }} className="relative z-50 min-h-0 overflow-visible"><SubTopbar activeProject={activeProject} /></motion.div>
      <WorkspaceLayout leftOpen={leftOpen} rightOpen={rightOpen} />
  </main>;
}
