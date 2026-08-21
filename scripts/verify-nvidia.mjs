const CATALOG_URL = 'https://models.dev/api.json';
const providerId = 'nvidia';
const apiKey = process.env.NVIDIA_API_KEY?.trim();

if (!apiKey) {
  console.error('Falta NVIDIA_API_KEY.');
  process.exit(2);
}

const catalogResponse = await fetch(CATALOG_URL);
if (!catalogResponse.ok) throw new Error(`models.dev respondió HTTP ${catalogResponse.status}`);
const catalog = await catalogResponse.json();
const provider = catalog?.[providerId];
if (!provider?.api || !provider?.models) throw new Error('No se encontró el proveedor NVIDIA en models.dev.');

const modelOverride = process.env.NVIDIA_MODEL?.trim();
const model = modelOverride
  ? provider.models[modelOverride]
  : Object.values(provider.models).find((candidate) => candidate?.modalities?.input?.includes('text') && candidate?.modalities?.output?.includes('text'));
if (!model?.id) throw new Error('No se encontró un modelo de texto compatible en models.dev.');

const endpoint = `${provider.api.replace(/\/$/, '')}/chat/completions`;
const requestBody = {
  model: model.id,
  messages: [{ role: 'user', content: 'Respondé únicamente: NVIDIA_OK' }],
  temperature: 0,
  max_tokens: 32,
};

console.log(JSON.stringify({ provider: provider.name || providerId, endpoint, catalog: CATALOG_URL, model: model.id }, null, 2));

const response = await fetch(endpoint, {
  method: 'POST',
  headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
  body: JSON.stringify(requestBody),
});
const raw = await response.text();
let payload;
try { payload = JSON.parse(raw); } catch { payload = { raw }; }

if (!response.ok) {
  console.error(JSON.stringify({ ok: false, status: response.status, error: payload?.error || payload }, null, 2));
  process.exit(1);
}

const content = payload?.choices?.[0]?.message?.content ?? '';
console.log(JSON.stringify({ ok: true, status: response.status, model: payload?.model || model.id, content }, null, 2));
