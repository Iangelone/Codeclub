import React, { useEffect, useState } from 'react';
import { Check, CheckCircle2, Download, List, Search, Sparkles, Trash2, TriangleAlert } from 'lucide-react';
import { LANGUAGE_STORAGE_KEY, type AppLanguage } from '../lib/i18n';
import { deleteMemory, listMemories, saveMemory, searchMemory, type MemoryEntry } from '../lib/engine/memory';

const copy = {
  es: {
    title: 'Memoria',
    search: 'Buscar en la memoria',
    all: 'Todas',
    confirmed: 'Confirmadas',
    new: 'Nuevas',
    conflicts: 'Conflictos',
    description: 'Administrá memorias, decisiones y contexto', export: 'Exportar memoria', confirm: 'Confirmar memoria', forget: 'Olvidar memoria', filters: 'Filtros de memoria',
    noProject: 'Seleccioná un proyecto para ver su memoria.',
    emptyTitle: 'Todavía no hay memorias',
    emptyDescription: 'Las decisiones, preferencias y pendientes importantes van a aparecer acá.',
  },
  en: {
    title: 'Memory',
    search: 'Search memory',
    all: 'All',
    confirmed: 'Confirmed',
    new: 'New',
    conflicts: 'Conflicts',
    description: 'Manage memories, decisions and context', export: 'Export memory', confirm: 'Confirm memory', forget: 'Forget memory', filters: 'Memory filters',
    noProject: 'Select a project to view its memory.',
    emptyTitle: 'No memories yet',
    emptyDescription: 'Important decisions, preferences and open threads will appear here.',
  },
} as const;

export default function AgentPanel({ projectPath, creature }: { projectPath?: string; creature?: React.ReactNode }) {
  const [language, setLanguage] = useState<AppLanguage>('es');
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [memories, setMemories] = useState<MemoryEntry[]>([]);
  const text = copy[language];
  const memoryProjectPath = projectPath || '';

  const load = async () => {
    setMemories(query ? await searchMemory(memoryProjectPath, query) : await listMemories(memoryProjectPath));
  };

  useEffect(() => { void load(); }, [projectPath, query]);

  useEffect(() => {
    if (window.localStorage.getItem(LANGUAGE_STORAGE_KEY) === 'en') setLanguage('en');
    const handleLanguageChange = (event: Event) => {
      const next = (event as CustomEvent<{ language?: AppLanguage }>).detail?.language;
      if (next === 'es' || next === 'en') setLanguage(next);
    };
    window.addEventListener('codeclub:language-change', handleLanguageChange);
    return () => window.removeEventListener('codeclub:language-change', handleLanguageChange);
  }, []);

  const filters = [
    { id: 'all', label: text.all, icon: List },
    { id: 'confirmed', label: text.confirmed, icon: CheckCircle2 },
    { id: 'new', label: text.new, icon: Sparkles },
    { id: 'conflicts', label: text.conflicts, icon: TriangleAlert },
  ];
  const visibleMemories = memories.filter((memory) => filter === 'all' || memory.status === filter);
  const filterCount = (id: string) => id === 'all' ? memories.length : memories.filter((memory) => memory.status === id).length;
  const confirmMemory = async (memory: MemoryEntry) => { await saveMemory(memoryProjectPath, memory.key, memory.content, memory.tags, { status: 'confirmed', confidence: Math.max(memory.confidence || 0.5, 0.8) }); await load(); };
  const forgetMemory = async (memory: MemoryEntry) => { await deleteMemory(memoryProjectPath, memory.key); await load(); };
  const exportMemories = () => { const blob = new Blob([JSON.stringify(memories, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'codeclub-memories.json'; anchor.click(); URL.revokeObjectURL(url); };

  return <main className="mt-10 w-full max-w-[1040px] px-6 pb-8 lg:px-8">
    <header className="flex items-center justify-between">
      <div><h2 className="m-0 text-[28px] font-normal tracking-[-0.04em] text-[#eeeeee]">{text.title}</h2><p className="mt-1.5 text-[14px] text-[#999999]">{text.description}</p></div>
    </header>
    <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        {creature && <div className="relative h-8 w-8 shrink-0"><div className="absolute left-0 top-0 origin-top-left scale-[0.36]">{creature}</div></div>}
        <nav className="flex items-center gap-0.5 text-[13px] text-[#777777]" aria-label={text.filters}>
          {filters.map(({ id, label, icon: Icon }) => <button key={id} type="button" onClick={() => setFilter(id)} aria-label={label} className={`inline-flex items-center gap-1.5 rounded-[8px] border-0 px-3 py-1.5 ${filter === id ? 'bg-[#2b2b2b] text-[#eeeeee]' : 'bg-transparent text-[#777777] hover:bg-[#202020]'}`}><Icon size={14} strokeWidth={1.8} className="shrink-0 text-[#eeeeee]" aria-hidden="true" />{label} {filterCount(id) > 0 && <span className="text-[#999999]">{filterCount(id)}</span>}</button>)}
        </nav>
      </div>
      <label className="flex h-9 w-full max-w-[320px] items-center gap-2 rounded-[9px] border border-[#3a3a3a] bg-[#202020] px-3 text-[#999999] focus-within:border-[#555555]"><Search size={16} strokeWidth={1.7} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={text.search} aria-label={text.search} className="min-w-0 flex-1 border-0 bg-transparent text-[13px] text-[#eeeeee] outline-none placeholder:text-[#777777]" /><button type="button" onClick={exportMemories} disabled={!memories.length} aria-label={text.export} className="grid h-6 w-6 shrink-0 place-items-center rounded-md border-0 bg-transparent text-[#777777] hover:bg-[#2b2b2b] hover:text-[#eeeeee] disabled:opacity-40"><Download size={14} /></button></label>
    </div>
    {visibleMemories.length > 0 ? <section className="mt-9 grid min-w-0 gap-1.5">{visibleMemories.map((memory) => <article key={memory.key} className="flex min-h-[60px] min-w-0 items-center gap-3 overflow-hidden rounded-lg px-3 transition-colors hover:bg-[#202020]"><div className="min-w-0 flex-1"><h3 className="m-0 truncate text-[14px] font-semibold text-[#eeeeee]">{memory.key}</h3><p className="mt-0.5 truncate text-[13px] text-[#888888]">{memory.content}</p></div><span className="shrink-0 text-[11px] text-[#777777]">{Math.round((memory.confidence || 0) * 100)}%</span>{memory.status !== 'confirmed' && <button type="button" onClick={() => void confirmMemory(memory)} aria-label={text.confirm} className="grid h-7 w-7 shrink-0 place-items-center rounded-md border-0 bg-transparent text-[#777777] hover:bg-[#2b2b2b] hover:text-[#eeeeee]"><Check size={14} /></button>}<button type="button" onClick={() => void forgetMemory(memory)} aria-label={text.forget} className="grid h-7 w-7 shrink-0 place-items-center rounded-md border-0 bg-transparent text-[#777777] hover:bg-[#2b2b2b] hover:text-[#eeeeee]"><Trash2 size={14} /></button></article>)}</section> : <section className="mt-9 py-12 text-center"><strong className="block text-xs font-medium text-[#bdbdbd]">{text.emptyTitle}</strong><p className="mx-auto mt-1 max-w-[360px] text-[11px] leading-relaxed text-[#777777]">{query ? text.emptyTitle : text.emptyDescription}</p></section>}
  </main>;
}
