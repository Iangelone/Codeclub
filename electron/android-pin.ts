import { BrowserWindow } from 'electron';

type Labels = { title: string; hint: string; cancel: string; unlock: string };
const escape = (text: string) => text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);

/** An isolated, ephemeral secret prompt. No renderer bridge, network, or persistence. */
export async function requestAndroidPin(parent: BrowserWindow | null, labels: Labels, signal?: AbortSignal): Promise<string | null> {
  if (!parent || parent.isDestroyed() || signal?.aborted) return null;
  const prompt = new BrowserWindow({ parent, modal: true, width: 400, height: 270, resizable: false, show: false, autoHideMenuBar: true, backgroundColor: '#111111', title: labels.title, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, devTools: false } });
  prompt.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  const close = () => { if (!prompt.isDestroyed()) prompt.close(); };
  signal?.addEventListener('abort', close, { once: true });
  parent.once('closed', close);
  const html = `<html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-eval'"><style>body{background:#111111;color:#eee;font:14px system-ui;margin:24px}h1{font-size:17px}p{color:#999;font-size:12px}input{box-sizing:border-box;width:100%;border:1px solid #2b2b2b;border-radius:12px;background:#191919;color:#eee;padding:12px}input:focus-visible,button:focus-visible{outline:2px solid #8bc7ff}footer{display:flex;justify-content:flex-end;gap:8px;margin-top:16px}button{border:1px solid #2b2b2b;border-radius:10px;background:#1e1e1e;color:#eee;padding:8px 14px}</style></head><body><h1>${escape(labels.title)}</h1><p>${escape(labels.hint)}</p><form><input type="password" inputmode="numeric" pattern="[0-9]{4,16}" minlength="4" maxlength="16" autocomplete="off" required aria-label="PIN" autofocus><footer><button type="button" id="cancel">${escape(labels.cancel)}</button><button type="submit">${escape(labels.unlock)}</button></footer></form></body></html>`;
  try {
    await prompt.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    const result = prompt.webContents.executeJavaScript(`new Promise(resolve => { const input = document.querySelector('input'); document.querySelector('form').onsubmit = event => { event.preventDefault(); const value = input.value; input.value = ''; resolve(value); }; document.querySelector('#cancel').onclick = () => resolve(null); document.onkeydown = event => { if (event.key === 'Escape') resolve(null); }; input.focus(); })`);
    prompt.show();
    return await Promise.race([result, new Promise<null>(resolve => prompt.once('closed', () => resolve(null)))]);
  } catch { return null; }
  finally { signal?.removeEventListener('abort', close); parent.removeListener('closed', close); close(); }
}
