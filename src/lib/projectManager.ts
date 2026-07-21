import { appConfigDir } from "@tauri-apps/api/path";
import { exists, mkdir, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { getAppConfigFilePath, getProjectFilePath, logPersistence } from "./persistence.ts";

const PROJECTS_INDEX = "projects.json";
const PROJECTS_BACKUP_INDEX = "projects.backup.json";

export interface ProjectEntry {
  path: string;
  name: string;
}

export interface ProjectMeta {
  name: string;
  path: string;
  created_at: string;
  chats: Array<{ id: string; name: string }>;
}

export const getProjectMetaPath = (projectPath: string) => getProjectFilePath(projectPath, "meta.json");
export const getProjectChatPath = (projectPath: string, chatId: string) => getProjectFilePath(projectPath, "chats", `${chatId}.jsonl`);

export const readProjectMeta = async (projectPath: string): Promise<ProjectMeta | null> => {
  const path = await getProjectMetaPath(projectPath);
  if (!(await exists(path))) return null;
  try {
    const data = JSON.parse(await readTextFile(path));
    return { ...data, chats: Array.isArray(data.chats) ? data.chats : [] };
  } catch {
    return null;
  }
};

export const writeProjectMeta = async (projectPath: string, meta: ProjectMeta) => {
  const path = await getProjectMetaPath(projectPath);
  await mkdir(await getProjectFilePath(projectPath), { recursive: true });
  await writeTextFile(path, JSON.stringify(meta));
};

export const ensureProjectMeta = async (projectPath: string, name: string) => {
  const current = await readProjectMeta(projectPath);
  const meta: ProjectMeta = {
    name,
    path: projectPath,
    created_at: current?.created_at || new Date().toISOString(),
    chats: current?.chats || [],
  };
  await writeProjectMeta(projectPath, meta);
  await logPersistence("save_project_meta", "ok", { name, projectPath, path: await getProjectMetaPath(projectPath) });
};

export const saveProjectIndex = async (name: string, projectPath: string) => {
  const globalProjects = await readProjectIndex();
  const existingProject = globalProjects.find((project) => project.path === projectPath);
  if (existingProject) existingProject.name = name;
  else globalProjects.push({ name, path: projectPath });
  await writeProjectIndex(globalProjects);
  await logPersistence("save_project_index", "ok", { name, projectPath, count: globalProjects.length });
};

export const writeProjectIndex = async (projects: ProjectEntry[]) => {
  const configPath = await appConfigDir();
  const payload = JSON.stringify(projects);
  await mkdir(configPath, { recursive: true });
  await writeTextFile(await getAppConfigFilePath(PROJECTS_INDEX), payload);
  await writeTextFile(await getAppConfigFilePath(PROJECTS_BACKUP_INDEX), payload);
};

export const readProjectIndex = async (): Promise<ProjectEntry[]> => {
  const candidates = [PROJECTS_INDEX, PROJECTS_BACKUP_INDEX];
  for (const fileName of candidates) {
    const path = await getAppConfigFilePath(fileName);
    try {
      if (!(await exists(path))) continue;
      const data = await readTextFile(path);
      const projects = data ? JSON.parse(data) : [];
      await logPersistence("read_project_index", "ok", { path, count: projects.length });
      return Array.isArray(projects) ? projects : [];
    } catch (error: any) {
      await logPersistence("read_project_index", "error", { path, error: error?.message || String(error) });
    }
  }
  return [];
};
