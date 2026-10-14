import assert from 'node:assert/strict';
import { builtinModules } from 'node:module';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from '@babel/parser';

async function files(directory) {
  return (await Promise.all((await readdir(directory, { withFileTypes: true })).map(entry => entry.isDirectory() ? files(path.join(directory, entry.name)) : /\.(ts|tsx|cjs)$/.test(entry.name) ? [path.join(directory, entry.name)] : []))).flat();
}
const nativeModules = new Set(builtinModules.map(name => name.replace(/^node:/, '')));
const failures = [];
function check(file, specifier) {
  const normalized = file.replaceAll('\\', '/');
  const resolved = specifier.startsWith('.') ? path.resolve(path.dirname(file), specifier).replaceAll('\\', '/') : specifier;
  const native = specifier.startsWith('node:') || nativeModules.has(specifier) || specifier === 'electron';
  if (normalized.startsWith('src/') && (native || resolved.includes('/electron/'))) failures.push(`${file}: renderer imports native module ${specifier}`);
  if (normalized.startsWith('src/lib/') && (resolved.includes('/src/components/') || resolved.includes('/src/app/'))) failures.push(`${file}: library imports UI ${specifier}`);
  if (normalized.startsWith('electron/') && (resolved.includes('/src/') || /^(react|next|@ai-sdk\/react)(\/|$)/.test(specifier))) failures.push(`${file}: native code imports renderer ${specifier}`);
  if (/^src\/(components|app)\//.test(normalized) && (/^(ai|@ai-sdk\/|langchain|@langchain\/)/.test(specifier) || resolved.includes('/src/lib/engine/'))) failures.push(`${file}: UI imports model/tool execution ${specifier}`);
  if (normalized.startsWith('src/lib/agent/') && /^(react|next)(\/|$)/.test(specifier)) failures.push(`${file}: execution imports a UI framework ${specifier}`);
}
function walk(node, file) {
  if (!node || typeof node !== 'object') return;
  if (['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration'].includes(node.type) && node.source) check(file, node.source.value);
  if (node.type === 'CallExpression' && (node.callee.type === 'Import' || node.callee.name === 'require') && node.arguments[0]?.type === 'StringLiteral') check(file, node.arguments[0].value);
  if (['MemberExpression', 'OptionalMemberExpression'].includes(node.type)) {
    const key = node.computed ? node.property.value : node.property.name;
    if (key === 'codeclub' && file.replaceAll('\\', '/') !== 'src/lib/desktop-bridge.ts') failures.push(`${file}:${node.loc.start.line}: preload access bypasses desktop-bridge`);
    if (file.replaceAll('\\', '/').startsWith('src/lib/agent/') && node.object?.name === 'document') failures.push(`${file}:${node.loc.start.line}: execution manipulates the DOM`);
    if (file.replaceAll('\\', '/').startsWith('electron/') && file.replaceAll('\\', '/') !== 'electron/ipc/register.ts' && node.object?.name === 'ipcMain' && key === 'handle') failures.push(`${file}:${node.loc.start.line}: IPC handler bypasses sender authorization`);
  }
  for (const [key, value] of Object.entries(node)) {
    if (['loc', 'extra', 'start', 'end'].includes(key)) continue;
    if (Array.isArray(value)) value.forEach(child => walk(child, file));
    else if (value && typeof value === 'object') walk(value, file);
  }
}
const sources = [...await files('src'), ...await files('electron')];
for (const file of sources) walk(parse(await readFile(file, 'utf8'), { sourceType: 'unambiguous', plugins: ['typescript', 'jsx'] }), file);
const preload = parse(await readFile('electron/preload.cjs', 'utf8'), { sourceType: 'script' });
const surface = preload.program.body.find(node => node.type === 'ExpressionStatement' && node.expression.callee?.property?.name === 'exposeInMainWorld').expression.arguments[1];
const contract = parse(await readFile('shared/desktop-contracts.d.ts', 'utf8'), { sourceType: 'module', plugins: ['typescript'] }).program.body.find(node => node.declaration?.id?.name === 'DesktopBridge').declaration;
assert.deepEqual(contract.body.body.map(field => field.key.name).sort(), surface.properties.map(field => field.key.name).sort(), 'Bridge contract differs from preload');
assert.deepEqual(failures, [], failures.join('\n'));
console.log(`Architecture: ${sources.length} source files, UI/engine/native boundaries, centralized bridge, authorized IPC and matching preload contract passed.`);
