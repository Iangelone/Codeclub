# Sidebar

The left panel contains project management, chat history, and app settings.

- File: `src/pages/index.astro` (`.left-panel`)
- Width: `264px`.
- Grid row: `2`, grid column: `1`.
- Background: `#161616`.
- Border top: `1px solid rgba(47, 47, 47, 1)`.
- Border right: `1px solid var(--color-surface-10, #2f2f2f)`.
- Box shadow: `12px 0 40px rgba(0, 0, 0, 0.25)`.
- Layout: `grid`, rows `auto 1fr auto`.
- Overflow: `hidden`.
- Z-index: `10`.

Hidden by default (`transform: translateX(-100%)`). Visible when `.is-open` is added (`transform: translateX(0)`). Transition: `transform 140ms ease`.

Body grid toggles between `grid-template-columns: 0 1fr` (hidden) and `264px 1fr` (visible) when `.has-sidebar` class is toggled on `<body>`.

## Panel Actions

Top section with workspace controls.

- Layout: `grid`, gap `4px`.
- Padding: `10px`.

### Sidebar Label

- Height: `24px`.
- Layout: `flex`, align center, gap `6px`.
- Color: `#9f9f9f`.
- Font size: `12px`.
- Icon: `LayoutDashboard`, size `14`.

### Action Buttons

- Min height: `34px`.
- Layout: `flex`, align center, gap `9px`.
- Radius: `7px`.
- Padding: `0 10px`.
- Font size: `12px`.
- Background: transparent.
- Color: `#d8d8d8`.
- Text align: `left`.
- Hover: `rgba(255, 255, 255, 0.02)`.

Buttons:

- `Nuevo chat` -> creates a new chat in the active project (inline SVG icon, size `15`).
- `Buscar` -> `Search` icon, size `15`.
- `Complementos` -> `Package` icon, size `15`.

## Projects Section

Middle scrollable area with project list.

- Padding: `10px`.
- Min height: `0`.

### Section Heading

- Height: `24px`.
- Layout: `flex`, align center, `space-between`.
- Color: `#9f9f9f`.
- Font size: `12px`.

Title: `Folder` icon (size `14`) + "Proyectos".

Action button (`FolderPlus`, size `14`):
- Width: `28px`, height: `28px`.
- Radius: `6px`.
- Opacity: `0` by default.
- Transition: `opacity 120ms ease`.
- Visible on `.section-heading:hover` or `:focus-visible`.

### Projects List

- Margin top: `4px`.
- Layout: `grid`, gap `4px`.

### Project Card

Container for each project and its chats.

- Layout: `grid`, gap `3px`.
- `.is-active`: expands to show chat rows.

### Project Row

Clickable button that toggles the project card.

- Min height: `34px`.
- Layout: `flex`, align center, gap `9px`.
- Radius: `7px`.
- Padding: `0 10px`.
- Font size: `12px`.
- Background: transparent.
- Color: `#d8d8d8`.
- Icon: folder SVG (size `15`).
- Hover: `rgba(255, 255, 255, 0.02)` (when not `.is-active`).
- Active (`.is-active` on parent): background `#1c1c1c`, color `#eeeeee`.
- Focus-visible: background `var(--color-surface-7, #202020)`.
- Double-click: triggers inline rename (shows `.project-input`).

### Project Input

Inline rename input shown on double-click.

- Height: `22px`.
- Background: transparent.
- Color: `#d8d8d8`.
- Caret color: `#d8d8d8`.
- Font: inherit, size `12px`.
- Border: none, outline: none.
- Placeholder color: `#8f8f8f`.

### New Chat Button

Hidden plus button revealed on project row hover.

- Width: `24px`, height: `24px`.
- Opacity: `0`.
- Transition: `all 120ms ease`.
- Color: `#9f9f9f`.
- Radius: `4px`.
- Visible on `.project-row:hover`.
- Hover: background `rgba(255, 255, 255, 0.1)`, color `#eeeeee`.
- Icon: `Plus` SVG (size `14`).

### Chat Row

Individual chat entry shown when project is active.

- Margin left: `12px`.
- Color: `rgba(216, 216, 216, 0.62)`.
- Opacity: `0.72`.
- Display: `none` by default, `flex` when parent has `.is-active`.
- Min height: `34px`.
- Layout: `flex`, align center, gap `9px`.
- Radius: `7px`.
- Padding: `0 10px`.
- Font size: `12px`.
- Icon: chat SVG (size `14`).
- Active (`.is-active`): background `rgba(255, 255, 255, 0.05)`, color `#eeeeee`.
- Hover: `rgba(255, 255, 255, 0.02)` (when not `.is-active`).
- Focus-visible: background `var(--color-surface-7, #202020)`.

First chat row is always "Crear chat" (new chat button). Subsequent rows are `.chat-item` with `.chat-title`.

## Sidebar Footer

Bottom section with settings and app controls.

- Padding: `10px`.
- Layout: `grid`, gap `4px`.
- Border top: `1px solid var(--color-surface-9, #2c2c2c)`.

Buttons follow the same styling as panel action buttons.

- `Ajustes` -> `Settings` icon, size `15`.
