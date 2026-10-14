import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { registerChatIpc } from '../build/electron/ipc/chats.js';
import { registerFileIpc } from '../build/electron/ipc/files.js';
import { registerSettingsIpc } from '../build/electron/ipc/settings.js';
import { ChatStore } from '../build/electron/chat-store.js';
import { SettingsStore } from '../build/electron/settings-store.js';

const directory = await mkdtemp(path.join(tmpdir(), 'codeclub-ipc-'));
const handlers = new Map();
const ipc = { handle: (channel, handler) => { assert.equal(handlers.has(channel), false); handlers.set(channel, handler); } };
const trusted = { sender: { id: 1 } }, foreign = { sender: { id: 2 } };
const authorize = event => { if (event.sender.id !== trusted.sender.id) throw new Error('Unauthorized renderer'); };
const chat = new ChatStore(directory);
const settings = new SettingsStore(path.join(directory, 'settings.json'), () => {});
const appended = [];
try {
  registerSettingsIpc(ipc, authorize, settings);
  registerChatIpc(ipc, authorize, chat, (project, id, message) => appended.push({ project, id, message }));
  registerFileIpc(ipc, authorize, directory, async () => []);
  const invoke = (channel, ...args) => handlers.get(channel)(trusted, ...args);
  // Rejection precedes every native handler, even when its arguments would otherwise be invalid.
  for (const handler of handlers.values()) await assert.rejects(async () => handler(foreign), /Unauthorized renderer/);
  await invoke('codeclub:settings-set', 'codeclub-language', 'en');
  assert.equal(await invoke('codeclub:settings-get', 'codeclub-language'), 'en');
  await invoke('codeclub:settings-remove', 'codeclub-language');
  assert.equal(await invoke('codeclub:settings-get', 'codeclub-language'), undefined);
  assert.equal(await invoke('chats:append', '', 'qa', { role: 'user', content: 'Keep my history', mobileRequestId: 'fixture' }), 1);
  assert.equal(appended.length, 1);
  assert.equal((await invoke('chats:page', '', 'qa')).messages[0].content, 'Keep my history');
  await assert.rejects(() => invoke('chats:tail', '', 'qa', 0, [], 0), /CHAT_HISTORY_CONFLICT/);
  assert.equal((await invoke('chats:all', '', 'qa')).length, 1);
  const file = path.join(directory, 'selected', 'test.txt');
  await invoke('files:write-text', file, 'UI-selected file');
  assert.equal(await invoke('files:read-text', file), 'UI-selected file');
  assert.equal(await invoke('files:exists', file), true);
  const log = path.join(directory, 'usage.jsonl');
  await Promise.all([invoke('codeclub:append-log', log, 'one\n'), invoke('codeclub:append-log', log, 'two\n')]);
  assert.equal(await readFile(log, 'utf8'), 'one\ntwo\n');
  await assert.rejects(() => invoke('codeclub:append-log', path.join(directory, '..', 'outside', 'usage.jsonl'), 'no'), /fuera|outside|proyecto/i);
  await invoke('files:remove', file);
  assert.equal(await invoke('files:exists', file), false);
  console.log(`IPC: ${handlers.size} channels reject foreign renderers; trusted settings, chat conflicts, selected files, serialized logs and path isolation passed.`);
} finally {
  chat.close();
  await rm(directory, { recursive: true, force: true });
}
