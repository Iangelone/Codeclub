import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { build } from 'esbuild';
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = await mkdtemp(path.join(tmpdir(), 'codeclub-extensions-layout-'));
let browser, server;
try {
  const entry = path.join(directory, 'entry.tsx');
  const bundle = path.join(directory, 'app.js');
  await writeFile(entry, `import React from 'react';import {createRoot} from 'react-dom/client';import ExtensionsPanel from ${JSON.stringify(path.join(repo,'src/components/ExtensionsPanel.tsx'))};createRoot(document.getElementById('root')!).render(<ExtensionsPanel selectedProject={{projectPath:'C:/projects/Very long project name for responsive layout'}}/>);`);
  await build({entryPoints:[entry],outfile:bundle,bundle:true,format:'esm',platform:'browser',target:'es2022',nodePaths:[path.join(repo,'node_modules')],define:{'process.env.NODE_ENV':'"production"'},logLevel:'silent'});
  const cssRoot = path.join(repo,'out/_next/static/chunks');
  const css = (await Promise.all((await readdir(cssRoot)).filter(file=>file.endsWith('.css')).map(file=>readFile(path.join(cssRoot,file),'utf8')))).join('\n');
  server = createServer(async (request,response) => {
    if(request.url === '/app.js') {response.setHeader('content-type','text/javascript');response.end(await readFile(bundle));return;}
    if(request.url === '/style.css') {response.setHeader('content-type','text/css');response.end(css);return;}
    response.setHeader('content-type','text/html');
    response.end('<link rel="stylesheet" href="/style.css"><style>body{margin:0}#root{width:var(--panel-width,320px);height:900px}</style><div id="root"></div><script type="module" src="/app.js"></script>');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  browser = await chromium.launch({channel:'msedge',headless:true});
  const page = await browser.newPage({viewport:{width:1400,height:1000}});
  const errors = [];
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(() => {
    window.qaActions = [];
    window.codeclub = {invoke:async (command,args) => {
      if(command === 'codeclub_browser_extension_info') return {browsers:[{id:'edge',name:'Microsoft Edge',installed:true,connected:false},{id:'chrome',name:'Google Chrome',installed:true,connected:true}]};
      if(command === 'codeclub_browser_extension_manage') {window.qaActions.push(args);return true;}
      if(command === 'codeclub_list_agent_plugins') return [{id:'qa',name:'Very long plugin source name for layout',description:'Plugin description',scope:'project',skills:[{id:'qa-skill',name:'Responsive skill',description:'Skill description',scope:'project'}],mcpServers:{qa:{type:'stdio',command:'qa'}}}];
      return null;
    }};
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByRole('button',{name:'Instalar: Microsoft Edge',exact:true}).waitFor();
  const checkLayout = async () => {
    const failures = await page.evaluate(() => {
      const root = document.querySelector('#codeclub-extensions-panel');
      const bounds = root.getBoundingClientRect();
      const issues = [];
      for(const node of root.querySelectorAll('nav,button,input,h2,.extensions-browser-row,.extensions-source')) {
        const box = node.getBoundingClientRect();
        if(box.width && (box.left < bounds.left-1 || box.right > bounds.right+1)) issues.push(`${node.tagName} escapes panel`);
        if(node.matches('h2') && box.width < 45) issues.push('Extension name has too little room');
      }
      for(const row of root.querySelectorAll('.extensions-browser-row')) {
        const [info,actions] = row.children;
        if(info.getBoundingClientRect().right > actions.getBoundingClientRect().left) issues.push('Browser status overlaps actions');
      }
      return issues;
    });
    assert.deepEqual(failures,[]);
  };
  for(const language of ['es','en']) {
    await page.evaluate(language=>{localStorage.setItem('codeclub-language',language);window.dispatchEvent(new CustomEvent('codeclub:language-change',{detail:{language}}));},language);
    for(const width of [280,320,400,480,540,640,1040]) {
      await page.evaluate(width=>document.documentElement.style.setProperty('--panel-width',`${width}px`),width);
      await page.getByRole('tab').first().click();
      await checkLayout();
      const compact = await page.locator('.extensions-category-label').first().evaluate(node=>getComputedStyle(node).display==='none');
      assert.equal(compact,width<=480,`Container width ${width} must select the right layout on a wide window`);
      for(const index of [1,2]) {await page.getByRole('tab').nth(index).click();await checkLayout();}
    }
  }
  await page.getByRole('tab').first().click();
  await page.getByRole('button',{name:'Install: Microsoft Edge',exact:true}).click();
  assert.deepEqual(await page.evaluate(()=>window.qaActions),[{browser:'edge',action:'install'}]);
  if(process.env.CODECLUB_QA_SCREENSHOT) {
    await page.evaluate(()=>document.documentElement.style.setProperty('--panel-width','320px'));
    await page.locator('#codeclub-extensions-panel').screenshot({path:process.env.CODECLUB_QA_SCREENSHOT});
  }
  assert.deepEqual(errors,[]);
  console.log('Extensions: 280–1040px container widths, Spanish/English, three tabs, accessible actions and no overlapping controls passed.');
} finally {
  await browser?.close();
  if(server) await new Promise(resolve=>server.close(resolve));
  const resolved = path.resolve(directory);
  assert.ok(path.dirname(resolved) === path.resolve(tmpdir()) && path.basename(resolved).startsWith('codeclub-extensions-layout-'));
  await rm(resolved,{recursive:true,force:true});
}
