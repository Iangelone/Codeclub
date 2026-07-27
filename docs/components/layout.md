# Layout

## Body Grid

The app shell uses a CSS grid on `<body>`. It supports a dynamic three-column layout with a topbar.

```css
body {
  display: grid;
  grid-template-rows: 36px minmax(0, 1fr);
  grid-template-columns: 0 minmax(0, 1fr) 0;
  transition: grid-template-columns 140ms ease;
}
body.has-sidebar {
  grid-template-columns: 264px minmax(0, 1fr) 0;
}
body.has-sidebar.has-right-panel {
  grid-template-columns: var(--left-panel-width, 264px) minmax(0, 1fr) var(--right-panel-width, 35vw);
}
```

- Row 1: topbar (`36px`).
- Row 2: content area (left panel + workspace + right panel).
- Column 1: left sidebar (`0` hidden, `264px` visible, resizable via `--left-panel-width`).
- Column 2: workspace (`minmax(0, 1fr)` — flexible center).
- Column 3: right panel (`0` hidden, resizable via `--right-panel-width`).

### Panel System

Three panel states controlled by CSS classes:

| State | Body classes | Left col | Right col |
|---|---|---|---|
| No sidebars | (none) | `0` | `0` |
| Left only | `.has-sidebar` | `264px` | `0` |
| Both panels | `.has-sidebar` `.has-right-panel` | `var(--left-panel-width)` | `var(--right-panel-width)` |

## Body Background Layer

```css
body::before {
  content: "";
  position: fixed;
  inset: 36px 0 0;
  background: var(--color-bg, #111111);
  z-index: -1;
}
```

Creates the main surface below the topbar.

## Topbar Grid

```css
.topbar {
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: auto 1fr 138px;
}
```

- Left: `auto` (tools + menus).
- Center: `1fr` (drag region).
- Right: `138px` (window controls).

## Left Sidebar (`.left-panel`)

```css
.left-panel {
  grid-row: 2;
  grid-column: 1;
  display: grid;
  grid-template-rows: auto 1fr auto;
}
```

- Row 1: `auto` (panel-actions — new chat, search, extensions).
- Row 2: `1fr` (projects-section — project list, file tree).
- Row 3: `auto` (sidebar-footer — settings).

Hidden via `transform: translateX(-100%)` with `transition: transform 140ms ease`. Visible when `.is-open` (`transform: translateX(0)`).

## Workspace

```css
.workspace {
  grid-row: 2;
  grid-column: 2;
}
```

The workspace contains:
- **ChatPanel**: main chat interface (centered, max 600px wide).
- **CodeMirror**: code editor for viewing files.
- **File browser views**: project folders, tabbed view, diff view.
- **Markdown/HTML previews**: rendered file content.

## Right Panel (`.right-panel`)

```css
.right-panel {
  grid-row: 2;
  grid-column: 3;
}
```

Resizable panel (drag left edge). Contains tabbed views:
- **FilesView**: file tree with search and content preview.
- **ReviewView**: git diff and code review.
- **Browser**: embedded Tauri WebView with URL bar and DOM inspector.
- **Artifacts**: plans, TODOs, and quotes from agent state.
- **WhatsApp**: bridge viewer (terminal or legacy chat UI).

Width controlled by `--right-panel-width` CSS custom property. Defaults to `35vw`. Resize via `mousedown` on left edge drag handle.

## Terminal Dock

Floating panel overlaid on the workspace, not part of the grid.

- Position: `fixed` with top/bottom/left offsets.
- Drag handle: tab bar (mousedown to reposition).
- Resize handle: bottom edge (180px min, 80% viewport height max).
- Contains `xterm.js` terminal emulator with multiple tabs.
- Z-index above workspace content.

## Chat Panel

```css
.chat-panel {
  display: grid;
  place-items: center;
}
```

## Spacing

| Value | Usage |
|---|---|
| `10px` | Panel padding (panel-actions, projects-section, sidebar-footer). |
| `4px` | Gap between panel action buttons, projects list items. |
| `3px` | Gap between dropdown items, gap inside project card. |
| `2px` | Gap between app menu items. |
| `6px` | Topbar left padding. |
| `12px` | Chat row left margin (indentation). |
| `1rem` | Gap between messages, messages area padding bottom. |
