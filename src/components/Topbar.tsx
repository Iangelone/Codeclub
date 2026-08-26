'use client';

import { useEffect, useState } from 'react';
import { Folder, FolderOpen, House, Minus, PanelLeft, PanelRight, PanelTop, Plus, Square, X } from 'lucide-react';
import { motion } from 'motion/react';
import { topbarTranslations, useAppLanguage } from '../lib/i18n';

export default function Topbar({ leftOpen, rightOpen, topbarOpen, onToggleLeft, onToggleRight, onToggleTopbar }: { leftOpen: boolean; rightOpen: boolean; topbarOpen: boolean; onToggleLeft: () => void; onToggleRight: () => void; onToggleTopbar: () => void }) {
  const language = useAppLanguage();
  const t = topbarTranslations[language];
  const [projects, setProjects] = useState<Array<{ id: string; name: string; path: string }>>([]);
  const [activeProjectId, setActiveProjectId] = useState('home');
  const noDragStyle = { WebkitAppRegion: 'no-drag' } as React.CSSProperties;
  const persistOpenProjects = (nextProjects: Array<{ id: string; name: string; path: string }>) => {
    window.localStorage.setItem('codeclub:open-projects', JSON.stringify(nextProjects.map((project) => project.id)));
    window.dispatchEvent(new CustomEvent('codeclub:open-projects-changed'));
  };
  const nativeWindow = (action: 'windowMinimize' | 'windowMaximize' | 'windowClose') => { const api = (window as any).codeclub; if (!api?.[action]) { console.error(`Electron bridge no disponible: ${action}`); return; } void Promise.resolve(api[action]()).catch((error) => console.error(`Falló ${action}`, error)); };
  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem('codeclub:active-project') || 'null') as { id?: string } | null;
      if (saved?.id) setActiveProjectId(saved.id);
    } catch { /* Si no hay proyecto persistido, queda seleccionado Inicio. */ }
    void (async () => {
      const existing = await (window as any).codeclub?.listProjects?.();
      if (!Array.isArray(existing)) return;
      let openProjectIds: string[] | null = null;
      try {
        const saved = JSON.parse(window.localStorage.getItem('codeclub:open-projects') || 'null');
        if (Array.isArray(saved)) openProjectIds = saved.filter((id): id is string => typeof id === 'string');
      } catch { /* Si la lista no es válida, se migra desde los proyectos registrados. */ }
      const openProjects = openProjectIds
        ? existing.filter((project: { id: string }) => openProjectIds!.includes(project.id))
        : existing;
      setProjects(openProjects);
      if (!openProjectIds) persistOpenProjects(openProjects);
    })();
  }, []);
  useEffect(() => { const handleProjectRenamed = (event: Event) => { const project = (event as CustomEvent<{ id?: string; name?: string; path?: string }>).detail; if (!project?.id || !project.name) return; setProjects((current) => current.map((item) => item.id === project.id ? { ...item, name: project.name!, path: project.path ?? item.path } : item)); }; window.addEventListener('codeclub:project-renamed', handleProjectRenamed); return () => window.removeEventListener('codeclub:project-renamed', handleProjectRenamed); }, []);
  useEffect(() => {
    const handleProjectSwitch = (event: Event) => {
      const project = (event as CustomEvent<{ id?: string; name?: string; path?: string }>).detail;
      if (!project?.id) return;
      setActiveProjectId(project.id);
      if (project.id === 'home' || !project.path) return;
      const projectId = project.id as string;
      const projectName = project.name || projectId;
      const projectPath = project.path as string;
      setProjects((current) => current.some((item) => item.id === projectId)
        ? current.map((item) => item.id === projectId ? { ...item, name: projectName, path: projectPath || item.path } : item)
        : [...current, { id: projectId, name: projectName, path: projectPath }]);
      try {
        const openProjectIds = JSON.parse(window.localStorage.getItem('codeclub:open-projects') || '[]') as unknown;
        const nextIds = Array.isArray(openProjectIds) ? openProjectIds.filter((id): id is string => typeof id === 'string' && id !== projectId) : [];
        window.localStorage.setItem('codeclub:open-projects', JSON.stringify([...nextIds, projectId]));
      } catch { window.localStorage.setItem('codeclub:open-projects', JSON.stringify([projectId])); }
    };
    window.addEventListener('codeclub:project-switch', handleProjectSwitch);
    return () => window.removeEventListener('codeclub:project-switch', handleProjectSwitch);
  }, []);
  const addProject = async () => {
    const api = (window as any).codeclub;
    if (!api?.selectProjectFolder) { console.error('Electron bridge codeclub no disponible'); return; }
    let project;
    try { project = await api.selectProjectFolder(); } catch (error) { console.error('No se pudo seleccionar la carpeta del proyecto', error); return; }
    if (!project) return;
    const selectedProject = project as { id: string; name: string; path: string };
    setProjects((current) => {
      const next = [...current.filter((item) => item.id !== selectedProject.id), selectedProject];
      persistOpenProjects(next);
      return next;
    });
    setActiveProjectId(selectedProject.id);
    window.dispatchEvent(new CustomEvent('codeclub:project-switch', { detail: selectedProject }));
  };
  const selectProject = async (project: { id: string; name: string; path: string }) => {
    setActiveProjectId(project.id);
    await (window as any).codeclub?.switchProject?.(project.id);
    window.dispatchEvent(new CustomEvent('codeclub:project-switch', { detail: project }));
  };
  const closeProject = (project: { id: string; name: string; path: string }) => {
    setProjects((current) => {
      const next = current.filter((item) => item.id !== project.id);
      persistOpenProjects(next);
      return next;
    });
    let persistedProjectId: string | undefined;
    try { persistedProjectId = (JSON.parse(window.localStorage.getItem('codeclub:active-project') || 'null') as { id?: string } | null)?.id; } catch { /* Estado persistido inválido. */ }
    if (activeProjectId !== project.id && persistedProjectId !== project.id) return;
    window.localStorage.removeItem('codeclub:active-project');
    setActiveProjectId('home');
    window.dispatchEvent(new CustomEvent('codeclub:project-switch', { detail: { id: 'home', name: 'Codeclub' } }));
  };
  return <header role="banner" aria-label="Codeclub" className="codeclub-graphite relative z-[100] col-span-full flex h-[34px] min-w-0 items-center select-none backdrop-blur-xl backdrop-saturate-150">
    <div className="flex h-full items-center gap-1 pl-2" role="tablist" aria-label={t.projectTab}>
      <motion.button type="button" role="tab" aria-selected={activeProjectId === 'home'} title={t.home} style={noDragStyle} onClick={() => { setActiveProjectId('home'); window.dispatchEvent(new CustomEvent('codeclub:project-switch', { detail: { id: 'home', name: 'Codeclub' } })); }} animate={{ scale: activeProjectId === 'home' ? 1 : 0.97, opacity: activeProjectId === 'home' ? 1 : 0.72 }} whileHover={{ scale: activeProjectId === 'home' ? 1.03 : 1 }} whileTap={{ scale: 0.96 }} transition={{ type: 'spring', stiffness: 420, damping: 26 }} className={`flex h-[28px] w-fit items-center gap-1.5 rounded-lg border px-2.5 !text-[12px] leading-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-(--codeclub-accent) ${activeProjectId === 'home' ? 'border-(--codeclub-border-soft) bg-(--codeclub-acrylic-active) text-(--codeclub-text-strong) shadow-(--codeclub-shadow-soft)' : 'border-transparent bg-transparent text-(--codeclub-text-muted) hover:bg-(--codeclub-hover)'}`}><House size={15} aria-hidden="true" className="shrink-0" /><span>{t.home}</span></motion.button>
      {projects.map((project) => <motion.div key={project.id} role="tab" aria-selected={activeProjectId === project.id} animate={{ scale: activeProjectId === project.id ? 1 : 0.97, opacity: activeProjectId === project.id ? 1 : 0.72 }} whileHover={{ scale: activeProjectId === project.id ? 1.03 : 1 }} transition={{ type: 'spring', stiffness: 420, damping: 26 }} className={`group flex h-[28px] max-w-[220px] items-center rounded-lg border !text-[12px] leading-none ${activeProjectId === project.id ? 'border-(--codeclub-border-soft) bg-(--codeclub-acrylic-active) text-(--codeclub-text-strong) shadow-(--codeclub-shadow-soft)' : 'border-transparent bg-transparent text-(--codeclub-text-muted) hover:bg-(--codeclub-hover)'}`}><button type="button" title={`${t.open} ${t.projects.toLowerCase()} ${project.name}`} style={noDragStyle} onClick={() => void selectProject(project)} className="flex h-full min-w-0 items-center gap-1.5 rounded-l-lg border-0 bg-transparent px-2.5 text-inherit focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-(--codeclub-accent)" role="tab" aria-selected={activeProjectId === project.id}>{activeProjectId === project.id ? <FolderOpen size={15} aria-hidden="true" className="shrink-0" /> : <Folder size={15} aria-hidden="true" className="shrink-0" />}<span className="truncate">{project.name}</span></button><button type="button" onClick={() => void closeProject(project)} style={noDragStyle} className={`mr-1 grid h-5 w-5 shrink-0 place-items-center rounded-md border-0 bg-transparent text-(--codeclub-text-muted) transition-opacity hover:bg-(--codeclub-hover) hover:text-(--codeclub-text-strong) focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-(--codeclub-accent) ${activeProjectId === project.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'}`} aria-label={`${t.close} ${t.projects.toLowerCase()} ${project.name}`} title={`${t.close} ${t.projects.toLowerCase()} ${project.name}`}><X size={13} aria-hidden="true" /></button></motion.div>)}
      <button type="button" style={noDragStyle} onClick={() => void addProject()} className="grid h-7 w-7 place-items-center rounded-md border-0 bg-transparent text-(--codeclub-text) hover:bg-(--codeclub-hover) focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-(--codeclub-accent)" aria-label={t.addProject} title={t.linkFolder}><Plus size={17} aria-hidden="true" /></button>
    </div>
    <div className="min-w-0 flex-1" />
    <nav className="mr-2 flex h-full items-center gap-1" aria-label={t.panels} style={noDragStyle}>
      <motion.button type="button" title={topbarOpen ? t.hideTopbar : t.showTopbar} onClick={onToggleTopbar} animate={{ scale: topbarOpen ? 1 : 0.94, opacity: topbarOpen ? 1 : 0.58 }} whileHover={{ scale: topbarOpen ? 1.08 : 1 }} whileTap={{ scale: 0.9 }} transition={{ type: 'spring', stiffness: 420, damping: 26 }} className={`grid h-7 w-7 place-items-center border focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-(--codeclub-accent) ${topbarOpen ? 'rounded-full border-(--codeclub-border-soft) bg-(--codeclub-acrylic-active) text-(--codeclub-text-strong)' : 'rounded-md border-transparent bg-transparent text-(--codeclub-icon) hover:bg-(--codeclub-hover)'}`} aria-label={topbarOpen ? t.hideTopbar : t.showTopbar} aria-pressed={topbarOpen}><PanelTop size={14} aria-hidden="true" /></motion.button>
      <motion.button type="button" title={leftOpen ? t.hideLeftSidebar : t.showLeftSidebar} onClick={onToggleLeft} animate={{ scale: leftOpen ? 1 : 0.94, opacity: leftOpen ? 1 : 0.58 }} whileHover={{ scale: leftOpen ? 1.08 : 1 }} whileTap={{ scale: 0.9 }} transition={{ type: 'spring', stiffness: 420, damping: 26 }} className={`grid h-7 w-7 place-items-center border focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-(--codeclub-accent) ${leftOpen ? 'rounded-full border-(--codeclub-border-soft) bg-(--codeclub-acrylic-active) text-(--codeclub-text-strong)' : 'rounded-md border-transparent bg-transparent text-(--codeclub-icon) hover:bg-(--codeclub-hover)'}`} aria-label={leftOpen ? t.hideLeftSidebar : t.showLeftSidebar} aria-pressed={leftOpen}><PanelLeft size={14} aria-hidden="true" /></motion.button>
      <motion.button type="button" title={rightOpen ? t.hideRightSidebar : t.showRightSidebar} onClick={onToggleRight} animate={{ scale: rightOpen ? 1 : 0.94, opacity: rightOpen ? 1 : 0.58 }} whileHover={{ scale: rightOpen ? 1.08 : 1 }} whileTap={{ scale: 0.9 }} transition={{ type: 'spring', stiffness: 420, damping: 26 }} className={`grid h-7 w-7 place-items-center border focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-(--codeclub-accent) ${rightOpen ? 'rounded-full border-(--codeclub-border-soft) bg-(--codeclub-acrylic-active) text-(--codeclub-text-strong)' : 'rounded-md border-transparent bg-transparent text-(--codeclub-icon) hover:bg-(--codeclub-hover)'}`} aria-label={rightOpen ? t.hideRightSidebar : t.showRightSidebar} aria-pressed={rightOpen}><PanelRight size={14} aria-hidden="true" /></motion.button>
    </nav>
    <nav className="flex h-full items-center" aria-label={t.windowControls}>
      <button id="minimize" title="Minimizar ventana" style={noDragStyle} onClick={() => nativeWindow('windowMinimize')} className="grid h-[34px] w-[42px] place-items-center border-0 bg-transparent text-(--codeclub-text) hover:bg-(--codeclub-hover) focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-(--codeclub-accent)" aria-label="Minimizar ventana"><Minus size={13} aria-hidden="true" /></button>
      <button id="maximize" title="Maximizar o restaurar ventana" style={noDragStyle} onClick={() => nativeWindow('windowMaximize')} className="grid h-[34px] w-[42px] place-items-center border-0 bg-transparent text-(--codeclub-text) hover:bg-(--codeclub-hover) focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-(--codeclub-accent)" aria-label="Maximizar o restaurar ventana"><Square size={12} aria-hidden="true" /></button>
      <button id="close" title="Ocultar en la bandeja" style={noDragStyle} onClick={() => nativeWindow('windowClose')} className="grid h-[34px] w-[42px] place-items-center border-0 bg-transparent text-(--codeclub-text) hover:bg-(--codeclub-danger) hover:text-white focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-(--codeclub-accent)" aria-label="Ocultar aplicación en la bandeja"><X size={15} aria-hidden="true" /></button>
    </nav>
  </header>;
}
