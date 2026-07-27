# Sidebar

The left panel (`Sidebar.tsx`) contains project management, chat history, file tree, and app settings. The right panel (`RightSidebar.tsx`) contains the file browser, git review, built-in browser, artifacts, and WhatsApp.

## Left Sidebar (Sidebar.tsx)

- File: `src/components/Sidebar.tsx` (React island, rendered via `client:load`)
- Width: `264px`.
- Grid row: `2`, grid column: `1`.
- Background: `#161616`.
- Border top: `1px solid rgba(47, 47, 47, 1)`.
- Border right: `1px solid var(--color-surface-10, #2f2f2f)`.
- Box shadow: `12px 0 40px rgba(0, 0, 0, 0.25)`.
- Layout: `grid`, rows `auto 1fr auto`.
- Overflow: `hidden`.
- Z-index: `10`.

Hidden by default (`transform: translateX(-100%)`). Visible when `.has-sidebar` is added to `<body>`. Transition: `transform 140ms ease`.

### Navigation Sections

The sidebar has four main sections:
- **Chat**: global chat list and chat creation
- **Projects**: project list with expanded chat artifacts, file structure
- **Business**: business workspace access
- **Extensions**: plugin/complement listing

### Panel Actions

Top section with workspace controls.

- Layout: `grid`, gap `4px`.
- Padding: `10px`.

#### Sidebar Label

- Height: `24px`.
- Layout: `flex`, align center, gap `6px`.
- Color: `#9f9f9f`.
- Font size: `12px`.
- Icon: `LayoutDashboard`, size `14`.

#### Action Buttons

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
- `Nuevo chat` -> creates a new chat in the active project.
- `Buscar` -> search projects and chats.
- `Complementos` -> manage extensions.

### Projects Section

Middle scrollable area with project list and file tree.

- Padding: `10px`.
- Min height: `0`.

#### Section Heading

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

#### File Tree Explorer

When a project is expanded, its file structure is shown recursively:

- **File icons**: language-specific icons with colors (JS=yellow, TS=blue, Python=blue/green, JSON=orange, etc.).
- **Expand/collapse**: folder entries toggle on click.
- **Context menu**: right-click for create file/folder, rename, delete.
- **Drag-and-drop**: files and folders are draggable (`application/codeclub-file`).

#### Project CRUD

- **Create**: folder picker via `@tauri-apps/plugin-dialog`. Indexes the selected folder.
- **Rename**: double-click a project row for inline rename (shows `.project-input`).
- **Delete**: removes from project index (filesystem untouched).

#### Chat CRUD

- **Create**: plus button on project hover or "Nuevo chat" action.
- **Rename**: inline rename via portal overlay.
- **Delete**: context menu action with confirmation dialog.
- **Clear all**: removes all chats from a project.

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
- Agent activity indicator: shows when agent is working on this project.

### Project Input

Inline rename input shown on double-click.

- Height: `22px`.
- Background: transparent.
- Color: `#d8d8d8`.
- Caret color: `#d8d8d8`.
- Font: inherit, size `12px`.
- Border: none, outline: none.
- Placeholder color: `#8f8f8f`.

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
- Draggable: `application/codeclub-sidebar-item`.

### Context Menus

Portal-based menus triggered by right-click or mouse events:

- **Project menu**: rename, delete, open in explorer.
- **Artifact menu**: rename, delete, move to project.
- **Structure entry menu**: create file, create folder, rename, delete.

Menus auto-close on `Escape` or click outside.

### Sidebar Footer

Bottom section with settings and app controls.

- Padding: `10px`.
- Layout: `grid`, gap `4px`.
- Border top: `1px solid var(--color-surface-9, #2c2c2c)`.

Buttons follow the same styling as panel action buttons.

- `Ajustes` -> opens `SettingsModal` (Settings icon, size `15`).

## Right Sidebar (RightSidebar.tsx)

The right panel is a tab-based resizable sidebar containing additional views.

- File: `src/components/RightSidebar.tsx` (React island, `client:load`)
- Width: controlled by `--right-panel-width` CSS custom property (default `35vw`).
- Resizable: left-edge drag to resize.
- Tab system: add/remove/switch tabs via context menu and tab bar.

### Tab Views

| Tab | Description |
|---|---|
| **Files** | File tree explorer with search, expand/collapse, and content preview. Language-specific icons with colors. |
| **Review** | Git diff viewer: parses `git status` and `git diff` output. Shows changed files with add/remove counts. |
| **Browser** | Embedded Tauri WebView with URL bar, back/forward, inspector mode. DOM element selection with overlay highlighting. |
| **Artifacts** | Displays plans, TODOs, and quotes from agent state. Supports double-click removal and right-click referencing to chat. |
| **WhatsApp** | Terminal-style log viewer or legacy chat UI with QR auth, chat list, and message display. |

### Browser Panel

- Tauri `Webview` embedded in the panel.
- Controls: URL input, back/forward buttons, inspector toggle.
- **DOM Inspector**: injects script for element selection. Selected elements highlighted with overlay. Selection data sent to chat via `codeclub:browser-reference` event.
- Auto-navigates via `codeclub:browser-navigate` event.

### Artifacts Panel

- Reads `agent-state.json` project artifacts.
- Displays: active plan with steps, TODO items with status, business quotes.
- Status icons: pending (gray), in_progress (blue), completed (green), blocked (red).
- Double-click: removes artifact with confirmation.
- Right-click "Referenciar en chat": sends `codeclub:artifact-reference` to chat input.
- Auto-refreshes via `codeclub:artifacts-changed` events.

### WhatsApp Panel

Two view modes:
- **Terminal view** (`WhatsAppTerminalView`): log-style display of WhatsApp events.
- **Legacy view** (`LegacyWhatsAppView`): full chat UI with QR code login, chat list, and message display.

Listens to `codeclub:whatsapp-event` Tauri events with states: `qr`, `ready`, `chats`, `message`, `error`, `disconnected`.
