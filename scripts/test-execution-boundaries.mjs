import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = await mkdtemp(path.join(tmpdir(), 'codeclub-execution-'));
try {
  const entry = path.join(directory, 'entry.ts'), bundle = path.join(directory, 'app.cjs');
  await writeFile(entry, `export * from ${JSON.stringify(path.join(repo, 'src/lib/agent/model-client.ts'))};
    export * from ${JSON.stringify(path.join(repo, 'src/lib/agent/native-model-fetch.ts'))};
    export * from ${JSON.stringify(path.join(repo, 'src/lib/agent/errors.ts'))};
    export * from ${JSON.stringify(path.join(repo, 'src/lib/desktop-bridge.ts'))};`);
  await build({ entryPoints: [entry], outfile: bundle, bundle: true, platform: 'node', format: 'cjs', nodePaths: [path.join(repo, 'node_modules')], logLevel: 'silent' });
  const { createModelClient, providerRequestHeaders, createNativeModelFetch, MissingModelCredentialError, isMissingModelCredential, requireDesktopBridge } = (await import(pathToFileURL(bundle).href)).default;
  const headers = providerRequestHeaders({ Authorization: 'reject', COOKIE: 'reject', Host: 'reject', 'bad header': 'reject', 'X-Session': '${chatId}', 'X-Number': 42 }, 'qa', { 'user-agent': 'Codeclub' });
  assert.deepEqual(headers, { 'user-agent': 'Codeclub', 'x-codeclub-session': 'qa', 'X-Session': 'qa' });
  for (const [provider, id] of [[{ id: 'qa', api: 'https://fixture.test/v1' }, 'fixture-model'], [{ id: 'google', api: 'https://fixture.test/v1beta' }, 'fixture-model'], [{ id: 'ai-gateway' }, 'qa/fixture-model']]) {
    const client = createModelClient({ provider, model: { id }, apiKey: 'fixture', headers: {}, fetch: async () => { throw new Error('Unexpected network access'); } });
    assert.equal(client(id).modelId, id);
  }
  assert.throws(() => createModelClient({ provider: { id: 'missing' }, model: { id: 'fixture' }, headers: {}, fetch }), /MODEL_ENDPOINT_MISSING/);
  for (const message of ['API key is missing', 'Falta la clave']) assert.equal(isMissingModelCredential(new MissingModelCredentialError(message)), true);
  assert.equal(isMissingModelCredential(new Error('API key is missing')), false);
  assert.throws(() => requireDesktopBridge(), /NATIVE_BRIDGE_UNAVAILABLE/);

  const calls = [], debug = [];
  const invoke = async (command, args) => { calls.push({ command, args }); return { body: 'fixture response', status: 200, status_text: 'OK', headers: [{ name: 'content-type', value: 'text/plain' }] }; };
  const modelFetch = createNativeModelFetch({ credentialKey: () => 'qa_api_key', prepareBody: body => body?.replace('original', 'prepared'), onFetch: value => debug.push(value), invoke });
  const completed = new AbortController();
  const response = await modelFetch('https://fixture.test/v1', { method: 'POST', body: 'original', signal: completed.signal });
  assert.equal(await response.text(), 'fixture response');
  assert.equal(calls[0].args.request.body, 'prepared');
  assert.equal(calls[0].args.request.credentialKey, 'qa_api_key');
  assert.equal(debug.at(-1).status, 200);
  completed.abort();
  assert.equal(calls.length, 1, 'Finished requests must remove their abort listener');

  const aborted = new AbortController(); aborted.abort();
  await assert.rejects(() => modelFetch('https://fixture.test/v1', { signal: aborted.signal }), { name: 'AbortError' });
  assert.equal(calls.length, 1, 'An already cancelled request must never reach native transport');
  let failRequest;
  const pendingCalls = [];
  const pendingFetch = createNativeModelFetch({ credentialKey: () => 'qa_api_key', invoke: async (command, args) => {
    pendingCalls.push({ command, args });
    if (command === 'codeclub_http_abort') { failRequest(new DOMException('Cancelled', 'AbortError')); return; }
    return new Promise((_resolve, reject) => { failRequest = reject; });
  } });
  const controller = new AbortController();
  const pending = pendingFetch('https://fixture.test/v1', { signal: controller.signal });
  while (!failRequest) await new Promise(resolve => setTimeout(resolve, 1));
  controller.abort();
  await assert.rejects(() => pending, { name: 'AbortError' });
  assert.deepEqual(pendingCalls.map(call => call.command), ['codeclub_http_fetch', 'codeclub_http_abort']);
  assert.equal(pendingCalls[0].args.request.requestId, pendingCalls[1].args.requestId);
  let attempts = 0;
  const failed = createNativeModelFetch({ credentialKey: () => undefined, onFetch: value => debug.push(value), invoke: async () => { attempts++; throw new Error('Fixture transport failure'); } });
  await assert.rejects(() => failed('https://fixture.test/v1'), /Fixture transport failure/);
  assert.equal(attempts, 1, 'The HTTP adapter must not replay a failed request');
  assert.equal(debug.at(-1).transportError, 'Fixture transport failure');
  console.log('Execution boundaries: direct/Gemini/Gateway routes, safe headers, stable error codes, credential selectors, cancellation, listener cleanup and no transport replay passed.');
} finally { await rm(directory, { recursive: true, force: true }); }
