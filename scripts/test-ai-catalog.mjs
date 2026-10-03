import assert from 'node:assert/strict';
import { credentialKeyFor, credentialTargetFor, modelIdFor, modelMatchesProvider, usesGateway } from '../src/lib/ai-routing.ts';

const realFetch = globalThis.fetch;
const directData = { providers: { original: { id: 'original', name: 'Original', api: 'https://direct.example/v1', env: ['DIRECT_API_KEY'], models: { shared: { id: 'shared', name: 'Shared direct' }, exclusive: { id: 'exclusive', name: 'Direct only' } } } } };
const gatewayData = { data: [
  { id: 'original/shared', name: 'Shared gateway', type: 'language' },
  { id: 'original/new', name: 'New model', type: 'language', tags: ['tool-use', 'reasoning'] },
  { id: 'new-provider/first', name: 'First', type: 'language' },
  { id: 'embedding-provider/embed', type: 'embedding' },
  { id: 'invalid', type: 'language' },
] };

try {
  globalThis.fetch = async url => ({ ok: true, json: async () => String(url).includes('models.dev') ? structuredClone(directData) : structuredClone(gatewayData) });
  const { providers, models } = await import('../src/lib/ai-catalog.ts?catalog-test');
  const original = providers.find(item => item.id === 'original');
  const gateway = providers.find(item => item.id === 'ai-gateway');
  const shared = models.find(item => item.gatewayId === 'original/shared');
  const added = models.find(item => item.gatewayId === 'original/new');
  const directOnly = models.find(item => item.gatewayId === 'original/exclusive');
  const addedProvider = providers.find(item => item.id === 'new-provider');
  const first = models.find(item => item.gatewayId === 'new-provider/first');

  assert.equal(models.length, 4, 'No duplicate shared model or unsupported modality');
  assert.equal(original.api, 'https://direct.example/v1');
  assert.equal(shared.label, 'Shared direct', 'Keep direct metadata and route');
  assert.equal(usesGateway(original, shared), false);
  assert.equal(credentialKeyFor(original, shared), 'original_api_key');
  assert.equal(modelIdFor(original, shared), 'shared');
  assert.equal(modelMatchesProvider(shared, gateway), true);
  assert.equal(modelMatchesProvider(directOnly, gateway), false, 'Do not offer unsupported models through Gateway');
  assert.equal(modelIdFor(gateway, shared), 'original/shared');
  assert.equal(added.label, 'New model');
  assert.equal(added.toolCall, true);
  assert.equal(added.reasoning, true);
  assert.equal(modelMatchesProvider(added, original), true, 'New Gateway model remains in the existing provider selector');
  assert.equal(usesGateway(original, added), true);
  assert.equal(credentialKeyFor(original, added), 'ai_gateway_api_key');
  assert.equal(credentialTargetFor(original, added).label, 'Vercel AI Gateway');
  assert.equal(modelIdFor(original, added), 'original/new', 'Gateway-only models require creator/model on every invocation');
  assert.equal(addedProvider.gatewayOnly, true);
  assert.equal(credentialKeyFor(addedProvider, first), 'ai_gateway_api_key');
  assert.equal(modelIdFor(addedProvider, first), 'new-provider/first');
  assert.equal(providers.some(item => item.id === 'embedding-provider'), false);

  globalThis.fetch = async url => String(url).includes('models.dev')
    ? { ok: true, json: async () => structuredClone(directData) }
    : { ok: false, status: 503 };
  const fallback = await import('../src/lib/ai-catalog.ts?gateway-unavailable-test');
  assert.equal(fallback.models.length, 2, 'Gateway outage keeps direct providers and models');
  assert.equal(fallback.providers.find(item => item.id === 'original').api, original.api);

  globalThis.fetch = async url => String(url).includes('models.dev')
    ? { ok: false, status: 503 }
    : { ok: true, json: async () => structuredClone(gatewayData) };
  const gatewayOnly = await import('../src/lib/ai-catalog.ts?direct-unavailable-test');
  assert.equal(gatewayOnly.models.length, 3, 'Direct catalog outage keeps Gateway available');
  assert.equal(gatewayOnly.providers.find(item => item.id === 'original').gatewayOnly, true);
  assert.equal(usesGateway(gatewayOnly.providers.find(item => item.id === 'original'), gatewayOnly.models[0]), true);
  console.log('AI catalog routing, credentials, deduplication and independent fallback: OK');
} finally { globalThis.fetch = realFetch; }
