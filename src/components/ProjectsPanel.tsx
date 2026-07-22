import React, { useEffect, useState } from "react";
import { FolderOpen, Plus } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { ensureProjectMeta, indexProjectContents, readProjectIndex, saveProjectIndex, type ProjectEntry } from "../lib/projectManager";

const formatSize = (bytes = 0) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
    <div className="h-full w-full overflow-y-auto p-8 md:p-12">
      <div className="mx-auto grid w-full max-w-6xl grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
        {loading && Array.from({ length: 5 }, (_, index) => <div key={index} className="h-[178px] animate-pulse rounded-2xl border border-[#202020] bg-[#161616]" />)}
        {!loading && projects.map((project) => (
          <button key={project.path} type="button" onClick={() => { if (renamingPath !== project.path) selectProject(project); }} onContextMenu={(event) => { event.preventDefault(); window.dispatchEvent(new CustomEvent("codeclub:project-context-menu", { detail: { path: project.path, name: project.name, top: event.clientY, left: event.clientX } })); }} className="group flex h-[178px] flex-col justify-between rounded-2xl border border-[#202020] bg-[#161616] p-5 text-left transition hover:border-[#2f2f2f] hover:bg-[#1c1c1c]">
            <div className="flex items-start justify-between"><div className="grid h-10 w-10 place-items-center rounded-xl bg-[#202020] text-[#9b9b9b] group-hover:text-[#eeeeee]"><FolderOpen size={19} /></div><span className="text-[10px] text-[#666]">{project.file_count ?? 0} archivos</span></div>
            <div>{renamingPath === project.path ? <input autoFocus value={renameValue} onChange={(event) => setRenameValue(event.target.value)} onClick={(event) => event.stopPropagation()} onKeyDown={(event) => { event.stopPropagation(); if (event.key === "Enter") { event.preventDefault(); void renameProject(project); } if (event.key === "Escape") { setRenamingPath(null); setRenameValue(""); } }} className="w-full rounded border border-[#2b2b2b] bg-[#1c1c1c] px-1.5 py-1 text-sm text-[#eee] outline-none" /> : <div className="truncate text-sm font-medium text-[#dedede]">{project.name}</div>}<div className="mt-1 truncate text-[11px] text-[#666]">{formatSize(project.total_size)}</div></div>
          </button>
        ))}
        {!loading && <button type="button" onClick={addProject} className="group flex h-[178px] flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-[#2b2b2b] bg-transparent text-[#666] transition hover:border-[#555] hover:bg-[#161616] hover:text-[#bdbdbd]">{adding ? <div className="h-7 w-7 animate-pulse rounded-lg bg-[#2b2b2b]" /> : <div className="grid h-10 w-10 place-items-center rounded-xl border border-[#2b2b2b] group-hover:border-[#555]"><Plus size={19} /></div>}</button>}
      </div>
    </div>
  );
}
