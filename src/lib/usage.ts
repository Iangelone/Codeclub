import { appConfigDir, join } from '@tauri-apps/api/path';
import { exists, mkdir, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
import { getProjectFilePath } from './persistence';

export interface GenerationUsageRecord {
  id: string;
  at: string;
  projectPath: string;
  chatId: string;
  mode: string;
  provider: string;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  reasoningTokens: number | null;
  inputCostPerMillion?: number | null;
  outputCostPerMillion?: number | null;
  durationMs: number;
  status: 'completed' | 'error';
}

const GLOBAL_USAGE_FILE = 'usage.jsonl';
let usageWriteQueue = Promise.resolve();

const usagePath = async (projectPath: string) => projectPath
  ? getProjectFilePath(projectPath, GLOBAL_USAGE_FILE)
  : join(await appConfigDir(), GLOBAL_USAGE_FILE);

export const appendGenerationUsage = async (record: GenerationUsageRecord) => {
  const operation = usageWriteQueue.then(async () => {
    const path = await usagePath(record.projectPath);
    const parent = path.slice(0, Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/')));
    if (parent) await mkdir(parent, { recursive: true });
    const previous = (await exists(path)) ? await readTextFile(path) : '';
    await writeTextFile(path, `${previous}${JSON.stringify(record)}\n`);
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('codeclub:usage-updated', { detail: { projectPath: record.projectPath } }));
  });
  usageWriteQueue = operation.catch(() => undefined);
  return operation;
};

export const readGenerationUsage = async (projectPath: string): Promise<GenerationUsageRecord[]> => {
  const path = await usagePath(projectPath);
  if (!(await exists(path))) return [];
  try {
    return (await readTextFile(path)).split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  } catch {
    return [];
  }
};

export const summarizeGenerationUsage = (records: GenerationUsageRecord[], from?: string, to?: string) => {
  const fromTime = from ? new Date(`${from}T00:00:00`).getTime() : Number.NEGATIVE_INFINITY;
  const toTime = to ? new Date(`${to}T23:59:59.999`).getTime() : Number.POSITIVE_INFINITY;
  const filtered = records.filter((record) => {
    const time = new Date(record.at).getTime();
    return Number.isFinite(time) && time >= fromTime && time <= toTime;
  });
  const sum = (key: 'inputTokens' | 'outputTokens' | 'totalTokens' | 'reasoningTokens') => filtered.reduce((total, record) => total + Number(record[key] || 0), 0);
  const estimatedCost = filtered.reduce((total, record) => total + (Number(record.inputTokens || 0) / 1_000_000) * Number(record.inputCostPerMillion || 0) + (Number(record.outputTokens || 0) / 1_000_000) * Number(record.outputCostPerMillion || 0), 0);
  return {
    from: from || null,
    to: to || null,
    generations: filtered.length,
    inputTokens: sum('inputTokens'),
    outputTokens: sum('outputTokens'),
    totalTokens: sum('totalTokens'),
    reasoningTokens: sum('reasoningTokens'),
    durationMs: filtered.reduce((total, record) => total + Number(record.durationMs || 0), 0),
    estimatedCost,
    records: filtered,
  };
};
