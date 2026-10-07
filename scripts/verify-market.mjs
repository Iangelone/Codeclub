import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

// Uses the existing native session locally; never prints tokens or calls any AI model.
const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');
const directory = mkdtempSync(path.join(tmpdir(), 'codeclub-market-verify-'));
const worker = path.join(directory, 'verify.cjs');
const entry = `
import { app, safeStorage } from 'electron';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { marketClient, marketUser, publishMarketProvider, readPublishedProviders, deletePublishedProvider } from './src/lib/market-cloud.ts';
(async () => {
  app.setPath('userData', path.join(process.env.APPDATA, 'codeclub-desktop'));
  await app.whenReady();
  const sessionPath = path.join(process.env.APPDATA, 'codeclub-desktop', 'market-session.encrypted');
  const entries = JSON.parse(safeStorage.decryptString(readFileSync(sessionPath)));
  const session = JSON.parse(entries['codeclub-market-auth']);
  if (!session?.access_token || session.expires_at < Date.now()/1000 + 120) throw new Error('SESSION_EXPIRES_SOON');
  const settings = new Map();
  globalThis.window = {
    codeclub: { marketAuthGet: async key => entries[key] ?? null, marketAuthSet: async (key,value) => { if(value === null) delete entries[key]; else entries[key] = value; } },
    addEventListener: () => {}, removeEventListener: () => {},
    localStorage: { getItem: key => settings.get(key) ?? null, setItem: (key,value) => settings.set(key,value) },
  };
  const db = marketClient();
  let offer;
  let deviceId;
  let profileCreated = false;
  let userId;
  try {
    const user = await marketUser(); userId = user.id;
    const before = await db.from('perfiles').select('nombre').eq('id', user.id).maybeSingle();
    if (before.error) throw before.error;
    profileCreated = !before.data;
    const name = before.data?.nombre || 'Verificacion temporal Codeclub';
    offer = { id: crypto.randomUUID(), name, origin:'local', endpoint:'http://localhost:11434/v1', model:'codeclub-verificacion-temporal', modelLabel:'Verificacion temporal Codeclub', provider:'', concurrency:1, requestsPerMinute:1, queueEnabled:false, queueCapacity:10, enabled:false, registeredAt:new Date().toISOString() };
    Object.assign(offer, await publishMarketProvider(offer));
    const record = await db.from('modelos').select('equipo_id,habilitado').eq('id',offer.remoteId).single();
    if(record.error) throw record.error; deviceId = record.data.equipo_id;
    if ((await readPublishedProviders()).some(item=>item.id===offer.remoteId)) throw new Error('PAUSED_MODEL_VISIBLE');
    offer.enabled = true;
    offer.modelLabel = 'Verificacion editada Codeclub';
    await publishMarketProvider(offer);
    const visible = (await readPublishedProviders()).find(item=>item.id===offer.remoteId);
    if (!visible || visible.modelLabel !== offer.modelLabel || visible.name !== name) throw new Error('PUBLISH_EDIT_FAILED');
    offer.enabled = false;
    await publishMarketProvider(offer);
    if ((await readPublishedProviders()).some(item=>item.id===offer.remoteId)) throw new Error('PAUSE_FAILED');
    await deletePublishedProvider(offer);
    const removed = await db.from('modelos').select('id').eq('id',offer.remoteId).maybeSingle();
    if(removed.error || removed.data) throw new Error('DELETE_FAILED');
    offer = undefined;
    console.log(JSON.stringify({ status:'passed', checks:['session','profile','device','publish','catalog','edit','pause','delete'], profileCreated, userId, deviceId }));
  } finally {
    if(offer?.remoteId) { try { await deletePublishedProvider(offer); } catch { console.log('TEST_MODEL_CLEANUP_REQUIRED'); } }
    if(deviceId) { const result = await db.from('equipos').delete().eq('id',deviceId); if(result.error) console.log('TEST_DEVICE_CLEANUP_REQUIRED'); }
    db.auth.stopAutoRefresh();
  }
})().then(()=>app.exit(0)).catch(error=>{ console.error('MARKET_VERIFY_FAILED', String(error.name || ''), String(error.message || '').replace(/[A-Za-z0-9_-]{30,}/g,'[redacted]').slice(0,160), /^[A-Z0-9_]+$/.test(error.code||'') ? error.code : /^[A-Z0-9_]+$/.test(error.message||'') ? error.message : 'REQUEST_FAILED'); app.exit(1); });
`;
try {
  await build({ stdin: { contents: entry, resolveDir: root, loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', external: ['electron'], outfile: worker, logLevel: 'silent' });
  const result = spawnSync(require('electron'), [worker], { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 60000 });
  process.stdout.write(result.stdout || '');
  process.stderr.write(result.stderr || '');
  process.exitCode = result.status ?? 1;
} finally { rmSync(directory, { recursive: true, force: true }); }
