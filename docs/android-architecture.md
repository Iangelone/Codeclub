# Android architecture and maintenance

Read [Companion setup](android-companion.md) for installation and pairing and [Android Use](android-use.md) for ADB operation. The companion is a local-network client of the desktop, not an independent agent runtime.

## Source map

| Source | Responsibility |
| --- | --- |
| `android-companion/app/src/main/java/com/codeclub/android/MainActivity.java` | Bundled WebView host, restricted JavaScript bridge, native settings and asynchronous pairing. |
| `android-companion/app/src/main/assets/mobile.html` | Bilingual chats, orb, pagination, delivery status, approvals and composer. |
| `PortraitCaptureActivity.java` | Portrait QR scanner. |
| `Pairing.java` | Pairing validation and desktop TLS certificate pinning. |
| `SecretStore.java` | Android Keystore encryption for credentials and queued messages. |
| `ConnectionService.java` | Visible foreground WebSocket service, local pause and reconnection. |
| `MobileBridge.java` | Serialized application requests and encrypted outbox reconciliation. |
| `ControlService.java` | Accessibility observations, screenshots and observation-bound actions. |
| `OrbView.java` | Native orb drawing helper; the chat WebView draws its own orb. |
| `electron/android-companion.ts` | Authenticated HTTPS/WSS server, offers, revocation and command correlation. |
| `electron/mobile-sync.ts` | Authorized chat catalog and persistent desktop inbox. |
| `electron/android-use.ts` | Agent operation routing, ADB processes and renderer-local snapshots. |
| `electron/android-pin.ts` | Isolated native PIN prompt. |
| `src/lib/engine/android-tools.ts` | Model-facing schemas, native tool calls and audit metadata. |
| `src/components/OrbPairingModal.tsx` | Pairing QR/code and device status. |
| `src/components/OrbCredentialsModal.tsx` | Native PIN save, replacement and removal. |

## Lifecycle and trust

Android opens a bundled WebView; native Java owns networking and encrypted persistence. External navigation is blocked, and message text cannot execute HTML or native commands. Debug WebView inspection is available only in debuggable APKs. Android resources and bundled UI dictionaries provide English and Spanish.

The user scans a QR or pastes its complete code. Pairing runs outside the UI thread. The offer contains local addresses, a single-use token, a certificate fingerprint and expiry. These values establish private trust and must not be logged. A successful exchange saves the peer and starts the foreground service. A failed attempt can recover an existing connection.

The service authenticates a pinned TLS WebSocket and sends a versioned hello. Closing the activity does not revoke the pairing. Force-stop, battery policies or a stopped desktop may interrupt service; opening the app restores its saved connection. Local pause blocks phone observation and control while chat synchronization can remain available. Disconnect clears the local pairing; desktop unpairing revokes the server credential.

## Chat protocol

Phone requests use `app_request` with a correlation `id` and structured `request`. Desktop replies use `app_result` with the same correlation identity, an `ok` flag and a result or error. Transport identities identify attempts; a send's separate message identity stays stable across reconnects.

| Operation | Input | Result |
| --- | --- | --- |
| `sync` | Optional `chatKey` and `before` offset | Authorized catalog, visible messages, activity, approvals and delivery states. |
| `send` | Stable `id`, `chatKey`, `text` | Queued delivery or the existing matching message state. |
| `control` | `chatKey`, `action`, approval identity when applicable | Cancellation or a response to a valid desktop approval. |

Conversation keys hash normalized desktop scope and chat identity. Only registered projects are eligible. The catalog excludes filesystem paths, credentials, PINs and raw tool payloads. Visible message text is synchronized as ordinary chat content; users must avoid putting secrets in chat.

Android encrypts a send before transport. Electron persists it in `mobile.sqlite`. WorkspaceManager polls for eligible conversations and opens the matching chat through `codeclub:open-chat`. ChatInterface claims the message and executes it through the existing desktop engine. Providers, models, credentials and tools remain configured on the desktop.

Inbox states are `queued`, `accepted` and `failed`. Acceptance means the user message was committed with `mobileRequestId`, not that the model finished answering. The phone removes encrypted outbox text after observing acceptance. Duplicate identities must match peer, conversation and text; conflicting reuse is rejected. Atomic thirty-second renderer claims prevent parallel dispatch, and committed history reconciles a crash before acknowledgment. Explicit failure retry creates a new message identity.

Busy conversations wait. Queues are bounded to one hundred entries, with message text limited to sixteen thousand characters. Stop and approval responses remain transient and are not replayed offline. Desktop authority validates the active session and approval expiry. The trusted `codeclub:mobile-next`, `codeclub:mobile-take` and `codeclub:mobile-release` IPC channels accept only the main renderer. Both renderer polling effects remove their intervals on cleanup.

## Interface state

Composer drafts stay in memory per conversation; submitted messages use encrypted native storage until accepted. Older pages merge by sequence, and clearing desktop history invalidates cached pages. Initial loading shows the latest message; later updates preserve reading position. Message rendering uses text nodes and code elements.

The mobile catalog exports saved orb name, purpose, color, model, autonomy and shared shape. Desktop global palette cycling and saved per-orb color are separate settings: the right desktop sidebar follows the global palette, while mobile currently receives the saved per-orb color. Palette changes must not be mistaken for persisted orb configuration.

## Android Use

Agents discover devices with `androidListDevices`, observe through `androidGetState` or `androidScreenshot`, and act with `androidAction`. Dedicated tools lock and unlock. Opaque handles and observations belong to the calling renderer. ADB and companion may list the same phone separately; choose the observed transport.

Companion actions execute through Accessibility. Semantic references identify observed nodes; coordinate gestures additionally require a matching screen. Freshness, hierarchy changes, consumed snapshots and local pause reject stale actions. Verify the returned state after dispatch. Timeout and cancellation cannot undo delivered gestures and never justify blind replay.

ADB uses authorized native platform tools and provides additional system access without guaranteeing root privileges or bypassing Android protections. Its text injection supports printable ASCII with explicit exclusions; companion semantic insertion supports Unicode. Password nodes are redacted and ordinary typing cannot target protected fields.

Electron retrieves PINs through encrypted native credentials. ADB unlock verifies keyguard state and submits at most one PIN attempt. APK secure-keyguard unlock is not guaranteed; manufacturer restrictions, biometrics and protected windows may require local interaction or ADB. Lock confirmation depends on actual state and Android lock-delay settings; tools do not silently change those settings.

## Maintenance

Keep UI labels bilingual and comments/documentation in English. Update both endpoints when changing payloads. Distinguish transport acknowledgment, committed message acceptance and completed agent execution. Do not log tokens, decrypted storage, PINs or message bodies.

Use the build commands in [Companion setup](android-companion.md). `test-mobile-sync.mjs` covers scope, persistence, deduplication and session authority; `test-mobile-ui.mjs` covers language, rendering and pagination. Physical checks require an authorized phone and exercise pairing, portrait scanning, reconnection and control. Inspect older live fixture selectors before treating them as current UI coverage.

For connection failures, check LAN reachability, offer expiry, certificate pinning, revocation and service state. For control failures, check Accessibility and local pause. Observe again after uncertain actions. For queued messages, check the desktop renderer and whether the conversation is busy.
