import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { createServer } from 'node:http';
import { ComputerUse, DesktopHost } from '../electron-dist/computer-use.js';

// Opt-in real desktop test. It only types/clicks in this disposable fixture.
const child = spawn('powershell.exe', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', path.resolve('scripts/fixtures/computer-use.ps1')], { windowsHide: true, stdio: 'pipe' });
const host = new DesktopHost(path.resolve('electron/computer-use.ps1'));
const engine = new ComputerUse(host.call, path.resolve('public/tesseract'));
let parserServer;
const originalParserUrl = process.env.CODECLUB_OMNIPARSER_URL;
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Fixture startup timeout')), 15000);
    const lines = createInterface({ input: child.stdout });
    lines.on('line', (line) => { if (line === 'READY') { clearTimeout(timer); lines.close(); resolve(); } });
    child.on('error', reject); child.stderr.on('data', (data) => { clearTimeout(timer); reject(new Error(data.toString())); });
  });
  const windows = await engine.run('windows');
  const fixture = windows.windows.find((w) => w.name === 'Codeclub Computer Use Fixture');
  assert.ok(fixture, JSON.stringify(windows));
  let result = await engine.run('action', { action: 'focus', windowId: fixture.windowId });
  assert.equal(result.ok, true, JSON.stringify(result));
  let state = result.state;
  const act = async (action, name, extra = {}) => {
    const element = state.elements.find((el) => el.name === name);
    assert.ok(element, `Missing ${name}: ${JSON.stringify(state)}`);
    result = await engine.run('action', { action, snapshotId: state.snapshotId, ref: element.ref, ...extra });
    assert.equal(result.ok, true, JSON.stringify(result)); state = result.state;
    return result;
  };
  assert.ok(!JSON.stringify(state).includes('never-expose-this'), 'Password leaked');
  await act('setValue', 'Fixture input', { text: 'Hola áé +^%{}' });
  assert.equal(result.verification.verified, true);
  await act('click', 'Apply fixture');
  assert.ok(state.elements.some((el) => el.name === 'Fixture result' && (el.text?.includes('Hola') || el.value?.includes('Hola'))) || JSON.stringify(state).includes('Applied: Hola'), 'Button did not apply input');
  await act('toggle', 'Fixture toggle');
  assert.equal(result.verification.verified, true);
  await act('focus', 'Fixture input');
  await act('key', 'Fixture input', { key: '^a' });
  await act('type', 'Fixture input', { text: 'Literal +^%{} ñ 😀' });
  assert.equal(state.elements.find((el) => el.name === 'Fixture input').value, 'Literal +^%{} ñ 😀');
  const canvas = state.elements.find((el) => el.role === 'Image');
  const ocr = await engine.run('ocr', { windowId: fixture.windowId, region: canvas.bounds });
  assert.equal(ocr.ocr?.ok, true, JSON.stringify(ocr));
  assert.ok(ocr.ocr.text.includes('CANVAS'), JSON.stringify(ocr.ocr));
  assert.ok(!JSON.stringify(ocr).includes('base64'));
  const candidate = ocr.elements.find((el) => el.source === 'ocr' && el.name.includes('CANVAS'));
  assert.ok(candidate, 'No OCR actionable region');
  result = await engine.run('action', { action: 'click', snapshotId: ocr.snapshotId, ref: candidate.ref });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.ok(JSON.stringify(result.state).includes('Canvas clicked'), 'OCR click did not reach the fixture canvas');
  // Exercise the official /parse/ transport contract without downloading model weights.
  parserServer = createServer((request, response) => {
    assert.equal(request.url, '/parse/'); assert.equal(request.method, 'POST');
    let body = ''; request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      assert.ok(JSON.parse(body).base64_image);
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ som_image_base64: 'must-not-reach-model', parsed_content_list: [{ type: 'icon', content: 'Fixture icon', interactivity: true, bbox: [0.1, 0.1, 0.9, 0.9] }] }));
    });
  });
  await new Promise((resolve) => parserServer.listen(0, '127.0.0.1', resolve));
  process.env.CODECLUB_OMNIPARSER_URL = `http://127.0.0.1:${parserServer.address().port}`;
  const parsed = await engine.run('ocr', { windowId: fixture.windowId, region: canvas.bounds, engine: 'omniparser' });
  assert.equal(parsed.ocr?.ok, true, JSON.stringify(parsed));
  assert.ok(parsed.elements.some((el) => el.role === 'IconCandidate'));
  assert.ok(!JSON.stringify(parsed).includes('must-not-reach-model'));
  console.log('PASS: UIA discovery, semantic write/invoke/toggle, focus, literal Unicode input, password masking, native OCR, verified canvas click, and local parser HTTP contract (stub, not model inference).');
} finally {
  if (originalParserUrl === undefined) delete process.env.CODECLUB_OMNIPARSER_URL; else process.env.CODECLUB_OMNIPARSER_URL = originalParserUrl;
  parserServer?.closeAllConnections(); parserServer?.close(); engine.stop(); host.stop(); child.kill();
}
