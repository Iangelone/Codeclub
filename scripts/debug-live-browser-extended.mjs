import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { spawn } from 'node:child_process';
import { cp, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { BrowserExtensionBridge } from '../electron-dist/browser-extension-bridge.js';
import { ExternalBrowserControl } from '../electron-dist/external-browser.js';

// Explicit manual debugging: controls a connected Edge profile, owns only the tabs it creates.
const bridge = new BrowserExtensionBridge();
const control = new ExternalBrowserControl(bridge);
const owned = [];
let browser;
let original;
let isolatedProcess;
let isolatedExit;
let isolatedProfile;
const server = createServer((_, response) => {
  response.setHeader('content-type', 'text/html; charset=utf-8');
  response.end("<title>Codeclub live debug</title><main>Ready</main><input id=\"entry\" aria-label=\"Debug input\"><button id=\"verify\" onclick=\"document.querySelector('main').textContent='CLICK_OK'\">Verify</button><textarea id=\"multiline\" aria-label=\"Multiline\"></textarea><div id=\"editable\" contenteditable=\"true\" role=\"textbox\">Editable</div><input id=\"readonly\" readonly value=\"READ_ONLY\"><input id=\"disabled\" disabled value=\"DISABLED\"><input id=\"password\" type=\"password\" value=\"fixture_secret_do_not_expose\" aria-label=\"Password\"><input id=\"hidden\" style=\"display:none\" value=\"HIDDEN_VALUE\"><input id=\"checkbox\" type=\"checkbox\" onchange=\"document.querySelector('main').textContent=this.checked?'CHECKED':'UNCHECKED'\"><input id=\"radio1\" type=\"radio\" name=\"choice\" value=\"one\"><input id=\"radio2\" type=\"radio\" name=\"choice\" value=\"two\" onchange=\"document.querySelector('main').textContent='RADIO_TWO'\"><select id=\"select\" onchange=\"document.querySelector('main').textContent='SELECT_'+this.value\"><option value=\"a\">Alpha</option><option value=\"b\">Beta</option></select><a id=\"link\" href=\"/second\">Local navigation</a><form action=\"/submitted\"><input id=\"forminput\" name=\"q\"><button id=\"submit\" type=\"submit\">Submit locally</button></form><button id=\"dynamic\" onclick=\"document.querySelector('main').textContent='DYNAMIC_OK';this.remove()\">Remove self</button><pre id=\"diagnostics\"></pre><script>let frames=0;const frame=()=>{frames++;requestAnimationFrame(frame)};requestAnimationFrame(frame);let events=[];for(const name of [\"click\",\"keydown\",\"input\"])document.addEventListener(name,e=>{events.push({type:e.type,id:e.target.id,key:e.key,trusted:e.isTrusted});events=events.slice(-6)});setInterval(()=>document.querySelector(\"#diagnostics\").textContent=JSON.stringify({frames,hidden:document.hidden,viewport:[innerWidth,innerHeight],focus:document.hasFocus(),active:document.activeElement?.id,start:document.querySelector(\"#entry\").selectionStart,end:document.querySelector(\"#entry\").selectionEnd,checked:document.querySelector(\"#checkbox\").checked,events}),100)</script><div style=\"height:2000px\">Scroll fixture</div>");
});
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  assert(await bridge.start(), 'Bridge unavailable');
  const url = `http://127.0.0.1:${server.address().port}/`;
  const isolatedUrl = `${url}?isolated-profile`;
  if (process.env.CODECLUB_DEBUG_ISOLATED_EXECUTABLE) {
    isolatedProfile = await mkdtemp(path.join(tmpdir(), 'codeclub-extended-test-'));
    const extension = path.join(isolatedProfile, 'extension');
    await cp(path.resolve('browser-extension'), extension, { recursive: true });
    const worker = path.join(extension, 'service-worker.js');
    await writeFile(worker, (await readFile(worker, 'utf8')).replace(
      'const BRIDGE_PORTS = Array.from({ length: 11 }, (_, index) => 47832 + index);',
      `const BRIDGE_PORTS = [${bridge.server.address().port}];`));
    isolatedProcess = spawn(process.env.CODECLUB_DEBUG_ISOLATED_EXECUTABLE, [
      '--headless=new', '--no-first-run', '--no-default-browser-check',
      `--user-data-dir=${isolatedProfile}`, `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`, isolatedUrl,
    ], { windowsHide: true, stdio: 'ignore' });
    isolatedExit = new Promise(resolve => isolatedProcess.once('exit', resolve));
  }
  console.log('Waiting for Edge companion...');
  const until = Date.now() + 75000;
  while (Date.now() < until) {
    const listed = await control.list({ ports: [] });
    browser = listed.browsers.find(item => item.name === 'Microsoft Edge' && item.connection === 'extension'
      && (!isolatedProcess || item.targets.some(tab => tab.url === isolatedUrl)));
    if (browser?.targets.length) break;
    await delay(1000);
  }
  assert(browser?.targets.length, 'No connected Edge companion');
  console.log(JSON.stringify({ extensionId: browser.extensionId, isolated: Boolean(isolatedProcess) }));
  original = browser.targets.find(tab => tab.active) || browser.targets[0];
  const manage = async input => {
    const result = await control.manageTabs({ browserId: browser.browserId, ...input });
    assert.equal(result.ok, true, result.error);
    console.log(JSON.stringify({ operation: input.action, ok: result.ok }));
    return result;
  };
  await manage({ action: 'listGroups' });
  for (let index = 0; index < 3; index++) {
    const created = await manage({ action: 'create', windowId: original.windowId, url: `${url}?tab=${index}`, active: false });
    owned.push(created.result.targetId);
  }
  for (const targetId of owned) {
    const result = await manage({ action: 'activate', targetId });
    assert(result.tabs.find(tab => tab.targetId === targetId)?.active);
  }
  await manage({ action: 'update', targetId: owned[0], pinned: true, muted: true });
  await manage({ action: 'update', targetId: owned[0], pinned: false, muted: false });
  await manage({ action: 'move', targetId: owned[2], index: -1 });
  const grouped = await manage({ action: 'group', targetIds: owned });
  const groupId = grouped.result.groupId;
  assert(owned.every(id => grouped.tabs.find(tab => tab.targetId === id)?.groupId === groupId));
  await manage({ action: 'updateGroup', groupId, title: 'Codeclub · prueba directa', color: 'blue' });
  await manage({ action: 'activate', targetId: original.targetId });
  await manage({ action: 'updateGroup', groupId, collapsed: true });
  const groups = await manage({ action: 'listGroups' });
  assert(groups.result.some(group => group.id === groupId && group.collapsed && group.color === 'blue'));
  await manage({ action: 'updateGroup', groupId, collapsed: false, color: 'green' });
  await manage({ action: 'activate', targetId: owned[0] });
  let observed = await control.getState({ browserId: browser.browserId, targetId: owned[0] });
  assert(observed.ok, observed.error);
  const act = async (action, extra = {}) => {
    const result = await control.action({ browserId: browser.browserId, targetId: owned[0], snapshotId: observed.snapshotId, action, ...extra });
    assert(result.ok, result.error); observed = result.state;
    if (process.env.CODECLUB_DEBUG_SETTLE === '1') {
      await delay(300);
      observed = await control.getState({ browserId: browser.browserId, targetId: owned[0] });
      assert(observed.ok, observed.error);
    }
    console.log(JSON.stringify({ operation: `DOM:${action}`, ok: result.ok }));
  };
  const entry = observed.elements.find(element => element.selector === '#entry');
  assert(entry, 'Input missing');
  await act('type', { selector: entry.selector, text: 'Prueba Unicode: diseño ✓' });
  console.log(JSON.stringify({ unicodeInput: observed.elements.find(element => element.selector === '#entry')?.value, expected: 'Prueba Unicode: diseño ✓' }));
  assert(observed.elements.some(element => element.value === 'Prueba Unicode: diseño ✓'));
  await act('key', { selector: '#entry', key: 'Control+A' });
  await act('click', { selector: '#verify' });
  console.log(JSON.stringify({ baselineClickText: observed.text.slice(0, 120) }));
  const checks = [];
  const check = async (name, fn) => {
    try { await fn(); checks.push({ name, passed: true }); }
    catch (error) { checks.push({ name, passed: false, error: error.message, diagnostics: observed.text.slice(-1300) }); }
    console.log(JSON.stringify(checks.at(-1)));
  };
  const reset = async () => {
    await act('navigate', { text: url });
    observed = await control.getState({ browserId: browser.browserId, targetId: owned[0] });
    assert(observed.ok, observed.error);
  };
  const reject = async extra => {
    const result = await control.action({ browserId: browser.browserId, targetId: owned[0], snapshotId: observed.snapshotId, ...extra });
    assert.equal(result.ok, false, 'Invalid operation must not report success');
    observed = await control.getState({ browserId: browser.browserId, targetId: owned[0] });
  };
  await check('password redaction and hidden fields', async () => {
    assert(!JSON.stringify(observed).includes('fixture_secret_do_not_expose'));
    assert(!observed.elements.some(element => element.selector === '#hidden'));
  });
  await check('replace selected input', async () => {
    await act('key', { selector: '#entry', key: 'Control+A' });
    await act('type', { selector: '#entry', text: 'REPLACED' });
    assert.equal(observed.elements.find(element => element.selector === '#entry').value, 'REPLACED');
  });
  await check('textarea preserves multiline and spaces', async () => {
    await act('type', { selector: '#multiline', text: 'first  line\nsecond line' });
    assert.equal(observed.elements.find(element => element.selector === '#multiline').value, 'first  line\nsecond line');
  });
  await check('contenteditable typing', async () => {
    await act('key', { selector: '#editable', key: 'Control+A' });
    await act('type', { selector: '#editable', text: 'EDITABLE_OK' });
    assert(observed.elements.find(element => element.selector === '#editable').text.includes('EDITABLE_OK'));
  });
  await check('readonly typing rejected', () => reject({ action: 'type', selector: '#readonly', text: 'BAD' }));
  await check('readonly click remains usable', () => act('click', { selector: '#readonly' }));
  await check('disabled input rejected', () => reject({ action: 'type', selector: '#disabled', text: 'BAD' }));
  await check('checkbox toggles', async () => {
    await act('click', { selector: '#checkbox' }); assert(observed.text.includes('CHECKED'));
    await act('click', { selector: '#checkbox' }); assert(observed.text.includes('UNCHECKED'));
  });
  await check('radio selection', async () => { await act('click', { selector: '#radio2' }); assert(observed.text.includes('RADIO_TWO')); });
  await check('select with keyboard', async () => {
    await act('key', { selector: '#select', key: 'ArrowDown' });
    await act('key', { selector: '#select', key: 'Tab' });
    assert.equal(observed.elements.find(element => element.selector === '#select').value, 'b');
  });
  await check('dynamic element removed after click', async () => {
    await act('click', { selector: '#dynamic' });
    assert(observed.text.includes('DYNAMIC_OK'));
    assert(!observed.elements.some(element => element.selector === '#dynamic'));
  });
  await check('unobserved selector rejected', () => reject({ action: 'click', selector: '#invented' }));
  await check('invalid key rejected', () => reject({ action: 'key', selector: '#entry', key: 'InventedKey' }));
  await check('zero scroll rejected', () => reject({ action: 'scroll', amount: 0 }));
  await check('invalid URL rejected', () => reject({ action: 'navigate', text: 'javascript:void(0)' }));
  await check('snapshot cannot target another tab', async () => {
    const result = await control.action({ browserId: browser.browserId, targetId: owned[1], snapshotId: observed.snapshotId, action: 'scroll', amount: -100 });
    assert.equal(result.ok, false);
  });
  await check('consumed snapshot rejected', async () => {
    const snapshotId = observed.snapshotId;
    await act('click', { selector: '#verify' });
    const result = await control.action({ browserId: browser.browserId, targetId: owned[0], snapshotId, action: 'click', selector: '#verify' });
    assert.equal(result.ok, false);
  });
  await check('local link navigation', async () => {
    await act('click', { selector: '#link' });
    await delay(300);
    observed = await control.getState({ browserId: browser.browserId, targetId: owned[0] });
    assert(observed.url.endsWith('/second'));
  });
  await reset();
  await check('local form submission', async () => {
    await act('type', { selector: '#forminput', text: 'fixture value' });
    await act('click', { selector: '#submit' });
    await delay(300);
    observed = await control.getState({ browserId: browser.browserId, targetId: owned[0] });
    assert(observed.url.includes('/submitted?q=fixture'));
  });
  await reset();
  await check('unsupported tab action rejected', async () => {
    const result = await control.manageTabs({ browserId: browser.browserId, action: 'invented' }); assert.equal(result.ok, false);
  });
  await check('missing tab ID rejected', async () => {
    const result = await control.manageTabs({ browserId: browser.browserId, action: 'activate' }); assert.equal(result.ok, false);
  });
  await check('invalid group ID rejected', async () => {
    const result = await control.manageTabs({ browserId: browser.browserId, action: 'updateGroup', groupId: -2, title: 'invalid' }); assert.equal(result.ok, false);
  });
  console.log(JSON.stringify({ extendedChecks: checks.length, passed: checks.filter(check => check.passed).length, failures: checks.filter(check => !check.passed) }));
  if (checks.some(check => !check.passed)) process.exitCode = 1;
  await act('scroll', { amount: -400 });
  await act('navigate', { text: `${url}?navigated` });
  assert(observed.url.includes('?navigated'));
  await manage({ action: 'reload', targetId: owned[0] });
  const ungrouped = await manage({ action: 'ungroup', targetIds: owned });
  assert(owned.every(id => ungrouped.tabs.find(tab => tab.targetId === id)?.groupId === -1));
  console.log('Live Edge baseline passed; see extended check results above. No model calls.');
} finally {
  if (browser) {
    if (owned.length) {
      const closed = await control.manageTabs({ browserId: browser.browserId, action: 'close', targetIds: owned });
      console.log(JSON.stringify({ cleanup: closed.ok, onlyOwnedTabs: owned.length, error: closed.error }));
    }
    if (original) await control.manageTabs({ browserId: browser.browserId, action: 'activate', targetId: original.targetId });
  }
  bridge.stop();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  if (isolatedProcess) {
    isolatedProcess.kill();
    await Promise.race([isolatedExit, delay(5000)]);
  }
  if (isolatedProfile) {
    const resolved = path.resolve(isolatedProfile);
    assert.equal(path.dirname(resolved), path.resolve(tmpdir()));
    assert(path.basename(resolved).startsWith('codeclub-extended-test-'));
    await rm(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
  }
}
