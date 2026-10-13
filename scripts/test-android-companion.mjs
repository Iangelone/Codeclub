/** Native transport checks against a real TLS/WebSocket server in an isolated encrypted store. */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { request as httpsRequest } from 'node:https';
import { randomBytes, createCipheriv, createDecipheriv, X509Certificate } from 'node:crypto';
import { WebSocket } from 'ws';
import { once } from 'node:events';
import { AndroidCompanion } from '../build/electron/android-companion.js';
import { createAndroidUse } from '../build/electron/android-use.js';

const directory = await mkdtemp(path.join(tmpdir(), 'codeclub-companion-'));
const key = randomBytes(32);
const crypto = {
  isEncryptionAvailable: () => true,
  encryptString(value) { const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv); const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), data]); },
  decryptString(value) { const cipher = createDecipheriv('aes-256-gcm', key, value.subarray(0, 12)); cipher.setAuthTag(value.subarray(12, 28)); return Buffer.concat([cipher.update(value.subarray(28)), cipher.final()]).toString(); },
};
let hub = new AndroidCompanion(directory, crypto), socket;
const decode = offer => JSON.parse(Buffer.from(offer.code.slice(4), 'base64url').toString());
const post = (data, body, certificate) => new Promise((resolve, reject) => {
  const request = httpsRequest({ hostname: '127.0.0.1', port: data.port, path: '/pair', method: 'POST', ca: certificate, checkServerIdentity: (_, cert) => cert.fingerprint256.replaceAll(':', '').toLowerCase() === data.fingerprint ? undefined : new Error('Certificate mismatch') }, response => { let value = ''; response.on('data', chunk => value += chunk); response.on('end', () => resolve({ status: response.statusCode, body: value ? JSON.parse(value) : null })); });
  request.on('error', reject); request.end(JSON.stringify(body));
});
try {
  const first = await hub.offer(1), second = await hub.offer(2), data = decode(first);
  const saved = JSON.parse(crypto.decryptString(Buffer.from(await readFile(path.join(directory, 'android-companion.encrypted.json'), 'utf8'), 'base64')));
  assert.equal(new X509Certificate(saved.cert).fingerprint256.replaceAll(':', '').toLowerCase(), data.fingerprint);
  const body = { pairId: data.pairId, token: data.token, deviceId: 'fixture-android-device' };
  assert.equal((await post(data, { ...body, token: 'incorrect' }, saved.cert)).status, 401);
  assert.equal((await post(data, { ...body, token: 'é'.repeat(data.token.length) }, saved.cert)).status, 401, 'Unicode tokens never crash constant-time comparisons');
  const paired = await post(data, body, saved.cert); assert.equal(paired.status, 200);
  assert.equal(hub.offerPaired(first.pairId, 1), true); assert.equal(hub.offerPaired(first.pairId, 2), false);
  assert.equal((await post(data, body, saved.cert)).status, 401, 'Pairing codes are single use');
  hub.cancelOffers(2); assert.equal((await post(decode(second), { ...body, pairId: second.pairId, token: decode(second).token }, saved.cert)).status, 401);
  assert.equal((await readFile(path.join(directory, 'android-companion.encrypted.json'), 'utf8')).includes(paired.body.secret), false, 'Pairing secrets are encrypted at rest');
  const id = `companion:${body.deviceId}`;
  const tls = { ca: saved.cert, checkServerIdentity: (_, cert) => cert.fingerprint256.replaceAll(':', '').toLowerCase() === data.fingerprint ? undefined : new Error('Certificate mismatch') };
  const unauthorized = new WebSocket(`wss://127.0.0.1:${data.port}/device`, { ...tls, headers: { 'x-codeclub-device': body.deviceId, Authorization: 'Bearer wrong' } });
  unauthorized.on('error', () => undefined);
  const [, response] = await once(unauthorized, 'unexpected-response'); assert.equal(response.statusCode, 401); unauthorized.terminate();
  socket = new WebSocket(`wss://127.0.0.1:${data.port}/device`, { ...tls, headers: { 'x-codeclub-device': body.deviceId, Authorization: `Bearer ${paired.body.secret}` } });
  await once(socket, 'open'); socket.send(JSON.stringify({ type: 'hello', v: 1, permissions: { accessibility: true, paused: false } }));
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(hub.status()[0].state, 'device');
  let snapshots = 0, actions = 0, cancelled = false;
  socket.on('message', bytes => {
    const command = JSON.parse(bytes);
    if (command.type === 'cancel') { cancelled = true; return; }
    if (command.request.wait) return;
    if (command.operation === 'action') actions++;
    socket.send(JSON.stringify({ type: 'result', id: command.id, result: command.operation === 'unlock' ? { ok: true, unlocked: true, alreadyUnlocked: true } : { ok: true, snapshotId: `fixture-${++snapshots}`, elements: [] } }));
  });
  let pinPrompts = 0;
  const control = createAndroidUse('unused', async () => { pinPrompts++; return '1234'; }, hub);
  const other = createAndroidUse('unused', undefined, hub);
  const observation = await control.run('get_state', { deviceId: id });
  assert.equal(observation.ok, true);
  const denied = await other.run('action', { deviceId: id, snapshotId: observation.snapshotId, action: 'key', key: 'home' });
  assert.equal(denied.ok, false); assert.equal(actions, 0, 'Renderer observations cannot be borrowed');
  assert.equal((await control.run('action', { deviceId: id, snapshotId: observation.snapshotId, action: 'key', key: 'home' })).ok, true);
  assert.equal((await control.run('unlock', { deviceId: id })).alreadyUnlocked, true); assert.equal(pinPrompts, 0, 'An unlocked phone never asks for a secret');
  const abort = new AbortController(); const pending = hub.run('action', { deviceId: id, wait: true }, abort.signal);
  setTimeout(() => abort.abort(), 30); const aborted = await pending;
  assert.equal(aborted.ok, false); assert.equal(aborted.dispatched, true);
  await new Promise(resolve => setTimeout(resolve, 25)); assert.equal(cancelled, true);
  hub.forget(id); await once(socket, 'close'); assert.equal(hub.has(id), false);
  hub.close(); await new Promise(resolve => setTimeout(resolve, 50));
  hub = new AndroidCompanion(directory, crypto); await hub.resume();
  const resumed = decode(await hub.offer(1)); assert.equal(resumed.port, data.port); assert.equal(resumed.fingerprint, data.fingerprint, 'Desktop identity persists across restart');
  const now = Date.now; Date.now = () => now() + 200000;
  try { assert.equal((await post(resumed, { ...body, pairId: resumed.pairId, token: resumed.token }, saved.cert)).status, 401); } finally { Date.now = now; }
  console.log('Android companion passed: pinned TLS identity, single-use/expired codes, encrypted storage, unauthorized sockets, renderer isolation, cancellation, revocation and restart.');
} finally {
  socket?.terminate(); hub.close();
  assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()));
  assert.ok(path.basename(directory).startsWith('codeclub-companion-'));
  await rm(directory, { recursive: true, force: true });
}
