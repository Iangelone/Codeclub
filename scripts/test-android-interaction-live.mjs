/** Harmless local browser fixture for real Android touch, text input and swipe verification. */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import path from 'node:path';
import { createAndroidUse, findAndroidAdb } from '../build/electron/android-use.js';
const execute = promisify(execFile);
const root = path.join(process.env.LOCALAPPDATA || '', 'Codeclub');
const control = createAndroidUse(root);
const adb = await findAndroidAdb(root);
let received = 0;
const server = createServer((_, response) => {
  received++;
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.end('<meta name="viewport" content="width=device-width, initial-scale=1"><title>Codeclub Android QA</title><h1>Codeclub Android test</h1><label>Codeclub test input <input aria-label="Codeclub test input" placeholder="Codeclub test input"></label><div style="height:1800px">Swipe test area</div><p>Codeclub scroll target</p>');
});
let reversed = false;
let port;
try {
  const list = await control.run('list_devices');
  const connected = list.devices?.filter(device => device.state === 'device') || [];
  assert.equal(connected.length, 1, 'Exactly one authorized Android is required.');
  const deviceId = connected[0].deviceId;
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
  await execute(adb, ['reverse', `tcp:${port}`, `tcp:${port}`], { windowsHide: true }); reversed = true;
  await execute(adb, ['shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-p', 'com.android.chrome', '-d', `http://127.0.0.1:${port}`], { windowsHide: true });
  let state = await control.run('get_state', { deviceId });
  assert.equal(state.ok, true, state.error);
  let input;
  for (let attempt = 0; attempt < 4; attempt++) {
    const fixtureVisible = state.elements.some(element => /Codeclub Android test/.test(element.text + element.description));
    input = state.elements.find(element => element.className.endsWith('EditText') && (/Codeclub test input/.test(element.text + element.description) || (fixtureVisible && !element.resourceId)));
    if (input) break;
    state = await control.run('get_state', { deviceId });
  }
  assert.ok(input, `Local fixture input must be observed through Android accessibility (requests=${received}, perception=${state.perception}, nodes=${state.elements.length}, fields=${state.elements.filter(element => element.className.endsWith('EditText')).map(element => element.resourceId).join(',')}).`);
  const act = async request => {
    const result = await control.run('action', { deviceId, snapshotId: state.snapshotId, ...request });
    assert.equal(result.ok, true, result.error); assert.equal(result.dispatched, true);
    state = result.state;
    return result;
  };
  await act({ action: 'tap', ref: input.ref });
  await act({ action: 'type', text: "Codeclub ' & test" });
  assert.ok(state.elements.some(element => element.text.includes("Codeclub ' & test")), 'Literal punctuation and spaces are present in the actual field.');
  await act({ action: 'key', key: 'back' });
  const heading = state.elements.find(element => element.text === 'Codeclub Android test');
  assert.ok(heading, 'Fixture heading remains visible before scrolling.');
  await act({ action: 'tap', ref: heading.ref });
  state = await control.run('get_state', { deviceId });
  const before = JSON.stringify(state.elements.map(element => [element.text, element.bounds]));
  await act({ action: 'swipe', x: Math.floor(state.width / 2), y: Math.floor(state.height * .7), endX: Math.floor(state.width / 2), endY: Math.floor(state.height * .35), durationMs: 500 });
  assert.notEqual(JSON.stringify(state.elements.map(element => [element.text, element.bounds])), before, 'Swipe changes observed content positions.');
  console.log(JSON.stringify({ liveInteraction: 'passed', tap: true, literalTyping: true, swipe: true, localFixtureOnly: true }));
} finally {
  control.stop();
  if (reversed) {
    await execute(adb, ['shell', 'input', 'keyevent', '3'], { windowsHide: true }).catch(() => undefined);
    await execute(adb, ['reverse', '--remove', `tcp:${port}`], { windowsHide: true }).catch(() => undefined);
  }
  server.closeAllConnections();
  if (server.listening) await new Promise(resolve => server.close(resolve));
}
