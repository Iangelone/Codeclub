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

export const getProjectFilePath = (projectPath: string, ...parts: string[]) => getProjectDataDir(projectPath, ...parts);

export const getProjectSetting = async <T>(projectPath: string | undefined, key: string, fallback: T): Promise<T> => {
  const filePath = await getProjectFilePath(projectPath ?? '', `${key}.json`);
  try { return (await exists(filePath)) ? JSON.parse(await readTextFile(filePath)) as T : fallback; } catch { return fallback; }
};

export const setProjectSetting = async (projectPath: string | undefined, key: string, value: unknown) => {
  const directory = await getProjectDataDir(projectPath ?? '');
  await mkdir(directory, { recursive: true });
  await writeTextFile(await getProjectFilePath(projectPath ?? '', `${key}.json`), JSON.stringify(value));
};

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
  return settingsCache ?? {};
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
