import { appConfigDir, fileExists as exists, makeDirectory as mkdir, readDesktopText as readTextFile, writeDesktopText as writeTextFile, nativeInvoke as invoke } from './runtime';
import { getAppConfigFilePath, getProjectFilePath, getSetting, logPersistence, migrateLegacyProjectData, setSetting } from "./persistence.ts";

const PROJECTS_INDEX = "projects.json";
const PROJECTS_BACKUP_INDEX = "projects.backup.json";

export interface ProjectEntry {
  path: string;
  name: string;
  file_count?: number;
  directory_count?: number;
  total_size?: number;
  files?: string[];
  indexed_at?: string;
}

export interface ProjectIndexSnapshot {
  fileCount: number;
  directoryCount: number;
  totalSize: number;
  files: string[];
}

export interface ProjectMeta {
  name: string;
  path: string;
  created_at: string;
  chats: Array<{ id: string; name: string; customName?: boolean }>;
}

export interface GlobalChatEntry {
  id: string;
  name: string;
  customName?: boolean;
  projectPath: "";
  projectName: "Sin proyecto";
}

const GLOBAL_CHATS_SETTING = "codeclub_global_chats";
const GLOBAL_CHAT_HISTORIES_SETTING = "codeclub_global_chat_histories";
const GLOBAL_CHAT_TRANSCRIPTS_SETTING = "codeclub_global_chat_transcripts";
export const readGlobalChats = async (): Promise<GlobalChatEntry[]> => {
  const chats = await getSetting<GlobalChatEntry[]>(GLOBAL_CHATS_SETTING, []);
  return Array.isArray(chats) ? chats : [];
};
export const writeGlobalChats = async (chats: GlobalChatEntry[]) => setSetting(GLOBAL_CHATS_SETTING, chats);
export const readGlobalChatHistory = async (chatId: string): Promise<any[]> => {
  const histories = await getSetting<Record<string, any[]>>(GLOBAL_CHAT_HISTORIES_SETTING, {});
  return Array.isArray(histories[chatId]) ? histories[chatId] : [];
};
export const writeGlobalChatHistory = async (chatId: string, messages: any[]) => {
  const histories = await getSetting<Record<string, any[]>>(GLOBAL_CHAT_HISTORIES_SETTING, {});
  histories[chatId] = messages;
  await setSetting(GLOBAL_CHAT_HISTORIES_SETTING, histories);
};
export const appendGlobalChatTranscript = async (chatId: string, markdown: string) => {
  const transcripts = await getSetting<Record<string, string>>(GLOBAL_CHAT_TRANSCRIPTS_SETTING, {});
  transcripts[chatId] = `${transcripts[chatId] || ''}${markdown}`;
  await setSetting(GLOBAL_CHAT_TRANSCRIPTS_SETTING, transcripts);
};

export const getProjectMetaPath = (projectPath: string) => getProjectFilePath(projectPath, "meta.json");
export const getProjectChatPath = (projectPath: string, chatId: string) => getProjectFilePath(projectPath, "chats", `${chatId}.jsonl`);
export const getProjectTranscriptPath = (projectPath: string, chatId: string) => getProjectFilePath(projectPath, "chats", `${chatId}.md`);

export const readProjectMeta = async (projectPath: string): Promise<ProjectMeta | null> => {
  await migrateLegacyProjectData(projectPath);
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

export const ensureCodeclubFolder = async (projectPath: string) => {
  await migrateLegacyProjectData(projectPath);
  await mkdir(await getProjectFilePath(projectPath), { recursive: true });
};

export const indexProjectContents = async (name: string, projectPath: string) => {
  const snapshot = await invoke<ProjectIndexSnapshot>("codeclub_index_project", { projectPath });
  const projects = await readProjectIndex();
  const existing = projects.find((project) => project.path === projectPath);
  const entry: ProjectEntry = {
    ...(existing || {}),
    name,
    path: projectPath,
    file_count: snapshot.fileCount,
    directory_count: snapshot.directoryCount,
    total_size: snapshot.totalSize,
    files: snapshot.files,
    indexed_at: new Date().toISOString(),
  };
  const next = existing ? projects.map((project) => project.path === projectPath ? entry : project) : [...projects, entry];
  await writeProjectIndex(next);
  return entry;
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
