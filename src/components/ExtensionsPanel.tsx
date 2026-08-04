import React, { useMemo, useState } from 'react';
import { Box, FileText, FileType2, LayoutTemplate, Presentation, Search, Table2 } from 'lucide-react';

const extensions = [
  { name: 'Documents', description: 'Create and edit document artifacts', icon: FileText, color: '#1687FF' },
  { name: 'PDF', description: 'Read, create, and verify PDF files', icon: FileType2, color: '#ff5d62' },
  { name: 'Spreadsheets', description: 'Create and edit spreadsheet files', icon: Table2, color: '#2e9b3f' },
  { name: 'Presentations', description: 'Create and edit presentations', icon: Presentation, color: '#e99a1a' },
  { name: 'Template Creator', description: 'Create or update reusable templates from reference content', icon: LayoutTemplate, color: '#17b9ef' },
];

export default function ExtensionsPanel() {
  const [query, setQuery] = useState('');
  const [enabled, setEnabled] = useState<Record<string, boolean>>(() => Object.fromEntries(extensions.map(({ name }) => [name, true])));
  const filteredExtensions = useMemo(() => extensions.filter(({ name, description }) => `${name} ${description}`.toLowerCase().includes(query.toLowerCase())), [query]);

  return (
    <main className="h-full min-h-0 overflow-y-auto bg-[#1A1A1A]">
      <div className="mx-auto w-full max-w-[1040px] px-6 py-7 lg:px-8">
        <header>
          <h1 className="m-0 text-[28px] font-normal tracking-[-0.04em] text-[#eeeeee]">Complementos</h1>
          <p className="mt-1.5 text-[14px] text-[#999999]">Administrá complementos, skills y MCP</p>
        </header>

        <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
          <nav className="flex items-center gap-0.5 text-[13px] text-[#777777]" aria-label="Categorías de complementos">
            <button type="button" className="rounded-[8px] border-0 bg-[#2b2b2b] px-3 py-1.5 text-[#eeeeee]">Complementos <span className="text-[#999999]">14</span></button>
            <button type="button" className="rounded-[8px] border-0 bg-transparent px-3 py-1.5 text-[#777777] hover:bg-[#202020]">Apps <span>7</span></button>
            <button type="button" className="rounded-[8px] border-0 bg-transparent px-3 py-1.5 text-[#777777] hover:bg-[#202020]">MCP <span>2</span></button>
            <button type="button" className="rounded-[8px] border-0 bg-transparent px-3 py-1.5 text-[#777777] hover:bg-[#202020]">Habilidades <span>16</span></button>
          </nav>
          <label className="flex h-9 w-full max-w-[280px] items-center gap-2 rounded-[9px] border border-[#3a3a3a] bg-[#202020] px-3 text-[#999999] focus-within:border-[#555555]">
            <Search size={16} strokeWidth={1.7} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar complementos" className="min-w-0 flex-1 border-0 bg-transparent text-[13px] text-[#eeeeee] outline-none placeholder:text-[#777777]" />
          </label>
        </div>

        <section className="mt-9 grid gap-1.5" aria-label="Lista de complementos">
          {filteredExtensions.map(({ name, description, icon: Icon, color }) => {
            const isEnabled = enabled[name];
            return (
              <div key={name} className="flex min-h-[60px] items-center gap-3 rounded-lg px-3 transition-colors hover:bg-[#202020]">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-[10px] border border-[#2d2d2d] bg-[#151515]">
                  <div className="grid h-7 w-7 place-items-center rounded-[7px]" style={{ background: color }}><Icon size={17} strokeWidth={1.8} className="text-white" /></div>
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="m-0 text-[14px] font-semibold text-[#eeeeee]">{name}</h2>
                  <p className="mt-0.5 truncate text-[13px] text-[#888888]">{description}</p>
                </div>
                <button type="button" role="switch" aria-checked={isEnabled} aria-label={`${isEnabled ? 'Desactivar' : 'Activar'} ${name}`} onClick={() => setEnabled((current) => ({ ...current, [name]: !current[name] }))} className={`relative h-6 w-10 shrink-0 rounded-full border-0 transition-colors ${isEnabled ? 'bg-[#3d9bff]' : 'bg-[#3a3a3a]'}`}>
                  <span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${isEnabled ? 'right-1' : 'left-1'}`} />
                </button>
              </div>
            );
          })}
          {filteredExtensions.length === 0 && <div className="py-12 text-center text-sm text-[#777777]">No se encontraron complementos.</div>}
        </section>
      </div>
    </main>
  );
}
