# Models & Providers

El catálogo se obtiene en vivo desde `https://models.dev/api.json`.

## Fuente

```json
{providerId} → { id, name, api, doc, models: { modelId → { id, name } } }
```

Docs: [models.dev/models/](https://models.dev/models/) · [models.dev/providers/](https://models.dev/providers/)

## Archivo

`src/lib/ai-catalog.ts` — fetch en runtime. Sin cacheo estático.

## Estructura

| Export | Formato |
|---|---|
| `providers` | `{ id, label, api, shortLabel, doc }[]` |
| `models` | `{ id, label, providerId }[]` |

Provider `Custom` hardcodeado para endpoints OpenAI-compatibles definidos por usuario.

## API Keys

Se almacenan por provider en localStorage con key `{providerId}_api_key`.
