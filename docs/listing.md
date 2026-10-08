# Codeclub Browser Control — Store listing draft

## English

**Name:** Codeclub Browser Control

**Short description:** Connect browser tabs to Codeclub for on-demand AI-assisted browsing.

**Category:** Productivity / Developer Tools

**Single purpose:** Connect Chromium browser tabs to the local Codeclub desktop app so its AI agent can inspect and interact with a tab when the user requests it.

**Description:**

Connect Microsoft Edge, Google Chrome, Brave, Opera, or Vivaldi to Codeclub. When you ask Codeclub to work with a browser tab, the extension returns the tab's URL, title, visible page text, and interactive controls to the Codeclub desktop app. The agent can then navigate, click, type, or scroll as requested.

The extension communicates with Codeclub on your computer over a loopback connection. It does not run a remote service, collect browsing history, or read cookies or saved browser data. Page information returned to Codeclub may be included in requests to the AI provider configured in the app. You control the extension's browser permissions and can remove it from the browser's extension manager.

## Permission justifications

- **debugger:** Required to inspect rendered page text and controls and perform the user-requested browser actions through the browser's debugging API.
- **tabs:** Required to list open tabs and obtain the title and URL of the tab selected by the user.
- **127.0.0.1 ports 47832–47842:** Required to connect to the Codeclub desktop app on the same computer. The app binds only to loopback and accepts the signed extension origin.

**Privacy policy URL:** Publish `docs/privacy.md` at a public HTTPS URL before submission.

**Support contact:** Add the publisher's support email or URL before submission.
**Store extension ID:** Confirm the store-assigned ID and add it to Codeclub's local bridge allowlist before release.
