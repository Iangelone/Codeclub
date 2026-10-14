import type { IpcMain } from 'electron';
import type { ChatStore } from '../chat-store.js';
import { createAppIpcRegistrar, type AuthorizeRenderer } from './register.js';

export function registerChatIpc(ipc: Pick<IpcMain, 'handle'>, authorize: AuthorizeRenderer, store: ChatStore, appended: (project: string, id: string, message: any) => void) {
  const handle = createAppIpcRegistrar(ipc, authorize);
  handle('chats:page', (_event, project: string, id: string, before?: number, limit?: number) => store.page(project, id, before, limit));
  handle('chats:turn-page', (_event, project: string, id: string, before?: number, limit?: number, direction?: 'before' | 'after') => store.turnPage(project, id, before, limit, direction));
  handle('chats:context', (_event, project: string, id: string) => store.context(project, id));
  handle('chats:tail', (_event, project: string, id: string, start: number, messages: any[], expectedTotal?: number) => store.saveTail(project, id, start, messages, expectedTotal));
  handle('chats:append', async (_event, project: string, id: string, message: any) => {
    const total = await store.append(project, id, message);
    appended(project, id, message);
    return total;
  });
  handle('chats:all', (_event, project: string, id: string) => store.all(project, id));
  handle('chats:search', (_event, project: string, id: string, query: string) => store.search(project, id, query));
  handle('chats:copy', (_event, from: string, to: string, id: string) => store.copy(from, to, id));
  handle('chats:delete', (_event, project: string, id: string) => store.delete(project, id));
  handle('chats:transcript', (_event, project: string, id: string, markdown: string) => store.transcript(project, id, markdown));
  handle('chats:read-project', async (_event, project: string, id: string) => (await store.all(project, id)).map(message => JSON.stringify(message)).join('\n'));
  handle('chats:write-project', async (_event, project: string, id: string, content: string) => {
    await store.saveTail(project, id, 0, content.split('\n').filter(line => line.trim()).map(line => JSON.parse(line)));
    return true;
  });
}
