import type { IpcMain, IpcMainInvokeEvent } from 'electron';

export type AuthorizeRenderer = (event: IpcMainInvokeEvent) => void;
/** Sender authorization is shared; subsystem handlers still validate paths, ownership and input. */
export function createAppIpcRegistrar(ipc: Pick<IpcMain, 'handle'>, authorize: AuthorizeRenderer) {
  return (channel: string, handler: (event: IpcMainInvokeEvent, ...args: any[]) => unknown) => {
    ipc.handle(channel, (event, ...args) => { authorize(event); return handler(event, ...args); });
  };
}
