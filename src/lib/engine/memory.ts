import { getProjectFilePath, migrateLegacyProjectData } from '../persistence';
import { cosineSimilarity, embed, embedMany } from 'ai';

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
  expires_at?: string;
  duplicateOf?: string;
  embedding?: number[];
  embeddingModel?: string;
}

const dir = (projectPath: string) => getProjectFilePath(projectPath, 'memory');
const filePath = (projectPath: string, key: string) => getProjectFilePath(projectPath, 'memory', `${encodeURIComponent(key)}.json`);
const normalizeMemoryText = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const memoryTokens = (value: string) => new Set(normalizeMemoryText(value).split(/[^a-z0-9]+/).filter((token) => token.length > 2));

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
    entry = { ...existing, ...metadata, content, tags, embedding: undefined, embeddingModel: undefined, updated_at: new Date().toISOString() };
  } else {
    const normalizedContent = normalizeMemoryText(content).trim();
    const duplicate = (await listMemories(projectPath)).find((memory) => normalizeMemoryText(memory.content).trim() === normalizedContent);
    if (duplicate) return { ...duplicate, duplicateOf: duplicate.key };
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
      .map((memory) => memory.expires_at && new Date(memory.expires_at).getTime() <= Date.now() ? { ...memory, status: 'stale' as const } : memory)
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

async function indexMissingEmbeddings(projectPath: string, memories: MemoryEntry[], embeddingModel: any): Promise<MemoryEntry[]> {
  const missing = memories.filter((memory) => !memory.embedding);
  if (missing.length === 0) return memories;
  const { embeddings } = await embedMany({ model: embeddingModel, values: missing.map((memory) => `${memory.key}\n${memory.content}\n${memory.tags.join(' ')}`), maxRetries: 0 });
  const { writeTextFile } = await import('@tauri-apps/plugin-fs');
  await Promise.all(missing.map(async (memory, index) => {
    const next = { ...memory, embedding: embeddings[index], embeddingModel: 'configured' };
    await writeTextFile(await filePath(projectPath, memory.key), JSON.stringify(next));
    Object.assign(memory, next);
  }));
  return memories;
}

export async function enrichMemoryIndex(projectPath: string, embeddingModel?: any): Promise<{ indexed: number; stale: number }> {
  const memories = await listMemories(projectPath);
  if (!embeddingModel || memories.length === 0) return { indexed: 0, stale: memories.filter((memory) => memory.status === 'stale').length };
  const missing = memories.filter((memory) => !memory.embedding).length;
  await indexMissingEmbeddings(projectPath, memories, embeddingModel);
  return { indexed: missing, stale: memories.filter((memory) => memory.status === 'stale').length };
}

export async function searchMemory(projectPath: string, query: string, embeddingModel?: any): Promise<MemoryEntry[]> {
  const normalized = normalizeMemoryText(query.trim());
  const memories = await listMemories(projectPath);
  if (!normalized) return memories;
  if (embeddingModel) {
    try {
      const [{ embedding }, indexed] = await Promise.all([
        embed({ model: embeddingModel, value: query, maxRetries: 0 }),
        indexMissingEmbeddings(projectPath, memories, embeddingModel),
      ]);
      const semantic = indexed.map((memory) => ({ memory, score: memory.embedding ? cosineSimilarity(embedding, memory.embedding) : -1 }))
        .filter(({ score }) => score >= 0.25).sort((a, b) => b.score - a.score).map(({ memory }) => memory);
      if (semantic.length > 0) return semantic;
    } catch {
      // Providers without an embeddings endpoint use the local relevance fallback below.
    }
  }
  const queryTokens = memoryTokens(normalized);
  return memories.map((memory) => {
    const haystack = normalizeMemoryText([memory.key, memory.content, ...(memory.tags || [])].join(' '));
    const tokens = memoryTokens(haystack);
    const overlap = [...queryTokens].filter((token) => tokens.has(token)).length;
    const score = (haystack.includes(normalized) ? 3 : 0) + overlap / Math.max(queryTokens.size, 1);
    return { memory, score };
  }).filter(({ score }) => score > 0).sort((a, b) => b.score - a.score).map(({ memory }) => memory);
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
