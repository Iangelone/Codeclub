'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

export default function SidebarCategory({ id, title, children, action, initiallyOpen = false }: { id: string; title: string; children: ReactNode; action?: ReactNode; initiallyOpen?: boolean }) {
  const [expanded, setExpanded] = useState(initiallyOpen);
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(`codeclub:sidebar-category:${id}`);
      if (stored === 'true' || stored === 'false') setExpanded(stored === 'true');
    } catch { /* Keep the category usable when preferences are unavailable. */ }
  }, [id]);
  const toggle = () => {
    const next = !expanded;
    setExpanded(next);
    try { window.localStorage.setItem(`codeclub:sidebar-category:${id}`, String(next)); } catch { /* Keep the in-memory preference. */ }
  };
  return <section className="mt-3 pb-1" aria-label={title}>
    <div className="flex items-center"><button type="button" onClick={toggle} aria-expanded={expanded} aria-controls={`codeclub-sidebar-category-${id}`} className="flex h-7 min-w-0 flex-1 items-center gap-1 rounded-md px-1.5 text-left text-[12px] font-medium text-(--codeclub-text-muted) hover:text-(--codeclub-text-strong) focus-visible:outline-2 focus-visible:outline-(--codeclub-accent)"><span className="truncate">{title}</span><ChevronDown size={12} className={`shrink-0 ${expanded ? '' : '-rotate-90'}`} aria-hidden="true" /></button>{action}</div>
    <div id={`codeclub-sidebar-category-${id}`} hidden={!expanded} className="mt-1 space-y-1">{children}</div>
  </section>;
}
