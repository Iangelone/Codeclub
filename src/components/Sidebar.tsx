import React, { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { exists, remove, readDir, rename } from "@tauri-apps/plugin-fs";
import { invoke } from "@tauri-apps/api/core";
import { confirm as confirmDialog, open } from "@tauri-apps/plugin-dialog";
import { logPersistence } from "../lib/persistence";
import SettingsModal from "./SettingsModal";
import {
  readProjectIndex,
  writeProjectIndex,
  ensureProjectMeta,
  saveProjectIndex,
  indexProjectContents,
  readProjectMeta,
  writeProjectMeta,
  getProjectChatPath,
  readGlobalChats,
  writeGlobalChats,
} from "../lib/projectManager";

import {
  Folder,
  FolderOpen,
  FolderPlus,
  Settings,
  MessageSquare,
  MessageSquarePlus,
  Blocks,
  Target,
  FileText,
  FileCode2,
  MousePointer2,
  Trash2,
  Eraser
} from "lucide-react";
import { activeChatStore, chatsStore, type GlobalChat } from "../lib/store";

const CHAT_AVATAR_GRADIENT = 'linear-gradient(145deg, #8BC7FF 0%, #3D9BFF 44%, #1687FF 100%)';
const MiniCreature = ({ active = false, avatarRef }: { active?: boolean; avatarRef?: React.RefObject<HTMLSpanElement | null> }) => <span ref={avatarRef} aria-hidden="true" className={`relative grid h-5 w-5 shrink-0 rounded-[6px] transition ${active ? 'shadow-[0_0_7px_rgba(45,145,255,0.42)]' : ''}`} style={{ background: active ? CHAT_AVATAR_GRADIENT : '#343434' }}><span className="absolute inset-0 flex items-center justify-center gap-1"><span className={`h-[6px] w-[4px] flex-none translate-x-[var(--chat-eye-x)] translate-y-[var(--chat-eye-y)] rounded-full transition-transform ${active ? 'bg-white' : 'bg-[#666666]'}`} /><span className={`h-[6px] w-[4px] flex-none translate-x-[var(--chat-eye-x)] translate-y-[var(--chat-eye-y)] rounded-full transition-transform ${active ? 'bg-white' : 'bg-[#666666]'}`} /></span></span>;
const getAgentActivityLabel = (activity: { state: string; tool?: string; agent?: string }) => activity.tool || ({ connecting: 'Conectando con el proveedor…', streaming: 'Generando respuesta…', tool_call: 'Usando herramienta…', approval: 'Esperando aprobación…', running: 'Ejecutando…', error: 'Revisando error…' }[activity.state] || activity.agent || 'Trabajando…');

// --- Types ---
type Artifact = { id: string; name: string };
type StructureEntry = { path: string; isDirectory: boolean };
type ProjectData = {
  name: string;
  path: string;
  chats: Artifact[];
};

export default function Sidebar() {
  const [projects, setProjects] = useState<ProjectData[]>([]);
  const [globalChats, setGlobalChats] = useState<GlobalChat[]>([]);
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [expandedStructures, setExpandedStructures] = useState<Set<string>>(new Set());
  const [openStructureDirectories, setOpenStructureDirectories] = useState<Set<string>>(new Set());
  const [structureFiles, setStructureFiles] = useState<Record<string, StructureEntry[]>>({});
  const [creatingStructure, setCreatingStructure] = useState<{ projectPath: string; parentPath: string; kind: "file" | "folder" } | null>(null);
  const [newStructureName, setNewStructureName] = useState("");
  const [structureError, setStructureError] = useState("");
  const structureCreationBusyRef = useRef(false);
  const [structureMenu, setStructureMenu] = useState<{ projectPath: string; path: string; isDirectory: boolean; top: number; left: number } | null>(null);
  const structureMenuRef = useRef<HTMLDivElement | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [activeArtifactId, setActiveArtifactId] = useState<string | null>(null);
  const [agentActivities, setAgentActivities] = useState<Record<string, { state: string; tool?: string; agent?: string; ready?: boolean }>>({});
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activeSection, setActiveSection] = useState<"chat" | "projects" | "businesses" | "extensions">("projects");

  useEffect(() => {
    const handleAgentActivity = (event: Event) => {
      const detail = (event as CustomEvent).detail || {};
      if (!detail.chatId) return;
      setAgentActivities((current) => {
        if (detail.state === 'idle' && activeChatStore.get().id === detail.chatId) {
          if (!current[detail.chatId]) return current;
          const next = { ...current };
          delete next[detail.chatId];
          return next;
        }
        return { ...current, [detail.chatId]: { ...detail, ready: detail.state === 'idle' } };
      });
    };
    window.addEventListener("codeclub:agent-activity", handleAgentActivity);
    return () => { window.removeEventListener("codeclub:agent-activity", handleAgentActivity); };
  }, []);

  const [creatingProject, setCreatingProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [creatingArtifact, setCreatingArtifact] = useState<{ projectPath: string; projectName: string } | null>(null);
  const [newArtifactName, setNewArtifactName] = useState("");
  const activeChatAvatarRef = useRef<HTMLSpanElement | null>(null);

  const moveActiveChatEyes = (event: React.MouseEvent<HTMLDivElement>) => {
    const avatar = activeChatAvatarRef.current;
    if (!avatar) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - bounds.left) / bounds.width) - 0.5;
    const y = ((event.clientY - bounds.top) / bounds.height) - 0.5;
    avatar.style.setProperty("--chat-eye-x", `${Math.max(-1, Math.min(1, x * 2))}px`);
    avatar.style.setProperty("--chat-eye-y", `${Math.max(-0.75, Math.min(0.75, y * 1.5))}px`);
  };

  const resetActiveChatEyes = () => {
    const avatar = activeChatAvatarRef.current;
    avatar?.style.setProperty("--chat-eye-x", "0px");
    avatar?.style.setProperty("--chat-eye-y", "0px");
  };
  const [renamingItemId, setRenamingItemId] = useState<string | null>(null);
  const [renameInput, setRenameInput] = useState("");
  const [projectMenu, setProjectMenu] = useState<{
    path: string;
    name: string;
    top: number;
    left: number;
    source?: "sidebar" | "panel";
  } | null>(null);
  const projectMenuRef = useRef<HTMLDivElement | null>(null);
  const [artifactMenu, setArtifactMenu] = useState<{
    kind: string;
    id: string;
    name: string;
    projectPath: string;
    projectName: string;
    top: number;
    left: number;
  } | null>(null);
  const artifactMenuRef = useRef<HTMLDivElement | null>(null);
  const [renamingArtifact, setRenamingArtifact] = useState<typeof artifactMenu>(null);

  const loadProjects = async () => {
    try {
      const globalProjects = await readProjectIndex();
      const loaded: ProjectData[] = [];
      for (const proj of globalProjects) {
        let chats: Artifact[] = [];
        try {
          const metaData = await readProjectMeta(proj.path);
          chats = metaData?.chats || [];
        } catch (e) {
          console.error("Error reading meta for", proj.name, e);
        }
        loaded.push({ name: proj.name, path: proj.path, chats });
      }
      setProjects(loaded);
      const projectChats = loaded.flatMap((project) => project.chats.map((chat) => ({
        ...chat,
        projectPath: project.path,
        projectName: project.name,
      })));
      const chats = [...projectChats, ...(await readGlobalChats())].sort((a, b) => {
        const time = (id: string) => Number(id.replace("global-", "")) || 0;
        return time(a.id) - time(b.id);
      });
      setGlobalChats(chats);
      chatsStore.set(chats);
    } catch (e) {
      console.error("Failed to load projects", e);
    }
  };

  useEffect(() => {
    loadProjects();
    const handleIndexed = () => loadProjects();
    const handleMetaChanged = () => loadProjects();
    const handleGlobalChatChanged = () => loadProjects();
    const handleRequire = () => setCreatingProject(true);
    const handleOpenChat = (event?: Event) => {
      setActiveSection("chat");
      const detail = (event as CustomEvent | undefined)?.detail || {};
      if (detail.chatId) {
        setActiveArtifactId(detail.chatId);
        activeChatStore.set({ id: detail.chatId, kind: "chat" });
      } else {
        setActiveArtifactId(null);
        activeChatStore.set({});
      }
    };
    const handleOpenRecentChat = (event: Event) => {
      const chat = (event as CustomEvent<GlobalChat>).detail;
      if (chat?.id) openGlobalChat(chat);
    };
    const handleOpenProjects = () => setActiveSection("projects");
    const handleOpenBusinesses = () => setActiveSection("businesses");
    const handleOpenExtensions = () => setActiveSection("extensions");
    const handleOpenSettings = () => setSettingsOpen(true);
    const handleProjectContextMenu = (event: Event) => {
      const detail = (event as CustomEvent).detail || {};
      if (!detail.path || !detail.name) return;
      setProjectMenu({ path: detail.path, name: detail.name, top: detail.top, left: detail.left, source: "panel" });
    };
    const handleNewChatRequest = () => void openNewChat();
    const handleChatCreated = (event: Event) => {
      const chatId = (event as CustomEvent).detail?.chatId;
      if (!chatId) return;
      setActiveSection("chat");
      setActiveArtifactId(chatId);
      activeChatStore.set({ id: chatId, kind: "chat" });
    };
    const handleChatRename = async (event: Event) => {
      const detail = (event as CustomEvent).detail || {};
      if (!detail.chatId || !detail.newName) return;
      if (!detail.projectPath) {
        const chats = await readGlobalChats();
        const chat = chats.find((item) => item.id === detail.chatId);
        if (!chat) return;
        chat.name = detail.newName;
        await writeGlobalChats(chats);
        await loadProjects();
        return;
      }
      const metaData = await readProjectMeta(detail.projectPath);
      const chat = metaData?.chats?.find((item) => item.id === detail.chatId);
      if (!metaData || !chat || chat.name === detail.newName) return;
      chat.name = detail.newName;
      await writeProjectMeta(detail.projectPath, metaData);
      notifyProjectMetaChanged(detail.projectPath);
      await loadProjects();
    };
    const handleProjectSelection = (event: Event) => {
      const detail = (event as CustomEvent).detail || {};
      setSelectedProjectId(detail.selected === true ? detail.projectPath : null);
    };
    window.dispatchEvent(new CustomEvent("codeclub:project-selection-changed", { detail: { selected: false } }));
    
    window.addEventListener("codeclub:project-indexed", handleIndexed);
    window.addEventListener("codeclub:project-meta-changed", handleMetaChanged);
    window.addEventListener("codeclub:global-chat-changed", handleGlobalChatChanged);
    window.addEventListener("codeclub:require-project", handleRequire);
    window.addEventListener("codeclub:open-empty-chat", handleOpenChat);
    window.addEventListener("codeclub:open-chat", handleOpenChat);
    window.addEventListener("codeclub:open-recent-chat", handleOpenRecentChat);
    window.addEventListener("codeclub:request-new-chat", handleNewChatRequest);
    window.addEventListener("codeclub:chat-created", handleChatCreated);
    window.addEventListener("codeclub:rename-chat", handleChatRename);
    window.addEventListener("codeclub:open-projects", handleOpenProjects);
    window.addEventListener("codeclub:open-businesses", handleOpenBusinesses);
    window.addEventListener("codeclub:open-extensions", handleOpenExtensions);
    window.addEventListener("codeclub:open-settings", handleOpenSettings);
    window.addEventListener("codeclub:project-context-menu", handleProjectContextMenu);
    window.addEventListener("codeclub:project-selection-changed", handleProjectSelection);
    return () => {
      window.removeEventListener("codeclub:project-indexed", handleIndexed);
      window.removeEventListener("codeclub:project-meta-changed", handleMetaChanged);
      window.removeEventListener("codeclub:global-chat-changed", handleGlobalChatChanged);
      window.removeEventListener("codeclub:require-project", handleRequire);
      window.removeEventListener("codeclub:open-empty-chat", handleOpenChat);
      window.removeEventListener("codeclub:open-chat", handleOpenChat);
      window.removeEventListener("codeclub:open-recent-chat", handleOpenRecentChat);
      window.removeEventListener("codeclub:request-new-chat", handleNewChatRequest);
      window.removeEventListener("codeclub:chat-created", handleChatCreated);
      window.removeEventListener("codeclub:rename-chat", handleChatRename);
      window.removeEventListener("codeclub:open-projects", handleOpenProjects);
      window.removeEventListener("codeclub:open-businesses", handleOpenBusinesses);
      window.removeEventListener("codeclub:open-extensions", handleOpenExtensions);
      window.removeEventListener("codeclub:open-settings", handleOpenSettings);
      window.removeEventListener("codeclub:project-context-menu", handleProjectContextMenu);
      window.removeEventListener("codeclub:project-selection-changed", handleProjectSelection);
    };
  }, []);

  useEffect(() => {
    if (!projectMenu) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (projectMenuRef.current?.contains(event.target as Node)) return;
      setProjectMenu(null);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setProjectMenu(null);
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [projectMenu]);

  useEffect(() => {
    if (!structureMenu) return;
    const close = (event: PointerEvent) => {
      if (!structureMenuRef.current?.contains(event.target as Node)) setStructureMenu(null);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setStructureMenu(null); };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", escape);
    };
  }, [structureMenu]);

  useEffect(() => {
    if (!artifactMenu) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (artifactMenuRef.current?.contains(event.target as Node)) return;
      setArtifactMenu(null);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setArtifactMenu(null);
    };
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [artifactMenu]);

  const toggleProject = (path: string) => {
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const readStructure = async (directory: string, prefix = ''): Promise<StructureEntry[]> => {
    const result: StructureEntry[] = [];
    for (const entry of await readDir(directory)) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      result.push({ path: relativePath, isDirectory: entry.isDirectory });
      if (entry.isDirectory) {
        result.push(...await readStructure(`${directory}/${entry.name}`, relativePath));
      }
    }
    return result.sort((a, b) => a.path.localeCompare(b.path));
  };

  const toggleStructure = async (project: ProjectData) => {
    selectProject(project.path, project.name);
    if (!structureFiles[project.path]) {
      try {
        if (!(await exists(project.path))) {
          setStructureFiles((current) => ({ ...current, [project.path]: [] }));
        } else {
          const files = await readStructure(project.path);
          setStructureFiles((current) => ({ ...current, [project.path]: files }));
        }
      } catch (error) {
        console.warn("No se pudo leer la estructura del proyecto", project.path, error);
        setStructureFiles((current) => ({ ...current, [project.path]: [] }));
      }
    }
    setExpandedStructures((current) => {
      const next = new Set(current);
      next.has(project.path) ? next.delete(project.path) : next.add(project.path);
      return next;
    });
  };

  const toggleStructureDirectory = (projectPath: string, entryPath: string) => {
    const key = `${projectPath}:${entryPath}`;
    setOpenStructureDirectories((current) => {
      const next = new Set(current);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const refreshStructure = async (projectPath: string) => {
    try {
      if (!(await exists(projectPath))) {
        setStructureFiles((current) => ({ ...current, [projectPath]: [] }));
        return;
      }
      const files = await readStructure(projectPath);
      setStructureFiles((current) => ({ ...current, [projectPath]: files }));
    } catch (error) {
      console.warn("No se pudo actualizar la estructura del proyecto", projectPath, error);
    }
  };

  const startStructureCreation = (projectPath: string, parentPath: string, kind: "file" | "folder") => {
    setStructureMenu(null);
    setExpandedProjects((current) => {
      if (current.has(projectPath)) return current;
      const next = new Set(current);
      next.add(projectPath);
      return next;
    });
    setCreatingStructure({ projectPath, parentPath, kind });
    setNewStructureName("");
    setStructureError("");
  };

  // Indexador de estructura del proyecto: refresca y despliega el árbol después de crear.
  const finishStructureCreation = async () => {
    if (!creatingStructure || !newStructureName.trim() || structureCreationBusyRef.current) return;
    const name = newStructureName.trim();
    if (name.includes("/") || name.includes("\\") || name === "." || name === "..") {
      setStructureError("El nombre no puede contener rutas ni ser '.' o '..'.");
      return;
    }
    // Los archivos nuevos sin extensión se crean como texto plano para que el indexador los trate correctamente.
    const lastDot = name.lastIndexOf(".");
    const hasExtension = lastDot > 0 && lastDot < name.length - 1;
    const entryName = creatingStructure.kind === "file" && !hasExtension ? `${name}.txt` : name;
    structureCreationBusyRef.current = true;
    try {
      const relativePath = `${creatingStructure.parentPath ? `${creatingStructure.parentPath}/` : ""}${entryName}`;
      await invoke("codeclub_create_entry", {
        projectPath: creatingStructure.projectPath,
        path: relativePath,
        kind: creatingStructure.kind,
      });
      await refreshStructure(creatingStructure.projectPath);
      setExpandedStructures((current) => new Set(current).add(creatingStructure.projectPath));
      if (creatingStructure.parentPath) {
        const segments = creatingStructure.parentPath.split("/").filter(Boolean);
        let currentPath = "";
        setOpenStructureDirectories((current) => {
          const next = new Set(current);
          for (const segment of segments) {
            currentPath = currentPath ? `${currentPath}/${segment}` : segment;
            next.add(`${creatingStructure.projectPath}:${currentPath}`);
          }
          return next;
        });
      }
      setCreatingStructure(null);
      setNewStructureName("");
      setStructureError("");
    } catch (error) {
      console.error("Error creando elemento de estructura", error);
      setStructureError(error instanceof Error ? error.message : String(error));
    } finally {
      structureCreationBusyRef.current = false;
    }
  };

  const renameStructureEntry = async () => {
    if (!structureMenu) return;
    const currentName = structureMenu.path.split("/").pop() || structureMenu.path;
    const nextName = window.prompt("Nuevo nombre", currentName)?.trim();
    if (!nextName || nextName === currentName || nextName.includes("/") || nextName.includes("\\")) return;
    const parent = structureMenu.path.split("/").slice(0, -1).join("/");
    try {
      await rename(`${structureMenu.projectPath}/${structureMenu.path}`, `${structureMenu.projectPath}/${parent ? `${parent}/` : ""}${nextName}`);
      await refreshStructure(structureMenu.projectPath);
    } catch (error) {
      console.error("Error renombrando elemento de estructura", error);
    } finally {
      setStructureMenu(null);
    }
  };

  const deleteStructureEntry = async () => {
    if (!structureMenu) return;
    if (!(await confirmDialog(`¿Eliminar ${structureMenu.path}?`, { title: "Eliminar elemento", kind: "warning" }))) return;
    try {
      await remove(`${structureMenu.projectPath}/${structureMenu.path}`, { recursive: structureMenu.isDirectory });
      await refreshStructure(structureMenu.projectPath);
    } catch (error) {
      console.error("Error eliminando elemento de estructura", error);
    } finally {
      setStructureMenu(null);
    }
  };

  const openStructureEntry = () => {
    if (!structureMenu) return;
    if (structureMenu.isDirectory) {
      toggleStructureDirectory(structureMenu.projectPath, structureMenu.path);
      setStructureMenu(null);
      return;
    }
    window.dispatchEvent(new CustomEvent("codeclub:open-folders", {
      detail: { projectPath: structureMenu.projectPath, path: structureMenu.path },
    }));
    setStructureMenu(null);
  };

  const isStructureEntryVisible = (projectPath: string, entryPath: string) => {
    const parts = entryPath.split('/');
    return parts.slice(0, -1).every((_, index) => openStructureDirectories.has(`${projectPath}:${parts.slice(0, index + 1).join('/')}`));
  };

  const isLastVisibleDescendant = (projectPath: string, entryPath: string, entries: StructureEntry[]) => {
    const openFolders = entries.filter((entry) => entry.isDirectory && openStructureDirectories.has(`${projectPath}:${entry.path}`));
    const endingFolders = openFolders.filter((folder) => {
      const descendants = entries.filter((entry) => entry.path.startsWith(`${folder.path}/`) && isStructureEntryVisible(projectPath, entry.path));
      return descendants.length > 0 && descendants[descendants.length - 1].path === entryPath;
    });
    return endingFolders.some((folder) => !endingFolders.some((other) => other.path.startsWith(`${folder.path}/`)));
  };

  const notifyProjectMetaChanged = (projectPath: string) => {
    window.dispatchEvent(new CustomEvent("codeclub:project-meta-changed", { detail: { projectPath } }));
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
      await indexProjectContents(newProjectName, selectedPath);
      await logPersistence("create_project", "ok", { name: newProjectName, projectPath: selectedPath });
      setCreatingProject(false);
      setNewProjectName("");
      loadProjects();
    } catch (err) {
      console.error(err);
      setCreatingProject(false);
    }
  };

  const startArtifactCreation = (projectPath: string, projectName: string) => {
    setProjectMenu(null);
    setArtifactMenu(null);
    setCreatingArtifact({ projectPath, projectName });
    setNewArtifactName("");
    setExpandedProjects((current) => new Set(current).add(projectPath));
  };

  const finishArtifactCreation = async () => {
    if (!creatingArtifact || !newArtifactName.trim()) {
      setCreatingArtifact(null);
      setNewArtifactName("");
      return;
    }
    const pending = creatingArtifact;
    const name = newArtifactName.trim();
    setCreatingArtifact(null);
    setNewArtifactName("");
    await handleCreateArtifact(pending.projectPath, pending.projectName, name);
  };

  const handleCreateArtifact = async (projectPath: string, projectName: string, customName?: string) => {
    const id = Date.now().toString();
    const name = customName || "Nuevo chat";
    
    try {
      await ensureProjectMeta(projectPath, projectName);
      const metaData = await readProjectMeta(projectPath);
      if (!metaData) return;
      if (!Array.isArray(metaData.chats)) metaData.chats = [];
      metaData.chats.push({ id, name });
      await writeProjectMeta(projectPath, metaData);

      await logPersistence("create_chat", "ok", { id, projectPath });
      setExpandedProjects(prev => new Set(prev).add(projectPath));
      loadProjects();
      notifyProjectMetaChanged(projectPath);
      openArtifact("chat", id, name, projectPath, projectName);
    } catch (e) {
      console.error("Error creating artifact", e);
    }
  };

  const handleDelete = async (kind: string, itemId: string, projectPath: string) => {
    try {
      if (kind === "project") {
        const projList = (await readProjectIndex()).filter((entry) => entry.path !== projectPath);
        await writeProjectIndex(projList);
        if (selectedProjectId === projectPath) window.dispatchEvent(new CustomEvent("codeclub:open-blank"));
        await logPersistence("delete_project", "ok", { projectPath });
        await loadProjects();
        window.dispatchEvent(new CustomEvent("codeclub:project-indexed"));
        return;
      }

      if (!projectPath) {
        const chats = await readGlobalChats();
        await writeGlobalChats(chats.filter((entry) => entry.id !== itemId));
        if (activeArtifactId === itemId) {
          setActiveArtifactId(null);
          activeChatStore.set({});
          window.dispatchEvent(new CustomEvent("codeclub:open-empty-chat"));
        }
        setArtifactMenu(null);
        await logPersistence(`delete_${kind}`, "ok", { itemId, projectPath: "global" });
        await loadProjects();
        return;
      }

      const metaData = await readProjectMeta(projectPath);
      if (!metaData) return;
      metaData.chats = (metaData.chats || []).filter((entry: any) => entry.id !== itemId);
      await writeProjectMeta(projectPath, metaData);

      const filePath = await getProjectChatPath(projectPath, itemId);
      
      if (await exists(filePath)) await remove(filePath);

      window.dispatchEvent(new CustomEvent("codeclub:open-blank"));
      notifyProjectMetaChanged(projectPath);
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
        await loadProjects();
        window.dispatchEvent(new CustomEvent("codeclub:project-indexed"));
        return;
      }

      if (!projectPath) {
        const chats = await readGlobalChats();
        const item = chats.find((entry) => entry.id === itemId);
        if (item) {
          item.name = finalName;
          await writeGlobalChats(chats);
          await loadProjects();
        }
        return;
      }

      const metaData = await readProjectMeta(projectPath);
      if (!metaData) return;
      const item = metaData.chats?.find((entry: any) => entry.id === itemId);
      if (item) {
        item.name = finalName;
        await writeProjectMeta(projectPath, metaData);
        window.dispatchEvent(new CustomEvent(`codeclub:renamed-${kind}`, {
          detail: { itemId, name: finalName, projectPath },
        }));
        if (kind === "chat") {
          window.dispatchEvent(new CustomEvent("codeclub:rename-chat", {
            detail: { chatId: itemId, newName: finalName, projectPath },
          }));
        }
        notifyProjectMetaChanged(projectPath);
        loadProjects();
      }
    } catch (e) {
      console.error("Error renaming", e);
    }
  };

  const selectProject = (path: string, name: string) => {
    setActiveSection("chat");
    setSelectedProjectId(path);
    window.dispatchEvent(new CustomEvent("codeclub:project-selection-changed", {
      detail: { selected: true, projectPath: path, projectName: name },
    }));
    window.dispatchEvent(new CustomEvent("codeclub:active-project", { detail: { projectPath: path, projectName: name } }));
  };

  const commitArtifactRename = async () => {
    if (!renamingArtifact || !renameInput.trim()) return;
    await handleRenameCommit("chat", renamingArtifact.id, renamingArtifact.projectPath, renamingArtifact.name);
    setRenamingArtifact(null);
  };

  const handleClearChats = async (projectPath: string) => {
    if (false) {
    const project = projects.find((item) => item.path === projectPath);
    if (!(await confirmDialog(`¿Limpiar todos los chats de ${project?.name || "este proyecto"}?`, { title: "Limpiar chats", kind: "warning" }))) return;
    }
    try {
      if (!projectPath) {
        await writeGlobalChats([]);
        window.dispatchEvent(new CustomEvent("codeclub:open-blank"));
        await loadProjects();
        return;
      }

      const metaData = await readProjectMeta(projectPath);
      if (!metaData) return;
      for (const chat of metaData.chats || []) {
        const chatPath = await getProjectChatPath(projectPath, chat.id);
        if (await exists(chatPath)) await remove(chatPath);
      }
      metaData.chats = [];
      await writeProjectMeta(projectPath, metaData);
      if (selectedProjectId === projectPath) {
        setActiveArtifactId(null);
        activeChatStore.set({});
        window.dispatchEvent(new CustomEvent("codeclub:open-blank", { detail: { preserveProject: true } }));
      }
      notifyProjectMetaChanged(projectPath);
      await logPersistence("clear_project_chats", "ok", { projectPath });
      await loadProjects();
    } catch (error) {
      console.error("Error limpiando chats del proyecto", error);
    }
  };

  const handleProjectSelection = (project: ProjectData) => {
    if (selectedProjectId === project.path) return;
    selectProject(project.path, project.name);
    setExpandedProjects((current) => {
      if (current.has(project.path)) return current;
      const next = new Set(current);
      next.add(project.path);
      return next;
    });
  };

  const openProjectMenu = (e: React.MouseEvent, project: ProjectData) => {
    e.preventDefault();
    setProjectMenu({ path: project.path, name: project.name, top: e.clientY, left: e.clientX, source: "sidebar" });
  };

  const openArtifactMenu = (e: React.MouseEvent, kind: string, item: Artifact, project: ProjectData) => {
    e.preventDefault();
    setArtifactMenu({ kind, id: item.id, name: item.name, projectPath: project.path, projectName: project.name, top: e.clientY, left: e.clientX });
  };

  const openProjectsPanel = () => {
    setActiveSection("projects");
    setSelectedProjectId(null);
    setActiveArtifactId(null);
    setProjectMenu(null);
    setArtifactMenu(null);
    activeChatStore.set({});
    window.dispatchEvent(new CustomEvent("codeclub:project-selection-changed", { detail: { selected: false } }));
    window.dispatchEvent(new CustomEvent("codeclub:open-projects"));
    window.dispatchEvent(new CustomEvent("codeclub:open-blank", { detail: {} }));
  };

  const openNewChat = async () => {
    setActiveSection("chat");
    setActiveArtifactId(null);
    activeChatStore.set({});
    window.dispatchEvent(new CustomEvent("codeclub:open-empty-chat"));
  };

  const openArtifact = (kind: string, id: string, name: string, projectPath: string, projectName: string) => {
    if (kind === "chat") {
      setActiveSection("chat");
      setAgentActivities((current) => {
        if (!current[id]) return current;
        const next = { ...current };
        delete next[id];
        return next;
      });
    }
    setActiveArtifactId(id);
    activeChatStore.set({ id, kind });
    selectProject(projectPath, projectName);
    // Cambiar desde un panel (por ejemplo, Negocios) desmonta el panel actual.
    // Esperamos al siguiente tick para que el destino ya tenga su listener montado.
    window.setTimeout(() => window.dispatchEvent(new CustomEvent(`codeclub:open-${kind}`, {
      detail: { [`${kind}Id`]: id, name, projectPath, projectName }
    })), 0);
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

  const openGlobalChat = (chat: GlobalChat) => {
    setAgentActivities((current) => { if (!current[chat.id]) return current; const next = { ...current }; delete next[chat.id]; return next; });
    if (!chat.projectPath) {
      setActiveSection("chat");
      setActiveArtifactId(chat.id);
      activeChatStore.set({ id: chat.id, kind: "chat" });
      window.dispatchEvent(new CustomEvent("codeclub:project-selection-changed", { detail: { selected: false, keepChat: true } }));
      // Negocios se desmonta antes de mostrar el chat; diferir el evento evita perderlo.
      window.setTimeout(() => window.dispatchEvent(new CustomEvent("codeclub:open-chat", { detail: { chatId: chat.id, name: chat.name, projectPath: "", projectName: "Sin proyecto" } })), 0);
      return;
    }
    openArtifact("chat", chat.id, chat.name, chat.projectPath, chat.projectName);
  };

  return (
      <div onMouseMove={activeSection === "chat" && activeArtifactId ? moveActiveChatEyes : undefined} onMouseLeave={activeSection === "chat" && activeArtifactId ? resetActiveChatEyes : undefined} className="acrylic-panel sidebar-shell row-start-2 col-start-1 min-w-[264px] w-[264px] h-[calc(100vh-36px)] min-h-0 overflow-hidden flex flex-col -translate-x-full transition-transform duration-140 ease-out z-10 group-[.has-sidebar]:translate-x-0">
      <section className="min-h-0 flex-1 flex flex-col p-[10px_10px_0] overflow-hidden">
        <div className="h-[28px] shrink-0 mb-1 flex items-center gap-[6px] px-[10px] text-[#b8bbc3] text-sm">
          Codeclub
        </div>
        <div className="shrink-0 flex flex-col gap-1 pb-1">
          <div data-sidebar-item onClick={() => void openNewChat()} className={`codeclub-motion-control w-full min-h-[32px] flex cursor-pointer items-center gap-[8px] rounded-[7px] px-[8px] text-[12px] text-left transition-colors hover:translate-x-px ${activeSection === "chat" && !activeArtifactId ? "bg-[#30333b] text-[#f3f4f6] shadow-[inset_0_1px_rgba(255,255,255,0.06)]" : "text-[#b8bbc3] hover:bg-[var(--color-surface-3)] hover:text-[#f3f4f6]"}`}>
            <span className="flex h-4 w-4 shrink-0 items-center justify-center"><MessageSquarePlus size={16} strokeWidth={1.8} /></span> Nuevo chat
          </div>
          <div data-sidebar-item role="button" tabIndex={0} onClick={openProjectsPanel} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openProjectsPanel(); } }} className={`codeclub-motion-control w-full min-h-[32px] flex cursor-pointer items-center gap-[8px] rounded-[7px] px-[8px] text-[12px] text-left transition-colors hover:translate-x-px focus-visible:outline-none ${activeSection === "projects" ? "bg-[#30333b] text-[#f3f4f6] shadow-[inset_0_1px_rgba(255,255,255,0.06)]" : "text-[#b8bbc3] hover:bg-[var(--color-surface-3)] hover:text-[#f3f4f6]"}`}>
            <span className="flex h-4 w-4 shrink-0 items-center justify-center"><Folder size={16} strokeWidth={1.8} /></span> Proyectos
          </div>
          <button type="button" className={`codeclub-motion-control w-full min-h-[32px] flex items-center gap-[8px] rounded-[7px] px-[8px] text-[12px] text-left transition-colors hover:translate-x-px ${activeSection === "businesses" ? "bg-[#30333b] text-[#f3f4f6] shadow-[inset_0_1px_rgba(255,255,255,0.06)]" : "text-[#b8bbc3] hover:bg-[var(--color-surface-3)] hover:text-[#f3f4f6]"} border-0 appearance-none`} onClick={() => { setActiveSection("businesses"); window.dispatchEvent(new CustomEvent("codeclub:open-businesses")); window.setTimeout(() => setActiveSection("businesses"), 80); }}>
            <span className="flex h-4 w-4 shrink-0 items-center justify-center"><Target size={16} strokeWidth={1.8} /></span> Agentes
          </button>
          <button type="button" className={`codeclub-motion-control w-full min-h-[32px] flex items-center gap-[8px] rounded-[7px] px-[8px] text-[12px] text-left transition-colors hover:translate-x-px ${activeSection === "extensions" ? "bg-[#30333b] text-[#f3f4f6] shadow-[inset_0_1px_rgba(255,255,255,0.06)]" : "text-[#b8bbc3] hover:bg-[var(--color-surface-3)] hover:text-[#f3f4f6]"} border-0 appearance-none`} onClick={() => window.dispatchEvent(new CustomEvent("codeclub:open-extensions"))}>
            <span className="flex h-4 w-4 shrink-0 items-center justify-center"><Blocks size={16} strokeWidth={1.8} /></span> Complementos
          </button>
        </div>
        
        <div className="mt-0 flex-1 min-h-0 flex flex-col gap-1 overflow-y-auto overscroll-contain pt-1 pb-[56px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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

          {false && (projects.map((proj) => {
            const isExpanded = expandedProjects.has(proj.path);
            const isSelected = selectedProjectId === proj.path;
            const isRenaming = renamingItemId === `proj-${proj.path}`;
            const indexedFolderName = proj.path.split(/[\\/]/).filter(Boolean).pop() || proj.name;

            return (
              <div key={proj.path} className={`flex flex-col gap-[3px] min-w-0 group/card ${isSelected ? "is-selected" : ""} ${isExpanded ? "is-expanded" : ""}`}>
                <div
                  data-sidebar-item
                  className="min-h-[30px] flex items-center gap-[8px] rounded-[6px] px-[8px] text-[11px] text-left cursor-pointer bg-[#2B2B2B] w-full min-w-0 box-border text-[#d8d8d8] hover:bg-[var(--color-surface-3)] focus-visible:bg-[var(--color-surface-7)] focus-visible:outline-none group-[.is-selected]/card:bg-[#2B2B2B] group-[.is-selected]/card:text-[#eeeeee] group-[.is-selected]/card:hover:bg-[var(--color-surface-3)] group/prow outline-none appearance-none border-0"
                  tabIndex={0}
                  onClick={() => handleProjectSelection(proj)}
                  onContextMenu={(e) => openProjectMenu(e, proj)}
                  onKeyDown={(e) => {
                    if (e.key === "Delete") handleDelete("project", proj.path, proj.path);
                    if (e.key === "F2") {
                      e.preventDefault();
                      setRenamingItemId(`proj-${proj.path}`);
                      setRenameInput(proj.name);
                    }
                    if (e.key === "Enter" || e.key === " ") {
                      handleProjectSelection(proj);
                    }
                  }}
                >
                  {isExpanded ? <FolderOpen size={14} className="shrink-0" /> : <Folder size={14} className="shrink-0" />}
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
                    <span className="min-w-0 flex-1 truncate">{proj.name}</span>
                  )}
                  <span className="flex items-center gap-[2px] opacity-0 transition-opacity duration-120 group-hover/prow:opacity-100 group-focus-within/prow:opacity-100">
                    <button className="w-[24px] h-[24px] flex items-center justify-center rounded-[4px] text-[#9f9f9f] transition-all duration-120 bg-transparent border-0 p-0 hover:bg-white/10 hover:text-[#eeeeee] opacity-100 appearance-none" title="Nuevo archivo" aria-label="Nuevo archivo" onClick={(e) => { e.stopPropagation(); startStructureCreation(proj.path, "", "file"); }}><FileCode2 size={13} /></button>
                    <button className="w-[24px] h-[24px] flex items-center justify-center rounded-[4px] text-[#9f9f9f] transition-all duration-120 bg-transparent border-0 p-0 hover:bg-white/10 hover:text-[#eeeeee] opacity-100 appearance-none" title="Nueva carpeta" aria-label="Nueva carpeta" onClick={(e) => { e.stopPropagation(); startStructureCreation(proj.path, "", "folder"); }}><FolderPlus size={13} /></button>
                    <button className="w-[24px] h-[24px] flex items-center justify-center rounded-[4px] text-[#9f9f9f] transition-all duration-120 bg-transparent border-0 p-0 hover:bg-white/10 hover:text-[#eeeeee] opacity-100 appearance-none" onClick={(e) => { e.stopPropagation(); startArtifactCreation(proj.path, proj.name); }}><MessageSquarePlus size={14} /></button>
                  </span>
                </div>

                {/* Expanded artifacts */}
                {isExpanded && (
                  <>
                    {creatingArtifact?.projectPath === proj.path && (
                      <div className="min-h-[34px] flex items-center gap-[9px] rounded-md px-[10px] ml-[12px] text-[#d8d8d8]/62">
                        <span className="text-[11px] text-[#777777]">Chat</span>
                        <input
                          className="appearance-none min-w-0 flex-1 h-[22px] box-border border-0 bg-[var(--color-surface-9)] text-[#d8d8d8] caret-[#d8d8d8] text-xs outline-none p-0 px-2 shadow-none placeholder:text-[#8f8f8f] rounded-md"
                          autoFocus
                          placeholder="Nombre"
                          value={newArtifactName}
                          onChange={(e) => setNewArtifactName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") finishArtifactCreation();
                            if (e.key === "Escape") { setCreatingArtifact(null); setNewArtifactName(""); }
                          }}
                          onBlur={() => { setCreatingArtifact(null); setNewArtifactName(""); }}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </div>
                    )}
                    <div className="flex items-center gap-1 ml-[12px]">
                      <button
                        data-sidebar-item
                        type="button"
                        className="min-h-[34px] flex min-w-0 flex-1 items-center gap-[9px] rounded-md px-[10px] text-xs text-left cursor-pointer text-[#d8d8d8]/62 hover:text-[#d8d8d8] hover:bg-white/2 transition-colors bg-transparent border-0 appearance-none"
                        onClick={() => toggleStructure(proj)}
                      >
                        <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center">
                          <MousePointer2 size={14} />
                        </span>
                        <span>{indexedFolderName}</span>
                      </button>
                    </div>

                    {creatingStructure?.projectPath === proj.path && <div className="ml-[24px] flex min-h-[34px] items-center gap-2 rounded-md px-[10px] text-xs text-[#d8d8d8]/70">
                      {creatingStructure.kind === "file" ? <FileCode2 size={14} /> : <Folder size={14} />}
                      <input autoFocus value={newStructureName} onChange={(e) => { setNewStructureName(e.target.value); setStructureError(""); }} placeholder={creatingStructure.kind === "file" ? "nombre.ext" : "Nombre de carpeta"} onBlur={finishStructureCreation} onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") { e.preventDefault(); void finishStructureCreation(); } if (e.key === "Escape") { setCreatingStructure(null); setNewStructureName(""); setStructureError(""); } }} onClick={(e) => e.stopPropagation()} className="min-w-0 flex-1 rounded-md border-0 bg-[var(--color-surface-9)] px-2 py-1 text-xs text-[#d8d8d8] outline-none placeholder:text-[#777]" />
                      {structureError && <span className="text-[10px] text-[#f28b82]" title={structureError}>No se pudo crear</span>}
                    </div>}

                    {expandedStructures.has(proj.path) && (structureFiles[proj.path] || []).filter((entry) => isStructureEntryVisible(proj.path, entry.path)).map((entry) => (
                      <React.Fragment key={`${proj.path}-${entry.path}`}>
                        <button type="button" draggable={!entry.isDirectory} onDragStart={(event) => { if (!entry.isDirectory) { const payload = JSON.stringify({ projectPath: proj.path, path: entry.path }); event.dataTransfer.effectAllowed = "copyMove"; event.dataTransfer.setData("application/codeclub-file", payload); event.dataTransfer.setData("text/plain", payload); window.dispatchEvent(new CustomEvent("codeclub-file-drag-start", { detail: { projectPath: proj.path, path: entry.path } })); } }} onClick={() => { if (entry.isDirectory) { toggleStructureDirectory(proj.path, entry.path); } else { window.dispatchEvent(new CustomEvent("codeclub:open-folders", { detail: { projectPath: proj.path, path: entry.path } })); } }} onContextMenu={(event) => { event.preventDefault(); setStructureMenu({ projectPath: proj.path, path: entry.path, isDirectory: entry.isDirectory, top: event.clientY, left: event.clientX }); }} className="min-h-[34px] flex w-full items-center gap-[9px] px-[10px] ml-[12px] text-xs text-left text-[#d8d8d8]/62 hover:bg-white/2 bg-transparent border-0 appearance-none">
                          <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center">
                            {entry.isDirectory ? (openStructureDirectories.has(`${proj.path}:${entry.path}`) ? <FolderOpen size={14} /> : <Folder size={14} />) : <FileCode2 size={14} />}
                          </span>
                          <span className="min-w-0 truncate">{entry.path}</span>
                        </button>
                        {isLastVisibleDescendant(proj.path, entry.path, structureFiles[proj.path] || []) && <div className="my-1 ml-[12px] mr-0 border-t border-[var(--color-surface-8)]" />}
                      </React.Fragment>
                    ))}

                  </>
                )}
              </div>
            );
          }))}

          <div className="mt-2">
            <div className="h-[24px] shrink-0 mb-1 flex items-center gap-[6px] px-[10px] text-[#9f9f9f] text-xs">Chats</div>
            <div className="flex flex-col gap-1">
              {[...globalChats].reverse().map((chat) => {
                const isActiveChat = activeSection === "chat" && activeArtifactId === chat.id;
                return <button key={`${chat.projectPath}:${chat.id}`} type="button" className={`codeclub-motion-control w-full min-h-[34px] flex items-center gap-[9px] rounded-md px-[10px] text-xs text-left text-[#777777] hover:bg-[var(--color-surface-3)] hover:translate-x-px bg-transparent border-0 appearance-none ${isActiveChat ? "bg-white/5 text-[#eeeeee]" : ""}`} onClick={() => openGlobalChat(chat)} onContextMenu={(event) => { event.preventDefault(); openArtifactMenu(event, "chat", { id: chat.id, name: chat.name }, { name: chat.projectName, path: chat.projectPath, chats: [] }); }} title={chat.projectName}>
                  <MiniCreature active={isActiveChat} avatarRef={isActiveChat ? activeChatAvatarRef : undefined} />
                  {renamingItemId === `chat-${chat.id}` ? <input autoFocus value={renameInput} onChange={(event) => setRenameInput(event.target.value)} onBlur={() => void handleRenameCommit("chat", chat.id, chat.projectPath, chat.name)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void handleRenameCommit("chat", chat.id, chat.projectPath, chat.name); } if (event.key === "Escape") { setRenamingItemId(null); setRenameInput(""); } }} onClick={(event) => event.stopPropagation()} className="min-w-0 flex-1 h-[22px] rounded-md border-0 bg-[#1c1c1c] px-1 text-xs text-[#eeeeee] outline-none" /> : <span className="min-w-0 flex-1 truncate">{activeSection === "chat" && activeArtifactId === chat.id ? chat.name : agentActivities[chat.id]?.ready ? 'Listo para revisión' : agentActivities[chat.id]?.state && agentActivities[chat.id].state !== 'idle' ? getAgentActivityLabel(agentActivities[chat.id]) : chat.name}</span>}
                </button>
              })}
            </div>
          </div>
        </div>
      </section>

      {projectMenu && typeof document !== "undefined" && createPortal(
        <div
          ref={projectMenuRef}
          className="fixed z-[100] min-w-[170px] flex flex-col gap-[3px] p-2 border border-[var(--color-surface-10)] rounded-lg bg-[rgba(18,18,18,0.96)] shadow-[0_18px_54px_rgba(0,0,0,0.38)]"
          style={{ top: projectMenu.top, left: projectMenu.left }}
          onClick={() => setProjectMenu(null)}
        >
          <button className="min-h-[28px] flex items-center gap-[9px] rounded-md px-[10px] text-xs text-left cursor-pointer hover:bg-white/10 text-[#d8d8d8] hover:text-[#eeeeee] transition-colors bg-transparent border-0 appearance-none" onClick={() => { selectProject(projectMenu.path, projectMenu.name); if (projectMenu.source !== "panel") toggleProject(projectMenu.path); }}>
            {expandedProjects.has(projectMenu.path) && projectMenu.source !== "panel" ? <Folder size={13} /> : <FolderOpen size={13} />}<span>{expandedProjects.has(projectMenu.path) && projectMenu.source !== "panel" ? "Cerrar" : "Abrir"}</span>
          </button>
          <button className="min-h-[28px] flex items-center gap-[9px] rounded-md px-[10px] text-xs text-left cursor-pointer hover:bg-white/10 text-[#d8d8d8] hover:text-[#eeeeee] transition-colors bg-transparent border-0 appearance-none" onClick={() => { window.dispatchEvent(new CustomEvent("codeclub:request-rename-project", { detail: { path: projectMenu.path, name: projectMenu.name } })); setProjectMenu(null); }}>
            <FileText size={13} /><span>Renombrar</span>
          </button>
          <button className="min-h-[28px] flex items-center gap-[9px] rounded-md px-[10px] text-xs text-left cursor-pointer hover:bg-white/10 text-[#d8d8d8] hover:text-[#eeeeee] transition-colors bg-transparent border-0 appearance-none" onClick={() => handleDelete("project", projectMenu.path, projectMenu.path)}>
            <Trash2 size={13} /><span>Eliminar</span>
          </button>
          {projectMenu.source !== "panel" && <>
          <div className="my-1 border-t border-[var(--color-surface-8)]" />
          <button className="min-h-[28px] flex items-center gap-[9px] rounded-md px-[10px] text-xs text-left cursor-pointer hover:bg-white/10 text-[#d8d8d8] hover:text-[#eeeeee] transition-colors bg-transparent border-0 appearance-none" onClick={() => handleClearChats(projectMenu.path)}>
            <Eraser size={13} /><span>Borrar todo</span>
          </button>
          <button className="min-h-[28px] flex items-center gap-[9px] rounded-md px-[10px] text-xs text-left cursor-pointer hover:bg-white/10 text-[#d8d8d8] hover:text-[#eeeeee] transition-colors bg-transparent border-0 appearance-none" onClick={() => startStructureCreation(projectMenu.path, "", "file")}>
            <FileCode2 size={13} /><span>Nuevo archivo</span>
          </button>
          <button className="min-h-[28px] flex items-center gap-[9px] rounded-md px-[10px] text-xs text-left cursor-pointer hover:bg-white/10 text-[#d8d8d8] hover:text-[#eeeeee] transition-colors bg-transparent border-0 appearance-none" onClick={() => startStructureCreation(projectMenu.path, "", "folder")}>
            <FolderPlus size={13} /><span>Nueva carpeta</span>
          </button>
          </>}
        </div>,
        document.body
      )}

      {structureMenu && typeof document !== "undefined" && createPortal(
        <div ref={structureMenuRef} className="fixed z-[100] min-w-[180px] flex flex-col gap-[3px] p-2 border border-[var(--color-surface-10)] rounded-lg bg-[rgba(18,18,18,0.96)] shadow-[0_18px_54px_rgba(0,0,0,0.38)]" style={{ top: structureMenu.top, left: structureMenu.left }}>
          <button className="min-h-[28px] flex items-center gap-[9px] rounded-md px-[10px] text-xs text-left cursor-pointer hover:bg-white/10 text-[#d8d8d8] hover:text-[#eeeeee] transition-colors bg-transparent border-0 appearance-none" onClick={openStructureEntry}>{structureMenu.isDirectory ? (openStructureDirectories.has(`${structureMenu.projectPath}:${structureMenu.path}`) ? <Folder size={13} /> : <FolderOpen size={13} />) : <FileCode2 size={13} />}<span>{structureMenu.isDirectory ? (openStructureDirectories.has(`${structureMenu.projectPath}:${structureMenu.path}`) ? "Cerrar" : "Abrir") : "Abrir"}</span></button>
          {structureMenu.isDirectory && <>
            <button className="min-h-[28px] flex items-center gap-[9px] rounded-md px-[10px] text-xs text-left cursor-pointer hover:bg-white/10 text-[#d8d8d8] hover:text-[#eeeeee] transition-colors bg-transparent border-0 appearance-none" onClick={() => startStructureCreation(structureMenu.projectPath, structureMenu.path, "file")}><FileCode2 size={13} /><span>Nuevo archivo</span></button>
            <button className="min-h-[28px] flex items-center gap-[9px] rounded-md px-[10px] text-xs text-left cursor-pointer hover:bg-white/10 text-[#d8d8d8] hover:text-[#eeeeee] transition-colors bg-transparent border-0 appearance-none" onClick={() => startStructureCreation(structureMenu.projectPath, structureMenu.path, "folder")}><FolderPlus size={13} /><span>Nueva carpeta</span></button>
            <div className="my-1 border-t border-[var(--color-surface-8)]" />
          </>}
          <button className="min-h-[28px] flex items-center gap-[9px] rounded-md px-[10px] text-xs text-left cursor-pointer hover:bg-white/10 text-[#d8d8d8] hover:text-[#eeeeee] transition-colors bg-transparent border-0 appearance-none" onClick={renameStructureEntry}><FileText size={13} /><span>Renombrar</span></button>
          <button className="min-h-[28px] flex items-center gap-[9px] rounded-md px-[10px] text-xs text-left cursor-pointer hover:bg-white/10 text-[#d8d8d8] hover:text-[#eeeeee] transition-colors bg-transparent border-0 appearance-none" onClick={deleteStructureEntry}><Trash2 size={13} /><span>Eliminar</span></button>
        </div>,
        document.body
      )}

      {artifactMenu && typeof document !== "undefined" && createPortal(
        <div
          ref={artifactMenuRef}
          className="fixed z-[100] min-w-[170px] flex flex-col gap-[3px] p-2 border border-[var(--color-surface-10)] rounded-lg bg-[rgba(18,18,18,0.96)] shadow-[0_18px_54px_rgba(0,0,0,0.38)]"
          style={{ top: artifactMenu.top, left: artifactMenu.left }}
          onClick={() => setArtifactMenu(null)}
        >
          <button className="min-h-[28px] flex items-center gap-[9px] rounded-md px-[10px] text-xs text-left cursor-pointer hover:bg-white/10 text-[#d8d8d8] hover:text-[#eeeeee] transition-colors bg-transparent border-0 appearance-none" onClick={() => openArtifact(artifactMenu.kind, artifactMenu.id, artifactMenu.name, artifactMenu.projectPath, artifactMenu.projectName)}>
            <MessageSquare size={13} /><span>Abrir</span>
          </button>
          <button className="min-h-[28px] flex items-center gap-[9px] rounded-md px-[10px] text-xs text-left cursor-pointer hover:bg-white/10 text-[#d8d8d8] hover:text-[#eeeeee] transition-colors bg-transparent border-0 appearance-none" onClick={() => { setRenamingItemId(`${artifactMenu.kind}-${artifactMenu.id}`); setRenameInput(artifactMenu.name); setArtifactMenu(null); }}>
            <FileText size={13} /><span>Renombrar</span>
          </button>
          <button className="min-h-[28px] flex items-center gap-[9px] rounded-md px-[10px] text-xs text-left cursor-pointer hover:bg-white/10 text-[#d8d8d8] hover:text-[#eeeeee] transition-colors bg-transparent border-0 appearance-none" onClick={() => handleDelete(artifactMenu.kind, artifactMenu.id, artifactMenu.projectPath)}>
            <Trash2 size={13} /><span>Eliminar</span>
          </button>
          <div className="my-1 border-t border-[var(--color-surface-8)]" />
          <button className="min-h-[28px] flex items-center gap-[9px] rounded-md px-[10px] text-xs text-left cursor-pointer hover:bg-white/10 text-[#d8d8d8] hover:text-[#eeeeee] transition-colors bg-transparent border-0 appearance-none" onClick={() => handleClearChats(artifactMenu.projectPath)}>
            <Eraser size={13} /><span>Borrar todo</span>
          </button>
        </div>,
        document.body
      )}

      <section className="shrink-0 flex flex-col gap-1 p-[10px] bg-transparent relative z-[2]">
        <button className="min-h-[34px] flex items-center gap-[9px] rounded-md px-[10px] text-xs text-left cursor-pointer bg-transparent border-0 text-[#d8d8d8] hover:bg-white/2 appearance-none" type="button" onClick={() => setSettingsOpen(true)}>
          <Settings size={15} /> Ajustes
        </button>
      </section>
      <SettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}

// --- Subcomponents ---

function ArtifactNode({
  kind, item, project, isActive,
  renaming, setRenaming, renameInput, setRenameInput,
  onCommit, onOpen, onDelete, onDragStart, onContextMenu
}: any) {
  const Icon = MessageSquare;
  const initial = item.name?.trim().charAt(0).toUpperCase() || "?";

  return (
    <button
      className={`min-h-[34px] items-center gap-[9px] rounded-md px-[10px] text-xs text-left cursor-pointer hover:bg-white/2 focus-visible:bg-[var(--color-surface-7)] focus-visible:outline-none ml-[12px] text-[#d8d8d8]/62 opacity-72 hidden group-[.is-expanded]/card:flex bg-transparent border-0 appearance-none outline-none ${isActive ? "bg-white/5 text-[#eeeeee]" : ""}`}
      draggable
      onDragStart={(e) => onDragStart(e, kind, item, project.path, project.name)}
      onClick={() => onOpen(kind, item.id, item.name, project.path, project.name)}
      onContextMenu={(e) => onContextMenu(e, kind, item, project)}
      onKeyDown={(e) => {
        if (e.key === "Delete") onDelete(kind, item.id, project.path);
        if (e.key === "F2") {
          e.preventDefault();
          setRenaming(`${kind}-${item.id}`);
          setRenameInput(item.name);
        }
      }}
    >
      {kind === "chat" ? (
        <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border border-[var(--color-surface-8)] bg-[var(--color-surface-3)] text-[10px] font-medium uppercase text-[#bdbdbd]">
          {initial}
        </span>
      ) : (
        <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center">
          <Icon size={14} />
        </span>
      )}
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
