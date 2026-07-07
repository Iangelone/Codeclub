# Topbar

The topbar is the only visible app chrome for the empty shell. It spans the full width across both grid columns.

- File: `src/pages/index.astro`
- Height: `36px`.
- Layout: `grid`, columns `auto 1fr 138px`.
- Grid column: `1 / -1`.
- Background: `rgba(17, 17, 17, 0.48)`.
- Bottom border: `1px solid rgba(47, 47, 47, 1)`.
- Text/icon color: `#d8d8d8`.
- User selection: disabled.

Windows uses the same topbar color over the native Tauri Mica effect. Linux and macOS keep a plain dark fallback (`background: var(--color-bg)` when `backdrop-filter` is unsupported). `.is-windows` class is set via script on `html`.

## Topbar Left

Flex container for tools and menus.

- Layout: `flex`, align center.
- Height: `100%`.
- Padding left: `6px`.

### Tool Buttons

Left-side navigation buttons using Lucide icons.

- Button size: `30px` wide, `28px` high.
- Radius: `6px`.
- Background: transparent.
- Hover: `var(--color-surface-7, #202020)`.
- Icon color: `#d8d8d8`.
- Display: `grid`, `place-items: center`.

Icons:

- Sidebar toggle: `PanelLeft`, size `15`, stroke `1.8`.
- Back: `ArrowLeft`, size `15`, stroke `1.8`.
- Forward: `ArrowRight`, size `15`, stroke `1.8`.

### App Menus

Menu labels sit beside the tool buttons.

- Container: `flex`, gap `2px`, margin-left `4px`.
- Height: `100%`.
- Position: `relative`.

Labels: `Archivo`, `Editar`, `Ver`, `Ayuda`.

- Button height: `28px`.
- Horizontal padding: `0 9px`.
- Font size: `12px`.
- Border: none.
- Radius: `6px`.
- Text color: `#d8d8d8`.
- Hover background: `var(--color-surface-7, #202020)`.

Dropdown menus open on hover (see [dropdown.md](dropdown.md)).

### Drag Area

Center area between tools and window controls.

- `data-tauri-drag-region` attribute.
- Double-click toggles maximize via Tauri API.
- No visual styling.

## Window Controls

Right-side native-style window control buttons.

- Container width: `138px`.
- Layout: `grid`, three columns of `46px`.
- Button size: `46px` wide, `36px` high.
- Button alignment: `grid`, `place-items: center`.
- Button background: transparent.
- Button color: `#d8d8d8`.
- SVG display: `block`.
- Hover background: `var(--color-surface-7, #202020)`.
- Close hover background: `#c42b1c`.
- Close hover color: `#ffffff`.

Icons:

- Minimize: `Minus`, size `14`, stroke `1.8`.
- Maximize: `Square`, size `12`, stroke `1.8`.
- Close: `X`, size `14`, stroke `1.8`.
