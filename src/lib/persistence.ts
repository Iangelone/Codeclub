import { appCacheDir, appConfigDir, join } from "@tauri-apps/api/path";
import { exists, mkdir, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";

const PERSISTENCE_LOG = "persistence-log.jsonl";
const SETTINGS_FILE = "settings.json";

export const getAppConfigFilePath = async (...parts: string[]) => join(await appConfigDir(), ...parts);
export const getAppCacheFilePath = async (...parts: string[]) => join(await appCacheDir(), ...parts);

export const getProjectDataDir = async (projectPath: string, ...parts: string[]) => {
  return join(await appConfigDir(), "projects", encodeURIComponent(projectPath), ...parts);
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
    const configPath = await appConfigDir();
    await mkdir(configPath, { recursive: true });
    await writeTextFile(await getAppConfigFilePath(SETTINGS_FILE), JSON.stringify(settings));
  });
  settingsWriteQueue = operation.catch(() => undefined);
  return operation;
};
