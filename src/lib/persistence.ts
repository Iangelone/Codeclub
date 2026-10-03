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
let settingsLoadPromise: Promise<Record<string, unknown>> | null = null;
let settingsRevision = 0;
export const invalidateSettingsCache = () => { settingsRevision++; settingsCache = null; settingsLoadPromise = null; };
let settingsWriteQueue = Promise.resolve();

const parseSettings = (value: string | null | undefined): Record<string, unknown> => {
  try {
    const parsed: unknown = JSON.parse(value || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
};

const loadSettings = async (): Promise<Record<string, unknown>> => {
  if (settingsCache) return settingsCache;
  if (!settingsLoadPromise) {
    const revision = settingsRevision;
    const pending = (async () => {
      let settings: Record<string, unknown> = {};
      try { settings = parseSettings(window.localStorage.getItem(browserSettingsKey)); } catch { /* localStorage puede estar deshabilitado. */ }
      const path = await getAppConfigFilePath(SETTINGS_FILE);
      if (path) {
        try {
          if (await exists(path)) settings = parseSettings(await readTextFile(path));
        } catch {
          // Si el archivo de escritorio no está disponible, se conserva la copia del navegador.
        }
      }
      if (revision !== settingsRevision) return loadSettings();
      settingsCache = settings;
      return settings;
    })();
    const tracked = pending.finally(() => { if (settingsLoadPromise === tracked) settingsLoadPromise = null; });
    settingsLoadPromise = tracked;
  }
  return settingsLoadPromise;
};

export const getSetting = async <T>(key: string, fallback: T): Promise<T> => {
  const settings = await loadSettings();
  return (settings[key] as T | undefined) ?? fallback;
};

export const setSetting = async (key: string, value: unknown) => {
  const operation = settingsWriteQueue.then(async () => {
    const settings = { ...await loadSettings() };
    settings[key] = value;
    const configPath = await appConfigDir();
    if (configPath) {
      try { window.localStorage.setItem(browserSettingsKey, JSON.stringify(settings)); } catch { /* El archivo de escritorio conserva los ajustes si localStorage está lleno. */ }
      await mkdir(configPath);
      await writeTextFile(await getAppConfigFilePath(SETTINGS_FILE), JSON.stringify(settings));
    } else {
      window.localStorage.setItem(browserSettingsKey, JSON.stringify(settings));
    }
    settingsCache = settings;
  });
  settingsWriteQueue = operation.catch(() => undefined);
  return operation;
};
