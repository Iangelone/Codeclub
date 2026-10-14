export { getDesktopBridge, requireDesktopBridge } from './desktop-bridge';
import { getDesktopBridge, requireDesktopBridge } from './desktop-bridge';
/** Native command bridge for the Electron desktop runtime. */
export const nativeInvoke = async <T = unknown>(command: string, args?: Record<string, unknown>): Promise<T> => {
  if (typeof window !== 'undefined' && typeof getDesktopBridge()?.invoke === 'function') {
    return requireDesktopBridge().invoke(command, args || {}) as Promise<T>;
  }
  throw new Error(`No hay bridge nativo disponible para ${command}.`);
};

export const safeListen = async <T>(event: string, handler: (event: T) => void) => {
  if (typeof window === 'undefined') return () => undefined;
  const listener = handler as EventListener;
  window.addEventListener(event, listener);
  return () => window.removeEventListener(event, listener);
};

/** Application services publish domain notifications; UI owns their listeners and cleanup. */
export function emitAppEvent<T>(name: string, detail?: T): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(name, { detail }));
}

const desktop = () => (typeof window !== 'undefined' ? getDesktopBridge() : undefined);
export const onTerminalOutput = (handler: (payload: { id: string }) => void): (() => void) =>
  desktop()?.onTerminalOutput?.(handler) ?? (() => undefined);
export const appConfigDir = async () => desktop()?.appConfigDir?.() ?? '';
export const appCacheDir = async () => desktop()?.appCacheDir?.() ?? '';
export const joinPath = async (...parts: string[]) => desktop()?.joinPath ? requireDesktopBridge().joinPath(...parts) : parts.join('/');
export const fileExists = async (path: string) => desktop()?.fileExists ? Boolean(await requireDesktopBridge().fileExists(path)) : false;
export const makeDirectory = async (path: string, _options?: { recursive?: boolean }) => desktop()?.makeDirectory ? requireDesktopBridge().makeDirectory(path) : undefined;
export const readDesktopBytes = async (path: string) => desktop()?.readFile ? new Uint8Array(await requireDesktopBridge().readFile(path)) : new Uint8Array();
export const readDesktopText = async (path: string) => desktop()?.readTextFile ? String(await requireDesktopBridge().readTextFile(path)) : '';
export const writeDesktopText = async (path: string, content: string) => desktop()?.writeTextFile ? requireDesktopBridge().writeTextFile(path, content) : undefined;
/** Native appends serialize across renderers; keep older bridges usable until restart. */
export const appendDesktopLog = async (path: string, content: string) => {
  if (desktop()?.appendLog) return requireDesktopBridge().appendLog(path, content);
  const previous = await fileExists(path) ? await readDesktopText(path) : '';
  return writeDesktopText(path, previous + content);
};
export const removeDesktopFile = async (path: string) => desktop()?.removeFile ? requireDesktopBridge().removeFile(path) : undefined;
export const selectDesktopFiles = async () => desktop()?.selectFiles ? (await requireDesktopBridge().selectFiles()) : [];
export const desktopFileUrl = (path: string) => path.startsWith('file://') || path.startsWith('data:') ? path : `file:///${path.replace(/\\/g, '/').replace(/^\/+/, '')}`;

export const copyText = async (value: string) => {
  if (typeof document === 'undefined') return false;
  if (navigator.clipboard && document.hasFocus()) {
    await navigator.clipboard.writeText(value);
    return true;
  }
  const area = document.createElement('textarea');
  area.value = value;
  area.setAttribute('readonly', 'true');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  const copied = document.execCommand('copy');
  area.remove();
  return copied;
};
