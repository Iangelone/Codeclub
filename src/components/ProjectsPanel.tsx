import React, { useEffect, useState } from "react";
import { Folder, MoreVertical, Plus } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { ensureProjectMeta, indexProjectContents, readProjectIndex, saveProjectIndex, type ProjectEntry } from "../lib/projectManager";

const formatSize = (bytes = 0) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const formatIndexedAt = (value?: string) => {
  if (!value) return "Sin fecha";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Sin fecha" : new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "short", year: "numeric" }).format(date);
};

export default function ProjectsPanel() {
  const [projects, setProjects] = useState<ProjectEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const load = async () => {
    setLoading(true);
    try { setProjects(await readProjectIndex()); } finally { setLoading(false); }
  };

  useEffect(() => {
    load();
    const refresh = () => load();
    window.addEventListener("codeclub:project-indexed", refresh);
    const requestRename = (event: Event) => {
      const detail = (event as CustomEvent).detail || {};
      if (detail.path) { setRenamingPath(detail.path); setRenameValue(detail.name || ""); }
    };
    window.addEventListener("codeclub:request-rename-project", requestRename);
    return () => { window.removeEventListener("codeclub:project-indexed", refresh); window.removeEventListener("codeclub:request-rename-project", requestRename); };
  }, []);

  const addProject = async () => {
    if (adding) return;
    setAdding(true);
    try {
      const selectedPath = await open({ directory: true, multiple: false, title: "Seleccionar carpeta para el proyecto" });
      if (!selectedPath || Array.isArray(selectedPath)) return;
      const name = selectedPath.split(/[\\/]/).filter(Boolean).pop() || "Proyecto";
      await ensureProjectMeta(selectedPath, name);
      await indexProjectContents(name, selectedPath);
      await load();
      window.dispatchEvent(new CustomEvent("codeclub:project-indexed"));
    } catch (error) { console.error("No se pudo indexar el proyecto", error); }
    finally { setAdding(false); }
  };

  const selectProject = (project: ProjectEntry) => {
    window.dispatchEvent(new CustomEvent("codeclub:project-selection-changed", { detail: { selected: true, projectPath: project.path, projectName: project.name } }));
    window.dispatchEvent(new CustomEvent("codeclub:active-project", { detail: { projectPath: project.path, projectName: project.name } }));
  };

  const renameProject = async (project: ProjectEntry) => {
    const name = renameValue.trim();
    setRenamingPath(null);
    if (!name || name === project.name) return;
    await ensureProjectMeta(project.path, name);
    await saveProjectIndex(name, project.path);
    await load();
    window.dispatchEvent(new CustomEvent("codeclub:project-indexed"));
  };

  return (
    <div className="projects-panel-scroll h-full w-full overflow-y-auto p-8 md:p-12">
      <div className="mx-auto flex w-full max-w-6xl flex-col overflow-hidden rounded-lg border border-[#2B2B2B] bg-[#2B2B2B]">
        {loading && Array.from({ length: 5 }, (_, index) => <div key={index} className="h-[58px] animate-pulse border-b border-[#3a3a3a] bg-[#2B2B2B]" />)}
        {!loading && projects.map((project) => (
          <button key={project.path} type="button" onClick={() => { if (renamingPath !== project.path) selectProject(project); }} onContextMenu={(event) => { event.preventDefault(); window.dispatchEvent(new CustomEvent("codeclub:project-context-menu", { detail: { path: project.path, name: project.name, top: event.clientY, left: event.clientX } })); }} className="group grid min-h-[58px] grid-cols-[minmax(0,1fr)_70px_32px] items-center gap-3 border-b border-[#3a3a3a] bg-[#2B2B2B] px-4 text-left transition hover:bg-[#303030] md:grid-cols-[minmax(0,1fr)_150px_110px_110px_32px] md:gap-4">
            <div className="flex min-w-0 items-center gap-3"><div className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-[#343434] text-[#c7c7c7] group-hover:text-white"><Folder size={17} /></div>{renamingPath === project.path ? <input autoFocus value={renameValue} onChange={(event) => setRenameValue(event.target.value)} onClick={(event) => event.stopPropagation()} onKeyDown={(event) => { event.stopPropagation(); if (event.key === "Enter") { event.preventDefault(); void renameProject(project); } if (event.key === "Escape") { setRenamingPath(null); setRenameValue(""); } }} className="min-w-0 w-full rounded border border-[#555] bg-[#303030] px-1.5 py-1 text-[13px] text-[#eee] outline-none" /> : <span className="truncate text-[13px] font-medium text-[#eeeeee]">{project.name}</span>}</div>
            <span className="hidden text-[12px] text-[#bdbdbd] md:block">{formatIndexedAt(project.indexed_at)}</span>
            <span className="text-[11px] text-[#999]">{formatSize(project.total_size)}</span>
            <span className="hidden text-[12px] text-[#bdbdbd] sm:block">yo</span>
            <MoreVertical size={16} className="text-[#888] opacity-0 transition-opacity group-hover:opacity-100" />
          </button>
        ))}
        {!loading && <button type="button" onClick={addProject} className="group flex min-h-[58px] items-center gap-3 border-b border-[#3a3a3a] bg-[#2B2B2B] px-4 text-left text-[13px] text-[#999] transition hover:bg-[#303030] hover:text-[#eeeeee]"><span className="grid h-8 w-8 place-items-center rounded-md border border-dashed border-[#666] group-hover:border-[#aaa]"><Plus size={17} /></span>Agregar proyecto</button>}
      </div>
    </div>
  );
}
