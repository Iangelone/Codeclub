import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { exists, readTextFile, writeTextFile, remove, readDir } from "@tauri-apps/plugin-fs";
import { open } from "@tauri-apps/plugin-dialog";
import { logPersistence } from "../lib/persistence";
import {
  readProjectIndex,
  writeProjectIndex,
  ensureProjectMeta,
  saveProjectIndex,
} from "../lib/projectManager";

import {
  Folder,
  FolderPlus,
  LayoutDashboard,
  Package,
  Search,
  Settings,
  MessageSquarePlus,
  Table as TableIconReact,
  FileText,
  MousePointer2
} from "lucide-react";

// --- Types ---
type Artifact = { id: string; name: string };
type ProjectData = {
  name: string;
  path: string;
  chats: Artifact[];
  notes: Artifact[];
  tables: Artifact[];
};

export default function Sidebar() {
  const [projects, setProjects] = useState<ProjectData[]>([]);
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [activeArtifactId, setActiveArtifactId] = useState<string | null>(null);

  const [creatingProject, setCreatingProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [renamingItemId, setRenamingItemId] = useState<string | null>(null);
  const [renameInput, setRenameInput] = useState("");

  const loadProjects = async () => {
    try {
      const globalProjects = await readProjectIndex();
      const loaded: ProjectData[] = [];
      for (const proj of globalProjects) {
        let chats: Artifact[] = [];
        let notes: Artifact[] = [];
        let tables: Artifact[] = [];
        try {
          const metaPath = `${proj.path}/.codeclub/meta.json`;
          if (await exists(metaPath)) {
            const metaData = JSON.parse(await readTextFile(metaPath));
            chats = metaData.chats || [];
            notes = metaData.notes || [];
            tables = metaData.tables || [];
          }
        } catch (e) {
          console.error("Error reading meta for", proj.name, e);
        }
        loaded.push({ name: proj.name, path: proj.path, chats, notes, tables });
      }
      setProjects(loaded);
    } catch (e) {
      console.error("Failed to load projects", e);
    }
  };

  useEffect(() => {
    loadProjects();
    const handleIndexed = () => loadProjects();
    const handleRequire = () => setCreatingProject(true);
    
    window.addEventListener("codeclub:project-indexed", handleIndexed);
    window.addEventListener("codeclub:require-project", handleRequire);
    return () => {
      window.removeEventListener("codeclub:project-indexed", handleIndexed);
      window.removeEventListener("codeclub:require-project", handleRequire);
    };
  }, []);

  const toggleProject = (path: string) => {
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const handleCreateProject = async () => {
    if (!newProjectName.trim()) {
      setCreatingProject(false);
      return;
    }
    try {
      const selectedPath = (await open({
        directory: true,
        multiple: false,
        title: "Seleccionar carpeta para el proyecto",
      })) as string;
      if (!selectedPath) {
        setCreatingProject(false);
        return;
      }
      await ensureProjectMeta(selectedPath, newProjectName);
      await saveProjectIndex(newProjectName, selectedPath);
      await logPersistence("create_project", "ok", { name: newProjectName, projectPath: selectedPath });
      setCreatingProject(false);
      setNewProjectName("");
      loadProjects();
    } catch (err) {
      console.error(err);
      setCreatingProject(false);
    }
  };

  const handleCreateArtifact = async (projectPath: string, projectName: string, kind: "chat" | "note" | "table") => {
    const id = Date.now().toString();
    const name = kind === "note" ? "Nueva nota" : kind === "table" ? "Nueva tabla" : "Nuevo chat";
    const collection = kind === "chat" ? "chats" : `${kind}s`;
    const extension = kind === "note" ? "md" : kind === "table" ? "json" : "jsonl"; // chats don't strictly use files like this yet, but keeping structure
    
    try {
      await ensureProjectMeta(projectPath, projectName);
      const metaPath = `${projectPath}/.codeclub/meta.json`;
      if (!(await exists(metaPath))) return;
      
      const metaData = JSON.parse(await readTextFile(metaPath));
      if (!Array.isArray(metaData[collection])) metaData[collection] = [];
      metaData[collection].push({ id, name });
      await writeTextFile(metaPath, JSON.stringify(metaData));

      if (kind !== "chat") {
        const filePath = `${projectPath}/.codeclub/${collection}/${id}.${extension}`;
        const initialContent = kind === "note" ? "" : JSON.stringify(Array.from({ length: 8 }, () => Array.from({ length: 5 }, () => "")));
        await writeTextFile(filePath, initialContent);
      }
      
      await logPersistence(`create_${kind}`, "ok", { id, projectPath });
      setExpandedProjects(prev => new Set(prev).add(projectPath));
      loadProjects();
    } catch (e) {
      console.error("Error creating artifact", e);
    }
  };

  const handleDelete = async (kind: string, itemId: string, projectPath: string) => {
    try {
      if (kind === "project") {
        const projList = (await readProjectIndex()).filter((entry) => entry.path !== projectPath);
        await writeProjectIndex(projList);
        window.dispatchEvent(new CustomEvent("codeclub:open-blank"));
        await logPersistence("delete_project", "ok", { projectPath });
        loadProjects();
        return;
      }

      const metaPath = `${projectPath}/.codeclub/meta.json`;
      if (!(await exists(metaPath))) return;
      const metaData = JSON.parse(await readTextFile(metaPath));
      const collection = kind === "chat" ? "chats" : `${kind}s`;
      metaData[collection] = (metaData[collection] || []).filter((entry: any) => entry.id !== itemId);
      await writeTextFile(metaPath, JSON.stringify(metaData));

      const filePath =
        kind === "chat" ? `${projectPath}/.codeclub/chats/${itemId}.jsonl` :
        kind === "note" ? `${projectPath}/.codeclub/notes/${itemId}.md` :
        `${projectPath}/.codeclub/tables/${itemId}.json`;
      
      if (await exists(filePath)) await remove(filePath);

      window.dispatchEvent(new CustomEvent("codeclub:open-blank"));
      await logPersistence(`delete_${kind}`, "ok", { itemId, projectPath });
      loadProjects();
    } catch (e) {
      console.error("Error deleting", e);
    }
  };

  const handleRenameCommit = async (kind: string, itemId: string, projectPath: string, oldName: string) => {
    const finalName = renameInput.trim() || oldName;
    setRenamingItemId(null);
    if (finalName === oldName) return;

    try {
      if (kind === "project") {
        await ensureProjectMeta(projectPath, finalName);
        await saveProjectIndex(finalName, projectPath);
        loadProjects();
        return;
      }

      const metaPath = `${projectPath}/.codeclub/meta.json`;
      if (!(await exists(metaPath))) return;
      const metaData = JSON.parse(await readTextFile(metaPath));
      const collection = kind === "chat" ? "chats" : `${kind}s`;
      const item = metaData[collection]?.find((entry: any) => entry.id === itemId);
      if (item) {
        item.name = finalName;
        await writeTextFile(metaPath, JSON.stringify(metaData));
        window.dispatchEvent(new CustomEvent(`codeclub:renamed-${kind}`, {
          detail: { itemId, name: finalName, projectPath },
        }));
        if (kind === "chat") {
          window.dispatchEvent(new CustomEvent("codeclub:rename-chat", {
            detail: { chatId: itemId, newName: finalName, projectPath },
          }));
        }
        loadProjects();
      }
    } catch (e) {
      console.error("Error renaming", e);
    }
  };

  const selectProject = (path: string, name: string) => {
    setSelectedProjectId(path);
    window.dispatchEvent(new CustomEvent("codeclub:active-project", { detail: { projectPath: path, projectName: name } }));
  };

  const openArtifact = (kind: string, id: string, name: string, projectPath: string, projectName: string) => {
    setActiveArtifactId(id);
    selectProject(projectPath, projectName);
    window.dispatchEvent(new CustomEvent(`codeclub:open-${kind}`, {
      detail: { [`${kind}Id`]: id, name, projectPath, projectName }
    }));
  };

  const onDragStart = (e: React.DragEvent, kind: string, item: Artifact, projectPath: string, projectName: string) => {
    const dragData = JSON.stringify({ kind, itemId: item.id, name: item.name, projectPath, projectName });
    e.dataTransfer.setData("application/codeclub-sidebar-item", dragData);
    e.dataTransfer.effectAllowed = "copyMove";
    
    const preview = document.createElement("div");
    preview.className = "drag-preview";
    preview.textContent = item.name;
    document.body.appendChild(preview);
    e.dataTransfer.setDragImage(preview, 0, 0);
    setTimeout(() => preview.remove(), 0);
  };

  const topButtonClass = "min-h-[34px] flex items-center gap-[9px] rounded-md px-[10px] text-xs text-left cursor-pointer bg-transparent border-0 text-[#d8d8d8] hover:bg-white/2 appearance-none";

  return (
    <div className="row-start-2 col-start-1 min-w-[264px] w-[264px] h-[calc(100vh-36px)] max-h-[calc(100vh-36px)] min-h-0 overflow-hidden grid grid-rows-[auto_minmax(0,1fr)_auto] border-t border-[rgba(47,47,47,1)] border-r border-[var(--color-surface-10)] bg-[#161616] shadow-[12px_0_40px_rgba(0,0,0,0.25)] -translate-x-full transition-transform duration-140 ease-out z-10 group-[.has-sidebar]:translate-x-0">
      <section className="grid gap-1 p-[10px]">
        <div className="h-[24px] flex items-center gap-[6px] p-0 text-[#9f9f9f] text-xs font-normal"><LayoutDashboard size={14} /> Espacio de trabajo</div>
        <button className={topButtonClass} type="button"><MessageSquarePlus size={15} /> Nuevo chat</button>
        <button className={topButtonClass} type="button"><Search size={15} /> Buscar</button>
        <button className={topButtonClass} type="button"><Package size={15} /> Complementos</button>
      </section>
      <section className="min-h-0 max-h-full h-full p-[10px_10px_0] overflow-hidden grid grid-rows-[auto_minmax(0,1fr)]">
        <div className="h-[24px] flex items-center justify-between text-[#9f9f9f] text-xs font-normal group/heading">
          <span className="flex items-center gap-[6px]"><Folder size={14} /> Proyectos</span>
          <button className="w-[28px] h-[28px] grid place-items-center rounded-md opacity-0 transition-opacity duration-120 group-hover/heading:opacity-100 focus-visible:opacity-100 bg-transparent border-0 text-[#d8d8d8] hover:bg-white/2 appearance-none" id="create-project" type="button" onClick={() => setCreatingProject(true)} aria-label="Crear proyecto"><FolderPlus size={14} /></button>
        </div>
        
        <div className="mt-0 grid content-start gap-1 h-full min-h-0 max-h-full overflow-y-auto overscroll-contain pt-1 pb-0 after:content-[''] after:block after:h-[56px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {creatingProject && (
            <div className="min-h-[34px] box-border flex items-center gap-[9px] px-[10px] text-[#cfcfcf]">
              <Folder size={14} />
              <input
                className="appearance-none min-w-0 w-full h-[22px] box-border border-0 bg-transparent text-[#d8d8d8] caret-[#d8d8d8] text-xs outline-none p-0 shadow-none placeholder:text-[#8f8f8f] focus:bg-transparent focus:shadow-none"
                type="text"
                autoFocus
                placeholder="Nombre del proyecto"
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreateProject();
                  if (e.key === "Escape") setCreatingProject(false);
                }}
                onBlur={() => setCreatingProject(false)}
              />
            </div>
          )}

          {projects.map((proj) => {
            const isExpanded = expandedProjects.has(proj.path);
            const isSelected = selectedProjectId === proj.path;
            const isRenaming = renamingItemId === `proj-${proj.path}`;

            return (
              <div key={proj.path} className={`grid gap-[3px] min-w-0 group/card ${isSelected ? "is-selected" : ""} ${isExpanded ? "is-expanded" : ""}`}>
                <div
                  className="min-h-[34px] flex items-center gap-[9px] rounded-md px-[10px] text-xs text-left cursor-pointer bg-transparent w-full min-w-0 box-border text-[#d8d8d8] hover:bg-white/2 focus-visible:bg-[var(--color-surface-7)] focus-visible:outline-none group-[.is-selected]/card:bg-[#1c1c1c] group-[.is-selected]/card:text-[#eeeeee] group-[.is-selected]/card:hover:bg-[#1e1e1e] group/prow outline-none appearance-none border-0"
                  tabIndex={0}
                  onClick={() => { selectProject(proj.path, proj.name); toggleProject(proj.path); }}
                  onDoubleClick={() => { setRenamingItemId(`proj-${proj.path}`); setRenameInput(proj.name); }}
                  onKeyDown={(e) => {
                    if (e.key === "Delete") handleDelete("project", proj.path, proj.path);
                    if (e.key === "Enter" || e.key === " ") {
                      selectProject(proj.path, proj.name);
                      toggleProject(proj.path);
                    }
                  }}
                >
                  <Folder size={14} />
                  {isRenaming ? (
                    <input
                      className="appearance-none min-w-0 w-full h-[22px] box-border border-0 bg-[var(--color-surface-9)] text-[#d8d8d8] caret-[#d8d8d8] text-xs outline-none p-0 shadow-none placeholder:text-[#8f8f8f] rounded-md"
                      autoFocus
                      value={renameInput}
                      onChange={(e) => setRenameInput(e.target.value)}
                      onBlur={() => handleRenameCommit("project", proj.path, proj.path, proj.name)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleRenameCommit("project", proj.path, proj.path, proj.name);
                        if (e.key === "Escape") setRenamingItemId(null);
                      }}
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <span style={{ flex: 1 }}>{proj.name}</span>
                  )}
                  <span className="flex items-center gap-[2px] opacity-0 transition-opacity duration-120 group-hover/prow:opacity-100 group-focus-within/prow:opacity-100">
                    <button className="w-[24px] h-[24px] flex items-center justify-center rounded-[4px] text-[#9f9f9f] transition-all duration-120 bg-transparent border-0 p-0 hover:bg-white/10 hover:text-[#eeeeee] opacity-100 appearance-none" onClick={(e) => { e.stopPropagation(); handleCreateArtifact(proj.path, proj.name, "chat"); }}><MessageSquarePlus size={14} /></button>
                    <button className="w-[24px] h-[24px] flex items-center justify-center rounded-[4px] text-[#9f9f9f] transition-all duration-120 bg-transparent border-0 p-0 hover:bg-white/10 hover:text-[#eeeeee] opacity-100 appearance-none" onClick={(e) => { e.stopPropagation(); handleCreateArtifact(proj.path, proj.name, "table"); }}><TableIconReact size={14} /></button>
                    <button className="w-[24px] h-[24px] flex items-center justify-center rounded-[4px] text-[#9f9f9f] transition-all duration-120 bg-transparent border-0 p-0 hover:bg-white/10 hover:text-[#eeeeee] opacity-100 appearance-none" onClick={(e) => { e.stopPropagation(); handleCreateArtifact(proj.path, proj.name, "note"); }}><FileText size={14} /></button>
                  </span>
                </div>

                {/* Expanded artifacts */}
                {isExpanded && (
                  <>
                    {proj.chats.map((chat) => (
                      <ArtifactNode key={chat.id} kind="chat" item={chat} project={proj} isActive={activeArtifactId === chat.id} 
                        renaming={renamingItemId === `chat-${chat.id}`} setRenaming={setRenamingItemId} renameInput={renameInput} setRenameInput={setRenameInput}
                        onCommit={handleRenameCommit} onOpen={openArtifact} onDelete={handleDelete} onDragStart={onDragStart} />
                    ))}

                    {proj.tables.map((table) => (
                      <ArtifactNode key={table.id} kind="table" item={table} project={proj} isActive={activeArtifactId === table.id}
                        renaming={renamingItemId === `table-${table.id}`} setRenaming={setRenamingItemId} renameInput={renameInput} setRenameInput={setRenameInput}
                        onCommit={handleRenameCommit} onOpen={openArtifact} onDelete={handleDelete} onDragStart={onDragStart} />
                    ))}

                    {proj.notes.map((note) => (
                      <ArtifactNode key={note.id} kind="note" item={note} project={proj} isActive={activeArtifactId === note.id}
                        renaming={renamingItemId === `note-${note.id}`} setRenaming={setRenamingItemId} renameInput={renameInput} setRenameInput={setRenameInput}
                        onCommit={handleRenameCommit} onOpen={openArtifact} onDelete={handleDelete} onDragStart={onDragStart} />
                    ))}

                    <CreateArtifactMenu projPath={proj.path} projName={proj.name} onCreate={handleCreateArtifact} />
                  </>
                )}
              </div>
            );
          })}
        </div>
      </section>
      
      <section className="p-[10px] grid gap-1 border-t border-[var(--color-surface-9)] bg-[#161616] relative z-[2]">
        <button className="min-h-[34px] flex items-center gap-[9px] rounded-md px-[10px] text-xs text-left cursor-pointer bg-transparent border-0 text-[#d8d8d8] hover:bg-white/2 appearance-none" type="button">
          <Settings size={15} /> Ajustes
        </button>
      </section>
    </div>
  );
}

// --- Subcomponents ---

function ArtifactNode({
  kind, item, project, isActive,
  renaming, setRenaming, renameInput, setRenameInput,
  onCommit, onOpen, onDelete, onDragStart
}: any) {
  const Icon = kind === "chat" ? MessageSquarePlus : kind === "table" ? TableIconReact : FileText;

  return (
    <button
      className={`min-h-[34px] items-center gap-[9px] rounded-md px-[10px] text-xs text-left cursor-pointer hover:bg-white/2 focus-visible:bg-[var(--color-surface-7)] focus-visible:outline-none ml-[12px] text-[#d8d8d8]/62 opacity-72 hidden group-[.is-expanded]/card:flex bg-transparent border-0 appearance-none outline-none ${isActive ? "bg-white/5 text-[#eeeeee]" : ""}`}
      draggable
      onDragStart={(e) => onDragStart(e, kind, item, project.path, project.name)}
      onClick={() => onOpen(kind, item.id, item.name, project.path, project.name)}
      onDoubleClick={() => { setRenaming(`${kind}-${item.id}`); setRenameInput(item.name); }}
      onKeyDown={(e) => {
        if (e.key === "Delete") onDelete(kind, item.id, project.path);
      }}
    >
      <Icon size={14} />
      {renaming ? (
        <input
          className="appearance-none min-w-0 w-full h-[22px] box-border border-0 bg-[var(--color-surface-9)] text-[#d8d8d8] caret-[#d8d8d8] text-xs outline-none p-0 shadow-none placeholder:text-[#8f8f8f] rounded-md"
          autoFocus
          value={renameInput}
          onChange={(e) => setRenameInput(e.target.value)}
          onBlur={() => onCommit(kind, item.id, project.path, item.name)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onCommit(kind, item.id, project.path, item.name);
            if (e.key === "Escape") setRenaming(null);
          }}
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <span>{item.name}</span>
      )}
    </button>
  );
}

function CreateArtifactMenu({ projPath, projName, onCreate }: any) {
  const [isOpen, setIsOpen] = useState(false);
  const timeoutRef = useRef<any>(null);
  const buttonRef = useRef<any>(null);
  const [coords, setCoords] = useState({ top: 0, left: 0 });

  const handleEnter = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setCoords({ top: rect.top - 8, left: rect.right + 8 });
    }
    setIsOpen(true);
  };
  const handleLeave = () => {
    timeoutRef.current = setTimeout(() => setIsOpen(false), 150);
  };
  const handleClick = (kind: string) => {
    setIsOpen(false);
    onCreate(projPath, projName, kind);
  };

  const menu = typeof document !== "undefined" ? createPortal(
    <div 
      className={`fixed z-[100] min-w-[160px] flex flex-col gap-[3px] p-2 border border-[var(--color-surface-10)] rounded-lg bg-[rgba(18,18,18,0.96)] shadow-[0_18px_54px_rgba(0,0,0,0.38)] transition duration-150 origin-left ${isOpen ? 'opacity-100 scale-100 pointer-events-auto' : 'opacity-0 scale-95 pointer-events-none'}`}
      style={{ top: coords.top, left: coords.left }}
      onMouseEnter={handleEnter} 
      onMouseLeave={handleLeave}
    >
      <button className="min-h-[28px] flex items-center gap-[9px] rounded-md px-[10px] text-xs text-left cursor-pointer hover:bg-white/10 text-[#d8d8d8] hover:text-[#eeeeee] transition-colors bg-transparent border-0 appearance-none" onClick={(e) => { e.stopPropagation(); handleClick("chat"); }}>
        <MessageSquarePlus size={13} /><span>Nuevo chat</span>
      </button>
      <button className="min-h-[28px] flex items-center gap-[9px] rounded-md px-[10px] text-xs text-left cursor-pointer hover:bg-white/10 text-[#d8d8d8] hover:text-[#eeeeee] transition-colors bg-transparent border-0 appearance-none" onClick={(e) => { e.stopPropagation(); handleClick("table"); }}>
        <TableIconReact size={13} /><span>Nueva tabla</span>
      </button>
      <button className="min-h-[28px] flex items-center gap-[9px] rounded-md px-[10px] text-xs text-left cursor-pointer hover:bg-white/10 text-[#d8d8d8] hover:text-[#eeeeee] transition-colors bg-transparent border-0 appearance-none" onClick={(e) => { e.stopPropagation(); handleClick("note"); }}>
        <FileText size={13} /><span>Nueva nota</span>
      </button>
    </div>,
    document.body
  ) : null;

  return (
    <div className="mt-2 mb-1 border-t border-white/5 pt-2 ml-[12px] group-[.is-expanded]/card:block hidden" onMouseEnter={handleEnter} onMouseLeave={handleLeave}>
      <button ref={buttonRef} className="min-h-[28px] w-full flex items-center gap-[9px] rounded-md px-[10px] text-xs text-left cursor-pointer text-[#d8d8d8]/50 hover:text-[#d8d8d8] hover:bg-white/2 transition-colors bg-transparent border-0 appearance-none">
        <MousePointer2 size={13} />
        <span>Crear nuevo...</span>
      </button>
      {menu}
    </div>
  );
}
