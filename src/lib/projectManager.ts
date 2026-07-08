import { BaseDirectory, readTextFile, writeTextFile, mkdir, exists, remove } from "@tauri-apps/plugin-fs";
import { appLocalDataDir } from "@tauri-apps/api/path";
import { getAppDataFilePath, logPersistence } from "./persistence.ts";

const PROJECTS_INDEX = "projects.json";
const PROJECTS_BACKUP_INDEX = "projects.backup.json";

export interface ProjectEntry {
  path: string;
  name: string;
}

export const ensureProjectMeta = async (projectPath: string, name: string) => {
  const codeclubPath = `${projectPath}/.codeclub`;
  const chatsPath = `${codeclubPath}/chats`;
  const notesPath = `${codeclubPath}/notes`;
  const tablesPath = `${codeclubPath}/tables`;
  const metaPath = `${codeclubPath}/meta.json`;

  await mkdir(chatsPath, { recursive: true });
  await mkdir(notesPath, { recursive: true });
  await mkdir(tablesPath, { recursive: true });

  let metaData: any = {};
  if (await exists(metaPath)) {
    try {
      metaData = JSON.parse(await readTextFile(metaPath));
    } catch {
      metaData = {};
    }
  }

  await writeTextFile(
    metaPath,
    JSON.stringify({
      ...metaData,
      name,
      path: projectPath,
      created_at: metaData.created_at || new Date().toISOString(),
      chats: Array.isArray(metaData.chats) ? metaData.chats : [],
      notes: Array.isArray(metaData.notes) ? metaData.notes : [],
      tables: Array.isArray(metaData.tables) ? metaData.tables : [],
    })
  );
  await logPersistence("save_project_meta", "ok", { name, projectPath, path: metaPath });
};

export const saveProjectIndex = async (name: string, projectPath: string) => {
  let globalProjects: ProjectEntry[] = [];
  await mkdir(await appLocalDataDir(), { recursive: true });

  if (await exists(PROJECTS_INDEX, { baseDir: BaseDirectory.AppLocalData })) {
    const data = await readTextFile(PROJECTS_INDEX, { baseDir: BaseDirectory.AppLocalData });
    if (data) globalProjects = JSON.parse(data);
  }

  const existingProject = globalProjects.find((project) => project.path === projectPath);
  if (existingProject) {
    existingProject.name = name;
  } else {
    globalProjects.push({ name, path: projectPath });
  }

  const payload = JSON.stringify(globalProjects);
  const absoluteIndexPath = await getAppDataFilePath(PROJECTS_INDEX);
  const absoluteBackupPath = await getAppDataFilePath(PROJECTS_BACKUP_INDEX);
  await writeTextFile(PROJECTS_INDEX, payload, { baseDir: BaseDirectory.AppLocalData });
  await writeTextFile(absoluteBackupPath, payload);
  await logPersistence("save_project_index", "ok", {
    name,
    projectPath,
    count: globalProjects.length,
    paths: [absoluteIndexPath, absoluteBackupPath],
  });
};

export const writeProjectIndex = async (projects: ProjectEntry[]) => {
  await mkdir(await appLocalDataDir(), { recursive: true });
  const payload = JSON.stringify(projects);
  await writeTextFile(PROJECTS_INDEX, payload, { baseDir: BaseDirectory.AppLocalData });
  await writeTextFile(await getAppDataFilePath(PROJECTS_BACKUP_INDEX), payload);
};

export const readProjectIndex = async (): Promise<ProjectEntry[]> => {
  const candidates = [
    { label: "AppLocalData", path: PROJECTS_INDEX, options: { baseDir: BaseDirectory.AppLocalData } },
    { label: "absolute", path: await getAppDataFilePath(PROJECTS_INDEX) },
    { label: "backup", path: await getAppDataFilePath(PROJECTS_BACKUP_INDEX) },
  ];

  for (const candidate of candidates) {
    try {
      if (await exists(candidate.path, candidate.options)) {
        const data = await readTextFile(candidate.path, candidate.options);
        const projects = data ? JSON.parse(data) : [];
        await logPersistence("read_project_index", "ok", {
          source: candidate.label,
          path: candidate.path,
          count: projects.length,
        });
        return projects;
      }
      await logPersistence("read_project_index", "missing", {
        source: candidate.label,
        path: candidate.path,
      });
    } catch (error: any) {
      await logPersistence("read_project_index", "error", {
        source: candidate.label,
        path: candidate.path,
        error: error?.message || String(error),
      });
    }
  }

  return [];
};
