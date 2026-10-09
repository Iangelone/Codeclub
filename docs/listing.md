# Codeclub Browser Control — Store listing draft

## English

**Name:** Codeclub Browser Control

**Short description:** Connect browser tabs to Codeclub for on-demand AI-assisted browsing.

**Category:** Productivity / Developer Tools

**Single purpose:** Connect Chromium browser tabs to the local Codeclub desktop app so its AI agent can inspect and interact with a tab when the user requests it.

**Description:**

Connect Microsoft Edge, Google Chrome, Brave, Opera, or Vivaldi to Codeclub. When you ask Codeclub to work with a browser tab, the extension returns the tab's URL, title, visible page text, and interactive controls to the Codeclub desktop app. The agent can then navigate, click, type, press supported keys, scroll, and manage tabs and groups as requested.

The extension communicates with Codeclub on your computer over a loopback connection. It does not run a remote service, collect browsing history, or read cookies or saved browser data. Page information returned to Codeclub may be included in requests to the AI provider configured in the app. You control the extension's browser permissions and can remove it from the browser's extension manager.

## Permission justifications

- **debugger:** Required to inspect rendered page text and controls and perform the user-requested browser actions through the browser's debugging API.
- **tabs:** Required to list open tabs and obtain the title and URL of the tab selected by the user.
- **tabGroups:** Required to create and update requested tab groups, including title, color, membership, and collapsed state.
- **alarms:** Required to wake the Manifest V3 worker for reconnection while Codeclub is available.
- **127.0.0.1 ports 47832–47842:** Required to connect to the Codeclub desktop app on the same computer. The app binds only to loopback and accepts the signed extension origin.

**Privacy policy URL:** Publish `docs/privacy.md` at a public HTTPS URL before submission.

**Support contact:** Add the publisher's support email or URL before submission.
**Edge store extension ID:** `bomojefgeconjddklieajpeimnjkkbbb`. The bridge also accepts the unpacked key identity `pomkkenhcjkfjdabdhogladflacafopd`; unrelated origins are rejected. Current source changes require a separately published store update.

## Notes for certification (under 2,000 characters)

Codeclub Browser Control is a companion to the Codeclub Windows desktop app. The app must be installed and running locally for the extension to connect. The extension does not contain an AI model or provider credential; AI-assisted tasks use the provider configured separately by the user in Codeclub.

To review: install the extension, start Codeclub, and request a list of external browser tabs. Keep the main Edge window visible. On a disposable page, request inspection, text entry, a click, and navigation, then verify the returned page state. Create disposable tabs to review grouping, group name/color/collapse, ungrouping, and closing those tabs.

Version 1.0.2 adds tab/group management and fixes input readiness, multiline click positioning, and reconnection backoff. debugger is used for requested page inspection and native input; tabs and tabGroups support tab/group operations; alarms wakes reconnection. Communication is through loopback ports 47832–47842, not an extension vendor server.

Password input values are omitted; cookies and browser storage are not read. Page information returned to Codeclub may be sent to the AI provider selected in the desktop app. Browser-protected pages may reject inspection. Navigation can leave such a page without scripting it. No arbitrary JavaScript tool is exposed.

## Packaging reference

Use `npm run package:browser-extension`. See [extension development and publishing](browser-extension-development.md) for ZIP layout, key removal, versions, certification, and porting. Store submission remains a separate publisher action. Publish the privacy policy and fill in support/contact details before submitting.
