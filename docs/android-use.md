# Android Use through ADB

See [Android architecture and maintenance](android-architecture.md) for the APK source map, shared tool routing, chat protocol and transport boundaries. [Companion setup](android-companion.md) describes control without USB or developer mode.

Codeclub's existing agent catalog now exposes `androidListDevices`, `androidGetState`, `androidScreenshot`, `androidAction`, `androidUnlock`, and `androidLock`. Chat and scheduled orb runs use the same tools, provider selection, discovery, approvals, and native bridge. Browser-only orbs cannot discover these tools; the native scheduled-worker boundary also rejects Android operations when `allowComputer=false`.

The same tool catalog also supports the [Android companion APK](android-companion.md) over a paired local TLS connection. This page documents ADB-specific behavior. Neither transport grants root access or unrestricted access to the Android operating system.

## Setup

Install [official Android Platform Tools](https://developer.android.com/tools/releases/platform-tools), enable USB debugging, connect the phone, and accept its authorization prompt. Unlock the phone locally. ADB resolution checks `CODECLUB_ADB_PATH`, `%LOCALAPPDATA%/Codeclub/platform-tools`, Android SDK environment variables, the standard Windows SDK directory, and `PATH`. The application does not download tools automatically. The local development machine's official tools were copied into the managed directory; binaries are not committed or bundled.

Discovery returns opaque device handles and the model reported by ADB. No device serial, phone model, provider, credential, or AI response is fixed in the product. See [Android's ADB documentation](https://developer.android.com/tools/adb).

## Observation and actions

1. Discover an authorized device.
2. Obtain its current state or screenshot and snapshot ID.
3. Tap an observed reference, use coordinates from the observed display, swipe, type into an observed focused text field, or navigate with Back, Home, Recents, Enter, or Delete.
4. Inspect the returned state and verify the requested outcome before continuing.

Wake only turns on the display and does not need a prior snapshot; it does not unlock the phone. Other actions require the latest snapshot for the selected device, no older than one minute. Native operations are serialized across renderer sessions. Each renderer owns its device handles and observations. Accessibility changes, display changes, and changed pixels for coordinate actions invalidate the previous observation. Display dimensions come from the actual PNG capture and account for orientation.

`androidUnlock` accepts only the opaque device handle. It wakes the screen, checks Android's actual keyguard state, dismisses unsecured locks, and uses the device PIN from the encrypted native vault for secure locks, falling back to an isolated desktop password prompt when none is saved. Prompt labels come from the shared English/Spanish catalog. Decrypted PINs stay in transient native memory: no model argument, chat result, audit event, plaintext file, or complete ADB argument contains them. Hardware digit events support secure screens that hide accessibility nodes. Secure input requires a confirmed unobscured keyguard; unsupported, changed, or unknown lock states fail. Only one PIN attempt is submitted, followed by bounded state polling; failures never replay the PIN. Cancellation closes the prompt and aborts operations. This tool does not bypass a pattern or biometric authentication and asks for the PIN only when no saved device credential is available.

UI Automation sometimes returns a null root during transitions or on specific app screens. Codeclub retries the observation once, never the dispatched action. If the hierarchy remains unavailable but the display can be captured, state explicitly reports screenshot perception and no semantic elements. A vision-capable model can request `androidScreenshot`, which returns the matching snapshot and a native SDK image result. Navigation remains available on an unchanged observed screen. Text-only agents must report the unavailable controls rather than invent them. Typing is rejected without an observed unprotected focused field.

ADB text injection supports printable ASCII here and rejects percent signs and Unicode explicitly. It appends text rather than replacing an entire field. Shell quoting preserves spaces, apostrophes and metacharacters as literal input. A companion input service is required for reliable Unicode and broader Android integration.

Password nodes are redacted, and protected fields reject semantic interaction. Explicit screenshots contain the visible display and must be treated as sensitive observations. Android audit records contain operation metadata, not input text, device identifiers, accessibility contents, or images. As with existing computer tools, chat tool results still provide observations to the agent; users should configure credentials through the existing credential flow.

Cancellation aborts active subprocesses and invalidates queued operations and snapshots. An uncertain action dispatch returns `dispatched=true` and requires another observation before deciding whether to retry. Renderer destruction and app shutdown stop their controllers. Embedded browser and foreign renderer content cannot invoke Android IPC.

## Verification

```powershell
npm run electron:compile
node scripts/test-android-use.mjs
npx tsx scripts/test-android-tools.mjs
node scripts/test-android-pin.mjs
node scripts/test-android-bridge.mjs
node scripts/test-android-use.mjs --live
node scripts/test-android-interaction-live.mjs
```

The first two test scripts use isolated fixtures for parsing, password redaction, opaque IDs, changed/consumed observations, pixel checks, bounds, unsupported text, quoting, uncertain dispatch, cancellation, renderer-session isolation, bilingual discovery, schema validation, native command mapping, and audit privacy. The bridge script uses the real Electron main process, preload and authorized USB device; it checks discovery, invalid snapshot rejection, stop, and rejection of foreign renderers.

Live checks require exactly one authorized phone. Navigation checks capture the actual display and compare accessibility observations around Recents and Back. The optional interaction script requires Chrome, creates a local HTML input/scroll fixture, temporarily reverses its randomly selected loopback port through ADB, and tests actual touch, literal typing, and swipe. Its cleanup returns to Home and removes only that reverse mapping. Run physical-device tests sequentially, keep the phone unlocked, and do not interact with it during a test. These scripts do not use an AI model or credentials and do not prove every model's ability to operate every Android app.

On October 10, 2026, initial real detection, 1080×2400 capture, Recents and Back passed on the authorized Motorola moto g71 5G running Android 12. The Settings search screen exposed the null-root limitation and motivated the explicit screenshot fallback. The checks are narrower than a full Android compatibility certification.

After recovery changes, sequential live navigation checks passed again. The local Chrome fixture also passed tap, literal `Codeclub ' & test` input, and swipe with changed observed positions. The fixture explicitly blurs its input and observes again before swiping, avoiding the blinking caret and keyboard transition in its pixel comparison. Electron/preload isolation, catalog/schema checks, accessibility checks, orb chat checks, Next/Electron builds, TypeScript and diff validation passed.

The existing real orb was then opened in the running development app and asked only to call `androidListDevices`. With its user-selected `nvidia/nemotron-3-super-120b-a12b:free` OpenRouter model, it reported the actual `moto g71 5G` in authorized `device` state. The [public provider catalog](https://openrouter.ai/api/v1/models) reported zero prompt and completion pricing before this run. This selection belongs to user configuration, not product code. This live model check covers discovery; physical interaction checks above run the real native tools directly.

The numeric-PIN unlock was verified on the same authorized phone after putting it to sleep: the native tool returned `ok=true`, `unlocked=true`, and `dispatched=true`. The PIN was supplied only to transient test memory, not written into product code or artifacts. Keyguard dismissal can complete after its animation; bounded polling handles that delay without submitting the PIN again. Isolated Electron tests cover the masked English/Spanish prompt, its lack of an application bridge, and cancellation. Native fixtures cover occluded keyguards, cancelled prompts, rejected PIN-bearing tool requests, and single-attempt failures.

`androidLock` sends the Android sleep key and verifies the actual keyguard state with bounded polling. It reports `locked=true` only after confirmation; delayed device lock settings may produce an unconfirmed result. It never changes those settings. A real lock/unlock round trip passed on the authorized phone, with both operations returning confirmed state.

## Orb credentials

The middle control in the right Orb sidebar opens the compact Credentials modal (Claves in Spanish). It currently configures Android PINs only. Devices are discovered through the same native controller; unauthorized or offline devices cannot be selected. Multiple connected phones require an explicit selection. Save, replace and remove use native IPC; the renderer can query only whether a PIN is present, never retrieve a saved value. No credentials are placed in localStorage or messages.

The existing native credential vault encrypts each PIN with Electron safeStorage (Windows DPAPI), bound to a SHA-256 identity derived privately from the physical device serial. Device handles remain opaque and renderer-local, while encrypted credentials survive app restarts. The native unlock callback resolves the matching credential without exposing it to the agent. Android PIN keys cannot be used by HTTP authorization. The modal uses the existing focus trap, background isolation, Escape dismissal and focus restoration, with masked input and shared English/Spanish labels.

Verification covers encrypted replacement/removal, persistence across vault instances, HTTP credential rejection, device identity isolation, actual Electron IPC and safeStorage, and modal save/reopen/removal/language/focus behavior. A physical lock/unlock check also passed using a stored PIN in a temporary isolated Electron profile, without an additional secret prompt. That profile was removed after verification.
