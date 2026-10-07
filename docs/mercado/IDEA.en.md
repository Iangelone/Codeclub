# Codeclub Market

[Español](IDEA.es.md) · [Implementation and schema notes (Spanish)](README.md)

## Idea and goal

Market connects people offering access to AI models with people who want to use them from Codeclub. The platform acts as an intermediary: it discovers offers, identifies participants and, in a future phase, coordinates requests and payments. Providers supply models or API access; consumers choose whom to hire.

The commercial intention is payment per use in cryptocurrency, with Codeclub retaining a small commission. Currency, network, price, billing unit and commission percentage have not been chosen. The prototype supports progress without charging; publishing an offer does not enable payments or remote execution.

## Participants

- **User:** one Supabase Auth account can consume and provide. Local Codeclub use does not require a Market account.
- **Provider:** has a public name and publishes one or more offers. Each offer identifies a model and has a label visible to consumers.
- **Consumer:** browses the catalog and connects chosen offers to the chat selectors.
- **Device:** a registered provider computer. The Spanish table name `equipos` means PCs here, not teams of people. Devices associate offers with a PC and prepare for reconnection after shutdown.
- **Codeclub:** manages the catalog and connections. Future infrastructure must coordinate jobs and verify payments.

## Offers and registration

From **Miscellaneous → Market → Add**, providers enter their public name, source, model, label, requests per minute, concurrent requests and optional queue.

| Source | Configuration | Credentials |
| --- | --- | --- |
| Local model | URL with host and optional port, for example an Ollama or LM Studio server, plus model identifier | Private endpoint on the PC |
| Codeclub | Provider and model from the existing Codeclub catalog | API key in the local vault; a saved key can be reused |

The modal provider/model selectors support search and open upward. Selection colors follow the orb, and scrolling uses the other modals' style.

The public name belongs to the profile: changing it updates the name shown for all its offers. Labels belong to individual offers. Current form limits: 1–32 concurrent requests; 0–100000 requests per minute, with 0 meaning unlimited; queue capacity 1–1000. **These values are currently stored; execution enforcement is pending.** The final scope of quotas shared across multiple models also needs a decision.

## Consumer experience

1. Sign in and open **Providers**.
2. Search by public name, label, model or source provider.
3. Click **Connect** on a published offer.
4. The chat shows the public name as the provider and the label as the model.
5. **Disconnect** removes that offer from the selectors.

A connection is a local preference scoped to an account; it is neither a purchase nor a network connection to the provider PC. It persists on this device. The catalog refreshes every 15 seconds; paused or deleted offers disappear from the selectors on refresh.

The active chat provider stays first with **Selected**. Providers with their own saved credential and **Custom** are prioritized next with **Recent**. This label indicates saved configuration, not a usage timestamp. An AI Gateway key does not mark every gateway-dependent provider as saved.

## Provider administration

**Status** shows the user's offers registered on this PC. Icons activate/pause, edit and delete them; older local-only offers can be published using the upload icon. Managing every PC from any device is not implemented.

Activation means publication in the catalog: **it does not prove that the PC is running or serving requests**. Actual availability and automatic reconnection require an expiring heartbeat. An offer referenced by request history cannot be physically deleted; it should be paused.

## Current architecture

React presents panels; Electron handles credentials and native storage. Supabase supplies Auth and a Postgres database exposed through Data API in the `mercado` schema:

| Table | Responsibility |
| --- | --- |
| `perfiles` | Public identity linked to `auth.users` |
| `equipos` | Each provider's private PCs |
| `modelos` | Offers and public configuration |
| `solicitudes` | Foundation for private consumer/provider requests |

The client uses a public URL and publishable key together with the user's session. RLS and explicit grants control access. Database passwords and administrative keys are not distributed. Private endpoints and API keys are not published to Supabase. Desktop sessions are encrypted using Windows DPAPI; API keys remain in the native vault. Browser sessions use sessionStorage.

Email confirmation links can be pasted into Codeclub; they are validated against the configured project without navigating to the localhost redirect. Market connections are scoped to the account and stored separately from the configurations offered by that PC.

## Future execution

The proposal is a provider agent within Codeclub that receives authorized jobs and runs the local model or API configured there. Consumers must not receive the provider's API key or use their own key to execute a remote offer.

Transport remains undecided: a persistent outgoing connection and relay, or a direct connection when viable. Publishing an offer does not require exposing a public IP. Actual connectivity, NAT traversal, device authentication, streaming and transport encryption are not implemented. A custom protocol can define messages and states, but confidentiality must rely on standard encryption; only being understood by the app does not itself provide security.

Proposed flow: authenticated consumer → authorized request → available provider → execution → response/stream → usage measurement → settlement. Atomic acceptance, quotas, concurrency, queues, cancellation, retries, expiration and recovery after disconnection must be implemented. The database currently creates pending requests, but provides neither transitions nor a worker.

## Future payments

The goal is usage billing split between provider earnings and platform commission. Before enabling it, define pricing, metering, minimum amounts, network/currency, wallet, responsibility for network fees, settlement and failed-request handling. Payment confirmation and balances require trustworthy verification; they must not depend on local client claims. Contracts, wallets, deposits, balances and payments are not implemented.

## Status and next steps

**Implemented:** account and persistent session, online publication, catalog, search, edit/pause/delete, connection to chat selectors and Spanish/English translations.

**Pending:** heartbeat, remote transport/execution, request worker, streaming/cancellation, actual limits and queues, metering, prices and payments. The chat blocks remote offers before reading credentials or sending a request.

Suggested order: (1) heartbeat and reconnection; (2) authenticated execution between two PCs without billing; (3) streaming and robust states; (4) limits/queues and metering; (5) payments and commission.

## Language and maintenance

The **/ → Language** command switches the interface between Spanish and English. Market, account, registration, states, labels, errors and accessible controls use `src/lib/i18n.ts` and `useAppLanguage()`. Public names, custom labels, brands and model identifiers retain user/provider wording. Documents have static versions in both languages; the slash menu does not translate them.

Keep this document aligned with its Spanish version. See [README.md](README.md) for implementation details, persistence, events, schema and previous verification results. Never include real keys, tokens or confirmation links in documentation.
