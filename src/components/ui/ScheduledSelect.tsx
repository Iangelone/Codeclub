'use client';

/** Shared keyboard-accessible selector used by scheduled-task controls. */
import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useAppLanguage } from '../../lib/i18n';

export default function ScheduledSelect({ value, options, onChange, label, searchable = false, optionSearchText, variant = 'default' }: { value: string; options: string[]; onChange: (value: string) => void; label: string; searchable?: boolean; optionSearchText?: (option: string) => string; variant?: 'default' | 'modal' | 'compact' }) {
  const language = useAppLanguage();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const selectRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 0, bottom: 0, width: 0, maxHeight: 300 });
  const floating = variant === 'modal' || variant === 'compact';
  const toggle = (button: HTMLButtonElement) => {
    if (floating) {
      const bounds = button.getBoundingClientRect();
      const dialogTop = button.closest('[role="dialog"]')?.getBoundingClientRect().top ?? 0;
      const width = variant === 'compact' ? Math.max(bounds.width, 180) : bounds.width;
      setPosition({ left: Math.max(8, Math.min(bounds.left, window.innerWidth - width - 8)), bottom: window.innerHeight - bounds.top + 6, width, maxHeight: Math.max(80, Math.min(300, bounds.top - dialogTop - 18)) });
    }
    setOpen((current) => !current);
  };
  useEffect(() => {
    if (!open) return;
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); selectRef.current?.querySelector('button')?.focus(); } };
    const closeOnScroll = (event: Event) => { if (!menuRef.current?.contains(event.target as Node)) setOpen(false); };
    const close = () => setOpen(false);
    selectRef.current?.addEventListener('keydown', escape);
    const element = selectRef.current;
    window.addEventListener('resize', close);
    window.addEventListener('scroll', closeOnScroll, true);
    return () => { element?.removeEventListener('keydown', escape); window.removeEventListener('resize', close); window.removeEventListener('scroll', closeOnScroll, true); };
  }, [open]);
  useEffect(() => {
    const close = (event: MouseEvent) => { if (!selectRef.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  return <div ref={selectRef} className="relative">
    <button type="button" onClick={(event) => toggle(event.currentTarget)} className={`flex items-center gap-2 ${variant === 'compact' ? 'text-[12px]' : 'text-[13px]'} ${variant === 'compact' ? 'text-[#999999]' : 'text-[#dddddd]'} transition-colors focus-visible:outline-2 focus-visible:outline-(--codeclub-accent) ${variant === 'modal' ? 'h-9 w-full justify-between rounded-none border border-[#2B2B2B] bg-[#161616] px-3 text-left hover:bg-[#191919]' : 'max-w-[280px] rounded-lg px-2 py-1.5 text-right hover:bg-white/[0.06]'}`} aria-label={label} aria-expanded={open}>
      <span className="truncate">{value}</span><ChevronDown size={15} className={`shrink-0 text-[#888888] transition-transform ${open ? 'rotate-180' : ''}`} />
    </button>
    {open && <div ref={menuRef} style={floating ? position : undefined} className={`z-30 flex flex-col overflow-hidden border p-1.5 shadow-2xl shadow-black/40 ${floating ? `fixed ${variant === 'compact' ? 'rounded-lg' : 'rounded-none'} border-[#2B2B2B] bg-[#111111]` : 'absolute right-0 top-[calc(100%+4px)] max-h-72 min-w-[220px] rounded-xl border-white/[0.1] bg-[#292929]'}`}>
      {searchable && <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`${language === 'en' ? 'Search' : 'Buscar'} ${label.toLowerCase()}`} className={`mb-1.5 h-9 w-full shrink-0 border border-[#2B2B2B] bg-[#161616] px-2.5 py-2 text-[12px] text-[#eeeeee] outline-none placeholder:text-[#777777] focus:border-(--codeclub-accent) ${variant === 'modal' ? 'rounded-none' : 'rounded-lg'}`} />}
      <div className="project-files-modal-scroll min-h-0 overflow-y-auto overscroll-contain">
      {options.filter((option) => `${option} ${optionSearchText?.(option) || ''}`.toLowerCase().includes(query.toLowerCase())).map((option) => <button key={option} type="button" onClick={() => { onChange(option); setQuery(''); setOpen(false); }} className={`flex w-full items-center rounded-lg px-3 py-2 text-left text-[13px] transition-colors ${option === value ? 'bg-[#333333] text-(--codeclub-accent-bright)' : 'text-[#cccccc] hover:bg-white/[0.07] hover:text-white'}`}>{option}</button>)}
      </div>
    </div>}
  </div>;
}

