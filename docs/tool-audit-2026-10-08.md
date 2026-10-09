# Tool audit — October 8, 2026

## Scope and current result

The initial review inspected the complete local tool catalog, discovery variants, agent adapters, schemas, executors, errors, and IPC/event boundaries. Static review did not execute every integration. Later checks used real Electron, Chromium, CDP, and the user's Edge companion without model-provider calls.

**Final external-browser result: 22/22 extended checks passed in the user's Edge profile and in an isolated Edge profile.** Tab/group operations, scroll, navigation, reload, ungroup, cleanup, and restoration of the previous active tab also passed. This does not certify all tools, all browsers, or all websites. See [the user and agent guide](browser-control.md) for current contracts; historical failures below are superseded only where explicitly verified.

## Catalog corrections

- Common wrappers return operational exceptions as `ok:false` and preserve cancellation propagation. `error` and `isError:true` results no longer become success in `executeTool`.
- Swarm schemas include `swarmId` and `childId`; child creation returns identities, and missing-child operations fail.
- `updatePlan` validates the step before changing title/status. `stepId` and `stepStatus` must be supplied together; validation errors do not partially mutate the plan.
- TODO add requires a title; update/remove require an ID; removing a missing ID fails.
- `runCommand` allows omitted `args`, matching its executor's empty-array default.
- `computerAction` focus rejects missing `windowId` and `targetName` before native execution.
- Tool descriptions distinguish tab IDs, window IDs, extension/CDP transport, and the embedded browser's keyboard selector.
- Auxiliary agents inherit the full context, including project/chat scope.
- `createMcpServer` no longer repeats configuration/env/args in creation results or manual audit metadata. This is not a complete transport-wide secret audit.
- Plugin/skill creation reports availability for the next message, matching the catalog captured at generation start.
- `manageMcpServer` update rejects missing `configJson`; `manageOrb` create does not silently update an existing ID.

## Remaining limits

- Browser-protected pages can reject scripting. HTTP/HTTPS navigation now works without a source DOM snapshot; DOM interaction still requires observation. This does not bypass browser security boundaries.
- Remote MCP schemas and behavior depend on their servers; reviewing adapters does not validate every remote tool.
- Large screenshots and UIA trees can still produce substantial context. DOM deduplication and incremental terminal reads do not compress every observation format.
- Swarm stop changes shared in-memory state; it does not establish cancellation of an active model call. Lifecycle verification remains necessary.
- Embedded-browser tools use event consumers and timeouts. Missing consumers can still cause errors; no simulated success was introduced.
- No provider run measured actual token savings during this audit. Build success does not certify all UI workflows.

## Local tool inventory

`askUser`, `browserAction`, `computerAction`, `computerGetState`, `computerListWindows`, `computerOcr`, `computerScreenshot`, `createExtension`, `createMcpServer`, `createPlan`, `createSkill`, `deleteExtension`, `deleteMcpServer`, `deleteSkill`, `editPluginResource`, `executeTool`, `externalBrowserAction`, `externalBrowserList`, `externalBrowserState`, `externalBrowserTabs`, `getBrowserState`, `getExecutionLog`, `getTaskStatus`, `listAvailableTools`, `listFiles`, `listResources`, `listScheduledTasks`, `loadSkill`, `manageMcpServer`, `manageOrb`, `manageScheduledTask`, `openBrowser`, `readFile`, `runCommand`, `scheduleTask`, `searchChatContext`, `searchPlugins`, `searchSkills`, `searchText`, `searchTools`, `subagent`, `swarm`, `switchProject`, `terminal`, `todo`, `updatePlan`, `writeFile`.

## Native tool verification

`node scripts/debug-real-tools.mjs` loads the original renderer definitions into a hidden Electron instance with a temporary project/profile. Calls cross real preload/IPC and native handlers; no model provider or simulated native result is used.

Passed: schema discovery, Unicode file paths, preserved ENOENT errors, a finite command with exit code 0, browser discovery, terminal command submission with automatic Enter, incremental reads, full rereads, and VT removal. The isolated instance had no connected external browsers. Cleanup removes only its temporary project/profile and adds no application debug endpoint.

`test-browser-extension.mjs` and `test-external-browser.mjs` passed with a real extension in isolated Chromium and a real CDP connection, respectively: discovery, DOM inspection, clicks, text insertion, and password-value omission.

## Protected-page navigation

`externalBrowserAction navigate` now uses observed browser/tab identities and an HTTP/HTTPS URL in `text`, without requiring a snapshot. The companion calls `tabs.update` without scripting the source page. Navigation invalidates earlier tab snapshots. CDP uses the same navigation contract; DOM actions still require snapshots.

The isolated extension regression starts at a protected extension gallery, confirms inspection fails, navigates to a local fixture, and verifies DOM/input. It rejects `javascript:` URLs and snapshots from before navigation. It also passed using the installed Edge executable, a temporary profile, and Microsoft Edge Add-ons as the protected source. No site-specific production exceptions were added. No package was published or signed during this work.

The isolated test accepts `CODECLUB_BROWSER_EXECUTABLE` and `CODECLUB_PROTECTED_TEST_URL`; only the test copy's bridge port changes. `CODECLUB_BROWSER_HEADED=1` also passed with a visible Edge window.

## Tabs and groups

`externalBrowserTabs` adds create, activate, move, group, ungroup, updateGroup, listGroups, update (pinned/muted), reload, and close. It requires the connected companion and `tabGroups` permission, not a DOM snapshot. IDs come from discovery/results. It does not expose arbitrary browser API or JavaScript execution.

Both isolated Edge and the connected user profile verified creation, activation, pin/mute and reversal, ordering, group membership, title/color, collapse/expand, reload, ungroup, and closing only fixture tabs. API references: [tabs](https://developer.chrome.com/docs/extensions/reference/api/tabs), [tabGroups](https://developer.chrome.com/docs/extensions/reference/api/tabGroups).

`debug-live-browser.mjs` and the extended harness require Codeclub completely closed so a standalone bridge can connect. They use local fixtures, create three tabs and a temporary group, close only their own tabs, restore the prior active tab, and make no model calls.

## Live debugging chronology

1. The first connected-profile run passed tab/group management. Typing reported success but the observed field remained empty. The remaining DOM flow was not certified; cleanup succeeded.
2. `Page.bringToFront` and explicit field focus improved the basic fixture. A subsequent basic run passed exact Unicode input, keyboard, an observed click result, scroll, navigation, reload, ungroup, and cleanup.
3. The extended 22-check run initially passed 13 and failed 9. Fixes preserved selection during insertion, exact multiline whitespace, readonly click usability, scroll-to-control positioning, window focus, and virtual key codes. Isolated checks validated these changes.
4. After reloading, the user profile passed 15/22. Failures remained in Ctrl+A replacement, checkbox, radio, select, dynamic removal, local link, and local form submission. Waiting 300 ms and observing again did not resolve them; scroll also timed out. Input insertion generated trusted input events, while the fixture did not record corresponding clicks/keys.
5. Explicit `Input.setIgnoreInputEvents(ignore:false)` passed isolated tests, including a temporary worker copy simulating disabled input, but did not resolve the user's failures. Simulated minimization and frozen lifecycle checks also passed in isolation and did not establish the user's cause.
6. Added fixture frame/visibility diagnostics showed `hidden:true` and zero rendered frames in the user profile. Input now explicitly activates the tab, restores a minimized window, brings the page forward, and checks visibility. If it remains hidden, input is not sent and an explicit error replaces the previous apparent success.
7. The full isolated run exposed a separate multiline-link failure: the bounding box center fell between text fragments. Coordinates now use a visible `getClientRects` fragment after two animation frames following scrolling, and `elementFromPoint` rejects covered targets. This keeps native CDP input; no synthetic click or site-specific selector is used.
8. The isolated extended suite then passed **22/22**. After reloading, the real profile correctly rejected input while its page remained hidden. The user closed worker inspection and brought the main browser window forward. The next real-profile run passed **22/22**, exit code 0, plus scroll/navigation/reload/ungroup/cleanup. Those two user actions occurred together, so their individual contributions were not isolated.

The connected unpacked extension was `pomkkenhcjkfjdabdhogladflacafopd`; no second companion was connected in the identity check. The bridge now returns `extensionId` from its already-validated WebSocket origin, allowing installations to be distinguished. The store identity remains separate.

The Computer Use helper rejected Edge capture because it could not determine the URL confidently. No GUI input followed that rejection. Browser verification continued through the explicitly authorized standalone extension tools.

## Reconnection and release status

`ERR_CONNECTION_REFUSED` means no listener accepted the requested loopback port, such as with Codeclub closed between tests. A retry bug reset backoff at every scanned port. The fix preserves increasing delay across scans; the regression checks 1, 2, 4, 8, 15, and 15 second inter-scan waits. Wake-up alarms and duplicate-socket protection remain.

No new extension package was published and no version was changed. At the end of browser testing the repository manifest was still 1.0.1. Subsequently, version 1.0.2 was prepared at the user's request as `release/codeclub-browser-control-1.0.2.zip`, with manifest.json at the archive root; creating this ZIP does not publish it. Store installations require a separately published update; unpacked installations require Reload after source changes.

## Final verification

Passed: `next:build`, `electron:compile`, `tsc --noEmit`, `git diff --check`, origin validation, reconnection regression, isolated extended Edge checks, and the real-profile 22-check run. The full language/project/persistence/resizing/UI matrix was not rerun as part of this browser audit. Raw observed results, not final model prose, support the browser outcome.
