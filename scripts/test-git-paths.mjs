import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { readProjectGit } from '../electron/git-read.ts';
import { parseGitFiles, parseGitStatus, parseGitNumstat } from '../src/lib/git-output.ts';

assert.deepEqual(parseGitStatus(' M app/api/drafts/route.ts\0?? docs/diseño/file.md\0').map(file => file.path), ['app/api/drafts/route.ts', 'docs/diseño/file.md']);
assert.equal(parseGitStatus('?? leading and trailing \0')[0].path, 'leading and trailing ');
assert.equal(parseGitNumstat('1\t2\tfile\twith-tab\0').get('file\twith-tab').deletions, 2);
assert.equal(parseGitNumstat('-\t-\timage.png\0').get('image.png').additions, 0);
const root = await mkdtemp(path.join(os.tmpdir(), 'codeclub-git-paths-'));
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true });
try {
  git('init'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid');
  const names = ['app/api/drafts/route.ts', 'docs/diseño/nexo-chat-clone.md', 'old name.md'];
  for (const file of names) { await mkdir(path.dirname(path.join(root, file)), { recursive: true }); await writeFile(path.join(root, file), 'first\n'); }
  git('add', '--', '.'); git('commit', '-m', 'Fixture');
  await writeFile(path.join(root, names[0]), 'first\nsecond\n');
  await writeFile(path.join(root, names[1]), 'first\nsecond\n');
  await rename(path.join(root, 'old name.md'), path.join(root, 'new name.md'));
  git('add', '--', 'old name.md', 'new name.md');
  const files = await readProjectGit(root, { operation: 'files' });
  assert.equal(files.code, 0);
  assert(parseGitFiles(files.stdout).includes(names[1]));
  const status = parseGitStatus((await readProjectGit(root, { operation: 'status' })).stdout);
  assert(status.some(file => file.code === ' M' && file.path === names[0]));
  assert(status.some(file => file.path === names[1]));
  assert(status.some(file => file.path === 'new name.md' && file.originalPath === 'old name.md'));
  const counts = parseGitNumstat((await readProjectGit(root, { operation: 'numstat', scope: 'unstaged' })).stdout);
  assert.equal(counts.get(names[0]).additions, 1);
  assert.equal(counts.get(names[1]).additions, 1);
  const staged = parseGitNumstat((await readProjectGit(root, { operation: 'numstat', scope: 'staged' })).stdout);
  assert(staged.has('new name.md'));
  assert.throws(() => readProjectGit(root, { operation: 'numstat', scope: 'branch', ref: '--output=bad' }));
  console.log('Git paths: UTF-8, leading status whitespace, spaces, renames, numstat and safe read operations passed.');
} finally {
  assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
  assert(path.basename(root).startsWith('codeclub-git-paths-'));
  await rm(root, { recursive: true, force: true });
}
