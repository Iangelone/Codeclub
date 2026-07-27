# Models & Providers

The catalog is fetched live from `https://models.dev/api.json`.

## Source

```json
{providerId} → { id, name, api, doc, models: { modelId → { id, name } } }
```

Docs: [models.dev/models/](https://models.dev/models/) · [models.dev/providers/](https://models.dev/providers/)

## File

`src/lib/ai-catalog.ts` — `fetch` at runtime. No static caching. Each startup fetches the latest catalog.

## Structure

| Export | Format |
|---|---|
| `providers` | `{ id, label, api, shortLabel, doc }[]` |
| `models` | `{ id, label, providerId, cost }[]` |

The `cost` field from models.dev (per-million token pricing) is stored per model and used for usage estimation in the business dashboard.

### Custom Provider

A hardcoded `Custom` provider is always available with `id: "custom"`. It enables user-defined OpenAI-compatible endpoints:

- **URL**: endpoint URL (e.g., `https://localhost:11434/v1` for Ollama, `http://localhost:4891/v1` for LM Studio).
- **Header**: Authorization header name (default: `Authorization`). Set to empty if no auth needed.
- **Body format**: JSON or XML request bodies.
- **API Key**: stored per provider in the OS config file under `{providerId}_api_key`.

Custom provider configuration UI is inline in the chat command menu.

## API Keys

Stored per provider in `settings.json` (app config directory) with key `{providerId}_api_key`. The credential input UI shows a masked field with a `KeyRound` icon that animates during credential entry.

## Command Menu

The chat composer supports inline provider/model selection via slash commands:
- `/proveedor` → opens provider picker with search.
- `/modelo` → opens model picker filtered to the active provider.
- `/proyecto` → opens project picker.

Selection is persisted per chat session.

## Error Handling

If the models.dev API is unreachable, the catalog falls back to only the `Custom` provider. Error is logged to the console but does not crash the app.

## Tauri HTTP Fetch

All model provider HTTP requests use a Tauri-backed fetch (`codeclub_http_fetch` in Rust using `reqwest 0.13`). This allows:
- Proper error surfacing (status codes, response bodies).
- Custom headers and body formats.
- Bypasses browser CORS restrictions.
- HTTP/2 and gzip/brotli/deflate compression.
