import type { IpcMain } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { resolveProjectFile } from '../project-files.js';
import { createAppIpcRegistrar, type AuthorizeRenderer } from './register.js';

/** UI file adapters keep their existing global capability; agent tools enforce their own project scope. */
export function registerFileIpc(ipc: Pick<IpcMain, 'handle'>, authorize: AuthorizeRenderer, userData: string, selectFiles: () => Promise<string[]>) {
  const handle = createAppIpcRegistrar(ipc, authorize);
  handle('files:select', selectFiles);
  handle('files:read', async (_event, file: string) => Array.from(await fs.readFile(file)));
  handle('files:read-text', (_event, file: string) => fs.readFile(file, 'utf8'));
  handle('files:exists', async (_event, file: string) => { try { await fs.access(file); return true; } catch { return false; } });
  handle('files:mkdir', async (_event, file: string) => { await fs.mkdir(file, { recursive: true }); return true; });
  handle('files:write-text', async (_event, file: string, content: string) => { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, String(content ?? ''), 'utf8'); return true; });
  const logWrites = new Map<string, Promise<void>>();
  handle('codeclub:append-log', async (_event, file: string, content: string) => {
    if (typeof file !== 'string' || typeof content !== 'string' || !['execution.jsonl', 'usage.jsonl', 'persistence-log.jsonl'].includes(path.basename(file))) throw new Error('INVALID_LOG');
    const target = await resolveProjectFile(userData, file, true);
    const key = target.toLowerCase();
    const operation = (logWrites.get(key) || Promise.resolve()).catch(() => undefined).then(async () => {
      await fs.mkdir(path.dirname(target), { recursive: true });
      const checked = await resolveProjectFile(userData, target, true);
      await fs.appendFile(checked, content, 'utf8');
    });
    logWrites.set(key, operation);
    try { await operation; } finally { if (logWrites.get(key) === operation) logWrites.delete(key); }
    return true;
  });
  handle('files:remove', async (_event, file: string) => { await fs.rm(file, { recursive: true, force: true }); return true; });
  handle('path:join', (_event, parts: string[]) => path.join(...(Array.isArray(parts) ? parts : [])));
  handle('path:app-config', () => userData);
  handle('path:app-cache', () => path.join(userData, 'cache'));
}
