/** Existing project path resolution, file traversal and bounded text search. */
import { promises as fs } from 'node:fs';
import path from 'node:path';

export const projectStorageKey = (value: string) => encodeURIComponent(path.resolve(value));

const ignoredDirectories = new Set(['.git', 'node_modules', '.next', 'build', 'out', 'electron-dist', 'target']);
const projectFile = (projectPath: string, relativePath: string) => {
  const rootPath = path.resolve(projectPath);
  const targetPath = path.resolve(rootPath, relativePath || '.');
  if (!isInsidePath(rootPath, targetPath)) throw new Error('La ruta queda fuera del proyecto.');
  return targetPath;
};

export const isInsidePath = (rootPath: string, targetPath: string) => {
  const relative = path.relative(rootPath, targetPath);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
};

export async function resolveProjectFile(projectPath: string, relativePath: string, allowMissing = false) {
  const rootPath = await fs.realpath(path.resolve(projectPath));
  const targetPath = projectFile(rootPath, relativePath);
  try {
    const resolved = await fs.realpath(targetPath);
    if (!isInsidePath(rootPath, resolved)) throw new Error('La ruta queda fuera del proyecto.');
    return resolved;
  } catch (error: any) {
    if (!allowMissing || error?.code !== 'ENOENT') throw error;
    let ancestor = path.dirname(targetPath);
    const suffix = [path.basename(targetPath)];
    while (isInsidePath(rootPath, ancestor)) {
      try {
        const resolvedAncestor = await fs.realpath(ancestor);
        if (!isInsidePath(rootPath, resolvedAncestor)) throw new Error('La ruta queda fuera del proyecto.');
        return path.join(resolvedAncestor, ...suffix.reverse());
      } catch (ancestorError: any) {
        if (ancestorError?.code !== 'ENOENT') throw ancestorError;
        const parent = path.dirname(ancestor);
        if (parent === ancestor) break;
        suffix.push(path.basename(ancestor));
        ancestor = parent;
      }
    }
    throw new Error('La ruta queda fuera del proyecto.');
  }
}

export async function listProjectFiles(projectPath: string, maxFiles: number) {
  const limit = Number.isFinite(maxFiles) ? Math.min(1200, Math.max(1, Math.floor(maxFiles))) : 400;
  let rootPath: string;
  try { rootPath = await fs.realpath(path.resolve(projectPath)); } catch (error: any) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return [];
    throw error;
  }
  const result: Array<{ path: string; kind: string; size?: number; modifiedAt?: number }> = [];
  const pending: Array<{ folder: string; relative: string }> = [{ folder: rootPath, relative: '' }];
  while (pending.length && result.length < limit) {
    const current = pending.pop()!;
    const directories: Array<{ folder: string; relative: string }> = [];
    try {
      const directory = await fs.opendir(current.folder);
      for await (const entry of directory) {
        if (entry.isSymbolicLink() || (entry.isDirectory() && ignoredDirectories.has(entry.name))) continue;
        const entryRelative = current.relative ? path.join(current.relative, entry.name) : entry.name;
        const entryPath = path.join(current.folder, entry.name);
        if (entry.isDirectory()) {
          result.push({ path: entryRelative.replaceAll(path.sep, '/'), kind: 'directory' });
          directories.push({ folder: entryPath, relative: entryRelative });
        } else if (entry.isFile()) {
          try {
            const stat = await fs.stat(entryPath);
            result.push({ path: entryRelative.replaceAll(path.sep, '/'), kind: 'file', size: stat.size, modifiedAt: stat.mtimeMs });
          } catch { /* A file may disappear while the project is being indexed. */ }
        }
        if (result.length >= limit) break;
      }
    } catch (error) {
      if (current.folder === rootPath) throw error;
      continue;
    }
    for (let index = directories.length - 1; index >= 0; index--) pending.push(directories[index]);
  }
  return result;
}

export async function searchProjectText(projectPath: string, query: string, maxMatches: number) {
  const needle = String(query || '').toLocaleLowerCase();
  if (!needle) return [];
  const limit = Number.isFinite(maxMatches) ? Math.min(200, Math.max(1, Math.floor(maxMatches))) : 80;
  const files = await listProjectFiles(projectPath, 1200);
  const matches: Array<{ path: string; line: number; preview: string }> = [];
  let scannedBytes = 0;
  for (const entry of files) {
    if (entry.kind !== 'file' || matches.length >= limit || !entry.size || entry.size > 2 * 1024 * 1024) continue;
    if (scannedBytes + entry.size > 32 * 1024 * 1024) break;
    scannedBytes += entry.size;
    try {
      const content = await fs.readFile(await resolveProjectFile(projectPath, entry.path), 'utf8');
      if (content.includes('\0')) continue;
      const lines = content.split(/\r?\n/);
      for (let index = 0; index < lines.length && matches.length < limit; index++) {
        if (lines[index].toLocaleLowerCase().includes(needle)) matches.push({ path: entry.path, line: index + 1, preview: lines[index].trim().slice(0, 240) });
      }
    } catch { /* Binarios o archivos ilegibles: se omiten. */ }
  }
  return matches;
}
