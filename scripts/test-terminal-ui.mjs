import assert from 'node:assert/strict';
import { _electron as electron } from '@playwright/test';
import { build } from 'esbuild';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = await mkdtemp(path.join(tmpdir(), 'codeclub-terminal-ui-'));
let app, server;
try {
  // Exercise the actual panel in isolation, with the production preload and PTY.
  const source = await readFile(path.join(repo, 'src/components/WorkspaceLayout.tsx'), 'utf8');
  const panel = source.slice(source.indexOf('type TerminalInfo ='), source.indexOf('function ChatSessionStatus('));
  assert.ok(panel.includes('function TerminalPanel('));
  const entry = path.join(directory, 'entry.tsx');
  const bundle = path.join(directory, 'app.js');
  await writeFile(entry, `
    import React, {useEffect,useRef,useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import {Terminal as XtermTerminal} from '@xterm/xterm';
    import {FitAddon} from '@xterm/addon-fit';
    import '@xterm/xterm/css/xterm.css';
    import {nativeInvoke,onTerminalOutput} from ${JSON.stringify(path.join(repo, 'src/lib/runtime.ts'))};
    import {useAppLanguage,rightSidebarTranslations} from ${JSON.stringify(path.join(repo, 'src/lib/i18n.ts'))};
    ${panel}
    function Fixture() {
      const [visible,setVisible]=useState(true);
      return <><button onClick={()=>setVisible(v=>!v)}>Toggle</button>
        <div style={{width:300,height:580,display:visible?'block':'none'}}>
          <TerminalPanel projectPath={${JSON.stringify(directory)}} instanceId="qa-terminal" visible={visible}/>
        </div></>;
    }
    createRoot(document.getElementById('root')!).render(<Fixture/>);
  `);
  await build({entryPoints:[entry],outfile:bundle,bundle:true,format:'esm',platform:'browser',target:'es2022',nodePaths:[path.join(repo,'node_modules')],define:{'process.env.NODE_ENV':'"production"'},logLevel:'silent'});
  server = createServer(async (request, response) => {
    if (request.url === '/app.js' || request.url === '/app.css') {
      response.setHeader('content-type', request.url.endsWith('.css') ? 'text/css' : 'text/javascript');
      response.end(await readFile(path.join(directory, request.url.slice(1))));
    } else {
      response.setHeader('content-type','text/html');
      response.end('<link rel="stylesheet" href="/app.css"><div id="root"></div><script type="module" src="/app.js"></script>');
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const wrapper = path.join(directory, 'main.mjs');
  await writeFile(wrapper, `import {app,BrowserWindow,ipcMain} from 'electron';app.setPath('userData',${JSON.stringify(path.join(directory,'profile'))});for(const method of ['show','showInactive','focus','maximize'])BrowserWindow.prototype[method]=function(){};globalThis.qaSnapshots=0;const handle=ipcMain.handle.bind(ipcMain);ipcMain.handle=(channel,listener)=>handle(channel,(event,...args)=>{if(channel==='native:invoke'&&args[0]?.command==='codeclub_terminal_snapshot')globalThis.qaSnapshots++;return listener(event,...args);});await import(${JSON.stringify(new URL('../electron-dist/main.js',import.meta.url).href)});`);
  const env = {...process.env,CODECLUB_NEXT_DEV_URL:`http://127.0.0.1:${server.address().port}`};
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({args:[wrapper],env});
  const page = await app.firstWindow();
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => document.querySelector('.xterm-rows')?.textContent.includes('>'));
  await page.evaluate(() => {
    window.qaTitles = [];
    window.addEventListener('codeclub:terminal-tab-meta', event => window.qaTitles.push(event.detail));
  });
  await page.waitForTimeout(350);
  const snapshots = () => app.evaluate(() => globalThis.qaSnapshots);
  const idle = await snapshots();
  await page.waitForTimeout(350);
  assert.equal(await snapshots(), idle, 'Idle terminal must not poll');
  const input = page.locator('.xterm-helper-textarea');
  await input.focus();
  await page.keyboard.type('echo TERMINAL_EVENT_OK');
  assert.deepEqual(await page.evaluate(() => window.qaTitles), [], 'Typing must not rename the tab per keystroke');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('.xterm-rows')?.textContent.split('TERMINAL_EVENT_OK').length >= 3);
  await page.waitForFunction(() => window.qaTitles.at(-1)?.title === 'echo TERMINAL_EVENT_OK').catch(async error => {
    console.error(await page.evaluate(() => ({titles:window.qaTitles, output:document.querySelector('.xterm-rows')?.textContent})));
    throw error;
  });
  assert.equal(await page.evaluate(() => window.qaTitles.at(-1).instanceId), 'qa-terminal');
  assert.ok(await snapshots() > idle, 'PTY output must request snapshots');
  await input.focus();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Control+c');
  await page.getByRole('button', {name:'Toggle'}).click();
  await page.evaluate(async () => {
    const sessions = await window.codeclub.invoke('codeclub_terminal_list');
    const session = sessions[0];
    await window.codeclub.invoke('codeclub_terminal_write',{id:session.id,data:'echo HIDDEN_OUTPUT_OK\r'});
  });
  await page.waitForTimeout(350);
  const hidden = await snapshots();
  await page.waitForTimeout(350);
  assert.equal(await snapshots(), hidden, 'Hidden terminal must not poll');
  await page.getByRole('button', {name:'Toggle'}).click();
  await page.waitForFunction(() => document.querySelector('.xterm-rows')?.textContent.includes('HIDDEN_OUTPUT_OK'));
  await page.waitForFunction(() => window.qaTitles.at(-1)?.title === 'echo HIDDEN_OUTPUT_OK').catch(async error => {
    console.error(await page.evaluate(() => ({titles:window.qaTitles, output:document.querySelector('.xterm-rows')?.textContent})));
    throw error;
  });
  assert.deepEqual(errors, []);
  console.log('Terminal UI: real PTY typing, event-driven output, idle/hidden panels and visibility catch-up passed.');
} finally {
  await app?.close();
  if (server) await new Promise(resolve => server.close(resolve));
  const resolved = path.resolve(directory);
  assert.ok(path.dirname(resolved) === path.resolve(tmpdir()) && path.basename(resolved).startsWith('codeclub-terminal-ui-'));
  await rm(resolved, {recursive:true,force:true});
}
