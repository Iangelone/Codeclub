'use client';

import { ArrowLeft, ArrowRight, ArrowUp, ChevronRight, House, Menu, RefreshCw, Search } from 'lucide-react';
import { topbarTranslations } from '../lib/i18n';

const t = topbarTranslations.es as Record<string, string>;
const iconButton = 'grid h-7 w-7 place-items-center rounded-md border-0 bg-transparent text-(--codeclub-icon) transition-colors hover:bg-(--codeclub-hover) hover:text-(--codeclub-text-strong)';

export default function WorkspaceToolbar() {
  return <div className="flex h-[30px] min-w-0 items-center gap-3 border-b border-(--codeclub-border-faint) bg-(--codeclub-border-faint) px-4" aria-label="Barra del espacio de trabajo">
    <nav className="flex shrink-0 items-center gap-1" aria-label="Navegación">
      <button className={`${iconButton} focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-(--codeclub-accent)`} title="Atrás" aria-label="Atrás"><ArrowLeft size={16} aria-hidden="true" /></button><button className={`${iconButton} focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-(--codeclub-accent)`} title="Adelante" aria-label="Adelante"><ArrowRight size={16} aria-hidden="true" /></button><button className={`${iconButton} focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-(--codeclub-accent)`} title="Subir un nivel" aria-label="Subir un nivel"><ArrowUp size={16} aria-hidden="true" /></button><button className={`${iconButton} focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-(--codeclub-accent)`} title="Actualizar" aria-label="Actualizar"><RefreshCw size={15} aria-hidden="true" /></button>
    </nav>
    <div className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-(--codeclub-border-faint) bg-(--codeclub-acrylic) px-3 py-1 text-xs text-(--codeclub-text) shadow-inner"><House size={15} className="shrink-0 text-(--codeclub-icon)" /><ChevronRight size={14} className="shrink-0 text-(--codeclub-text-muted)" /><span className="truncate">Inicio</span></div>
    <div className="flex w-[260px] shrink-0 items-center gap-2 rounded-md border border-(--codeclub-border-faint) bg-(--codeclub-acrylic) px-3 py-1 text-xs text-(--codeclub-text-muted) shadow-inner"><span className="flex-1 truncate">Buscar en Inicio</span><Search size={15} /></div>
    <button className="grid h-7 w-7 shrink-0 place-items-center rounded-md border-0 bg-transparent text-(--codeclub-icon) hover:bg-(--codeclub-hover) focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-(--codeclub-accent)" title="Más opciones" aria-label="Más opciones"><Menu size={16} aria-hidden="true" /></button>
  </div>;
}


