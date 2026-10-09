'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, X } from 'lucide-react';
import ScheduledSelect from './ui/ScheduledSelect';
import { taskEditorTranslations, useAppLanguage } from '../lib/i18n';

/** Visual task editor. Values remain local until task creation is connected to the native scheduler. */
export default function TaskEditorModal({ onClose }: { onClose: () => void }) {
  const language = useAppLanguage();
  const text = taskEditorTranslations[language];
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [repeat, setRepeat] = useState(true);
  const [frequency, setFrequency] = useState<string>(text.frequencies[0]);
  const timeOptions = Array.from({ length: 48 }, (_, index) => {
    const date = new Date();
    date.setHours(Math.floor(index / 2), index % 2 * 30, 0, 0);
    return new Intl.DateTimeFormat(language === 'en' ? 'en-US' : 'es-AR', { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(date);
  });
  const [time, setTime] = useState(timeOptions[18]);
  const [endRepeat, setEndRepeat] = useState<string>(text.endOptions[0]);
  const [advanced, setAdvanced] = useState(false);
  const [notifications, setNotifications] = useState<string>(text.notificationOptions[0]);
  const [paused, setPaused] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => nameRef.current?.focus());
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); closeRef.current(); }
    };
    window.addEventListener('keydown', escape);
    return () => { window.cancelAnimationFrame(frame); window.removeEventListener('keydown', escape); opener?.focus(); };
  }, []);
  return createPortal(<div className="fixed inset-0 z-[2147483647] grid place-items-center bg-black/70 p-4" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="codeclub-task-editor-heading" className="flex max-h-[calc(100dvh-32px)] w-full max-w-[440px] flex-col overflow-hidden rounded-[20px] border border-[#151515] bg-[#111111] p-4 shadow-2xl" onKeyDown={event => {
      if (event.key !== 'Tab') return;
      const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled)')).filter(element => element.getClientRects().length > 0);
      const first = controls[0];
      const last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}>
      <header className="mb-3 flex shrink-0 items-center justify-between"><h2 id="codeclub-task-editor-heading" className="m-0 text-[14px] font-semibold text-[#eeeeee]">{text.title}</h2><button type="button" onClick={onClose} aria-label={text.close} title={text.close} className="grid h-6 w-6 place-items-center rounded-md text-[#666666] hover:text-[#eeeeee] focus-visible:outline-2 focus-visible:outline-(--codeclub-accent)"><X size={14} aria-hidden="true" /></button></header>
      <div className="min-h-0 overflow-y-auto [scrollbar-width:thin]">
        <input ref={nameRef} value={name} onChange={event => setName(event.target.value)} aria-label={text.name} placeholder={text.namePlaceholder} className="h-8 w-full rounded-lg border border-[#171717] bg-[#101010] px-4 text-[12px] text-[#eeeeee] outline-none placeholder:text-[#666666] focus-visible:border-[#2b2b2b]" />
        <textarea value={prompt} onChange={event => setPrompt(event.target.value)} aria-label={text.prompt} placeholder={text.promptPlaceholder} rows={3} className="mt-2 block min-h-[76px] w-full resize-none rounded-lg border border-[#171717] bg-[#101010] px-3 py-2.5 text-[12px] leading-[17px] text-[#eeeeee] outline-none placeholder:text-[#666666] focus-visible:border-[#2b2b2b]" />
        <div className="mt-3 overflow-hidden rounded-[12px] border border-[#202020] bg-[#101010]">
          <div className="flex h-8 items-center justify-between px-3"><span className="text-[12px] text-[#eeeeee]">{text.repeatTask}</span><button type="button" role="switch" aria-checked={repeat} aria-label={text.repeatTask} title={text.repeatTask} onClick={() => setRepeat(value => !value)} className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-transparent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--codeclub-accent)"><span className={`relative block h-4 w-[26px] rounded-full ${repeat ? 'bg-[#1687ff]' : 'bg-[#3a3a3a]'}`} aria-hidden="true"><span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white ${repeat ? 'right-0.5' : 'left-0.5'}`} /></span></button></div>
          <fieldset disabled={!repeat} className={`m-0 min-w-0 border-0 p-0 ${repeat ? '' : 'opacity-40'}`}>
            <div className="flex h-8 items-center justify-between border-t border-[#202020] px-3"><span className="text-[12px] text-[#eeeeee]">{text.repeat}</span><ScheduledSelect variant="compact" value={frequency} options={[...text.frequencies]} onChange={setFrequency} label={text.repeat} /></div>
            <div className="flex h-8 items-center justify-between border-t border-[#202020] px-3"><span className="text-[12px] text-[#eeeeee]">{text.time}</span><ScheduledSelect variant="compact" value={time} options={timeOptions} onChange={setTime} label={text.time} /></div>
            <div className="flex h-8 items-center justify-between border-t border-[#202020] px-3"><span className="text-[12px] text-[#eeeeee]">{text.endRepeat}</span><ScheduledSelect variant="compact" value={endRepeat} options={[...text.endOptions]} onChange={setEndRepeat} label={text.endRepeat} /></div>
          </fieldset>
        </div>
        <button type="button" onClick={() => setAdvanced(value => !value)} aria-expanded={advanced} aria-controls="codeclub-task-advanced" className="mt-3 inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px] text-[#999999] hover:text-[#eeeeee] focus-visible:outline-2 focus-visible:outline-(--codeclub-accent)">{text.advanced}<ChevronDown size={12} className={advanced ? 'rotate-180' : ''} aria-hidden="true" /></button>
        {advanced && <div id="codeclub-task-advanced" className="mt-2 flex h-8 items-center justify-between rounded-lg border border-[#202020] px-3"><span className="text-[12px] text-[#eeeeee]">{text.notifications}</span><ScheduledSelect variant="compact" value={notifications} options={[...text.notificationOptions]} onChange={setNotifications} label={text.notifications} /></div>}
      </div>
      <footer className="mt-3 flex shrink-0 justify-end gap-2"><button type="button" onClick={() => setPaused(value => !value)} className="h-7 rounded-full bg-[#151515] px-4 text-[12px] text-[#eeeeee] hover:bg-[#202020] focus-visible:outline-2 focus-visible:outline-(--codeclub-accent)">{paused ? text.resume : text.pause}</button><button type="button" disabled className="h-7 rounded-full bg-[#555555] px-5 text-[12px] text-[#111111]">{text.save}</button></footer>
    </div>
  </div>, document.body);
}
