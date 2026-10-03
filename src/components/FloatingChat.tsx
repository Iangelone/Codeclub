'use client';

import { useEffect, useState, type PointerEvent } from 'react';
import { Home, MessageSquare, Plus, ChevronDown, GripHorizontal } from 'lucide-react';
import ChatInterface from './ChatInterface';
import FluidOrb from './ui/fluid-orb';
import { models, providers } from '../lib/ai-catalog';
import { floatingChatTranslations, useAppLanguage } from '../lib/i18n';
import './floating-chat.css';
import { invalidateSettingsCache } from '../lib/persistence';

const catalog = [...providers.map(provider => ({ ...provider, type: 'provider' })), ...models.map(model => ({ ...model, type: 'model' }))];
const defaultProvider = providers[0];
const defaultModel = models.find(model => model.providerId === defaultProvider?.id);

export default function FloatingChat() {
  const [expanded, setExpanded] = useState(false);
  const language = useAppLanguage();
  const text = floatingChatTranslations[language];
  const bridge = () => (window as any).codeclub;
  const resize = (next: boolean) => { setExpanded(next); void bridge()?.floatingResize(next); };
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
    const unsubscribe = bridge()?.onFloatingShow(() => {
      invalidateSettingsCache();
      window.dispatchEvent(new CustomEvent('codeclub:settings-changed'));
      const stored = window.localStorage.getItem('codeclub-language');
      if (stored === 'en' || stored === 'es') window.dispatchEvent(new CustomEvent('codeclub:language-change', { detail: { language: stored } }));
    });
    return () => unsubscribe?.();
  }, []);

  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !(event.target as HTMLElement)?.closest('.command-menu')) resize(false);
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, []);

  const newChat = () => { window.dispatchEvent(new CustomEvent('codeclub:open-empty-chat')); resize(true); };
  return <main className={`floating-shell ${expanded ? 'is-expanded' : 'is-compact'}`} aria-label={text.chat}>
    <header className="floating-toolbar">
      <nav aria-label={text.controls}>
        <button type="button" title={text.open} aria-label={text.open} onClick={() => void bridge()?.floatingOpenMain()}><Home size={17} /></button>
        <button type="button" className={expanded ? 'is-active' : ''} title={text.chat} aria-label={text.chat} onClick={() => resize(!expanded)}><MessageSquare size={17} /></button>
        <button type="button" title={text.newChat} aria-label={text.newChat} onClick={newChat}><Plus size={20} /></button>
      </nav>
      <div className="floating-drag-handle" title={text.drag} aria-label={text.drag} {...dragProps}><GripHorizontal size={18} /></div>
      <button type="button" title={text.collapse} aria-label={text.collapse} onClick={() => resize(false)}><ChevronDown size={17} /></button>
    </header>
    <section className="floating-surface">
      <ChatInterface catalog={catalog} defaultProvider={defaultProvider} defaultModel={defaultModel} panelId="floating" eventPrefix="codeclub:floating" floating onDraftChange={() => { if (!expanded) resize(true); }} composerLeading={<div className="floating-orb" title={text.drag} aria-label={text.drag} {...dragProps}><FluidOrb aria-hidden="true" size={24} color="#2D5FD6" /></div>} />
    </section>
  </main>;
}
