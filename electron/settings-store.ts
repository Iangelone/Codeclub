import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';

/** Native single writer: renderer caches must never replace another window's keys. */
export class SettingsStore {
  constructor(private file: string, private changed: (key: string) => void) {}
  private read(): Record<string, unknown> {
    if (!existsSync(this.file)) return {};
    const value = JSON.parse(readFileSync(this.file, 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_SETTINGS');
    return value;
  }
  private validate(key: string) {
    if (typeof key !== 'string' || !key || key.length > 300 || ['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('INVALID_SETTING_KEY');
  }
  get(key: string): unknown { this.validate(key); if (/_api_key$/i.test(key)) throw new Error('USE_CREDENTIAL_VAULT'); return this.read()[key]; }
  set(key: string, value: unknown, remove = false) {
    this.validate(key);
    if (!remove && /_api_key$/i.test(key)) throw new Error('USE_CREDENTIAL_VAULT');
    const settings = this.read();
    if (remove) delete settings[key]; else settings[key] = value;
    writeFileSync(this.file + '.settings.tmp', JSON.stringify(settings), 'utf8');
    renameSync(this.file + '.settings.tmp', this.file);
    this.changed(key);
  }
  upsertGlobalChat(chat: { id: string; name: string; customName?: boolean }) {
    if (!chat || typeof chat.id !== 'string' || !chat.id || chat.id.length > 300 || typeof chat.name !== 'string') throw new Error('INVALID_CHAT');
    const previous = this.get('codeclub_global_chats');
    const chats: any[] = Array.isArray(previous) ? previous : [];
    const entry = { id: chat.id, name: chat.name.slice(0, 200), customName: chat.customName === true, projectPath: '', projectName: 'Sin proyecto' };
    const index = chats.findIndex(item => item.id === entry.id);
    if (index < 0) chats.push(entry); else chats[index] = entry;
    this.set('codeclub_global_chats', chats);
  }
}
