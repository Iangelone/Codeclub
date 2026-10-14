import type { IpcMain } from 'electron';
import type { SettingsStore } from '../settings-store.js';
import { createAppIpcRegistrar, type AuthorizeRenderer } from './register.js';

export function registerSettingsIpc(ipc: Pick<IpcMain, 'handle'>, authorize: AuthorizeRenderer, store: SettingsStore) {
  const handle = createAppIpcRegistrar(ipc, authorize);
  handle('codeclub:settings-get', (_event, key: string) => store.get(key));
  handle('codeclub:settings-set', (_event, key: string, value: unknown) => store.set(key, value));
  handle('codeclub:settings-remove', (_event, key: string) => store.set(key, undefined, true));
  handle('codeclub:global-chat-upsert', (_event, chat: { id: string; name: string; customName?: boolean }) => store.upsertGlobalChat(chat));
}
