import { appCacheDir, appConfigDir, fileExists as exists, joinPath as join, makeDirectory as mkdir, readDesktopText as readTextFile, writeDesktopText as writeTextFile, appendDesktopLog } from './runtime';

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
    await appendDesktopLog(logPath, `${JSON.stringify(entry)}\n`);
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
      try { settings = parseSettings(window.localStorage.getItem(browserSettingsKey)); } catch { /* Browser settings are optional when local storage is disabled. */ }
      const path = await getAppConfigFilePath(SETTINGS_FILE);
      if (path) {
        try {
          if (await exists(path)) settings = parseSettings(await readTextFile(path));
        } catch {
          // Keep the browser copy when the desktop settings file is unavailable.
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
  if(/^[a-z0-9][a-z0-9_.-]*_api_key$/i.test(key)&&(window as any).codeclub?.credentialPresent) {
    const bridge=(window as any).codeclub;
    if(await bridge.credentialPresent(key)){await removeSetting(key);return 'codeclub-native-credential' as T;}
    const legacy=(await loadSettings())[key];
    if(typeof legacy==='string'&&legacy){await bridge.credentialSet(key,legacy);await removeSetting(key);return 'codeclub-native-credential' as T;}
    return fallback;
  }
  const nativeSettings = (window as any).codeclub?.settingsGet;
  if (nativeSettings) return (await nativeSettings(key)) ?? fallback;
  const settings = await loadSettings();
  return (settings[key] as T | undefined) ?? fallback;
};

const removeSetting = async (key: string) => {
  if ((window as any).codeclub?.settingsRemove) { await (window as any).codeclub.settingsRemove(key); invalidateSettingsCache(); return; }
  const operation = settingsWriteQueue.then(async () => {
    const settings = { ...await loadSettings() };
    let browserSettings = {} as Record<string, unknown>;
    try { browserSettings = parseSettings(window.localStorage.getItem(browserSettingsKey)); } catch { /* Desktop settings remain authoritative. */ }
    if (!(key in settings) && !(key in browserSettings)) return;
    delete settings[key];
    try { window.localStorage.setItem(browserSettingsKey, JSON.stringify(settings)); } catch { /* Optional browser cache. */ }
    if (key in (settingsCache || {})) await writeTextFile(await getAppConfigFilePath(SETTINGS_FILE), JSON.stringify(settings));
    settingsCache = settings;
  });
  settingsWriteQueue = operation.catch(() => undefined);
  return operation;
};

export const setSetting = async (key: string, value: unknown) => {
  if(/^[a-z0-9][a-z0-9_.-]*_api_key$/i.test(key)&&(window as any).codeclub?.credentialSet) {
    await (window as any).codeclub.credentialSet(key,String(value||''));await removeSetting(key);return;
  }
  if ((window as any).codeclub?.settingsSet) { await (window as any).codeclub.settingsSet(key, value); invalidateSettingsCache(); return; }
  const operation = settingsWriteQueue.then(async () => {
    const settings = { ...await loadSettings() };
    settings[key] = value;
    const configPath = await appConfigDir();
    if (configPath) {
      try { window.localStorage.setItem(browserSettingsKey, JSON.stringify(settings)); } catch { /* The desktop settings file remains authoritative if browser storage is full. */ }
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
