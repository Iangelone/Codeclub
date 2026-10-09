/** Git -z records contain literal UTF-8 paths; never trim or unquote them. */
export const parseGitFiles = (stdout: string): string[] => stdout.split('\0').filter(Boolean);

export function parseGitStatus(stdout: string): Array<{ code: string; path: string; originalPath?: string }> {
  const records = stdout.split('\0');
  const files: Array<{ code: string; path: string; originalPath?: string }> = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (record.length < 4 || record[2] !== ' ') continue;
    const code = record.slice(0, 2);
    const path = record.slice(3);
    const renamed = /[RC]/.test(code);
    files.push({ code, path, ...(renamed ? { originalPath: records[++index] } : {}) });
  }
  return files;
}

export function parseGitNumstat(stdout: string): Map<string, { additions: number; deletions: number }> {
  const records = stdout.split('\0');
  const files = new Map<string, { additions: number; deletions: number }>();
  for (let index = 0; index < records.length; index += 1) {
    const match = /^(\d+|-)\t(\d+|-)\t([\s\S]*)$/.exec(records[index]);
    if (!match) continue;
    let path = match[3];
    if (!path) { index += 1; path = records[++index]; }
    if (path) files.set(path, { additions: Number(match[1]) || 0, deletions: Number(match[2]) || 0 });
  }
  return files;
}
