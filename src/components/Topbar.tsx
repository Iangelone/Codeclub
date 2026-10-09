'use client';

/** Navigation, layout toggles, and native window controls. */
import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Command, Minus, PanelLeft, PanelRight, Square, X } from 'lucide-react';
import { motion } from 'motion/react';
import { topbarTranslations, useAppLanguage } from '../lib/i18n';


export default function Topbar({ leftOpen, rightOpen, onToggleLeft, onToggleRight }: { leftOpen: boolean; rightOpen: boolean; onToggleLeft: () => void; onToggleRight: () => void }) {
  const language = useAppLanguage();
  const t = topbarTranslations[language];
  const [chatPanelVisible, setChatPanelVisible] = useState(true);
  const [slashMenuActive, setSlashMenuActive] = useState(false);
  const [panelNavigation, setPanelNavigation] = useState({ back: false, forward: false });
  const noDragStyle = { WebkitAppRegion: 'no-drag' } as React.CSSProperties;
  useEffect(() => {
    const handleChatPanelVisibility = (event: Event) => setChatPanelVisible((event as CustomEvent<{ visible?: boolean }>).detail?.visible === true);
    const handleSlashMenuState = (event: Event) => setSlashMenuActive((event as CustomEvent<{ active?: boolean }>).detail?.active === true);
    const handlePanelNavigation = (event: Event) => {
      const detail = (event as CustomEvent<{ back?: boolean; forward?: boolean }>).detail;
      setPanelNavigation({ back: Boolean(detail?.back), forward: Boolean(detail?.forward) });
    };
    window.addEventListener('codeclub:chat-panel-visibility', handleChatPanelVisibility);
    window.addEventListener('codeclub:slash-menu-state', handleSlashMenuState);
    window.addEventListener('codeclub:right-panel-navigation-state', handlePanelNavigation);
    window.dispatchEvent(new CustomEvent('codeclub:right-panel-navigation-request'));
    return () => {
      window.removeEventListener('codeclub:chat-panel-visibility', handleChatPanelVisibility);
      window.removeEventListener('codeclub:slash-menu-state', handleSlashMenuState);
      window.removeEventListener('codeclub:right-panel-navigation-state', handlePanelNavigation);
    };
  }, []);
  const nativeWindow = (action: 'windowMinimize' | 'windowMaximize' | 'windowClose') => { const api = (window as any).codeclub; if (!api?.[action]) { console.error(`Electron bridge no disponible: ${action}`); return; } void Promise.resolve(api[action]()).catch((error) => console.error(`Falló ${action}`, error)); };
  return <header role="banner" aria-label="Codeclub" className="codeclub-widget-chrome relative z-[100] col-span-full flex h-[34px] min-w-0 items-center select-none">
    <div className="flex h-full items-center gap-1 pl-2" role="toolbar" aria-orientation="horizontal" aria-label={t.windowControls}>
      <motion.button type="button" disabled={!panelNavigation.back} onClick={() => window.dispatchEvent(new CustomEvent('codeclub:right-panel-back'))} title={t.back} aria-label={t.back} className="grid h-7 w-7 shrink-0 place-items-center rounded-md border-0 bg-transparent text-(--codeclub-icon) transition-colors hover:bg-transparent hover:text-(--codeclub-text-strong) disabled:cursor-not-allowed disabled:opacity-35 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-(--codeclub-accent)" whileHover={panelNavigation.back ? { scale: 1.06 } : undefined} whileTap={panelNavigation.back ? { scale: 0.92 } : undefined} transition={{ type: 'spring', stiffness: 420, damping: 26 }}><ArrowLeft size={17} strokeWidth={1.7} aria-hidden="true" /></motion.button>
      <motion.button type="button" disabled={!panelNavigation.forward} onClick={() => window.dispatchEvent(new CustomEvent('codeclub:right-panel-forward'))} title={t.forward} aria-label={t.forward} className="grid h-7 w-7 shrink-0 place-items-center rounded-md border-0 bg-transparent text-(--codeclub-icon) transition-colors hover:bg-transparent hover:text-(--codeclub-text-strong) disabled:cursor-not-allowed disabled:opacity-35 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-(--codeclub-accent)" whileHover={panelNavigation.forward ? { scale: 1.06 } : undefined} whileTap={panelNavigation.forward ? { scale: 0.92 } : undefined} transition={{ type: 'spring', stiffness: 420, damping: 26 }}><ArrowRight size={17} strokeWidth={1.7} aria-hidden="true" /></motion.button>
    </div>
    <div className="min-w-0 flex-1" />
    <nav className="mr-2 flex h-full items-center gap-1" aria-label={t.panels} style={noDragStyle}>
      <motion.button type="button" title={leftOpen ? t.hideLeftSidebar : t.showLeftSidebar} onClick={onToggleLeft} animate={{ scale: leftOpen ? 1 : 0.94, opacity: leftOpen ? 1 : 0.58 }} whileHover={{ scale: leftOpen ? 1.08 : 1 }} whileTap={{ scale: 0.9 }} transition={{ type: 'spring', stiffness: 420, damping: 26 }} className={`grid h-7 w-7 place-items-center border focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-(--codeclub-accent) ${leftOpen ? 'rounded-full border-(--codeclub-border-soft) bg-(--codeclub-acrylic-active) text-(--codeclub-text-strong)' : 'rounded-md border-transparent bg-transparent text-(--codeclub-icon) hover:bg-(--codeclub-hover)'}`} aria-label={leftOpen ? t.hideLeftSidebar : t.showLeftSidebar} aria-pressed={leftOpen}><PanelLeft size={14} aria-hidden="true" /></motion.button>
      <motion.button type="button" title={rightOpen ? t.hideRightSidebar : t.showRightSidebar} onClick={onToggleRight} animate={{ scale: rightOpen ? 1 : 0.94, opacity: rightOpen ? 1 : 0.58 }} whileHover={{ scale: rightOpen ? 1.08 : 1 }} whileTap={{ scale: 0.9 }} transition={{ type: 'spring', stiffness: 420, damping: 26 }} className={`grid h-7 w-7 place-items-center border focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-(--codeclub-accent) ${rightOpen ? 'rounded-full border-(--codeclub-border-soft) bg-(--codeclub-acrylic-active) text-(--codeclub-text-strong)' : 'rounded-md border-transparent bg-transparent text-(--codeclub-icon) hover:bg-(--codeclub-hover)'}`} aria-label={rightOpen ? t.hideRightSidebar : t.showRightSidebar} aria-pressed={rightOpen}><PanelRight size={14} aria-hidden="true" /></motion.button>
      {chatPanelVisible && <motion.button type="button" data-slash-menu-toggle="true" title={slashMenuActive ? t.closeCommands : t.openCommands} onClick={() => window.dispatchEvent(new CustomEvent('codeclub:toggle-slash-menu'))} whileHover={{ scale: 1.08 }} whileTap={{ scale: 0.9 }} transition={{ type: 'spring', stiffness: 420, damping: 26 }} className={`grid h-7 w-7 place-items-center border focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-(--codeclub-accent) ${slashMenuActive ? 'rounded-full border-(--codeclub-border-soft) bg-(--codeclub-acrylic-active) text-(--codeclub-text-strong)' : 'rounded-md border-transparent bg-transparent text-(--codeclub-icon) hover:bg-(--codeclub-hover) hover:text-(--codeclub-text-strong)'}`} aria-label={slashMenuActive ? t.closeCommands : t.openCommands} aria-pressed={slashMenuActive}><Command size={14} aria-hidden="true" /></motion.button>}
    </nav>
    <nav className="flex h-full items-center" aria-label={t.windowControls}>
      <button id="minimize" title={t.minimizeWindow} style={noDragStyle} onClick={() => nativeWindow('windowMinimize')} className="grid h-[34px] w-[42px] place-items-center border-0 bg-transparent text-(--codeclub-text) hover:bg-(--codeclub-hover) focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-(--codeclub-accent)" aria-label={t.minimizeWindow}><Minus size={13} aria-hidden="true" /></button>
      <button id="maximize" title={t.maximizeWindow} style={noDragStyle} onClick={() => nativeWindow('windowMaximize')} className="grid h-[34px] w-[42px] place-items-center border-0 bg-transparent text-(--codeclub-text) hover:bg-(--codeclub-hover) focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-(--codeclub-accent)" aria-label={t.maximizeWindow}><Square size={12} aria-hidden="true" /></button>
      <button id="close" title={t.hideInTray} style={noDragStyle} onClick={() => nativeWindow('windowClose')} className="grid h-[34px] w-[42px] place-items-center border-0 bg-transparent text-(--codeclub-text) hover:bg-(--codeclub-danger) hover:text-white focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-(--codeclub-accent)" aria-label={t.hideInTray}><X size={15} aria-hidden="true" /></button>
    </nav>
  </header>;
}
