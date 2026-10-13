import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from '@babel/parser';

const root = 'src/lib/i18n/locales';
const english = (await readdir(`${root}/en`)).sort();
assert.deepEqual((await readdir(`${root}/es`)).sort(), english, 'Every module needs both languages');
const parameters = text => [...text.matchAll(/\{\{\s*([^},]+).*?\}\}/g)].map(match => match[1].trim()).sort();
let messages = 0;
function compare(en, es, key) {
  assert.equal(typeof es, typeof en, `${key}: incompatible translation`);
  if (typeof en === 'string') {
    assert.ok(es.trim(), `${key}: empty translation`);
    assert.deepEqual(parameters(es), parameters(en), `${key}: interpolation parameters differ`);
    messages++;
  } else {
    assert.equal(Array.isArray(en), Array.isArray(es), `${key}: incompatible collection`);
    assert.deepEqual(Object.keys(es).sort(), Object.keys(en).sort(), `${key}: missing or extra keys`);
    for (const name of Object.keys(en)) compare(en[name], es[name], `${key}.${name}`);
  }
}
for (const file of english) compare(JSON.parse(await readFile(`${root}/en/${file}`, 'utf8')), JSON.parse(await readFile(`${root}/es/${file}`, 'utf8')), file);

async function files(directory) {
  return (await Promise.all((await readdir(directory, { withFileTypes: true })).map(entry => entry.isDirectory() ? files(path.join(directory, entry.name)) : /\.tsx$/.test(entry.name) ? [path.join(directory, entry.name)] : []))).flat();
}
// Product names, code labels and measurement units are deliberately language-independent.
const fixedLabels = new Set(['Codeclub', 'Codeclub · 2026', 'Codeclub Browser Control', 'GitHub', 'Android', 'PC', 'Chat', 'Terminal', 'Shell', 'px', 's', '×']);
const failures = [];
function walk(node, parent, file) {
  if (!node || typeof node !== 'object') return;
  const text = node.type === 'JSXText' ? node.value.trim() : node.type === 'StringLiteral' && parent?.type === 'JSXAttribute' && ['title', 'placeholder', 'aria-label', 'alt'].includes(parent.name.name) ? node.value : '';
  if (/[A-Za-zÀ-ÿ]/.test(text) && !fixedLabels.has(text)) failures.push(`${file}:${node.loc.start.line}: inline UI text ${JSON.stringify(text)}`);
  if (node.type === 'ConditionalExpression' && node.test.type === 'BinaryExpression' && [node.test.left.value, node.test.right.value].some(value => value === 'en' || value === 'es')) {
    const values = [node.consequent, node.alternate];
    if (values.every(value => value.type === 'StringLiteral') && values.some(value => !/^(en|es)(-[A-Z]{2})?$/.test(value.value))) failures.push(`${file}:${node.loc.start.line}: inline bilingual UI text`);
  }
  for (const [key, value] of Object.entries(node)) {
    if (['loc', 'extra', 'start', 'end'].includes(key)) continue;
    if (Array.isArray(value)) value.forEach(child => walk(child, node, file));
    else if (value && typeof value === 'object') walk(value, node, file);
  }
}
for (const file of await files('src')) walk(parse(await readFile(file, 'utf8'), { sourceType: 'module', plugins: ['typescript', 'jsx'] }), null, file);
assert.deepEqual(failures, [], failures.join('\n'));
console.log(`i18n: ${english.length} modules, ${messages} messages, matching keys/parameters and no inline UI translations.`);
