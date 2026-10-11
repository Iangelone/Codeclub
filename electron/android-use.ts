/** ADB-backed Android control. Device content is untrusted; all actions require a fresh observation. */
import { execFile, type ChildProcess } from 'node:child_process';
import { access } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { AndroidCompanion } from './android-companion.js';

type Element = { ref: string; text: string; description: string; resourceId: string; className: string; clickable: boolean; enabled: boolean; focused: boolean; password: boolean; bounds: number[] };
type Snapshot = { serial: string; hash: string; imageHash: string; at: number; elements: Element[]; width: number; height: number };
let androidQueue: Promise<unknown> = Promise.resolve();
const decode = (value: string) => value.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);/gi, (_, entity: string) => {
  if (entity.startsWith('#')) return String.fromCodePoint(Number.parseInt(entity.slice(entity[1] === 'x' ? 2 : 1), entity[1] === 'x' ? 16 : 10));
  return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" } as Record<string, string>)[entity] || '';
});
/** Decode semantic nodes while redacting password values before exposing observations. */
export function parseAndroidHierarchy(xml: string): Element[] {
  if (!xml.includes('<hierarchy') || !xml.includes('</hierarchy>')) throw new Error('Android returned no accessible hierarchy. Unlock the device and observe again.');
  return [...xml.matchAll(/<node\b([^>]+)>/g)].slice(0, 1500).map((node, index) => {
    const attrs = Object.fromEntries([...node[1].matchAll(/([\w-]+)="([^"]*)"/g)].map(match => [match[1], decode(match[2])]));
    const password = attrs.password === 'true';
    const bounds = /^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$/.exec(attrs.bounds || '')?.slice(1).map(Number) || [];
    return { ref: `a${index}`, text: password ? '[redacted]' : (attrs.text || '').slice(0, 1000), description: password ? '[redacted]' : (attrs['content-desc'] || '').slice(0, 1000), resourceId: attrs['resource-id'] || '', className: attrs.class || '', clickable: attrs.clickable === 'true', enabled: attrs.enabled === 'true', focused: attrs.focused === 'true', password, bounds };
  });
}

/** Prefer an available ADB executable and fall back to the managed platform tools. */
export async function findAndroidAdb(managedRoot: string) {
  const executable = process.platform === 'win32' ? 'adb.exe' : 'adb';
  if (process.env.CODECLUB_ADB_PATH) { await access(process.env.CODECLUB_ADB_PATH); return process.env.CODECLUB_ADB_PATH; }
  const candidates = [path.join(managedRoot, 'platform-tools', executable), ...[process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT, process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk')].filter((root): root is string => Boolean(root)).map(root => path.join(root, 'platform-tools', executable)), ...(process.env.PATH || '').split(path.delimiter).filter(Boolean).map(root => path.join(root, executable))];
  for (const candidate of candidates) { try { await access(candidate); return candidate; } catch { /* Try the next standard installation. */ } }
  throw new Error('ADB is unavailable. Install official Android Platform Tools or set CODECLUB_ADB_PATH to the adb executable.');
}

/** Create renderer-local handles and snapshots over the shared serialized native transport. */
export function createAndroidUse(managedRoot: string, requestPin?: (signal: AbortSignal | undefined, credentialKey: string) => Promise<string | null>, companion?: AndroidCompanion) {
  const devices = new Map<string, string>();
  const snapshots = new Map<string, Snapshot>();
  const children = new Set<ChildProcess>();
  let activeController: AbortController | undefined;
  let generation = 0;
  const remoteSnapshots = new Map<string,string>();
  const remoteDevices = new Set<string>();
  const pinKey = (deviceId: string) => {
    const serial = companion?.has(deviceId) ? companion.credentialIdentity(deviceId) : devices.get(deviceId);
    if (!serial) throw new Error('Select a deviceId from androidListDevices first.');
    return `android_${createHash('sha256').update(serial).digest('hex')}_pin`;
  };
  const stop = () => { generation++; activeController?.abort(); snapshots.clear(); remoteSnapshots.clear(); for(const deviceId of remoteDevices)void companion?.run('stop',{deviceId}); for (const child of children) child.kill(); };
  const command = async (args: string[], signal?: AbortSignal): Promise<Buffer> => {
    if (signal?.aborted) throw new Error('Android operation cancelled.');
    const executable = await findAndroidAdb(managedRoot);
    return new Promise((resolve, reject) => {
      const child = execFile(executable, args, { encoding: 'buffer', timeout: 20000, maxBuffer: 12 * 1024 * 1024, windowsHide: true, signal }, (error, stdout) => {
        children.delete(child);
        // ADB errors may include device identifiers or input text; return metadata only.
        if (error) reject(new Error(`ADB operation failed (${error.code || 'cancelled'}). Observe again before retrying any action.`));
        else resolve(stdout);
      });
      children.add(child);
    });
  };
  const shell = async (serial: string, args: string[], signal?: AbortSignal) => (await command(['-s', serial, 'shell', ...args], signal)).toString('utf8');
  // Observe hierarchy and pixels together; coordinates must refer to this exact captured screen.
  const observe = async (serial: string, deviceId: string, signal?: AbortSignal, includeScreenshot = false) => {
    const file = `/data/local/tmp/codeclub-ui-${randomUUID()}.xml`;
    let xml = '';
    let elements: Element[] = [];
    let accessibilityError: string | undefined;
    try {
      // UI Automation can briefly return a null root during keyboard/window transitions.
      // Retry observations only; dispatched actions are never replayed here.
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          await shell(serial, ['uiautomator', 'dump', file], signal);
          xml = await shell(serial, ['cat', file], signal);
          elements = parseAndroidHierarchy(xml);
          break;
        } catch (error) {
          if (signal?.aborted || attempt === 1) throw error;
          await delay(250, undefined, { signal });
        }
      }
    } catch (error) {
      if (signal?.aborted) throw error;
      xml = ''; elements = [];
      accessibilityError = 'Accessibility hierarchy is unavailable on this screen. Use androidScreenshot with a vision-capable model, or navigate back/home. Typing requires an observed unprotected field.';
    }
    finally { await shell(serial, ['rm', '-f', file]).catch(() => undefined); }
    const image = await command(['-s', serial, 'exec-out', 'screencap', '-p'], signal);
    if (image.length < 24 || !image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('Android display dimensions are unavailable.');
    const snapshotId = randomUUID();
    const snapshot = { serial, hash: createHash('sha256').update(xml).digest('hex'), imageHash: createHash('sha256').update(image).digest('hex'), at: Date.now(), elements, width: image.readUInt32BE(16), height: image.readUInt32BE(20) };
    snapshots.clear(); snapshots.set(snapshotId, snapshot);
    return { ok: true, deviceId, snapshotId, width: snapshot.width, height: snapshot.height, elements, at: new Date(snapshot.at).toISOString(), perception: accessibilityError ? 'screenshot' : 'accessibility', ...(accessibilityError ? { accessibilityError } : {}), ...(includeScreenshot ? { mimeType: 'image/png', data: image.toString('base64') } : {}) };
  };
  const perform = async (operation: string, request: Record<string, any>, signal?: AbortSignal): Promise<any> => {
    if (operation === 'list_devices') {
      let output = '';
      let adbError: string | undefined;
      try { output = (await command(['devices', '-l'], signal)).toString('utf8'); }
      catch(error) { adbError=(error as Error).message; }
      const found = output.split(/\r?\n/).flatMap(line => {
        const match = /^(\S+)\s+(device|unauthorized|offline)(?:\s|$)/.exec(line);
        if (!match) return [];
        let id = [...devices].find(([, serial]) => serial === match[1])?.[0];
        if (!id) { id = randomUUID(); devices.set(id, match[1]); }
        return [{ deviceId: id, state: match[2], model: /\bmodel:(\S+)/.exec(line)?.[1]?.replaceAll('_', ' ') || 'Android' }];
      });
      const present = new Set(found.map(device => device.deviceId));
      for (const id of devices.keys()) if (!present.has(id)) devices.delete(id);
      const wireless=companion?.status()||[];
      if(adbError&&!wireless.length) return {ok:false,devices:[],error:adbError};
      return { ok: true, devices: [...wireless,...found], ...(adbError?{adbUnavailable:true}:{}) };
    }
    if(companion?.has(request.deviceId)) {
      const deviceId=String(request.deviceId);remoteDevices.add(deviceId);
      if(operation==='action'&&!(request.action==='key'&&request.key==='wake')&&remoteSnapshots.get(deviceId)!==request.snapshotId)throw new Error('Observe this Android companion in this chat before acting.');
      let pin: string | null | undefined;
      if(operation==='unlock') {
        if('pin' in request||'password' in request)throw new Error('PINs must come from the native vault.');
        const initial=await companion.run('unlock',{...request},signal);
        remoteSnapshots.delete(deviceId);
        if(!initial.requiresPin)return {...initial,deviceId};
        pin=await requestPin?.(signal,pinKey(deviceId));
        if(!pin)return {ok:false,cancelled:true,error:'Android unlock cancelled.',deviceId};
      }
      try {
        if(['action','lock','unlock'].includes(operation))remoteSnapshots.delete(deviceId);
        const result=await companion.run(operation,{...request,...(pin?{pin}:{})},signal);
        const state=result.state||result;
        if(state.snapshotId)remoteSnapshots.set(deviceId,state.snapshotId);
        if(result.data&&operation==='screenshot')result.mimeType='image/png';
        return {...result,deviceId};
      } finally {pin='';}
    }
    const serial = devices.get(request.deviceId);
    if (!serial) throw new Error('Select a deviceId from androidListDevices first.');
    if (operation === 'lock') {
      snapshots.clear();
      try {
        await shell(serial, ['input', 'keyevent', '223'], signal);
        for (let attempt = 0; attempt < 6; attempt++) {
          await delay(400, undefined, { signal });
          const policy = await shell(serial, ['dumpsys', 'window', 'policy'], signal);
          if (/\bmIsShowing=true\b/.test(policy) || /^\s*showing=true\s*$/m.test(policy)) return { ok: true, locked: true, dispatched: true };
        }
        return { ok: false, locked: false, dispatched: true, error: 'Sleep was dispatched but keyguard locking was not confirmed. Android may defer locking according to its lock settings.' };
      } catch { return { ok: false, dispatched: true, error: 'Lock could not be confirmed. Check the phone before retrying.' }; }
    }
    if (operation === 'unlock') {
      if ('pin' in request || 'password' in request) throw new Error('Enter the PIN in the private desktop prompt, never in tool arguments.');
      const locked = async () => {
        const policy = await shell(serial, ['dumpsys', 'window', 'policy'], signal);
        const match = /\bmIsShowing=(true|false)\b/.exec(policy) || /^\s*showing=(true|false)\s*$/m.exec(policy);
        if (!match) throw new Error('Android lock state is unavailable. Unlock on the phone.');
        return match[1] === 'true';
      };
      snapshots.clear();
      await shell(serial, ['input', 'keyevent', '224'], signal);
      if (!await locked()) return { ok: true, unlocked: true, alreadyUnlocked: true };
      await shell(serial, ['wm', 'dismiss-keyguard'], signal);
      if (!await locked()) return { ok: true, unlocked: true };
      const size = await shell(serial, ['wm', 'size'], signal);
      const dimensions = [...size.matchAll(/(?:Physical|Override) size: (\d+)x(\d+)/g)].at(-1);
      if (!dimensions) throw new Error('Android display dimensions are unavailable.');
      const width = Number(dimensions[1]), height = Number(dimensions[2]);
      await shell(serial, ['input', 'swipe', String(Math.floor(width / 2)), String(Math.floor(height * .8)), String(Math.floor(width / 2)), String(Math.floor(height * .2)), '350'], signal);
      const secureLock = async () => {
        const policy = await shell(serial, ['dumpsys', 'window', 'policy'], signal);
        return /\bmIsShowing=true\b/.test(policy) && /\bmKeyguardOccluded=false\b/.test(policy) && /^\s*secure=true\s*$/m.test(policy);
      };
      if (!await secureLock()) return { ok: false, unlocked: false, error: 'A secure, unobscured Android lock screen could not be confirmed. Unlock on the phone.' };
      let pin = await requestPin?.(signal, pinKey(request.deviceId));
      if (!pin) return { ok: false, unlocked: false, cancelled: true };
      if (!/^\d{4,16}$/.test(pin)) { pin = ''; return { ok: false, error: 'The PIN must contain 4 to 16 digits.' }; }
      // Only one attempt. The PIN stays in native memory; ADB receives hardware key events.
      try {
        if (!await secureLock()) throw new Error('Lock screen changed. Unlock on the phone.');
        // Hardware digit events work even when Android hides the secure PIN hierarchy.
        // Clear an unfinished PIN first; navigation is restricted to the verified keyguard.
        await shell(serial, ['input', 'keyevent', ...Array(16).fill('67')], signal);
        for (const digit of pin) {
          await shell(serial, ['input', 'keyevent', String(7 + Number(digit))], signal);
        }
        if (await locked()) await shell(serial, ['input', 'keyevent', '66'], signal);
        let unlocked = false;
        for (let attempt = 0; attempt < 6; attempt++) {
          await delay(400, undefined, { signal });
          if (!await locked()) { unlocked = true; break; }
        }
        return { ok: unlocked, unlocked, dispatched: true, ...(unlocked ? {} : { error: 'Unlock was not confirmed. No automatic retry was made. Unlock on the phone.' }) };
      } catch { return { ok: false, unlocked: false, dispatched: true, error: 'Unlock could not be confirmed. No automatic retry was made. Unlock on the phone.' }; }
      finally { pin = ''; snapshots.clear(); }
    }
    if (operation === 'get_state') return observe(serial, request.deviceId, signal);
    if (operation === 'screenshot') {
      return observe(serial, request.deviceId, signal, true);
    }
    if (operation !== 'action') throw new Error('Unknown Android operation.');
    if (request.action === 'key' && request.key === 'wake') {
      snapshots.clear();
      try { await shell(serial, ['input', 'keyevent', '224'], signal); }
      catch { return { ok: false, dispatched: true, error: 'Wake dispatch could not be confirmed. Observe again.' }; }
      try { return { ok: true, dispatched: true, state: await observe(serial, request.deviceId, signal) }; }
      catch { return { ok: false, dispatched: true, error: 'Device was asked to wake but its screen is unavailable. Unlock it on the phone and observe again.' }; }
    }
    const before = snapshots.get(request.snapshotId);
    if (!before || before.serial !== serial || Date.now() - before.at > 60000) throw new Error('Observe this device again; snapshot is missing or expired.');
    await observe(serial, request.deviceId, signal);
    const fresh = [...snapshots.values()][0];
    if (fresh.hash !== before.hash || fresh.width !== before.width || fresh.height !== before.height) throw new Error('Android screen changed. Observe again before acting.');
    if ((before.elements.length === 0 || request.action === 'swipe' || (request.action === 'tap' && !request.ref)) && fresh.imageHash !== before.imageHash) throw new Error('Android pixels changed. Observe again before using this snapshot.');
    const point = (x: unknown, y: unknown) => {
      if (!Number.isInteger(x) || !Number.isInteger(y) || Number(x) < 0 || Number(y) < 0 || Number(x) >= before.width || Number(y) >= before.height) throw new Error('Coordinates must be integers within the observed display.');
      return [String(x), String(y)];
    };
    let args: string[];
    if (request.action === 'tap') {
      const element = request.ref ? before.elements.find(element => element.ref === request.ref) : undefined;
      if (request.ref && (!element || !element.enabled || element.password || element.bounds.length !== 4)) throw new Error('The observed element is unavailable or protected.');
      args = ['input', 'tap', ...point(element ? Math.floor((element.bounds[0] + element.bounds[2]) / 2) : request.x, element ? Math.floor((element.bounds[1] + element.bounds[3]) / 2) : request.y)];
    } else if (request.action === 'swipe') {
      const duration = request.durationMs ?? 350;
      if (!Number.isInteger(duration) || duration < 100 || duration > 2000) throw new Error('Swipe duration must be between 100 and 2000 ms.');
      args = ['input', 'swipe', ...point(request.x, request.y), ...point(request.endX, request.endY), String(duration)];
    } else if (request.action === 'type') {
      const focused = before.elements.find(element => element.focused && element.className.endsWith('EditText'));
      if (!focused || focused.password) throw new Error('Observe and focus an unprotected text field before typing.');
      // ADB input text has no reliable Unicode support; do not silently corrupt text.
      if (typeof request.text !== 'string' || !request.text.length || request.text.length > 2000 || !/^[\x20-\x7e]+$/.test(request.text) || request.text.includes('%')) throw new Error('ADB typing supports printable ASCII without percent signs only. Unicode requires a companion input service.');
      const quoted = "'" + request.text.replaceAll(' ', '%s').replaceAll("'", "'\\''") + "'";
      args = ['input', 'text', quoted];
    } else if (request.action === 'key') {
      const key = ({ back: '4', home: '3', recents: '187', enter: '66', delete: '67' } as Record<string, string>)[request.key];
      if (!key) throw new Error('Unsupported Android navigation key.');
      args = ['input', 'keyevent', key];
    } else throw new Error('Unsupported Android action.');
    snapshots.clear();
    try { await shell(serial, args, signal); }
    catch { return { ok: false, dispatched: true, error: 'Action dispatch could not be confirmed. Observe again before deciding whether to retry.' }; }
    try { return { ok: true, dispatched: true, state: await observe(serial, request.deviceId, signal), verification: 'Inspect the returned state; dispatch alone does not prove the objective was achieved.' }; }
    catch { return { ok: false, dispatched: true, error: 'Action was dispatched but the resulting screen could not be observed. Observe again; do not repeat blindly.' }; }
  };
  return {
    stop,
    pinKey,
    run(operation: string, request: Record<string, any> = {}, signal?: AbortSignal): Promise<any> {
      if (operation === 'stop') { stop(); return Promise.resolve({ ok: true }); }
      const startedGeneration = generation;
      const work = androidQueue.then(async () => {
        if (startedGeneration !== generation || signal?.aborted) return { ok: false, error: 'Android operation cancelled.' };
        const controller = new AbortController();
        const cancel = () => controller.abort();
        signal?.addEventListener('abort', cancel, { once: true });
        activeController = controller;
        try { return await perform(operation, request, controller.signal); } catch (error) { return { ok: false, error: (error as Error).message }; }
        finally { signal?.removeEventListener('abort', cancel); activeController = undefined; }
      });
      androidQueue = work.catch(() => undefined);
      return work;
    },
  };
}
