# Browser DOM style editor

The picker captures the actual selected node, page URL, unique CSS path, tag, sanitized HTML, original leaf text, and computed CSS values. The pencil opens the compact `BrowserStyleEditor`. Valid field edits preview on that node after a 60 ms debounce. Invalid CSS is excluded from preview and blocks confirmation. Cancel restores the original inline style and original text nodes. Multiple edits to one node are layered in creation order; removing an earlier reference preserves later edits.

Confirm adds the exact property/text changes (`before` and `after`) to the chat composer and keeps the preview. Sending retires composer markers while keeping accepted previews. Removing a reference restores its preview layer. Navigation, deleted/replaced nodes, or browser unmount invalidate selections and restore previews. Project files still require the agent to apply the attached instructions.

Markers live in a fixed shadow-root overlay isolated from page styles. An animation frame loop follows visible nodes through layout changes, sidebar resizing, and nested scrolling; clipped/offscreen nodes hide their markers. Multiple markers on one element are spaced apart. The loop stops when all markers are retired. The renderer polls every 250 ms to synchronize removal and popup anchors, including retired previews after same-document navigation. The orb palette updates picker outlines, marker backgrounds, and chat reference badges.

## Events

All listeners are installed and removed in the same React effect. Guest listeners and animation frames are removed on disposal/pagehide.

| Event | Emitter | Detail | Consumer |
| --- | --- | --- | --- |
| `codeclub:browser-reference` | `BrowserPanel` | `{ title, text, url, markerId }`; style text includes description, selector, exact diff, original HTML | `ChatInterface` adds the attachment |
| `codeclub:remove-browser-marker` | `ChatInterface` when deleting an attachment | `{ markerId }` | `BrowserPanel` removes marker and preview layer |
| `codeclub:remove-browser-reference` | `BrowserPanel` after guest removal/invalidation | `{ markerId }` | `ChatInterface` removes the attachment |
| `codeclub:browser-reference-order` | `ChatInterface` on attachment changes or request | `{ total, items: [{ markerId, number }] }` | `BrowserPanel` synchronizes composer numbering |
| `codeclub:browser-reference-order-request` | `BrowserPanel` after attaching listeners | none | `ChatInterface` republishes order |

Text replacement is available only for leaf HTML elements, to preserve nested elements. CSS values are editable as strings (including rgba transparency and CSS units); numeric dimension inputs default to pixels. Computed values describe the selected page at capture time, not necessarily literal declarations in project source.

Run `node scripts/test-browser-dom-picker.mjs` for headless Edge coverage of the runtime and real React editor: preview, rollback, overlapping edits, resize, scroll, theme, numbering, replaced nodes, navigation, validation, language, exact payload, and cleanup.
