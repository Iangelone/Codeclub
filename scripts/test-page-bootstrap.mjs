import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { build } from 'esbuild';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = await mkdtemp(path.join(tmpdir(), 'codeclub-page-test-'));
let browser, server;
try {
  const entry = path.join(directory, 'entry.tsx');
  const bundle = path.join(directory, 'app.js');
  await writeFile(entry, `import React from 'react';import {createRoot} from 'react-dom/client';import HomePage from ${JSON.stringify(path.join(repo, 'src/app/page.tsx'))};createRoot(document.getElementById('root')).render(<React.StrictMode><HomePage /></React.StrictMode>);`);
  await build({ entryPoints: [entry], outfile: bundle, bundle: true, jsx: 'automatic', format: 'esm', platform: 'browser', nodePaths: [path.join(repo, 'node_modules')], define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent', plugins: [{
    name: 'isolate-native-children',
    setup(builder) {
      // Exercise the real page's hooks; child native integrations are separate tests.
      builder.onResolve({ filter: /components\/(Topbar|SubTopbar|WorkspaceLayout|FloatingChat)$/ }, args => ({ path: args.path.split('/').at(-1), namespace: 'qa-child' }));
      builder.onLoad({ filter: /.*/, namespace: 'qa-child' }, args => ({ contents: `import React from 'react';export default function Child(){return <div data-qa-child="${args.path}"/>}`, loader: 'jsx', resolveDir: repo }));
    },
  }] });
  server = createServer(async (request, response) => {
    response.setHeader('content-type', request.url === '/app.js' ? 'text/javascript' : 'text/html');
    response.end(request.url === '/app.js' ? await readFile(bundle) : '<html><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => { errors.push(error.message); console.error(error.message); });
  await page.addInitScript(() => {
    window.codeclub = { onMainShow: () => () => {}, windowIsFullScreen: async () => false, onFullscreenChange: callback => { window.qaFullscreen = callback; return () => { delete window.qaFullscreen; }; } };
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  for (const query of ['', '?floating=1', '']) {
    await page.goto(origin + '/' + query);
    await page.locator(`[data-qa-child="${query ? 'FloatingChat' : 'WorkspaceLayout'}"]`).waitFor({ state: 'attached' });
    await page.evaluate(() => window.qaFullscreen(true));
    if (!query) await page.locator('main[data-fullscreen="true"]').waitFor({ state: 'attached' });
    await page.evaluate(() => window.qaFullscreen(false));
    if (!query) await page.locator('main[data-fullscreen="false"]').waitFor({ state: 'attached' });
  }
  assert.deepEqual(errors, [], 'Initial loading and fullscreen updates preserve hook order');
  console.log(JSON.stringify({ passed: true, normalStartup: true, floatingStartup: true, fullscreenUpdates: true }));
} finally {
  await browser?.close();
  await new Promise(resolve => server ? server.close(resolve) : resolve());
  const resolved = path.resolve(directory);
  if (path.dirname(resolved) !== path.resolve(tmpdir()) || !path.basename(resolved).startsWith('codeclub-page-test-')) throw new Error('Unexpected test directory');
  await rm(resolved, { recursive: true, force: true });
}
