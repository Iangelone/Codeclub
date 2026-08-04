import { appConfigDir, join } from '@tauri-apps/api/path';
import { exists, mkdir, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
import { getProjectFilePath, migrateLegacyProjectData } from './persistence';

export interface ExecutionLogRecord {
  id: string;
  at: string;
  projectPath: string;
  chatId?: string;
  tool: string;
  input: unknown;
  output: unknown;
}

const LOG_FILE = 'execution.jsonl';
let writeQueue = Promise.resolve();

const logPath = async (projectPath: string) => projectPath ? getProjectFilePath(projectPath, LOG_FILE) : join(await appConfigDir(), LOG_FILE);
const compact = (value: unknown) => {
  if (typeof value === 'string') return value.slice(0, 12000);
  try { return JSON.parse(JSON.stringify(value).slice(0, 12000)); } catch { return String(value).slice(0, 12000); }
};

export const appendExecutionLog = async (record: Omit<ExecutionLogRecord, 'id' | 'at'>) => {
  const operation = writeQueue.then(async () => {
    await migrateLegacyProjectData(record.projectPath);
    const path = await logPath(record.projectPath);
    const parent = path.slice(0, Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/')));
    if (parent) await mkdir(parent, { recursive: true });
    const previous = (await exists(path)) ? await readTextFile(path) : '';
    const entry: ExecutionLogRecord = { id: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`, at: new Date().toISOString(), ...record, input: compact(record.input), output: compact(record.output) };
    await writeTextFile(path, `${previous}${JSON.stringify(entry)}\n`);
  });
  writeQueue = operation.catch(() => undefined);
  return operation;
};

export const readExecutionLog = async (projectPath: string, limit = 100) => {
  await migrateLegacyProjectData(projectPath);
  const path = await logPath(projectPath);
  if (!(await exists(path))) return [];
  try { return (await readTextFile(path)).split(/\r?\n/).filter(Boolean).slice(-Math.min(Math.max(limit, 1), 500)).map((line) => JSON.parse(line)); } catch { return []; }
};
