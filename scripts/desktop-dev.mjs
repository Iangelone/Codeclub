import { spawn } from 'node:child_process';
import http from 'node:http';

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const env = { ...process.env, FORCE_COLOR: '1' };
const next = spawn(npmCommand, ['run', 'next:dev'], { stdio: 'inherit', env, shell: process.platform === 'win32' });
let electron = null;
let stopping = false;

function isReady() {
  return new Promise((resolve) => {
    const request = http.get('http://127.0.0.1:3000', (response) => { response.resume(); resolve(response.statusCode < 500); });
    request.on('error', () => resolve(false));
    request.setTimeout(500, () => { request.destroy(); resolve(false); });
  });
}

async function waitForNext() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (await isReady()) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Next.js no estuvo disponible en http://127.0.0.1:3000');
}

function stop() {
  if (stopping) return;
  stopping = true;
  next.kill();
  electron?.kill();
}

process.once('SIGINT', stop);
process.once('SIGTERM', stop);

try {
  await waitForNext();
  electron = spawn(npmCommand, ['run', 'electron:launch'], { stdio: 'inherit', env: { ...env, CODECLUB_NEXT_DEV_URL: 'http://127.0.0.1:3000' }, shell: process.platform === 'win32' });
  electron.once('exit', (code) => { stop(); process.exit(code ?? 0); });
  next.once('exit', (code) => { if (!stopping) { electron?.kill(); process.exit(code ?? 1); } });
} catch (error) {
  stop();
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
