/** Exercise overlay lifecycle with isolated windows and a fake mouse hook, never the user's desktop. */
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const directory = await mkdtemp(path.join(tmpdir(), 'codeclub-overlay-'));
const windows = [], hooks = [], shortcuts = new Map(), actions = [];
const displays = [{ bounds: { x: 0, y: 0, width: 800, height: 560 }, size: { width: 800, height: 600 } }];
class FixtureWindow extends EventEmitter {
  constructor(options) { super(); this.options = options; this.webContents = new EventEmitter(); this.destroyed = false; windows.push(this); }
  isDestroyed() { return this.destroyed; }
  destroy() { if (!this.destroyed) { this.destroyed = true; this.emit('closed'); } }
  close() { this.destroy(); }
  async loadURL(url) { this.url = url; }
  setAlwaysOnTop() {}
  setVisibleOnAllWorkspaces() {}
  setIgnoreMouseEvents() {}
  showInactive() {}
  focus() {}
}
globalThis.codeclubOverlayFixture = {
  BrowserWindow: FixtureWindow,
  globalShortcut: { register: (key, callback) => shortcuts.set(key, callback), unregister: key => shortcuts.delete(key), isRegistered: key => shortcuts.has(key) },
  screen: { getAllDisplays: () => displays, getDisplayNearestPoint: () => displays[0] },
  spawn: () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter(); child.killed = false;
    child.kill = () => { child.killed = true; };
    hooks.push(child); return child;
  },
};
try {
  const bundle = path.join(directory, 'overlay.mjs');
  await build({ entryPoints: ['electron/computer-overlay.ts'], outfile: bundle, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent', plugins: [{
    name: 'isolated-overlay-surfaces',
    setup(builder) {
      builder.onResolve({ filter: /^(electron|node:child_process)$/ }, args => ({ path: args.path, namespace: 'overlay-fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'overlay-fixture' }, args => ({ contents: args.path === 'electron'
        ? 'export const {BrowserWindow,globalShortcut,screen}=globalThis.codeclubOverlayFixture;'
        : 'export const {spawn}=globalThis.codeclubOverlayFixture;' }));
    },
  }] });
  const { createComputerOverlayController } = await import(pathToFileURL(bundle).href);
  let cancellations = 0;
  const controller = createComputerOverlayController(directory, () => cancellations++, payload => actions.push(payload));
  assert.deepEqual(controller.setComputerOverlay(true, 'en', 0), { ok: true, active: true, displays: 1 });
  assert.equal(windows[0].options.height, 600, 'Overlay covers the full monitor including the taskbar');
  assert.ok(decodeURIComponent(windows[0].url).includes('Codeclub is using your computer'));
  const context = { x: 799, y: 599, windowId: 'fixture-window' };
  hooks[0].stdout.emit('data', JSON.stringify(context).slice(0, 10));
  assert.equal(windows.length, 1, 'Partial hook output does not open a menu');
  hooks[0].stdout.emit('data', JSON.stringify(context).slice(10) + '\n');
  assert.equal(windows.length, 2);
  assert.equal(windows[1].options.x, 500, 'Context menu stays inside the display');
  controller.handleComputerMenuAction('inspect');
  assert.equal(windows[1].isDestroyed(), true);
  assert.deepEqual(actions, [{ action: 'inspect', ...context }]);
  controller.handleComputerMenuAction('close');
  assert.equal(actions.length, 1, 'Closing the menu does not dispatch an action');
  controller.updateComputerOverlayPalette(1);
  assert.equal(windows[0].isDestroyed(), true);
  assert.equal(hooks.length, 1, 'Palette changes do not restart the mouse hook');
  assert.ok(decodeURIComponent(windows.at(-1).url).includes('#F04E65'));
  shortcuts.get('Esc')();
  assert.equal(cancellations, 1);
  assert.equal(hooks[0].killed, true);
  assert.equal(shortcuts.has('Esc'), false);
  assert.ok(windows.every(window => window.isDestroyed()));
  controller.setComputerOverlay(true, 'es', 0);
  controller.setComputerOverlay(false);
  controller.destroyComputerOverlay();
  assert.equal(cancellations, 1, 'Cleanup does not cancel a second time');
  assert.ok(hooks.every(hook => hook.killed));
  assert.ok(windows.every(window => window.isDestroyed()));
  console.log('Computer overlay: full display, partial hook output, menu actions, palette refresh, Escape and cleanup passed.');
} finally {
  delete globalThis.codeclubOverlayFixture;
  const resolved = path.resolve(directory);
  assert.ok(path.dirname(resolved) === path.resolve(tmpdir()) && path.basename(resolved).startsWith('codeclub-overlay-'));
  await rm(resolved, { recursive: true, force: true });
}
