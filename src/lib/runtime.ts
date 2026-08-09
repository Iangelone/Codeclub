/** Native command bridge for the Electron desktop runtime. */
export const nativeInvoke = async <T = unknown>(command: string, args?: Record<string, unknown>): Promise<T> => {
  if (typeof window !== 'undefined' && typeof (window as any).codeclub?.invoke === 'function') {
    return (window as any).codeclub.invoke(command, args || {}) as Promise<T>;
  }
  throw new Error(`No hay bridge nativo disponible para ${command}.`);
};

export const safeListen = async <T>(event: string, handler: (event: T) => void) => {
  if (typeof window === 'undefined') return () => undefined;
  const listener = handler as EventListener;
  window.addEventListener(event, listener);
  return () => window.removeEventListener(event, listener);
};

const desktop = () => (typeof window !== 'undefined' ? (window as any).codeclub : undefined);
export const appConfigDir = async () => desktop()?.appConfigDir?.() ?? '';
export const appCacheDir = async () => desktop()?.appCacheDir?.() ?? '';
export const joinPath = async (...parts: string[]) => desktop()?.joinPath ? desktop().joinPath(...parts) : parts.join('/');
export const fileExists = async (path: string) => desktop()?.fileExists ? Boolean(await desktop().fileExists(path)) : false;
export const makeDirectory = async (path: string, _options?: { recursive?: boolean }) => desktop()?.makeDirectory ? desktop().makeDirectory(path) : undefined;
export const readDesktopBytes = async (path: string) => desktop()?.readFile ? new Uint8Array(await desktop().readFile(path)) : new Uint8Array();
export const readDesktopText = async (path: string) => desktop()?.readTextFile ? String(await desktop().readTextFile(path)) : '';
export const writeDesktopText = async (path: string, content: string) => desktop()?.writeTextFile ? desktop().writeTextFile(path, content) : undefined;
export const removeDesktopFile = async (path: string) => desktop()?.removeFile ? desktop().removeFile(path) : undefined;
export const selectDesktopFiles = async () => desktop()?.selectFiles ? (await desktop().selectFiles()) : [];
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
