# Codeclub Browser Control — Privacy

**Draft for the browser-store submission.** Publish this page at a public HTTPS URL and review it before using that URL in a store listing.

Codeclub Browser Control connects a Chromium-based browser to the Codeclub desktop app running on the same computer. It is activated by the user and communicates with Codeclub over a loopback connection (`127.0.0.1`).

## What the extension can access

The extension requests `debugger` for page inspection/input, `tabs` for tab discovery and management, `tabGroups` for group operations, and `alarms` for local reconnection wake-ups. Loopback host permissions allow its connection to Codeclub. When Codeclub asks it to inspect or operate a selected tab, it can read that tab's URL, title, visible page text, and interactive controls, and can perform requested navigation, clicks, typing, key presses, or scrolling. It can also create, activate, reorder, pin/mute, reload, close, group, and ungroup explicitly selected tabs and update group names, colors, and collapsed state. It omits password input values. It does not read cookies or browser storage.

The extension does not continuously collect page contents or send them to an extension vendor server. It keeps temporary tab snapshots in memory and removes them after use or expiry. Its network connection is restricted to the local Codeclub app.

## How page data is used

When you ask the Codeclub agent to work with a browser tab, the extension returns the requested page information to the Codeclub desktop app. The app may include that information in the AI request sent to the provider and model you selected, and it may retain the conversation and tool results in local Codeclub chat history. The selected AI provider's privacy and retention terms apply to that request.

## Control and removal

The extension works only while enabled and connected to Codeclub. You can disable or remove it from the browser's extension manager at any time. Browser permission prompts and browser-native confirmations remain under your control.

## Contact

For privacy questions, use the support contact published in the Codeclub browser-store listing.
