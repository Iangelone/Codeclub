'use client';

import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';
import { House, Bell, Plus, ChevronDown, GripHorizontal, Pin, PinOff, X } from 'lucide-react';
import { motion, useAnimationControls, useReducedMotion } from 'motion/react';
import ChatInterface from './ChatInterface';
import OrbPaletteButton from './ui/OrbPaletteButton';
import { models, providers } from '../lib/ai-catalog';
import { activityTranslations, floatingChatTranslations, useAppLanguage } from '../lib/i18n';
import { useSharedSessions } from '../lib/shared-sessions';
import { idleWidgetMode, type WidgetMode } from '../lib/widget-state';
import './floating-chat.css';
import { getSetting, invalidateSettingsCache, setSetting } from '../lib/persistence';

const catalog = [...providers.map(provider => ({ ...provider, type: 'provider' })), ...models.map(model => ({ ...model, type: 'model' }))];
const defaultProvider = providers[0];
const defaultModel = models.find(model => model.providerId === defaultProvider?.id);

export default function FloatingChat() {
  const [mode, setMode] = useState<WidgetMode>('compact');
  const animation = useAnimationControls();
  const reducedMotion = useReducedMotion();
  const visibilitySequence = useRef(0);
  const expanded = mode === 'expanded';
  const [autoHide,setAutoHide] = useState(false);
  const sessions = useSharedSessions();
  const attention = sessions.find(session=>session.approvals.length || session.state==='question') || sessions.find(session=>session.state==='error' || session.state==='interrupted');
  const relevant = attention || sessions.find(session=>session.busy) || sessions[0];
  const needsAnswer = Boolean(relevant?.approvals.length || relevant?.state==='question');
  const draft = useRef('');
  const interaction = useRef(false);
  const lastActivity = useRef(Date.now());
  const shell = useRef<HTMLElement>(null);
  const [dropping,setDropping] = useState(false);
  const language = useAppLanguage();
  const text = floatingChatTranslations[language];
  const activityText = activityTranslations[language];
  const bridge = () => (window as any).codeclub;
  const resize = useCallback((next: boolean | WidgetMode) => {
    const state=typeof next==='boolean'?(next?'expanded':'compact'):next;
    setMode(state); void (window as any).codeclub?.floatingResize(state, !reducedMotion);
  }, [reducedMotion]);
  const onDraft = useCallback((value:string) => {draft.current=value;lastActivity.current=Date.now();if(value)resize(true);},[resize]);
  const dragProps = {
    onPointerDown: (event: PointerEvent<HTMLElement>) => { if (event.button !== 0) return; event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); void bridge()?.floatingDrag('start', { x: event.screenX, y: event.screenY }); },
    onPointerMove: (event: PointerEvent<HTMLElement>) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) void bridge()?.floatingDrag('move', { x: event.screenX, y: event.screenY }); },
    onPointerUp: (event: PointerEvent<HTMLElement>) => { if (!event.currentTarget.hasPointerCapture(event.pointerId)) return; event.currentTarget.releasePointerCapture(event.pointerId); void bridge()?.floatingDrag('end', { x: event.screenX, y: event.screenY }); },
    onPointerCancel: (event: PointerEvent<HTMLElement>) => { void bridge()?.floatingDrag('end', { x: event.screenX, y: event.screenY }); },
  };

  useEffect(() => {
    document.title = 'Codeclub · Orb';
    void bridge()?.floatingResize(false);
    // The main process emits visibility on every reveal. This window owns the
    // listener and removes it on unmount; language is shared across renderers.
    const reveal = () => {
      visibilitySequence.current++;
      lastActivity.current = Date.now();
      animation.stop();
      animation.set({ opacity: 0, scale: reducedMotion ? 1 : 0.985 });
      void animation.start({ opacity: 1, scale: 1, transition: { duration: reducedMotion ? 0 : 0.16, ease: 'easeOut' } });
      resize('compact');
      invalidateSettingsCache();
      window.dispatchEvent(new CustomEvent('codeclub:settings-changed'));
      const stored = window.localStorage.getItem('codeclub-language');
      if (stored === 'en' || stored === 'es') window.dispatchEvent(new CustomEvent('codeclub:language-change', { detail: { language: stored } }));
      void bridge()?.sessionSelected?.().then((chat:any)=>{if(chat?.chatId)window.dispatchEvent(new CustomEvent('codeclub:floating:open-chat',{detail:chat}));});
    };
    const unsubscribe = bridge()?.onFloatingShow(reveal);
    const unsubscribeHide = bridge()?.onFloatingHide?.((revision: number) => {
      const sequence = ++visibilitySequence.current;
      animation.stop();
      void animation.start({ opacity: 0, scale: reducedMotion ? 1 : 0.985, transition: { duration: reducedMotion ? 0 : 0.14, ease: 'easeIn' } }).then(() => {
        if (sequence === visibilitySequence.current) void bridge()?.floatingHidden(revision);
      });
    });
    void getSetting('codeclub_widget_auto_hide',false).then(setAutoHide);
    reveal();
    return () => { visibilitySequence.current++; unsubscribe?.(); unsubscribeHide?.(); animation.stop(); };
  }, [resize, animation, reducedMotion]);

  useEffect(()=>{if(needsAnswer)resize(true);},[needsAnswer,resize]);
  useEffect(()=>{
    if(!autoHide)return;
    const timer=setInterval(()=>{
      const blocked=Boolean(draft.current.trim() || needsAnswer || interaction.current || dropping || shell.current?.querySelector('.command-menu'));
      if(Date.now()-lastActivity.current<30000)return;
      const next=idleWidgetMode(mode,blocked,autoHide);
      if(next!==mode){resize(next);lastActivity.current=Date.now();}
    },1000);
    return ()=>clearInterval(timer);
  },[autoHide,mode,needsAnswer,dropping,resize]);
  useEffect(()=>{
    const move=(event:MouseEvent)=>{
      const bounds=shell.current?.getBoundingClientRect();
      const inside=Boolean(bounds&&event.clientX>=bounds.left&&event.clientX<=bounds.right&&event.clientY>=bounds.top&&event.clientY<=bounds.bottom);
      void bridge()?.floatingPointer?.(inside);
      interaction.current=inside;
      if(inside)lastActivity.current=Date.now();
    };
    window.addEventListener('mousemove',move);
    return ()=>window.removeEventListener('mousemove',move);
  },[]);

  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !(event.target as HTMLElement)?.closest('.command-menu')) resize(false);
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, []);

  const newChat = () => { window.dispatchEvent(new CustomEvent('codeclub:open-empty-chat')); resize(true); };
  const openAttention = () => {
    if (!attention) return;
    if (attention.external) {
      if (attention.url) void bridge()?.openExternal?.(attention.url);
      else void bridge()?.floatingOpenMain();
      return;
    }
    resize(true);
    window.dispatchEvent(new CustomEvent('codeclub:floating:open-chat', { detail: attention }));
  };
  return <motion.main ref={shell} initial={{ opacity: 0 }} animate={animation} className={`floating-shell is-${mode} ${dropping?'is-dropping':''}`} aria-label={text.chat}
    onPointerDownCapture={event=>{if((event.target as HTMLElement).closest('textarea')){lastActivity.current=Date.now();resize(true);}}}
    onFocusCapture={event=>{lastActivity.current=Date.now();if(mode!=='expanded' && (event.target as HTMLElement).matches('textarea'))resize(true);}}
    onDragEnter={event=>{event.preventDefault();setDropping(true);resize(true);}}
    onDragLeave={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node))setDropping(false);}}
    onDrop={()=>{setDropping(false);lastActivity.current=Date.now();}}>
    <div className="floating-peek">
      <OrbPaletteButton size={24} active={Boolean(relevant?.busy)} className="floating-peek-orb" />
      <button className="floating-peek-open" type="button" title={text.chat} aria-label={text.chat} onClick={()=>resize(true)}><GripHorizontal size={14}/></button>
    </div>
    <header className="floating-toolbar">
      <nav aria-label={text.controls}>
        <button type="button" title={text.open} aria-label={text.open} onClick={() => void bridge()?.floatingOpenMain()}><House size={17} strokeWidth={1.7} /></button>
        <button type="button" className={`floating-notifications ${attention ? 'is-active' : ''}`} disabled={!attention} title={attention ? text.openAttention : text.noAttention} aria-label={attention ? text.openAttention : text.noAttention} onClick={openAttention}><Bell size={14} /></button>
        <button type="button" title={text.newChat} aria-label={text.newChat} onClick={newChat}><Plus size={20} /></button>
      </nav>
      <div className="floating-drag-handle" title={text.drag} aria-label={text.drag} {...dragProps}><GripHorizontal size={18} /></div>
      <button type="button" aria-pressed={!autoHide} title={autoHide?activityText.autoHide:activityText.keepOpen} aria-label={autoHide?activityText.autoHide:activityText.keepOpen} onClick={()=>{const next=!autoHide;setAutoHide(next);void setSetting('codeclub_widget_auto_hide',next);}}>{autoHide?<PinOff size={14}/>:<Pin size={14}/>}</button>
      <button type="button" title={text.collapse} aria-label={text.collapse} onClick={() => resize(false)}><ChevronDown size={17} /></button>
      <button className="floating-close" type="button" title={text.close} aria-label={text.close} onClick={() => void bridge()?.floatingClose()}><X size={16} strokeWidth={1.7} /></button>
    </header>
    <section className="floating-surface">
      <ChatInterface catalog={catalog} defaultProvider={defaultProvider} defaultModel={defaultModel} panelId="floating" eventPrefix="codeclub:floating" floating onDraftChange={onDraft} composerLeading={<div className={`floating-orb ${needsAnswer?'needs-answer':relevant?.busy?'is-working':''}`} title={text.drag} aria-label={text.drag} {...dragProps}><OrbPaletteButton size={24} active={!needsAnswer && Boolean(relevant?.busy)} className="floating-orb-button" /></div>} />
    </section>
  </motion.main>;
}
