import { getProjectFilePath, migrateLegacyProjectData } from '../persistence';

export interface MemoryEntry {
  key: string;
  content: string;
  tags: string[];
  created_at: string;
  updated_at: string;
  scope?: 'personal' | 'project';
  status?: 'new' | 'confirmed' | 'stale' | 'conflict';
  confidence?: number;
  source?: 'chat' | 'manual' | 'tool';
  projectPath?: string;
  supersedes?: string;
}

const dir = (projectPath: string) => getProjectFilePath(projectPath, 'memory');
const filePath = (projectPath: string, key: string) => getProjectFilePath(projectPath, 'memory', `${encodeURIComponent(key)}.json`);

export async function saveMemory(
  projectPath: string,
  key: string,
  content: string,
  tags: string[] = [],
  metadata: Partial<Omit<MemoryEntry, 'key' | 'content' | 'tags' | 'created_at' | 'updated_at'>> = {},
): Promise<MemoryEntry> {
  const { mkdir, writeTextFile, readTextFile, exists } = await import('@tauri-apps/plugin-fs');
  await migrateLegacyProjectData(projectPath);
  const memoryDir = await dir(projectPath);
  await mkdir(memoryDir, { recursive: true });
  const fp = await filePath(projectPath, key);
  let entry: MemoryEntry;
  if (await exists(fp)) {
    const existing = JSON.parse(await readTextFile(fp));
    entry = { ...existing, ...metadata, content, tags, updated_at: new Date().toISOString() };
  } else {
    entry = { key, content, tags, scope: 'project', status: 'new', confidence: 0.5, source: 'manual', ...metadata, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
  }
  await writeTextFile(fp, JSON.stringify(entry));
  return entry;
}

export async function listMemories(projectPath: string): Promise<MemoryEntry[]> {
  const { readDir, readTextFile } = await import('@tauri-apps/plugin-fs');
  await migrateLegacyProjectData(projectPath);
  const memoryDir = await dir(projectPath);
  try {
    const entries = await readDir(memoryDir);
    return (await Promise.all(entries.filter((entry) => entry.name?.endsWith('.json')).map(async (entry) => JSON.parse(await readTextFile(`${memoryDir}/${entry.name}`)) as MemoryEntry)))
      .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
  } catch {
    return [];
  }
}

export async function loadMemory(projectPath: string, key: string): Promise<MemoryEntry | null> {
  const { readTextFile, exists } = await import('@tauri-apps/plugin-fs');
  await migrateLegacyProjectData(projectPath);
  const fp = await filePath(projectPath, key);
  if (!(await exists(fp))) return null;
  return JSON.parse(await readTextFile(fp));
}

export async function searchMemory(projectPath: string, query: string): Promise<MemoryEntry[]> {
  const normalized = query.trim().toLowerCase();
  const memories = await listMemories(projectPath);
  if (!normalized) return memories;
  return memories.filter((memory) => [memory.key, memory.content, ...(memory.tags || [])].join(' ').toLowerCase().includes(normalized));
}

export async function deleteMemory(projectPath: string, key: string): Promise<boolean> {
  const { remove, exists } = await import('@tauri-apps/plugin-fs');
  await migrateLegacyProjectData(projectPath);
  const fp = await filePath(projectPath, key);
  if (!(await exists(fp))) return false;
  await remove(fp);
  return true;
}

export async function deleteMemoriesByTag(projectPath: string, tag: string): Promise<number> {
  const { readDir, readTextFile, remove } = await import('@tauri-apps/plugin-fs');
  await migrateLegacyProjectData(projectPath);
  const d = await dir(projectPath);
  let count = 0;
  try {
    const entries = await readDir(d);
    for (const entry of entries) {
      if (!entry.name?.endsWith('.json')) continue;
      const fp = `${d}/${entry.name}`;
      const mem: MemoryEntry = JSON.parse(await readTextFile(fp));
      if (mem.tags?.includes(tag)) {
        await remove(fp);
        count++;
      }
    }
  } catch { /* */ }
  return count;
}
