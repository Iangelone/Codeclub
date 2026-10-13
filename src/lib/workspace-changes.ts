/** Optional before/after Git workspace evidence for chat turn summaries. */
import { nativeInvoke as invoke } from './runtime';
import { parseGitFiles, parseGitStatus } from './git-output';

export type WorkspaceSnapshot = Map<string, string | null>;

export const readWorkspaceSnapshot = async (projectPath: string): Promise<WorkspaceSnapshot> => {
  const snapshot: WorkspaceSnapshot = new Map();
  try {
    const [filesResult, statusResult] = await Promise.all([
      invoke<{ code?: number | null; stdout: string }>('codeclub_git_read', { projectPath, operation: 'files' }),
      invoke<{ code?: number | null; stdout: string }>('codeclub_git_read', { projectPath, operation: 'status' }),
    ]);
    if (filesResult.code !== 0 && statusResult.code !== 0) return snapshot;
    const trackedPaths = parseGitFiles(filesResult.stdout);
    const statusFiles = parseGitStatus(statusResult.stdout);
    const changedPaths = statusFiles.filter(file => !file.code.includes('D')).map(file => file.path);
    const deletedPaths = new Set(statusFiles.filter(file => file.code.includes('D') && !changedPaths.includes(file.path)).map(file => file.path));
    const paths = [...new Set([...trackedPaths, ...changedPaths])].filter(path => !deletedPaths.has(path));
    await Promise.all(paths.map(async (path) => {
      try { snapshot.set(path, await invoke<string>('codeclub_read_file', { projectPath, path })); }
      catch { snapshot.set(path, null); }
    }));
  } catch { /* Summary generation is optional and must not block the chat. */ }
  return snapshot;
};

const lineDelta = (before: string[], after: string[]) => {
  if (before.length > 2500 || after.length > 2500) return { additions: Math.max(0, after.length - before.length), deletions: Math.max(0, before.length - after.length) };
  let previous = new Array(after.length + 1).fill(0);
  for (const beforeLine of before) {
    const current = new Array(after.length + 1).fill(0);
    for (let index = 1; index <= after.length; index += 1) current[index] = beforeLine === after[index - 1] ? previous[index - 1] + 1 : Math.max(previous[index], current[index - 1]);
    previous = current;
  }
  const unchanged = previous[after.length];
  return { additions: after.length - unchanged, deletions: before.length - unchanged };
};

export const summarizeWorkspaceDelta = (before: WorkspaceSnapshot, after: WorkspaceSnapshot) => {
  let additions = 0;
  let deletions = 0;
  const fileChanges: Array<{ path: string; additions: number; deletions: number; status: 'added' | 'deleted' | 'modified' }> = [];
  const paths = new Set([...before.keys(), ...after.keys()]);
  paths.forEach((path) => {
    const beforeContent = before.get(path);
    const afterContent = after.get(path);
    if (beforeContent === afterContent || beforeContent === null || afterContent === null) return;
    const oldText = beforeContent ?? '';
    const newText = afterContent ?? '';
    const delta = lineDelta(oldText.split(/\r?\n/), newText.split(/\r?\n/));
    if (!delta.additions && !delta.deletions) return;
    additions += delta.additions;
    deletions += delta.deletions;
    fileChanges.push({ path, ...delta, status: beforeContent === undefined ? 'added' : afterContent === undefined ? 'deleted' : 'modified' });
  });
  return { additions, deletions, files: fileChanges.length, fileChanges };
};
