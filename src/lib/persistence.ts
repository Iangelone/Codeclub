import { join, appLocalDataDir } from "@tauri-apps/api/path";
import { readTextFile, writeTextFile, mkdir, exists } from "@tauri-apps/plugin-fs";

const PERSISTENCE_LOG = "persistence-log.jsonl";

export const getAppDataFilePath = async (fileName: string) => {
  return join(await appLocalDataDir(), fileName);
};

export const logPersistence = async (action: string, status: string, detail: Record<string, any> = {}) => {
  const entry = {
    at: new Date().toISOString(),
    action,
    status,
    ...detail,
  };

  console.info("[codeclub:persist]", entry);

  try {
    const logPath = await getAppDataFilePath(PERSISTENCE_LOG);
    await mkdir(await appLocalDataDir(), { recursive: true });
    const previous = (await exists(logPath)) ? await readTextFile(logPath) : "";
    await writeTextFile(logPath, `${previous}${JSON.stringify(entry)}\n`);
  } catch (error) {
    console.error("[codeclub:persist] log failed", error);
  }
};

export const startPersistenceSession = async () => {
  try {
    const logPath = await getAppDataFilePath(PERSISTENCE_LOG);
    await mkdir(await appLocalDataDir(), { recursive: true });
    await writeTextFile(logPath, "");
  } catch (error) {
    console.error("[codeclub:persist] session reset failed", error);
  }
  await logPersistence("app_start", "ok");
};
