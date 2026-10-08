# AI catalog and routing

The existing selectors use the combined catalogs from models.dev and the public
`https://ai-gateway.vercel.sh/v1/models` endpoint. Gateway provides language
models; chat uses the SDK's text-generation APIs.

Direct models retain their provider, endpoint, display name, and identifier. If a
model appears in both catalogs, it is listed once under its provider and is also
available through the existing AI Gateway option. That option includes only
models confirmed as available by the Gateway catalog.

New Gateway models appear under their creator in the same selector. The model's
`gatewayOnly` field determines its route even when that creator already has
direct models. Creators available only through Gateway use the same indicator on
the provider. No screens or controls are added.

`ai-routing.ts` centralizes provider membership, routing, execution identifiers,
and storage keys. Direct routing keeps its local ID and
`<provider>_api_key`; Gateway uses `creator/model` and `ai_gateway_api_key`. The
existing dialog displays Vercel AI Gateway when appropriate. A saved Gateway
key is reused when switching between its models.

Chat, tool resolution, and tool contexts receive the same resolved identifier.
Task selectors filter using the same provider membership and load the correct
credential when the route changes.

Each source handles errors independently: if one fails, the other catalog
remains available. The app does not automatically select an unrelated model
when the chosen provider has no available models.

## Verification

`node scripts/test-ai-catalog.mjs` checks mixed catalogs, shared models,
Gateway-only models under a direct provider, new creators, execution IDs,
credentials, and independent failures of each source. The tests use controlled
catalog responses and do not send generations or use real credentials.

## Credentials, transport, and errors

Selectable providers and models come from models.dev and the public Vercel AI
Gateway catalog. Unknown prices remain unknown; they are not treated as zero.
Gateway keeps its per-route price separate from the direct provider's price and
context window. There is no fallback provider endpoint: if the catalog does not
provide a compatible endpoint, the app reports a configuration error.

The Gateway credential is stored in `credentials.encrypted.json`, encrypted by
Electron safeStorage/DPAPI and associated with the service origin. It is never
stored in messages, tests, or documentation. Live tests receive the credential
through stdin, without command-line arguments or plaintext files. Free-model
selection uses current prices and tool support; model IDs are not hard-coded.

## Sessions and errors

Direct requests identify Codeclub and include a stable chat ID. Additional
session headers are configured per provider in the
`codeclub_provider_headers_<id>` setting; `${chatId}` is replaced with the chat
ID. There are no code paths keyed to provider names. Authorization, Cookie, and
Host are not accepted as configurable headers.

The engine preserves the first real stream error instead of replacing it with a
generic no-output error. The UI distinguishes payment requirements,
subscriptions, and client restrictions before interpreting HTTP 403 as an
invalid credential. Messages are translated into Spanish and English.

Tests with a fixture provider validate transport, encrypted storage,
cancellation, shared history, the main-app/widget surfaces, and account errors.
They require no real credentials and do not verify the availability or account
restrictions of an external provider.
