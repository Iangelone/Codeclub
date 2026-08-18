'use client';

import { ArrowLeft, ArrowRight, ChevronRight, Download, House, RefreshCw, Search } from 'lucide-react';
import { motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { nativeInvoke } from '../lib/runtime';

const controlClass = 'grid h-8 w-8 shrink-0 place-items-center rounded-lg border-0 bg-transparent text-(--codeclub-icon) transition-colors hover:bg-(--codeclub-hover) hover:text-(--codeclub-text-strong) focus-visible:outline-2 focus-visible:outline-(--codeclub-accent)';
const versionParts = (version: string) => version.replace(/^v/i, '').split(/[.-]/).slice(0, 3).map((part) => Number(part) || 0);
const isNewerVersion = (latest: string, current: string) => {
  const next = versionParts(latest);
  const installed = versionParts(current);
  for (let index = 0; index < 3; index += 1) {
    if (next[index] !== installed[index]) return next[index] > installed[index];
  }
  return false;
};

export default function SubTopbar({ activeProject }: { activeProject: { name: string; path?: string } }) {
  const folders = activeProject.path?.split(/[\\/]/).filter(Boolean) ?? [];
  const breadcrumb = activeProject.path ? [...folders.slice(0, -1), activeProject.name] : ['Inicio'];
  const breadcrumbRef = useRef<HTMLDivElement>(null);
  const fullBreadcrumbRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [updateVersion, setUpdateVersion] = useState('');
  const [navigation, setNavigation] = useState({ leftBack: false, leftForward: false, rightBack: false, rightForward: false });
  useEffect(() => {
    const update = () => {
      const container = breadcrumbRef.current;
      const full = fullBreadcrumbRef.current;
      if (!container || !full) return;
      setCollapsed(full.getBoundingClientRect().width > container.clientWidth);
    };
    update();
    const observer = new ResizeObserver(update);
    if (breadcrumbRef.current) observer.observe(breadcrumbRef.current);
    return () => observer.disconnect();
  }, [breadcrumb.join('|')]);
  useEffect(() => {
    const updateRightNavigation = (event: Event) => {
      const detail = (event as CustomEvent<{ back?: boolean; forward?: boolean }>).detail;
      setNavigation((current) => ({ ...current, rightBack: Boolean(detail?.back), rightForward: Boolean(detail?.forward) }));
    };
    const updateLeftNavigation = (event: Event) => {
      const detail = (event as CustomEvent<{ back?: boolean; forward?: boolean }>).detail;
      setNavigation((current) => ({ ...current, leftBack: Boolean(detail?.back), leftForward: Boolean(detail?.forward) }));
    };
    window.addEventListener('codeclub:right-panel-navigation-state', updateRightNavigation);
    window.addEventListener('codeclub:left-panel-navigation-state', updateLeftNavigation);
    window.dispatchEvent(new CustomEvent('codeclub:right-panel-navigation-request'));
    window.dispatchEvent(new CustomEvent('codeclub:left-panel-navigation-request'));
    return () => {
      window.removeEventListener('codeclub:right-panel-navigation-state', updateRightNavigation);
      window.removeEventListener('codeclub:left-panel-navigation-state', updateLeftNavigation);
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    const checkForUpdate = async () => {
      try {
        const current = await nativeInvoke<string>('codeclub_get_app_version');
        const response = await fetch('https://api.github.com/repos/Iangelone/Codeclub/releases/latest', { headers: { Accept: 'application/vnd.github+json' } });
        if (!response.ok) return;
        const release = await response.json() as { tag_name?: string };
        const latest = String(release.tag_name || '').replace(/^v/i, '');
        if (!cancelled && latest && isNewerVersion(latest, current)) setUpdateVersion(latest);
      } catch { /* offline or repository without releases */ }
    };
    void checkForUpdate();
    const timer = window.setInterval(checkForUpdate, 15 * 60 * 1000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, []);
  const visibleBreadcrumb = collapsed && breadcrumb.length > 4 ? breadcrumb.slice(-4) : breadcrumb;
  return <div className="codeclub-graphite flex h-11 min-w-0 items-center gap-2 px-3 text-(--codeclub-text) backdrop-blur-xl backdrop-saturate-150" role="toolbar" aria-label="Navegación del panel">
    <div className="flex shrink-0 items-center gap-1">
      <motion.button type="button" disabled={!navigation.leftBack && !navigation.rightBack} onClick={() => window.dispatchEvent(new CustomEvent('codeclub:right-panel-back'))} className={`${controlClass} disabled:cursor-not-allowed disabled:opacity-35`} whileHover={navigation.leftBack || navigation.rightBack ? { scale: 1.06 } : undefined} whileTap={navigation.leftBack || navigation.rightBack ? { scale: 0.92 } : undefined} transition={{ type: 'spring', stiffness: 420, damping: 26 }} aria-label="Panel anterior" title="Panel anterior"><ArrowLeft size={18} strokeWidth={1.7} /></motion.button>
      <motion.button type="button" disabled={!navigation.leftForward && !navigation.rightForward} onClick={() => window.dispatchEvent(new CustomEvent('codeclub:right-panel-forward'))} className={`${controlClass} disabled:cursor-not-allowed disabled:opacity-35`} whileHover={navigation.leftForward || navigation.rightForward ? { scale: 1.06 } : undefined} whileTap={navigation.leftForward || navigation.rightForward ? { scale: 0.92 } : undefined} transition={{ type: 'spring', stiffness: 420, damping: 26 }} aria-label="Panel siguiente" title="Panel siguiente"><ArrowRight size={18} strokeWidth={1.7} /></motion.button>
      <motion.button type="button" onClick={() => void nativeInvoke('codeclub_open_external', { url: 'https://github.com/Iangelone/Codeclub/releases/latest' })} className={`${controlClass} ${updateVersion ? 'text-white hover:text-white' : ''}`} whileHover={{ scale: 1.06 }} whileTap={{ scale: 0.92 }} transition={{ type: 'spring', stiffness: 420, damping: 26 }} aria-label={updateVersion ? `Actualizar a ${updateVersion}` : 'Buscar actualizaciones'} title={updateVersion ? `Actualización disponible: ${updateVersion}` : 'Buscar actualizaciones'}><Download size={18} strokeWidth={1.7} /></motion.button>
      <motion.button type="button" onClick={() => void (window as any).codeclub?.reloadApp?.()} className={controlClass} whileHover={{ scale: 1.06 }} whileTap={{ scale: 0.92 }} transition={{ type: 'spring', stiffness: 420, damping: 26 }} aria-label="Recargar aplicación" title="Recargar aplicación"><RefreshCw size={18} strokeWidth={1.7} /></motion.button>
    </div>
    <div ref={breadcrumbRef} className="relative flex h-8 min-w-0 flex-1 items-center gap-1 overflow-hidden rounded-lg bg-(--codeclub-acrylic-active) px-3 text-[13px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <House size={17} strokeWidth={1.7} className="shrink-0 text-(--codeclub-icon)" aria-hidden="true" />
      <ChevronRight size={16} strokeWidth={1.7} className="shrink-0 text-(--codeclub-text-muted)" aria-hidden="true" />
      {collapsed && breadcrumb.length > 4 && <span className="flex h-full shrink-0 items-center px-2 text-(--codeclub-text-muted)" aria-hidden="true">…</span>}
      {visibleBreadcrumb.map((segment, index) => <span key={`${segment}-${index}`} className="flex h-full shrink-0 items-center gap-1 leading-none"><span className="px-2 leading-none text-(--codeclub-text-strong)">{segment}</span>{index < visibleBreadcrumb.length - 1 && <ChevronRight size={16} strokeWidth={1.7} className="shrink-0 text-(--codeclub-text-muted)" aria-hidden="true" />}</span>)}
      <div ref={fullBreadcrumbRef} className="pointer-events-none absolute left-0 top-0 flex h-full w-max items-center gap-1 opacity-0" aria-hidden="true"><House size={17} /><ChevronRight size={16} />{breadcrumb.map((segment, index) => <span key={`${segment}-${index}`} className="flex shrink-0 items-center gap-1"><span className="px-2">{segment}</span>{index < breadcrumb.length - 1 && <ChevronRight size={16} />}</span>)}</div>
    </div>
    <label className="flex h-8 min-w-[150px] max-w-[360px] flex-[0.42] items-center gap-2 rounded-lg bg-(--codeclub-acrylic-active) px-3 text-[13px] text-(--codeclub-text-muted)">
      <span className="sr-only">Buscar en {activeProject.name}</span>
      <input className="min-w-0 flex-1 bg-transparent text-(--codeclub-text-strong) outline-none placeholder:text-(--codeclub-text-muted)" placeholder={`Buscar en ${activeProject.name}`} aria-label={`Buscar en ${activeProject.name}`} />
      <Search size={16} strokeWidth={1.8} className="shrink-0" aria-hidden="true" />
    </label>
  </div>;
}
