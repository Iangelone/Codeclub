# Windows control with text models

Codeclub converts the interface into a JSON map of elements. The model chooses
a reference and an action; Electron resolves the target, performs the action, and
returns a fresh observation. No image needs to be sent to the chat model.

## Implemented

- UI Automation: windows by handle, observation-scoped references, hierarchy,
  names, roles, text, values, focus, state, and supported patterns.
- Semantic actions: `setValue`, `toggle`, `select`, `expand`, `collapse`, and
  `scroll`. `click` prefers InvokePattern or SelectionItemPattern.
- Keyboard: `type` inserts literal Unicode (including `+^%{}`); `key` uses
  SendKeys (`^a` selects all, `{ENTER}` confirms). `setValue` replaces a field;
  `type` inserts at the current focus/selection.
- Local Spanish/English OCR in Electron, with data bundled in the installer.
  The worker is reused and shut down after inactivity. Regions can be cropped
  and enlarged 2x when dimensions allow. It reads Tesseract 7
  `blocks/paragraphs/lines`; earlier code looked for `data.words`, which no
  longer provides those boxes.
- Combined map: retains accessible controls and adds OCR regions for extra
  labels. Each region has a source, confidence, and reference. A text region is
  not presented as a confirmed button.
- Coordinates use physical pixels, capture origin, scaling, and monitors with
  negative coordinates. They are not confused with CSS pixels or Electron DIPs.
- Observations remain valid for 90 seconds; every mutation invalidates earlier
  observations. UIA targets are resolved again inside their window and process.
  OCR actions require the window and region capture to remain unchanged before
  clicking.
- Persistent, hidden PowerShell host, JSON requests over stdin, timeout,
  serialized operations, and cancellation through AbortSignal or overlay Escape.
- Results include `dispatched`, `verification`, and `state`: dispatching a click
  does not mean the user's goal was achieved. Actions are not retried
  automatically, avoiding duplicate submissions.
- Audit metadata excludes typed text and screenshots. Fields marked as
  passwords by UIA, protected ancestors, and Win32 edits with ES_PASSWORD are
  excluded and masked. This cannot identify arbitrary secrets drawn on screen.

## Tool workflow

The Computer Use specialist activates for requests involving Edge, Chrome,
Firefox, Safari, and other Windows windows. For Edge/Chrome/Brave, it first
checks for the extension using `externalBrowserList` and uses
`externalBrowserState`/`externalBrowserAction` to access the DOM of open tabs.
Local CDP is also supported when the browser was started with an allowed
endpoint. If the extension is missing or the page is incompatible, it can use
visual operations through `computerListWindows`, `computerGetState`,
`computerOcr`, and `computerAction`. `browserAction` controls Codeclub's embedded
WebView.

1. `computerListWindows({})`: choose `windows[].windowId`.
2. `computerAction({action:"focus", windowId:"…"})`: observe the returned
   `state`.
3. Find the control in `state.elements` and choose an available action.
4. `computerAction({action:"setValue", snapshotId:"…", ref:"e12", text:"Hello"})`.
5. Use the **new** `state.snapshotId`. Check the value/state before continuing.
6. If the control is missing, call `computerOcr({windowId:"…"})`; click its
   reference and check focus in the new state before typing.

For large interfaces, `computerGetState` accepts `query` and `offset`. The result
reports `truncated`, `nextOffset`, and `textTruncated`. A traversal is limited to
250 elements per response, 1,500 visited elements, depth 15, and a time budget.
A partial response that omits an element does not prove it is absent.

For small text or a changing region, pass a crop to `computerOcr`:

```json
{"windowId":"…","region":{"x":100,"y":200,"width":500,"height":180}}
```

The region uses physical coordinates returned by the map. If animation or a
cursor changes the crop's pixels, the action is rejected; observe again or
narrow the crop. UIA actions do not depend on matching screenshots.

`computerScreenshot` remains available for explicit image requests; it is not
included by default in the selected PC-control tools or the text-based
specialist. The embedded browser retains its existing DOM tools.

## External browser extension

The official Codeclub extension connects to tabs already open in Edge, Chrome,
Brave, and other compatible Chromium browsers. It uses `chrome.debugger`, the
extension's CDP transport, and a local WebSocket that accepts only the signed
extension origin. It does not ask users to close or restart the browser or
enable debugging ports. The browser displays its debugging indicator while
connected.

For installation, updates, permissions, tab groups, recovery, and exact agent contracts, use [Browser Control: user and agent guide](browser-control.md). Edge's Install action opens the published Add-ons listing; development uses an unpacked copy loaded from `browser-extension`. Keep Codeclub open for normal use. Standalone debug scripts require it completely closed.

`externalBrowserList` returns observed browser/tab/window identities and the connected extension ID. `externalBrowserState` returns a one-minute, tab-scoped snapshot. `externalBrowserAction` requires that snapshot for click/type/key/scroll, consumes it, and returns fresh state. HTTP/HTTPS navigation uses the observed tab identity without a snapshot, including from protected source pages. `externalBrowserTabs` manages tabs/groups through the companion without a DOM snapshot.

The companion activates tabs and checks visibility before input; an accepted command alone does not establish task success. Password values are omitted, cookies/storage are not read, and arbitrary page JavaScript is not exposed. Visual Computer Use remains a separate integration with its own observations and limitations. Loopback CDP on ports 9222–9232 or explicit ports is also supported for DOM actions; the companion tab-management tool is not implemented by direct CDP.

## Beyond OCR: OmniParser

The [Microsoft OmniParser contribution](https://github.com/microsoft/OmniParser)
detects interactive regions and describes icons. For example, it can return
`IconCandidate: Open settings` where OCR would find only text or nothing. The
[OmniParser V2 documentation](https://www.microsoft.com/en-us/research/articles/omniparser-v2-turning-any-llm-into-a-computer-use-agent/)
explains detection and functional descriptions. The official README reviewed on
September 4, 2026, includes a July 2026 update: a YOLOv9-E detector with
instructions for weights published in a PR. Those weights are not assumed to
be downloaded or validated for accuracy in Codeclub.

The connector is implemented. **The OmniParser server and weights are optional
and were not installed with this change.** Tesseract remains available without
them. OmniParser does process images locally; only the chat model avoids
receiving images. This does not eliminate all visual processing.

Setup:

1. Install OmniParser and its weights using the current official README. Keep
   that Python environment separate from the Electron project.
2. From `OmniParser/omnitool/omniparserserver`, start the official server:

   ```powershell
   python omniparserserver.py --host 127.0.0.1 --port 8000 --caption_model_name florence2 --caption_model_path ../../weights/icon_caption_florence
   ```

3. Start Codeclub from a session with this variable:

   ```powershell
   $env:CODECLUB_OMNIPARSER_URL = 'http://127.0.0.1:8000'
   npm run dev
   ```

4. Call `computerOcr({windowId:"…", engine:"omniparser"})`.

The adapter uses the official [POST /parse/](https://github.com/microsoft/OmniParser/blob/master/omnitool/omniparserserver/omniparserserver.py)
contract: it sends `base64_image`, validates `parsed_content_list`, converts
normalized boxes to physical pixels, and discards the output image. It accepts
HTTP only on `127.0.0.1`; redirects, credentials, and remote hosts are rejected.
Its timeout is 45 seconds. If the service fails, it returns the UIA map and an
explicit OCR error. The model can continue with `engine:"tesseract"`.

Icon descriptions are predictions; they do not guarantee meaning or success.
OmniParser inference accuracy was not tested; its HTTP transport and validation
were tested with a stub server.

## Verification

```powershell
npm run electron:compile
node --test scripts/test-computer-use.mjs
npx tsx --test scripts/test-computer-tools.ts
node scripts/verify-computer-use.mjs
npm run next:build
git diff --check
```

The integration opens a disposable WPF window and interacts only with it. It
checks ValuePattern writing, InvokePattern, TogglePattern, focus, literal Unicode,
password masking, OCR of text drawn in an image, clicking an OCR reference, and
the resulting change. It also checks the local HTTP contract with a stub; it
does not download or run OmniParser weights. Its process is closed afterward.

Tool tests cover error propagation, cancellation, and auditing without input
text. Engine tests cover consumed/expired references, negative coordinates, and
parser validation.

The project's Next build skips type validation, so run `npx tsc --noEmit` separately. The October 8 checks passed TypeScript as well as the Next and Electron builds. Earlier errors mentioned in this document are historical, not current results. See [the October 8 audit](tool-audit-2026-10-08.md) for later external-browser verification.

No full manual regression covered language switching, projects, persistence,
panel resizing, browser selection, or terminals. Their UI was not changed. No
conversation with a real provider was run, and no signed installer was
validated. Native resources go in `extraResources` so PowerShell can open the
script outside app.asar.

## Operational limits

Windows must be unlocked and the target application must be in the foreground.
UAC, secure desktops, and apps at a higher integrity level may reject input.
Some older apps expose only Panes, and canvas apps or games may lack accessible
semantics. OCR provides text in those cases; icons require the optional parser
or another specific integration. Universal control is not guaranteed.

Technical references: [UI Automation control patterns](https://learn.microsoft.com/en-us/dotnet/framework/ui-automation/ui-automation-control-patterns-overview)
and [Tesseract.js output format](https://github.com/naptha/tesseract.js/blob/master/docs/api.md).
