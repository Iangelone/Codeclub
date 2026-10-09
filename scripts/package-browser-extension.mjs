import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Windows packaging only; browser portability is independent of the build host.
assert.equal(process.platform, 'win32', 'Run this packager on Windows with PowerShell installed.');
const root = fileURLToPath(new URL('../', import.meta.url));
const source = await realpath(path.join(root, 'browser-extension'));
const manifest = JSON.parse(await readFile(path.join(source, 'manifest.json'), 'utf8'));
assert.match(manifest.version, /^\d+(?:\.\d+){0,3}$/, 'Invalid extension version');
assert.equal(manifest.manifest_version, 3);
assert(manifest.background?.service_worker, 'Missing background worker');
delete manifest.key; // Store upload only; never change the unpacked source identity.
const files = [...new Set([
  manifest.background.service_worker,
  ...Object.values(manifest.icons || {}),
  ...Object.values(manifest.action?.default_icon || {}),
])];
const temporary = await mkdtemp(path.join(tmpdir(), 'codeclub-extension-package-'));
const staging = path.join(temporary, 'contents');
const archive = path.join(temporary, 'package.zip');
const output = path.join(root, 'release', `codeclub-browser-control-${manifest.version}.zip`);
try {
  await mkdir(staging);
  await writeFile(path.join(staging, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  for (const file of files) {
    assert.equal(typeof file, 'string');
    const resolved = await realpath(path.resolve(source, file));
    const relative = path.relative(source, resolved);
    assert(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'Asset must stay inside the extension');
    const destination = path.join(staging, relative);
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(resolved, destination);
  }
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `
    $ErrorActionPreference = 'Stop'
    Compress-Archive -Path (Join-Path $env:CODECLUB_PACKAGE_STAGE '*') -DestinationPath $env:CODECLUB_PACKAGE_ARCHIVE
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [IO.Compression.ZipFile]::OpenRead($env:CODECLUB_PACKAGE_ARCHIVE)
    try {
      $entry = $zip.GetEntry('manifest.json')
      if ($null -eq $entry) { throw 'Manifest must be at archive root' }
      $reader = [IO.StreamReader]::new($entry.Open())
      try { $manifest = $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }
      if ($manifest.PSObject.Properties.Name -contains 'key') { throw 'Store manifest must omit key' }
      if (@($zip.Entries | Where-Object { $_.Name -ne '' }).Count -ne [int]$env:CODECLUB_PACKAGE_COUNT) { throw 'Unexpected archive contents' }
    } finally { $zip.Dispose() }
  `], { windowsHide: true, encoding: 'utf8', env: {
    ...process.env, CODECLUB_PACKAGE_STAGE: staging, CODECLUB_PACKAGE_ARCHIVE: archive,
    CODECLUB_PACKAGE_COUNT: String(files.length + 1),
  } });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, result.stderr || result.stdout || 'ZIP creation failed');
  await mkdir(path.dirname(output), { recursive: true });
  await copyFile(archive, output);
  const bytes = await readFile(output);
  console.log(JSON.stringify({ output, version: manifest.version, bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'), files: ['manifest.json', ...files] }, null, 2));
} finally {
  const resolved = path.resolve(temporary);
  assert.equal(path.dirname(resolved), path.resolve(tmpdir()));
  assert(path.basename(resolved).startsWith('codeclub-extension-package-'));
  await rm(resolved, { recursive: true, force: true });
}
