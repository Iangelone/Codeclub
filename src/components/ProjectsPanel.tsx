import React, { useEffect, useRef, useState } from "react";
import { MoreVertical, Plus } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { ensureProjectMeta, indexProjectContents, readProjectIndex, saveProjectIndex, type ProjectEntry } from "../lib/projectManager";
import { LANGUAGE_STORAGE_KEY, type AppLanguage } from "../lib/i18n";

const formatSize = (bytes = 0) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const formatIndexedAt = (value: string | undefined, language: AppLanguage) => {
  if (!value) return language === "en" ? "No date" : "Sin fecha";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? (language === "en" ? "No date" : "Sin fecha") : new Intl.DateTimeFormat(language === "en" ? "en-US" : "es-AR", { day: "2-digit", month: "short", year: "numeric" }).format(date);
};

const avatarGradients = [
  "linear-gradient(145deg, #8BC7FF 0%, #3D9BFF 44%, #1687FF 100%)",
  "linear-gradient(145deg, #A6D8FF 0%, #4CA4FF 42%, #237BFF 100%)",
  "linear-gradient(145deg, #79B8FF 0%, #2F8EFF 48%, #1469E8 100%)",
  "linear-gradient(145deg, #B3DEFF 0%, #5DB0FF 44%, #2A82F2 100%)",
  "linear-gradient(145deg, #8ACBFF 0%, #398FFF 46%, #385FEF 100%)",
  "linear-gradient(145deg, #9BD1FF 0%, #369BFF 45%, #126FEA 100%)",
];
const getAvatarGradient = (name: string) => {
  const hash = [...name].reduce((total, character) => total + character.charCodeAt(0), 0);
  return avatarGradients[hash % avatarGradients.length];
};

export default function ProjectsPanel() {
  const [language, setLanguage] = useState<AppLanguage>("es");
  const text = language === "en" ? { title: "Projects", description: "Manage your projects and workspaces", owner: "me", add: "Add project", folder: "Select folder for project" } : { title: "Proyectos", description: "Administrá tus proyectos y espacios de trabajo", owner: "yo", add: "Agregar proyecto", folder: "Seleccionar carpeta para el proyecto" };
  const [projects, setProjects] = useState<ProjectEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const selectedAvatarRef = useRef<HTMLDivElement | null>(null);

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
      const selectedPath = await open({ directory: true, multiple: false, title: text.folder });
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
    setSelectedPath(project.path);
    window.dispatchEvent(new CustomEvent("codeclub:project-panel-selected", { detail: { projectPath: project.path, projectName: project.name } }));
  };

  useEffect(() => {
    if (window.localStorage.getItem(LANGUAGE_STORAGE_KEY) === "en") setLanguage("en");
    const handleLanguageChange = (event: Event) => {
      const nextLanguage = (event as CustomEvent<{ language?: AppLanguage }>).detail?.language;
      if (nextLanguage === "es" || nextLanguage === "en") setLanguage(nextLanguage);
    };
    window.addEventListener("codeclub:language-change", handleLanguageChange);
    return () => window.removeEventListener("codeclub:language-change", handleLanguageChange);
  }, []);

  const moveAvatarEyes = (event: React.MouseEvent<HTMLDivElement>) => {
    const avatar = selectedAvatarRef.current;
    if (!avatar) return;
    const bounds = avatar.getBoundingClientRect();
    const x = ((event.clientX - bounds.left) / bounds.width) - 0.5;
    const y = ((event.clientY - bounds.top) / bounds.height) - 0.5;
    avatar.style.setProperty("--eye-x", `${Math.max(-2, Math.min(2, x * 4))}px`);
    avatar.style.setProperty("--eye-y", `${Math.max(-1.5, Math.min(1.5, y * 3))}px`);
  };

  const resetAvatarEyes = (event: React.MouseEvent<HTMLDivElement>) => {
    const avatar = selectedAvatarRef.current;
    if (!avatar) return;
    avatar.style.setProperty("--eye-x", "0px");
    avatar.style.setProperty("--eye-y", "0px");
  };

  const clearProjectSelection = (event: React.MouseEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest(".project-row")) return;
    setSelectedPath(null);
    window.dispatchEvent(new CustomEvent("codeclub:project-panel-selected", { detail: { projectPath: null } }));
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
    <div className="projects-panel-scroll h-full w-full overflow-y-auto" onClick={clearProjectSelection} onMouseMove={selectedPath ? moveAvatarEyes : undefined} onMouseLeave={selectedPath ? resetAvatarEyes : undefined}>
      <header className="projects-panel-heading">
        <h1 className="m-0 text-[28px] font-normal tracking-[-0.04em] text-[#eeeeee]">{text.title}</h1>
        <p className="mt-1.5 text-[14px] text-[#999999]">{text.description}</p>
      </header>
      <div className="projects-panel-content mx-auto flex w-full max-w-[1040px] flex-col overflow-hidden rounded-lg border border-[#2B2B2B] bg-[#2B2B2B]">
        {loading && Array.from({ length: 5 }, (_, index) => <div key={index} className="h-[58px] animate-pulse border-b border-[#3a3a3a] bg-[#2B2B2B]" />)}
        {!loading && projects.map((project) => (
          <button key={project.path} type="button" aria-pressed={selectedPath === project.path} onClick={(event) => { event.stopPropagation(); if (renamingPath !== project.path) selectProject(project); }} onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); window.dispatchEvent(new CustomEvent("codeclub:project-context-menu", { detail: { path: project.path, name: project.name, top: event.clientY, left: event.clientX } })); }} className={`project-row group grid min-h-[58px] min-w-0 grid-cols-[minmax(0,1fr)_150px_110px_110px_32px] items-center gap-4 border-b border-[#3a3a3a] px-4 text-left transition hover:bg-[#303030] ${selectedPath === project.path ? "bg-[#303030] shadow-[inset_2px_0_0_#4ca4ff]" : "bg-[#2B2B2B]"}`}>
            <div className="project-name-cell flex min-w-0 items-center gap-3"><div ref={selectedPath === project.path ? selectedAvatarRef : undefined} aria-hidden="true" className={`relative h-8 w-8 shrink-0 rounded-[11px] transition ${selectedPath === project.path ? "shadow-[inset_0_1px_2px_rgba(255,255,255,0.5),0_0_12px_rgba(45,145,255,0.42)] group-hover:brightness-110" : "shadow-[inset_0_1px_rgba(255,255,255,0.08)]"}`} style={{ background: selectedPath === project.path ? getAvatarGradient(project.name) : "#343434" }}><span className={`absolute left-[6px] top-[8px] h-[8px] w-[6px] translate-x-[var(--eye-x)] translate-y-[var(--eye-y)] rounded-full transition-transform duration-200 ease-out ${selectedPath === project.path ? "bg-white" : "bg-[#666666]"}`} /><span className={`absolute right-[6px] top-[8px] h-[8px] w-[6px] translate-x-[var(--eye-x)] translate-y-[var(--eye-y)] rounded-full transition-transform duration-200 ease-out ${selectedPath === project.path ? "bg-white" : "bg-[#666666]"}`} /></div>{renamingPath === project.path ? <input autoFocus value={renameValue} onChange={(event) => setRenameValue(event.target.value)} onClick={(event) => event.stopPropagation()} onKeyDown={(event) => { event.stopPropagation(); if (event.key === "Enter") { event.preventDefault(); void renameProject(project); } if (event.key === "Escape") { setRenamingPath(null); setRenameValue(""); } }} className="min-w-0 w-full rounded border border-[#555] bg-[#303030] px-1.5 py-1 text-[13px] text-[#eee] outline-none" /> : <span className="project-name truncate text-[13px] font-medium text-[#eeeeee]">{project.name}</span>}</div>
            <span className="project-date text-[12px] text-[#bdbdbd]">{formatIndexedAt(project.indexed_at, language)}</span>
            <span className="project-size text-[11px] text-[#999]">{formatSize(project.total_size)}</span>
            <span className="project-owner text-[12px] text-[#bdbdbd]">{text.owner}</span>
            <MoreVertical size={16} className="project-menu text-[#888] opacity-0 transition-opacity group-hover:opacity-100" />
          </button>
        ))}
        {!loading && <button type="button" onClick={addProject} className="group flex min-h-[58px] min-w-0 items-center gap-3 border-b border-[#3a3a3a] bg-[#2B2B2B] px-3 text-left text-[13px] text-[#999] transition hover:bg-[#303030] hover:text-[#eeeeee] sm:px-4"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-dashed border-[#666] group-hover:border-[#aaa]"><Plus size={17} /></span><span className="truncate">{text.add}</span></button>}
      </div>
    </div>
  );
}
