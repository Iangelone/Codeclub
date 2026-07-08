import { useState, useEffect, useRef } from "react";
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
  FileText
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
    
    // Create drag preview
    const preview = document.createElement("div");
    preview.className = "drag-preview";
    preview.textContent = item.name;
    document.body.appendChild(preview);
    e.dataTransfer.setDragImage(preview, 0, 0);
    setTimeout(() => preview.remove(), 0);
  };

  return (
    <div className="left-panel">
      <section className="panel-actions">
        <div className="sidebar-label"><LayoutDashboard size={14} /> Espacio de trabajo</div>
        <button type="button"><MessageSquarePlus size={15} /> Nuevo chat</button>
        <button type="button"><Search size={15} /> Buscar</button>
        <button type="button"><Package size={15} /> Complementos</button>
      </section>
      <section className="projects-section">
        <div className="section-heading">
          <span className="heading-title"><Folder size={14} /> Proyectos</span>
          <button id="create-project" type="button" onClick={() => setCreatingProject(true)} aria-label="Crear proyecto"><FolderPlus size={14} /></button>
        </div>
        
        <div className="projects-list">
          {creatingProject && (
            <div className="project-input-row">
              <FolderIcon />
              <input
                className="project-input"
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
              <div key={proj.path} className={`project-card ${isSelected ? "is-selected" : ""} ${isExpanded ? "is-expanded" : ""}`}>
                <div
                  className="project-row"
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
                      className="project-input"
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
                  <span className="project-action-group">
                    <button className="project-action-btn" onClick={(e) => { e.stopPropagation(); handleCreateArtifact(proj.path, proj.name, "chat"); }}><MessageSquarePlus size={14} /></button>
                    <button className="project-action-btn" onClick={(e) => { e.stopPropagation(); handleCreateArtifact(proj.path, proj.name, "table"); }}><TableIconReact size={14} /></button>
                    <button className="project-action-btn" onClick={(e) => { e.stopPropagation(); handleCreateArtifact(proj.path, proj.name, "note"); }}><FileText size={14} /></button>
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
                    <button className="chat-row" style={{display: 'flex'}} onClick={() => handleCreateArtifact(proj.path, proj.name, "chat")}>
                      <MessageSquarePlus size={14} /><span>Crear chat</span>
                    </button>

                    {proj.tables.map((table) => (
                      <ArtifactNode key={table.id} kind="table" item={table} project={proj} isActive={activeArtifactId === table.id}
                        renaming={renamingItemId === `table-${table.id}`} setRenaming={setRenamingItemId} renameInput={renameInput} setRenameInput={setRenameInput}
                        onCommit={handleRenameCommit} onOpen={openArtifact} onDelete={handleDelete} onDragStart={onDragStart} />
                    ))}
                    <button className="chat-row" style={{display: 'flex'}} onClick={() => handleCreateArtifact(proj.path, proj.name, "table")}>
                      <TableIconReact size={14} /><span>Crear tabla</span>
                    </button>

                    {proj.notes.map((note) => (
                      <ArtifactNode key={note.id} kind="note" item={note} project={proj} isActive={activeArtifactId === note.id}
                        renaming={renamingItemId === `note-${note.id}`} setRenaming={setRenamingItemId} renameInput={renameInput} setRenameInput={setRenameInput}
                        onCommit={handleRenameCommit} onOpen={openArtifact} onDelete={handleDelete} onDragStart={onDragStart} />
                    ))}
                    <button className="chat-row" style={{display: 'flex'}} onClick={() => handleCreateArtifact(proj.path, proj.name, "note")}>
                      <FileText size={14} /><span>Crear nota</span>
                    </button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </section>
      
      <section className="sidebar-footer">
        <button type="button">
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
      className={`chat-row chat-item ${kind}-item ${isActive ? "is-active" : ""}`}
      style={{display: 'flex'}}
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
          className="project-input"
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
        <span className="chat-title">{item.name}</span>
      )}
    </button>
  );
}
