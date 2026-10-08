# Floating chat

The X hides the main window and shows a transparent, frameless Electron window
that stays above other windows and outside the taskbar. It shares the origin,
preload, and ChatInterface with the main window. When opened, it resumes the chat
selected in the IDE with its project explicitly set. Session state and controls
are shared between windows.

## Response surface

The widget displays only the agent's latest response, its activity, and pending
questions or permissions. User messages and earlier responses remain in history
and AI context but are not drawn in this surface. The IDE retains the full
conversation.

The widget has no attachment buttons or model selector. It uses the provider and
model selected in the IDE and still accepts files dropped onto the input.
Navigation icons use the same Lucide catalog and color as the app. The bell
replaces the chat button and opens the session that needs attention, prioritizing
permissions and questions, then errors or interrupted runs. It is disabled when
nothing is pending. External sessions open their link or the IDE. No status
label is displayed over the widget content.

In compact mode, the bell, X, and other buttons are hidden; only the drag handle
and input remain. Controls return when expanded. The vertical divider uses a
compact 14 px margin; hiding it removes that margin. Clicking the input expands
the widget even if the input retained focus while hidden.

The widget is 460 px wide. Focusing the input expands the window to 300 px;
Escape or the collapse button returns it to 92 px, including the black frame and
always-visible drag handle. The one-line input is 40 px high (38 px inside plus
border), with 6 px vertical padding. The 24 px orb sits on the left inside the
black `#161616` input. Conversation and draft persist while the window is
hidden. Home opens Codeclub; the tray also opens it and hides the widget. Exit
from the tray destroys both windows. The minimize button behavior is unchanged.

The tray menu includes Widget as an unchecked toggle beside Open and Exit.
Enabling it hides the main window; disabling it hides the widget. Opening
Codeclub disables Widget. The main window's X enables it again; the widget's X
hides it, and it can be reopened from the tray.

Drag from the orb or top handle. Electron constrains bounds to the monitor's
work area, anchors to the top or bottom edge based on the window center, and
keeps the edge anchored while height changes. Position and anchor are saved in
`floating-position.json`. Bounds are adjusted when monitors change or are
removed.

## Soft blue halo

The background effect is drawn in `src/components/floating-chat.css` on
`.floating-surface`, using a soft radial gradient over a dark base:

```css
background:
  radial-gradient(ellipse at 30% 110%, #2d5fd633, transparent 55%),
  #111315;
```

The ellipse is centered at 30% of the width and 110% of the height: its center
sits slightly below the panel and the halo enters through the bottom edge. Blue
fades gradually until transparent at 55% of the radius, producing the soft look
in the screenshot.

`#2D5FD6` is also the color passed to `FluidOrb` in `FloatingChat.tsx`. The
hexadecimal suffix `33` applies 20% opacity to the halo while preserving the
black background and chat legibility. The widget no longer shows the model
selector.

The `#202020` border, 22 px radius, and `overflow: hidden` clip the halo inside
the panel. The outer `0 4px 12px #0006` shadow belongs to `.floating-shell`. The
input keeps its separate `#161616` surface. Compact mode uses a solid `#080808`
background; the halo appears when expanded.

To adjust intensity, change only alpha `33`; to change its spread, adjust the
transparent stop `55%` and ellipse position. Keep RGB `2d5fd6` in sync with the
orb color.

## Events and bridge

- `codeclub:floating-drag`: invoked by the handle and orb with phase
  start/move/end and event screen coordinates. Electron verifies the sender,
  validates coordinates, and constrains movement to the monitor. Pointer capture
  preserves the gesture and releases at the end; the main process anchors and
  saves the position when finished.
- `codeclub:floating-resize`: preload invoke from FloatingChat with an expansion
  boolean. The main process verifies the sender WebContents.
- `codeclub:floating-open-main`: invoke from the Home button, no payload. Only
  the floating window may send it.
- `codeclub:floating-show`: sent by the main process when showing the widget,
  with no payload. FloatingChat invalidates its settings cache and updates the
  language. Its `useEffect` unsubscribes from preload on unmount.
- `codeclub:main-show`: sent by the main process when opening the main window,
  with no payload. HomePage refreshes settings and global chats, and unsubscribes
  on unmount.
- `codeclub:settings-changed`: HomePage and FloatingChat emit it without a
  payload when revealing a window. ChatInterface restores the provider/model and
  removes its listener in the same `useEffect`. HomePage also invalidates its
  cache on cross-window `storage` and propagates the shared language event.
- `codeclub:open-empty-chat`: existing event emitted by the floating + button.
  ChatInterface keeps its listener setup and cleanup in the same effect.

Chat retains its existing engine, visual model selection, attachments,
credentials, cancellation, tool approval, and persistence. It adds no second AI
implementation and stores no credentials in artifacts.

## Manual verification

Close with X; type from the compact bar; send with Enter; open the model
selector; collapse; drag the orb to both edges; reopen from Home and the tray;
check the global conversation and draft; switch languages; verify the main
project and terminal remain unchanged. A real response requires a valid
credential for the selected provider.

## Coordinated opening and closing

The X hides the widget without destroying its window or interrupting the agent.
The tray's Widget menu item shows it again. Opening Codeclub also hides the
widget.

Motion animates opacity and scale for 160 ms on opening and 140 ms on closing,
without bounce. Electron interpolates height for 160 ms while expanding or
collapsing and keeps the top or bottom edge anchored. With reduced motion,
transitions are immediate.

Electron emits `codeclub:floating-hide` with a numeric revision. FloatingChat
finishes its exit and confirms over IPC with `codeclub:floating-hidden(revision)`;
Electron hides the window only if that revision is still current. A 250 ms timer
allows it to close even if the renderer does not respond. Showing it again
invalidates the earlier close and restores mouse interaction. The X starts
`codeclub:floating-close`; the main process validates the sender. The
`codeclub:floating-show` event starts the entrance. Renderer listeners are
installed and removed in the same effect; Electron clears handlers and timers
when destroying the widget.
