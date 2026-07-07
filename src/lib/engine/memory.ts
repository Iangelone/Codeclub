export interface MemoryEntry {
  key: string;
  content: string;
  tags: string[];
  created_at: string;
  updated_at: string;
}

function dir(projectPath: string) {
  return `${projectPath}/.codeclub/memory`;
}

function filePath(projectPath: string, key: string) {
  return `${dir(projectPath)}/${encodeURIComponent(key)}.json`;
}

export async function saveMemory(
  projectPath: string,
  key: string,
  content: string,
  tags: string[] = [],
): Promise<MemoryEntry> {
  const { mkdir, writeTextFile, readTextFile, exists } = await import('@tauri-apps/plugin-fs');
  await mkdir(dir(projectPath), { recursive: true });
  const fp = filePath(projectPath, key);
  let entry: MemoryEntry;
  if (await exists(fp)) {
    const existing = JSON.parse(await readTextFile(fp));
    entry = { ...existing, content, tags, updated_at: new Date().toISOString() };
  } else {
    entry = { key, content, tags, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
  }
  await writeTextFile(fp, JSON.stringify(entry));
  return entry;
}

export async function loadMemory(projectPath: string, key: string): Promise<MemoryEntry | null> {
  const { readTextFile, exists } = await import('@tauri-apps/plugin-fs');
  const fp = filePath(projectPath, key);
  if (!(await exists(fp))) return null;
  return JSON.parse(await readTextFile(fp));
}

export async function searchMemory(projectPath: string, query: string): Promise<MemoryEntry[]> {
  const { readDir, readTextFile } = await import('@tauri-apps/plugin-fs');
  const d = dir(projectPath);
  try {
    const entries = await readDir(d);
    const results: MemoryEntry[] = [];
    for (const entry of entries) {
      if (!entry.name?.endsWith('.json')) continue;
      const mem: MemoryEntry = JSON.parse(await readTextFile(`${d}/${entry.name}`));
      if (mem.key === query || mem.tags.some(t => t.includes(query))) {
        results.push(mem);
      }
    }
    return results;
  } catch {
    return [];
  }
}

export async function deleteMemory(projectPath: string, key: string): Promise<boolean> {
  const { remove, exists } = await import('@tauri-apps/plugin-fs');
  const fp = filePath(projectPath, key);
  if (!(await exists(fp))) return false;
  await remove(fp);
  return true;
}

export async function deleteMemoriesByTag(projectPath: string, tag: string): Promise<number> {
  const { readDir, readTextFile, remove } = await import('@tauri-apps/plugin-fs');
  const d = dir(projectPath);
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
