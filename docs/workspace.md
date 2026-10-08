# Terminal and browser
## Terminals

The visual terminal uses @xterm/xterm. Electron creates a real PTY with node-pty and keeps the native session alive.

    xterm -> onData -> IPC -> node-pty
    node-pty -> output -> IPC -> xterm

Electron emits `codeclub:terminal-output` with `{ id }` after buffering PTY output. The preload exposes `onTerminalOutput`; TerminalPanel subscribes and requests an incremental snapshot immediately instead of polling every 120 ms. Concurrent notifications coalesce into a follow-up snapshot. Hidden panels catch up when shown, and the session effect removes its IPC listener on cleanup. Snapshots and offsets remain available to agent tools.

Terminal tabs start as `PowerShell` and use the latest submitted command echoed after a standard PowerShell prompt. TerminalPanel emits `codeclub:terminal-tab-meta` with `{ instanceId, title }` after xterm parses output, joining wrapped lines and limiting the title to 120 characters. WorkspaceLayout updates only the matching tab and removes its listener in the same effect. Unsubmitted input does not change the title or trigger React updates per keystroke. The tab truncates visually and exposes the full label in its tooltip.

It includes PowerShell in the project directory, keyboard input, history, arrows and Ctrl+C, ANSI output, scrolling, visual fitting with @xterm/addon-fit, and cleanup when a tab closes.

## Browser

BrowserPanel uses an Electron webview. Its toolbar provides back and forward, reload and home, an address bar, element selection, and a menu to open outside Codeclub.

## DOM selection and comments

1. Activate Select.
2. Click a visible element.
3. Write an optional comment.
4. Confirm with Enter.
5. The page receives a numbered bubble.
6. The card appears as a chat reference.

The reference contains sanitized HTML, visible text, URL, and comment. It must not send page credentials or secrets.

## Computer Use and security

The browser publishes observable state such as URL, title, text, and visible controls. Actions use selectors generated from that state. ERR_ABORTED (-3) is a normal cancellation when one navigation replaces another.

Tool snapshots include control values, checkbox/radio `checked` state and select `options` (value, label, disabled, selected). Password values are omitted. Select actions use `type` with an observed option value or label and report failure for unavailable options. Each snapshot regenerates selectors: observe again after acting. `key` currently dispatches DOM keyboard events; native default keyboard behavior is not guaranteed. Use `type` for selects and `click` to activate controls. Electron also exposes native input events, which require focus; see [WebView input](https://www.electronjs.org/docs/latest/api/webview-tag#webviewsendinputeventevent).

| Event | Emitter → consumer | Detail and cleanup |
| --- | --- | --- |
| `codeclub:browser-state-request` | `getBrowserState` → BrowserPanel | No payload; BrowserPanel observes the active WebView. Its effect removes the listener on unmount. |
| `codeclub:browser-state` | BrowserPanel → `getBrowserState` | `ok`, URL, title, text, snapshotId and elements, or failure. The tool removes its one-shot listener/timer on result or timeout. |
| `codeclub:browser-action` | `browserAction` → BrowserPanel | type, selector, text/key/amount; the effect removes the listener on unmount. |
| `codeclub:browser-action-result` | BrowserPanel → `browserAction` | `ok`, result/value or error, and fresh `state` for verification and subsequent actions. The tool removes its one-shot listener/timer on result or timeout. |

The agent terminal tool normalizes newlines to CR so Windows PTYs actually submit the command. Interactive xterm input remains native. `runCommand` uses an isolated, finite PTY and reports nonzero exits as `ok: false`; Windows launchers run with literal arguments through PowerShell. Its output combines stdout/stderr in `stdout` and strips terminal controls. Persistent servers/watchers must use `terminal`.

Do not execute arbitrary JavaScript from the renderer, expose API keys or cookies in chat, or skip focus, label, and listener cleanup.
