import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const bundle = await build({ entryPoints: ['src/lib/browser-dom-picker.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
const { createBrowserPickerScript } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setContent(`<style>body{margin:20px}#scroll{height:200px;overflow:auto;width:90vw}#target{margin-left:15vw;max-width:70%;box-sizing:border-box}button{font:14px Arial}</style><div id="scroll"><div style="height:70px"></div><button id="target" style="width:120px;height:60px;color:rgb(10, 20, 30);border:1px solid black">Original text</button><div style="height:500px"></div></div>`);
  await page.evaluate(() => { window.originalTextNode = document.querySelector('#target').firstChild; });
  const target = page.locator('#target');
  const originalStyle = await target.getAttribute('style');
  const select = async (order = { total: 0, items: [] }) => {
    await page.evaluate(createBrowserPickerScript('', '#3D9BFF', order, 'Quitar referencia'));
    await target.click();
    const selection = await page.evaluate(() => window.__codeclubSelection);
    assert.ok(selection, errors.join('\n') || 'Picker did not capture the clicked node');
    assert.equal(selection.selector, '#target');
    assert.equal(selection.tagName, 'button');
    return selection;
  };
  const first = await select({ total: 2, items: [] });
  const marker = (id) => page.locator(`[data-codeclub-marker-id="${id}"]`);
  const changes = (styles, text) => ({ selector: '#target', styles: Object.fromEntries(Object.entries(styles).map(([key, after]) => [key, { before: first.styles[key], after }])), ...(text === undefined ? {} : { text: { before: first.originalText, after: text } }) });
  const preview = (id, value) => page.evaluate(({ id, value }) => window.__codeclubPreviewCommentMarker(id, value), { id, value });
  const color = () => target.evaluate((element) => getComputedStyle(element).color);
  await marker(first.markerId).waitFor({ state: 'visible' });
  assert.equal(await marker(first.markerId).textContent(), '3');
  assert.equal(await preview(first.markerId, changes({ color: '#ff0000', width: '200px' }, 'Preview text')), true);
  assert.equal(await color(), 'rgb(255, 0, 0)');
  assert.equal(await target.textContent(), 'Preview text');
  assert.equal(await target.evaluate((element) => getComputedStyle(element).width), '200px');
  await page.evaluate((id) => window.__codeclubRollbackCommentMarker(id), first.markerId);
  assert.equal(await target.getAttribute('style'), originalStyle);
  assert.equal(await target.textContent(), 'Original text');
  assert.equal(await page.evaluate(() => window.originalTextNode === document.querySelector('#target').firstChild), true);
  await preview(first.markerId, changes({ width: 'invalid', opacity: '2', 'background-image': 'url(https://invalid.example)' }));
  assert.equal(await target.evaluate((element) => getComputedStyle(element).width), '120px');
  assert.equal(await target.evaluate((element) => getComputedStyle(element).opacity), '1');
  await preview(first.markerId, changes({ color: '#ff0000', width: '200px' }));
  await page.evaluate((id) => {
    window.__codeclubFinalizeCommentMarker(id);
    window.__codeclubSetCommentMarkerOrder({ total: 3, items: [{ markerId: id, number: 3 }] });
    window.__codeclubSetPickerPalette('#39B77C');
  }, first.markerId);
  assert.equal(await marker(first.markerId).evaluate((element) => getComputedStyle(element).backgroundColor), 'rgb(57, 183, 124)');
  await page.setViewportSize({ width: 400, height: 450 });
  await page.waitForFunction((id) => {
    const marker = document.querySelector('[data-codeclub-marker-layer]').shadowRoot.querySelector(`[data-codeclub-marker-id="${id}"]`);
    const target = document.querySelector('#target').getBoundingClientRect();
    return Math.abs(marker.getBoundingClientRect().left - (target.right - 12)) < 2;
  }, first.markerId);
  const scroller = page.locator('#scroll');
  await scroller.evaluate((element) => { element.scrollTop = 400; });
  await marker(first.markerId).waitFor({ state: 'hidden' });
  await scroller.evaluate((element) => { element.scrollTop = 0; });
  await marker(first.markerId).waitFor({ state: 'visible' });
  const second = await select({ total: 3, items: [{ markerId: first.markerId, number: 3 }] });
  await marker(second.markerId).waitFor({ state: 'visible' });
  assert.equal(await marker(second.markerId).textContent(), '4');
  assert.notEqual(await marker(first.markerId).getAttribute('style'), await marker(second.markerId).getAttribute('style'));
  await preview(second.markerId, changes({ color: '#0000ff', width: '220px' }));
  // Removing an earlier edit must preserve the later edit to the same element.
  await marker(first.markerId).click();
  assert.equal(await color(), 'rgb(0, 0, 255)');
  assert.equal(await target.evaluate((element) => getComputedStyle(element).width), '220px');
  const removedFirst = await page.evaluate(() => window.__codeclubTakeCommentMarkerState(null));
  assert.deepEqual(removedFirst.removed, [first.markerId]);
  await page.evaluate((id) => {
    window.__codeclubFinalizeCommentMarker(id);
    window.__codeclubSetCommentMarkerOrder({ total: 1, items: [{ markerId: id, number: 1 }] });
  }, second.markerId);
  assert.equal(await marker(second.markerId).textContent(), '1');
  // Sending the reference retires its badge but keeps the accepted live preview.
  await page.evaluate(() => window.__codeclubSetCommentMarkerOrder({ total: 0, items: [] }));
  assert.equal(await marker(second.markerId).count(), 0);
  assert.equal(await color(), 'rgb(0, 0, 255)');
  const third = await select();
  await preview(third.markerId, changes({ color: '#00ff00' }));
  // Starting a new selection discards the unfinished preview, not the accepted one.
  await page.evaluate(createBrowserPickerScript('', '#9C6AFF', { total: 0, items: [] }, 'Remove reference'));
  assert.equal(await color(), 'rgb(0, 0, 255)');
  assert.equal(await marker(third.markerId).count(), 0);
  await target.click();
  const last = await page.evaluate(() => window.__codeclubSelection);
  await target.evaluate((element) => element.replaceWith(element.cloneNode(true)));
  await page.waitForFunction((id) => !document.querySelector('[data-codeclub-marker-layer]').shadowRoot.querySelector(`[data-codeclub-marker-id="${id}"]`), last.markerId);
  assert.equal(await preview(last.markerId, changes({ color: '#fff' })), false);
  const removed = await page.evaluate((id) => window.__codeclubTakeCommentMarkerState(id), last.markerId);
  assert.equal(removed.active, null);
  assert.ok(removed.removed.includes(last.markerId));
  await page.evaluate(() => window.__codeclubDisposeDomPicker());
  assert.equal(await page.locator('[data-codeclub-marker-layer]').count(), 0);
  assert.deepEqual(errors, []);
  console.log('Browser DOM picker: preview, rollback, overlapping edits, resize, scroll, palette, numbering, send, replaced nodes, cleanup OK');

  // Exercise the real React editor against the same guest runtime, including validation and resize.
  await page.setContent('<button id="target" style="width:120px;color:rgb(10,20,30)">Original text</button><div id="codeclub-right-sidebar" style="position:fixed;top:80px;left:20px;width:360px;height:320px"></div>');
  const editorSelection = await select();
  const stylesheet = await readFile('src/app/globals.css', 'utf8');
  await page.addStyleTag({ content: '*{box-sizing:border-box}' + stylesheet.slice(stylesheet.indexOf('.browser-style-editor {'), stylesheet.indexOf('.browser-reference-remove {')) });
  const editorBundle = await build({ stdin: { contents: `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import BrowserStyleEditor from './src/components/BrowserStyleEditor';
    let root;
    const element = window.__codeclubSelection;
    const preview = async (id, changes) => window.__codeclubPreviewCommentMarker(id, changes);
    window.mountEditor = (language = 'es') => {
      root = createRoot(document.querySelector('#codeclub-right-sidebar'));
      root.render(React.createElement(BrowserStyleEditor, {element, language, onPreview: preview,
        onCancel: () => { root.unmount(); window.__codeclubRollbackCommentMarker(element.markerId); window.cancelled = true; },
        onConfirm: async (changes, description) => { await preview(element.markerId, changes); window.__codeclubFinalizeCommentMarker(element.markerId); window.confirmed = {changes, description}; root.unmount(); }
      }));
    };
    window.mountEditor();
  `, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }, write: false });
  await page.addScriptTag({ content: editorBundle.outputFiles[0].text });
  await page.getByRole('textbox', { name: 'Ancho', exact: true }).fill('210');
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#target')).width === '210px');
  await page.getByRole('textbox', { name: 'Color del texto', exact: true }).fill('#ff0000');
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#target')).color === 'rgb(255, 0, 0)');
  await page.locator('#codeclub-right-sidebar').evaluate((element) => { element.style.width = '204px'; });
  assert.ok(await page.locator('.browser-style-editor').evaluate((element) => element.scrollWidth <= element.clientWidth + 1));
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
  assert.equal(await color(), 'rgb(10, 20, 30)');
  assert.equal(await target.evaluate((element) => getComputedStyle(element).width), '120px');
  await page.evaluate(() => window.mountEditor('en'));
  await page.getByRole('textbox', { name: 'Width', exact: true }).fill('-');
  await page.getByRole('button', { name: 'Add changes to chat', exact: true }).click();
  assert.match(await page.getByRole('alert').textContent(), /Invalid CSS value/);
  await page.getByRole('textbox', { name: 'Width', exact: true }).fill('230');
  await page.getByRole('textbox', { name: 'Text', exact: true }).fill('Updated text');
  await page.getByRole('textbox', { name: 'Describe these changes...', exact: true }).fill('Requested edit');
  await page.getByRole('button', { name: 'Add changes to chat', exact: true }).click();
  const confirmed = await page.evaluate(() => window.confirmed);
  assert.deepEqual(confirmed.changes.styles, { width: { before: editorSelection.styles.width, after: '230px' } });
  assert.deepEqual(confirmed.changes.text, { before: 'Original text', after: 'Updated text' });
  assert.equal(confirmed.description, 'Requested edit');
  assert.equal(await target.textContent(), 'Updated text');
  await page.evaluate(() => window.__codeclubDisposeDomPicker());
  assert.equal(await target.textContent(), 'Original text');
  const navigationSelection = await select();
  await preview(navigationSelection.markerId, changes({ color: '#ff0000' }));
  await page.evaluate((id) => {
    window.__codeclubFinalizeCommentMarker(id);
    window.__codeclubSetCommentMarkerOrder({ total: 0, items: [] });
    location.hash = 'another-route';
  }, navigationSelection.markerId);
  const navigationState = await page.evaluate((id) => window.__codeclubTakeCommentMarkerState(id), navigationSelection.markerId);
  assert.equal(navigationState.active, null);
  assert.ok(navigationState.removed.includes(navigationSelection.markerId));
  assert.equal(await color(), 'rgb(10, 20, 30)');
  await page.evaluate(() => window.__codeclubDisposeDomPicker());
  assert.deepEqual(errors, []);
  console.log('React style editor: live inputs, cancel restoration, narrow width, language switch, CSS validation, exact confirmation payload, SPA navigation OK');
} finally { await browser.close(); }
