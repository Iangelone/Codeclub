import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SettingsStore } from '../electron/settings-store.ts';
import { OrbRunGuard } from '../src/lib/orb-run-guard.ts';
const directory = mkdtempSync(path.join(tmpdir(), 'codeclub-orb-state-'));
try {
  const notifications = [];
  const file = path.join(directory, 'settings.json');
  const first = new SettingsStore(file, key => notifications.push(key));
  const second = new SettingsStore(file, key => notifications.push(key));
  first.set('language', 'es'); second.set('sidebar', {width: 300});
  assert.equal(first.get('language'), 'es'); assert.deepEqual(first.get('sidebar'), {width: 300});
  first.upsertGlobalChat({id:'orb-chat', name:'Saludo'});
  second.upsertGlobalChat({id:'other-chat', name:'Otro'});
  first.upsertGlobalChat({id:'orb-chat', name:'Nuevo resumen'});
  assert.equal(second.get('codeclub_global_chats').length, 2);
  assert.equal(second.get('codeclub_global_chats')[0].name, 'Nuevo resumen');
  assert.throws(() => first.set('google_api_key', 'secret'), /USE_CREDENTIAL_VAULT/);
  assert.throws(() => first.get('google_api_key'), /USE_CREDENTIAL_VAULT/);
  assert.throws(() => first.set('__proto__', {}), /INVALID_SETTING_KEY/);
  second.set('sidebar', null, true); assert.equal(first.get('sidebar'), undefined);
  assert.ok(notifications.includes('codeclub_global_chats'));
  const mutation = new OrbRunGuard();
  for(let i=0;i<3;i++) mutation.before('click', {target:1});
  assert.throws(() => mutation.before('click', {target:1}), /TASK_NO_PROGRESS/);
  const observation = new OrbRunGuard();
  observation.after('getState', {}, {text:'unchanged', at:1});
  observation.after('getState', {}, {text:'unchanged', at:2});
  assert.throws(() => observation.after('getState', {}, {text:'unchanged', at:3}), /TASK_NO_PROGRESS/);
  const progress = new OrbRunGuard();
  for(let i=0;i<48;i++) {progress.before('getState', {}); progress.after('getState', {}, {text:String(i)});}
  assert.throws(() => progress.before('getState', {}), /TASK_BUDGET_EXCEEDED/);
  console.log('Settings: concurrent windows, chat registration, credentials, events and removal passed. Orbs: repeated actions, unchanged observations, changing evidence and call budget passed.');
} finally { rmSync(directory, {recursive:true, force:true}); }
