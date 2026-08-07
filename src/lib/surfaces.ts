import { nativeInvoke as invoke } from './runtime';

export type SurfaceBounds = { left: number; top: number; width: number; height: number };
export type PopupAction = { action?: string; testingAction?: string; tab?: string };

type PopupRequest = {
  id: string;
  anchor: DOMRect;
  content: HTMLElement;
};

const runSerial = <T>(queue: Promise<unknown>, action: () => Promise<T>) => queue.catch(() => undefined).then(action);

class BrowserSurfaceController {
  private nativeWindowOpen = false;
  private host: HTMLElement | null = null;
  private url = '';
  private panelVisible = false;
  private queue: Promise<unknown> = Promise.resolve();
  private mounted = false;

  private async bounds(): Promise<SurfaceBounds | null> {
    const rect = this.host?.getBoundingClientRect();
    if (!this.panelVisible || !rect || rect.width < 1 || rect.height < 1) return null;
    const width = window.innerWidth;
    const height = window.innerHeight;
    const left = Math.max(0, Math.min(rect.left, width));
    const top = Math.max(0, Math.min(rect.top, height));
    const boundedWidth = Math.max(0, Math.min(rect.width, width - left));
    const boundedHeight = Math.max(0, Math.min(rect.height, height - top));
    return boundedWidth > 0 && boundedHeight > 0 ? { left, top, width: boundedWidth, height: boundedHeight } : null;
  }

  private async ensure() {
    const bounds = await this.bounds();
    if (!bounds || !this.url) return;
    const creating = !this.nativeWindowOpen;
    if (creating) {
      await invoke('codeclub_browser_close').catch(() => undefined);
      await invoke('codeclub_browser_create', {
        url: this.url,
        x: bounds.left,
        y: bounds.top,
        width: bounds.width,
        height: bounds.height,
      });
      this.nativeWindowOpen = true;
      return;
    }
    await invoke('codeclub_browser_set_bounds', {
      x: bounds.left,
      y: bounds.top,
      width: bounds.width,
      height: bounds.height,
    });
  }

  mount(host: HTMLElement, url: string) {
    const urlChanged = Boolean(this.nativeWindowOpen && this.url && this.url !== url);
    this.host = host;
    this.url = url;
    this.mounted = true;
    if (urlChanged) return this.navigate(url);
    return this.syncBounds();
  }

  navigate(url: string) {
    this.url = url;
    return this.enqueue(async () => {
      if (this.nativeWindowOpen) await invoke('codeclub_browser_navigate', { url });
      await this.ensure();
    });
  }

  setPanelVisible(visible: boolean) {
    this.panelVisible = visible;
    return this.enqueue(async () => {
      if (!visible) return this.disposeView();
      await this.ensure();
    });
  }

  syncBounds() {
    return this.enqueue(async () => {
      if (!this.panelVisible || !this.mounted) return;
      await this.ensure();
    });
  }

  evaluate(script: string) { return invoke('codeclub_browser_eval', { script }); }
  getUrl() { return invoke<string>('codeclub_browser_get_url'); }

  dispose() {
    this.mounted = false;
    this.host = null;
    return this.enqueue(() => this.disposeView());
  }

  private enqueue<T>(action: () => Promise<T>) {
    const next = runSerial(this.queue, action);
    this.queue = next;
    return next;
  }

  private async disposeView() {
    this.nativeWindowOpen = false;
    await invoke('codeclub_browser_close').catch(() => undefined);
  }
}

class PopupSurfaceController {
  private activeId = '';
  private queue: Promise<unknown> = Promise.resolve();
  private initialized = false;

  private async initialize() {
    if (this.initialized) return;
    this.initialized = true;
  }

  open(request: PopupRequest) {
    return this.enqueue(async () => {
      await this.initialize();
      const { anchor, content } = request;
      if (anchor.width < 1 || anchor.height < 1) return;
      this.activeId = request.id;
      document.documentElement.dataset.nativeMenuActive = 'true';
      await invoke('codeclub_popup_window', {
        open: true,
        x: anchor.left,
        y: anchor.top,
        width: anchor.width,
        height: anchor.height,
        html: content.outerHTML,
      });
    });
  }

  close() {
    return this.enqueue(async () => {
      this.activeId = '';
      document.documentElement.dataset.nativeMenuActive = 'false';
      await invoke('codeclub_popup_window', { open: false, x: 0, y: 0, width: 0, height: 0, html: '' });
    });
  }

  isOpen() { return document.documentElement.dataset.nativeMenuActive === 'true'; }

  private enqueue<T>(action: () => Promise<T>) {
    const next = runSerial(this.queue, action);
    this.queue = next;
    return next;
  }
}

export const surfaces = {
  browser: new BrowserSurfaceController(),
  popup: new PopupSurfaceController(),
};
