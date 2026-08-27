# Terminal and browser
## Terminals

The visual terminal uses @xterm/xterm. Electron creates a real PTY with node-pty and keeps the native session alive.

    xterm -> onData -> IPC -> node-pty
    node-pty -> output -> IPC -> xterm

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

Do not execute arbitrary JavaScript from the renderer, expose API keys or cookies in chat, or skip focus, label, and listener cleanup.
