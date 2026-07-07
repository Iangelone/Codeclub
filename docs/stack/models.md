# Models & Providers

El catálogo de modelos y proveedores se obtiene en vivo desde `https://models.dev/api.json`.

## Fuente de datos

```
https://models.dev/api.json
├── {providerId}
│   ├── id          → string
│   ├── name        → string
│   ├── api         → string (base URL)
│   ├── doc         → string (URL de documentación)
│   └── models
│       └── {modelId}
│           ├── id   → string
│           └── name → string
```

Docs oficiales: [models.dev/models/](https://models.dev/models/) y [models.dev/providers/](https://models.dev/providers/).

## Archivo

`src/lib/ai-catalog.ts` — fetch en runtime, sin cacheo estático.

## Estructura

- `providers[]` — cada entry: `{ id, label, api, shortLabel, doc }`
- `models[]` — cada entry: `{ id, label, providerId }`

Un provider `Custom` hardcodeado permite endpoints OpenAI-compatibles definidos por el usuario.

## Uso

```ts
import { providers, models } from '../lib/ai-catalog';

// ChatPanel.astro filtra providers y models en un catálogo plano
const catalog = [
  ...providers.map(p => ({ ...p, type: 'provider' })),
  ...models.map(m => ({ ...m, type: 'model' })),
];
```

El catálogo se pasa a `ChatInterface` como prop y se usa en el command menu (`/proveedor`, `/modelo`).

## API Keys

Se almacenan por provider en localStorage con key `{providerId}_api_key`.
