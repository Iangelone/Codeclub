# Layout

## Body Grid

The app shell uses a CSS grid on `<body>`.

```css
body {
  display: grid;
  grid-template-rows: 36px 1fr;
  grid-template-columns: 0 1fr;
  transition: grid-template-columns 140ms ease;
}
body.has-sidebar {
  grid-template-columns: 264px 1fr;
}
```

- Row 1: topbar (`36px`).
- Row 2: content area (sidebar + workspace).
- Column 1: sidebar (`0` when hidden, `264px` when visible).
- Column 2: workspace (`1fr`).
- Min width: `320px`.
- Min height: `100vh`.
- Overflow: `hidden`.

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

## Sidebar

```css
.left-panel {
  grid-row: 2;
  grid-column: 1;
  display: grid;
  grid-template-rows: auto 1fr auto;
}
```

- Row 1: `auto` (panel-actions).
- Row 2: `1fr` (projects-section).
- Row 3: `auto` (sidebar-footer).

Hidden via `transform: translateX(-100%)` with `transition: transform 140ms ease`. Visible when `.is-open` (`transform: translateX(0)`).

## Workspace

```css
.workspace {
  grid-row: 2;
  grid-column: 2;
}
```

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
