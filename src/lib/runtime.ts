import { listen } from '@tauri-apps/api/event';

export const isTauriRuntime = () => typeof window !== 'undefined' && Boolean((window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);

export const safeListen = async <T>(event: string, handler: (event: T) => void) => {
  if (!isTauriRuntime()) return () => undefined;
  return listen<T>(event, handler);
};

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
