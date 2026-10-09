import { execFile } from 'node:child_process';

/** Machine-readable Git output must bypass the PTY: it changes whitespace and NUL records. */
export function readProjectGit(cwd: string, request: { operation?: unknown; scope?: unknown; ref?: unknown }, signal?: AbortSignal) {
  let args: string[];
  if (request.operation === 'files') args = ['ls-files', '-z', '-co', '--exclude-standard'];
  else if (request.operation === 'status') args = ['status', '--porcelain=v1', '-z', '--untracked-files=all'];
  else if (request.operation === 'numstat') {
    const scope = String(request.scope || 'unstaged');
    if (!['unstaged', 'staged', 'uncommitted', 'branch'].includes(scope)) throw new Error('Invalid Git review scope');
    const ref = String(request.ref || 'HEAD');
    if (scope === 'branch' && ref.startsWith('-')) throw new Error('Invalid Git reference');
    args = ['diff', ...(scope === 'staged' ? ['--cached'] : scope === 'uncommitted' ? ['HEAD'] : scope === 'branch' ? [ref] : []), '--numstat', '-z', '--'];
  } else throw new Error('Invalid Git read operation');
  return new Promise<{ stdout: string; stderr: string; code: number }>(resolve => {
    execFile('git', args, { cwd, encoding: 'utf8', windowsHide: true, timeout: 15000, maxBuffer: 8 * 1024 * 1024, signal }, (error, stdout, stderr) => {
      resolve({ stdout, stderr, code: error ? typeof error.code === 'number' ? error.code : 1 : 0 });
    });
  });
}
