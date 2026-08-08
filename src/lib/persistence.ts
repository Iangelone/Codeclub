import { appCacheDir, appConfigDir, fileExists as exists, joinPath as join, makeDirectory as mkdir, readDesktopText as readTextFile, writeDesktopText as writeTextFile } from './runtime';

const PERSISTENCE_LOG = "persistence-log.jsonl";
const SETTINGS_FILE = "settings.json";

const browserSettingsKey = 'codeclub:settings';

export const getAppConfigFilePath = async (...parts: string[]) => join(await appConfigDir(), ...parts);
export const getAppCacheFilePath = async (...parts: string[]) => join(await appCacheDir(), ...parts);

/** All project data stays inside the app, keyed by the canonical project path. */
export const getProjectDataDir = async (projectPath: string, ...parts: string[]) => {
  if (!projectPath) return join(await appConfigDir(), "projects", "global", ...parts);
  return join(await appConfigDir(), "projects", encodeURIComponent(projectPath), ...parts);
};

const getLegacyAppProjectDataDir = async (projectPath: string) => join(await appConfigDir(), "projects", encodeURIComponent(projectPath));
const getLegacyProjectDataDir = async (projectPath: string) => join(projectPath, ".codeclub");

let projectMigrationQueue = Promise.resolve();
const migrateDirectory = async (source: string, target: string): Promise<void> => {
  if (!(await exists(source))) return;
  await mkdir(target, { recursive: true });
  const desktop = (typeof window !== 'undefined' ? (window as any).codeclub : undefined);
  if (!desktop?.listDirectory) return;
  for (const entry of await desktop.listDirectory(source)) {
    const sourceEntry = await join(source, entry.name);
    const targetEntry = await join(target, entry.name);
    if (entry.isDirectory) await migrateDirectory(sourceEntry, targetEntry);
    else if (!(await exists(targetEntry))) await writeTextFile(targetEntry, await readTextFile(sourceEntry));
  }
};

export const migrateLegacyProjectData = async (projectPath: string) => {
  if (!projectPath) return;
  const operation = projectMigrationQueue.then(async () => {
    const target = await getProjectDataDir(projectPath);
    const legacySources = [await getLegacyAppProjectDataDir(projectPath), await getLegacyProjectDataDir(projectPath)];
    for (const source of legacySources) {
      if (source !== target && await exists(source)) await migrateDirectory(source, target);
    }
  });
  projectMigrationQueue = operation.catch(() => undefined);
  await operation;
};

export const getProjectFilePath = (projectPath: string, ...parts: string[]) => getProjectDataDir(projectPath, ...parts);

export const logPersistence = async (action: string, status: string, detail: Record<string, any> = {}) => {
  const entry = { at: new Date().toISOString(), action, status, ...detail };
  console.info("[codeclub:persist]", entry);

  try {
    const cachePath = await appCacheDir();
    const logPath = await getAppCacheFilePath(PERSISTENCE_LOG);
    await mkdir(cachePath, { recursive: true });
    const previous = (await exists(logPath)) ? await readTextFile(logPath) : "";
    await writeTextFile(logPath, `${previous}${JSON.stringify(entry)}\n`);
  } catch (error) {
    console.error("[codeclub:persist] log failed", error);
  }
};

export const startPersistenceSession = async () => {
  try {
    const cachePath = await appCacheDir();
    const logPath = await getAppCacheFilePath(PERSISTENCE_LOG);
    await mkdir(cachePath, { recursive: true });
    await writeTextFile(logPath, "");
  } catch (error) {
    console.error("[codeclub:persist] session reset failed", error);
  }
  await logPersistence("app_start", "ok");
};

let settingsCache: Record<string, unknown> | null = null;
let settingsWriteQueue = Promise.resolve();

const loadSettings = async (): Promise<Record<string, unknown>> => {
  if (settingsCache) return settingsCache;
  try { settingsCache = JSON.parse(window.localStorage.getItem(browserSettingsKey) ?? '{}'); } catch { settingsCache = {}; }
  const path = await getAppConfigFilePath(SETTINGS_FILE);
  try {
    settingsCache = (await exists(path)) ? JSON.parse(await readTextFile(path)) : {};
  } catch {
    settingsCache = {};
  }
  return settingsCache;
};

export const getSetting = async <T>(key: string, fallback: T): Promise<T> => {
  const settings = await loadSettings();
  return (settings[key] as T | undefined) ?? fallback;
};

export const setSetting = async (key: string, value: unknown) => {
  const operation = settingsWriteQueue.then(async () => {
    const settings = await loadSettings();
    settings[key] = value;
    window.localStorage.setItem(browserSettingsKey, JSON.stringify(settings));
    const configPath = await appConfigDir();
    if (configPath) {
      await mkdir(configPath);
      await writeTextFile(await getAppConfigFilePath(SETTINGS_FILE), JSON.stringify(settings));
    }
  });
  settingsWriteQueue = operation.catch(() => undefined);
  return operation;
};
