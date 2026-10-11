# Codeclub Android companion

See [Android architecture and maintenance](android-architecture.md) for the source map, lifecycle, protocol and delivery states.

The Android companion uses the existing Android tools over an authenticated local network connection. Normal screen control requires Android 11 or newer and the Codeclub Accessibility service; USB, ADB and developer mode are not required after installation. ADB remains an independent fallback for privileged operations that Android does not expose to ordinary applications.

## Connect

1. Install the locally built APK and open Codeclub on Android.
2. Open your orb in the desktop app. Select **Connect Android** beside Settings, Credentials and Clear chat.
3. Keep both devices on the same Wi-Fi network. Scan the QR in the Android app, or copy the complete pairing code and paste it into **Enter pairing code**.
4. Enable **Codeclub Android Use** in Android Accessibility settings. Android requires an explicit permission grant. Recent Android versions may require allowing restricted settings for a sideloaded app.
5. Use the existing `androidListDevices`, `androidGetState`, `androidScreenshot`, `androidAction`, `androidLock` and `androidUnlock` tools. Choose the observed `transport=companion` device for APK control; an ADB connection may be listed separately.

Pause control from the app or its ongoing notification. Paused devices reject observation and actions. Disconnect removes the phone's saved connection. Unpair from the desktop modal revokes the server credential and disconnects that phone. A fresh QR is required to reconnect after revocation. Multiple phones are identified generically in the interface; hardware serials and personal device names are not shown.

The desktop must stay running. Wi-Fi isolation, VPN routing and Windows firewall rules can prevent a connection even when the QR is valid. Permit only the Codeclub executable on the intended local network; do not disable the firewall. Connection retry uses bounded backoff and never replays actions. A changed desktop address requires a new pairing code. Pairing expires after three minutes and is single use; closing or refreshing its dialog invalidates unconsumed codes.

## Trust and credentials

The QR carries a random 256-bit pairing token, a SHA-256 certificate fingerprint and local addresses. HTTPS and WebSocket TLS authenticate the desktop by that exact fingerprint, including certificate validity checks. Redirects are disabled. This private trust relationship does not accept arbitrary certificates or cloud relays. Only the linked device secret authorizes a WebSocket connection; access is unavailable before the versioned hello handshake.

Desktop TLS identity and device credentials are encrypted using Electron safeStorage (Windows DPAPI). Android stores the connection using AES-GCM with a non-exportable Android Keystore key. Backup and device transfer exclude saved credentials. No pairing secrets, PINs or API keys belong in logs, chat, localStorage, source or build artifacts. The UI does not display saved secrets. Corrupt connection storage produces an unavailable connection without replacing the encrypted data or preventing the rest of the desktop app from opening.

Companion PIN credentials are bound to both its opaque device identifier and current pairing secret. Pairing again rotates that identity: configure the PIN again if needed. An already-unlocked device never asks for a PIN. PIN retrieval occurs only inside Electron, never in a model-facing tool argument.

## Chat synchronization

The compact Android screen is a client of the existing desktop chats and orb. Its bundled WebView cannot navigate to remote pages or fetch network content; paired HTTPS/WebSocket transport remains native. The QR capture activity stays in portrait orientation. Connection, accessibility, pairing and disconnect actions live in one overflow menu.

Authenticated `app_request`/`app_result` frames synchronize registered global/project chats, orb name/color/shape/model/purpose, paginated messages, live answers and pending approvals. API credentials, PINs, raw tools and project paths are not included in the synchronization catalog. Message text remains the same text shown in the desktop chat; code blocks render as text, and message content cannot invoke native actions. Agent execution always uses the desktop's current configuration and normal chat engine.

Android encrypts unsent messages with its Keystore key. Stable message identities and the desktop SQLite inbox prevent reconnect/retry duplication. Accepted messages become ordinary chat history with `mobileRequestId`; queued messages wait for an existing run to finish. A failed dispatch is shown with an explicit retry action. Stop and approval responses reuse the desktop session authority, which validates the current session and approval expiry. The desktop must remain running on the same reachable network.

`codeclub:mobile-next`, `codeclub:mobile-take` and `codeclub:mobile-release` are trusted IPC requests from the main renderer only. WorkspaceManager polls for queued conversations and emits the existing `codeclub:open-chat` event with `{ chatId, projectPath, name, projectName, customName }`. ChatInterface consumes the selected chat after history loading, claims the queued message and sends through its existing engine. Both polling effects remove their intervals during cleanup. The persisted user message acknowledges delivery; session ownership and an atomic claim prevent parallel renderers from sending twice. A crash before acknowledgment requires reconciliation against stored history.

Run `node scripts/test-mobile-sync.mjs` and `node scripts/test-mobile-ui.mjs` for SQLite/ownership/scope/approval and ES/EN/interface checks. `node scripts/test-mobile-live.mjs` uses the already-paired phone and verifies the configured model's public pricing is zero before a real message. It checks both synchronization directions and duplicate retries. `node scripts/test-mobile-portrait.mjs` verifies the real scanner's portrait activity and rotation. WebView debugging is enabled only for a debuggable APK and uses an ADB-local forwarding socket; release builds disable it.

## Android control limits

Accessibility exposes semantic nodes, Unicode text insertion, taps, swipes, navigation and the global lock action. Password nodes are redacted and ordinary typing cannot target password fields. Protected windows can refuse screenshots. Secure keyguard controls differ between manufacturers: the APK cannot promise PIN unlock or bypass biometrics, app sandboxes, Android permissions, root protection or protected content. Unsupported operations report a failure instead of pretending success; use ADB or unlock locally when required.

Each action must use a fresh observation from its own renderer session. Consumed, expired and changed observations are rejected. Android confirms dispatch and returns a new state; the agent must verify its objective against that state. A timeout, disconnect or cancellation can leave an action's outcome uncertain and requires another observation. Cancel cannot undo a gesture already delivered to Android.

The companion runs a visible foreground service. Android battery policies and force-stop can still stop it; open the app again to reconnect. No boot receiver silently starts control. Camera permission is needed only for QR scanning; manual pairing remains available when the camera is unavailable. Notification permission improves visibility on Android 13+, while the service still obeys Android's foreground requirements.

## Build and verification

Use JDK 17, Android SDK 35, Build Tools 35.0.0, Gradle 8.11.1 and AGP 8.9.3. The build script honors installed `JAVA_HOME` and `ANDROID_HOME`; its managed toolchain fallback is under `%LOCALAPPDATA%/Codeclub/android-build-tools`.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-android.ps1 -Lint
npm run electron:compile
node scripts/test-android-companion.mjs
node scripts/test-android-use.mjs
npx tsx scripts/test-android-tools.mjs
node scripts/test-orb-chat.mjs
npm run next:build
npx tsc --noEmit
git diff --check
```

The APK is `android-companion/app/build/outputs/apk/debug/app-debug.apk`. It is a development build signed with the developer's local Android debug key; it is not a store release. Do not commit build outputs, signing keys, local SDK paths or credentials. Distribution requires a separately managed release signing key; keep that key stable for future updates.

Transport tests use a real temporary TLS/WebSocket server and an isolated encrypted store. They cover token replay/expiry, owner isolation, encrypted persistence, invalid authentication, per-chat snapshots, cancellation, revocation and restart. Orb UI checks cover QR refresh, pairing status, failure recovery, English/Spanish labels, Escape and focus restoration. These fixtures do not certify every Android manufacturer or replace physical camera/network/control checks.

Physical verification on Android 12 passed QR pairing, desktop restart/reconnection, pinned TLS, screenshots, Unicode input, taps, swipes, navigation, pause and local resume. Run `node scripts/test-android-companion-live.mjs` with an already-paired development profile and an available phone. The harmless browser fixture is served locally; ADB opens the fixture and restores control locally after pause. Agent actions use the Wi-Fi companion transport. Local resume uses observed keyboard focus because manufacturer accessibility bounds can disagree with touch coordinates. Unchanged status text is not reassigned during UI polling, avoiding redundant accessibility announcements.

Primary references: [AccessibilityService](https://developer.android.com/reference/android/accessibilityservice/AccessibilityService), [AGP 8.9 compatibility](https://developer.android.com/build/releases/agp-8-9-0-release-notes), [connected-device foreground services](https://developer.android.com/develop/background-work/services/fgs/service-types#connected-device), [Android backup exclusions](https://developer.android.com/about/versions/12/backup-restore#xml-changes), [ZXing Android Embedded](https://github.com/journeyapps/zxing-android-embedded), [OkHttp](https://square.github.io/okhttp/).
